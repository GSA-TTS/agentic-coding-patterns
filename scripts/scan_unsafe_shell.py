#!/usr/bin/env python3
"""Scan shell scripts and Markdown shell code-blocks for unsafe patterns.

Enforces the prohibited list in docs/clean-script-standard.md (issue #154).

Scope (hybrid, per consensus scan-4d7c):
  * Real shell files (``*.sh``, ``*.bash``, files named ``verify`` with a shell
    shebang) are FULLY scanned — a prohibited pattern in runnable code is a
    violation, no allowlist.
  * Markdown files are scanned only inside fenced ``bash`` / ``sh`` code blocks
    (never prose). A finding in a fenced block is suppressed only when the
    offending line carries an explicit marker comment ``# anti-pattern`` (an
    optional rule id may follow, e.g. ``# anti-pattern: USH001``), or the block's
    info string is ``bash anti-pattern`` / ``sh anti-pattern``.

Only ``bash`` / ``sh`` contexts are scanned, so ``eval`` in a ``python`` or
``js`` block never matches (avoids cross-language false positives).

Severity tiers:
  * ``error``  — fails CI (non-zero exit).
  * ``warn``   — reported, does not fail CI (unless --strict).

Output is machine-readable: ``path:line: [RULE severity] message``.

stdlib only.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Rule:
    """A single unsafe-shell rule."""

    rule_id: str
    severity: str  # "error" | "warn"
    pattern: re.Pattern[str]
    message: str


# Each pattern is matched against a single logical shell line. Patterns are kept
# high-precision to keep false positives at zero on legitimate scripts.
RULES: list[Rule] = [
    Rule(
        "USH001",
        "error",
        re.compile(r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b"),
        "pipe-to-shell: downloading and piping a remote script to a shell executes unreviewed code",
    ),
    Rule(
        "USH002",
        "error",
        re.compile(r"(?:ba)?sh\s+-c\s+[\"']?\$\((?:curl|wget)\b"),
        "shell -c on remote fetch: executes unreviewed remote code",
    ),
    Rule(
        "USH003",
        "error",
        # eval on a variable/command-substitution (untrusted input). NOTE: we do
        # NOT flag `sh -c "$var"` / `exec cmd` wrappers here — those are common,
        # safe local helpers; USH001/USH002 cover the remote-fetch exec cases.
        re.compile(r"\beval\s+[\"']?\$[({]?[A-Za-z_@*]"),
        "eval on variable or command substitution: arbitrary code execution / injection risk",
    ),
    Rule(
        "USH004",
        "error",
        # Unguarded rm -rf: root, glob, home (~ or $HOME), or a BARE unbraced
        # variable. A quoted "$var", a ${var:?}-guarded path, or a var with a
        # fixed suffix (e.g. "$dir/sub") is NOT flagged — those are controlled.
        re.compile(
            r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\b\s+"
            r"(?:/(?:\s|$)|-rf\s|\*|~(?:/|\s|$)|\$HOME\b|\$[A-Za-z_][A-Za-z0-9_]*(?:\s|$))"
        ),
        "unguarded rm -rf: deletes root/glob/home/bare-unchecked variable; guard with ${var:?} and quote it",
    ),
    Rule(
        "USH005",
        "error",
        re.compile(r"\bchmod\s+(?:-[a-zA-Z]+\s+)*777\b"),
        "chmod 777: world-writable/executable; grant the minimum needed",
    ),
    Rule(
        "USH006",
        "error",
        # env/printenv/export -p redirected or piped somewhere (a dump), NOT
        # `env FOO=bar cmd` prefix usage.
        re.compile(r"\b(?:printenv|export\s+-p|env)\b\s*(?:\||>|>>|\d?>&?)"),
        "environment dump: piping/redirecting env output can surface injected secrets outside the boundary",
    ),
    Rule(
        "USH007",
        "error",
        # Reads of host credential/dotfile locations.
        re.compile(
            r"(?:cat|less|more|head|tail|cp|rsync|scp|source|\.)\s+[^\n]*"
            r"(?:~/\.ssh/|~/\.aws/|~/\.config/gcloud/|~/\.kube/|/\.git-credentials|\.netrc|\.vault-token)"
        ),
        "host credential/dotfile read: reading SSH/cloud/kube credentials is a credential-exposure surface",
    ),
    Rule(
        "USH008",
        "error",
        re.compile(r">\s*/dev/tcp/"),
        "/dev/tcp exfiltration channel: writing to a raw TCP socket opens an unbounded outbound channel",
    ),
    Rule(
        "USH009",
        "error",
        re.compile(r"\bnc\b\s+[^\n]*\s-e\b"),
        "netcat -e: spawns a shell over the network (reverse/bind shell)",
    ),
    # High-signal hardcoded secrets (kept narrow; full scanning is gitleaks' job).
    Rule(
        "USH010",
        "error",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        "hardcoded AWS access key id",
    ),
    Rule(
        "USH011",
        "error",
        re.compile(r"\bghp_[A-Za-z0-9]{36}\b"),
        "hardcoded GitHub personal access token",
    ),
    Rule(
        "USH012",
        "error",
        re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----"),
        "hardcoded private key material",
    ),
    # Warn tier — legitimate scoped uses exist.
    Rule(
        "USH050",
        "warn",
        re.compile(r"\bset\s+\+e\b"),
        "set +e disables error-exit; scope it narrowly (set +e; cmd; rc=$?; set -e) and justify",
    ),
]

MARKER_RE = re.compile(r"#\s*anti-pattern\b(?:\s*:\s*(?P<ids>[A-Z0-9, ]+))?", re.IGNORECASE)
FENCE_RE = re.compile(r"^(?P<indent>\s*)(?P<ticks>`{3,}|~{3,})(?P<info>[^\n]*)$")
SHELL_LANGS = {"bash", "sh", "shell", "shellscript", "zsh"}
SHELL_EXTS = {".sh", ".bash", ".zsh"}


@dataclass
class Finding:
    path: str
    line: int
    rule_id: str
    severity: str
    message: str

    def format(self) -> str:
        return f"{self.path}:{self.line}: [{self.rule_id} {self.severity}] {self.message}"


def _line_suppressed(line: str, rule_id: str) -> bool:
    """True if the line carries a ``# anti-pattern`` marker covering this rule."""
    m = MARKER_RE.search(line)
    if not m:
        return False
    ids = m.group("ids")
    if not ids:
        return True  # bare marker suppresses any rule on this line
    wanted = {tok.strip().upper() for tok in ids.split(",") if tok.strip()}
    return rule_id in wanted


def _scan_line(line: str, path: str, lineno: int, block_suppressed: bool) -> list[Finding]:
    findings: list[Finding] = []
    for rule in RULES:
        if rule.pattern.search(line):
            if block_suppressed or _line_suppressed(line, rule.rule_id):
                continue
            findings.append(Finding(path, lineno, rule.rule_id, rule.severity, rule.message))
    return findings


def scan_shell_file(path: Path) -> list[Finding]:
    """Fully scan a runnable shell file (no block-level allowlist; line markers still honored)."""
    findings: list[Finding] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:  # fail-closed: report unreadable file
        return [Finding(str(path), 0, "USH000", "error", f"could not read file: {exc}")]
    for i, line in enumerate(text.splitlines(), start=1):
        findings.extend(_scan_line(line, str(path), i, block_suppressed=False))
    return findings


def scan_markdown_file(path: Path) -> list[Finding]:
    """Scan only fenced bash/sh code blocks in a Markdown file."""
    findings: list[Finding] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return [Finding(str(path), 0, "USH000", "error", f"could not read file: {exc}")]

    in_block = False
    fence = ""
    block_is_shell = False
    block_suppressed = False
    for i, line in enumerate(lines, start=1):
        if not in_block:
            m = FENCE_RE.match(line)
            if m:
                in_block = True
                fence = m.group("ticks")[0] * len(m.group("ticks"))
                info = m.group("info").strip().lower()
                first = info.split()[0] if info else ""
                block_is_shell = first in SHELL_LANGS
                # info-string marker, e.g. ```bash anti-pattern
                block_suppressed = "anti-pattern" in info
            continue
        # inside a block
        stripped = line.strip()
        if stripped.startswith(fence) and set(stripped) <= {fence[0]}:
            in_block = False
            block_is_shell = False
            block_suppressed = False
            continue
        if block_is_shell:
            findings.extend(_scan_line(line, str(path), i, block_suppressed))
    return findings


def _has_shell_shebang(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            first = fh.readline()
    except OSError:
        return False
    return first.startswith("#!") and ("sh" in first)


def iter_target_files(root: Path) -> tuple[list[Path], list[Path]]:
    """Return (shell_files, markdown_files) to scan, skipping VCS/vendor noise."""
    shell_files: list[Path] = []
    md_files: list[Path] = []
    skip_dirs = {".git", "node_modules", ".venv", "venv", "__pycache__"}
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if any(part in skip_dirs for part in p.parts):
            continue
        if p.suffix in SHELL_EXTS or (p.suffix == "" and _has_shell_shebang(p)):
            shell_files.append(p)
        elif p.suffix in {".md", ".markdown"}:
            md_files.append(p)
    return shell_files, md_files


def scan_repo(root: Path) -> list[Finding]:
    shell_files, md_files = iter_target_files(root)
    findings: list[Finding] = []
    for f in shell_files:
        findings.extend(scan_shell_file(f))
    for f in md_files:
        findings.extend(scan_markdown_file(f))
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan for unsafe shell patterns (issue #154).")
    parser.add_argument("paths", nargs="*", default=None, help="Files or dirs to scan (default: cwd).")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as errors.")
    args = parser.parse_args(argv)

    targets = [Path(p) for p in args.paths] if args.paths else [Path.cwd()]
    findings: list[Finding] = []
    for t in targets:
        if t.is_dir():
            findings.extend(scan_repo(t))
        elif t.suffix in {".md", ".markdown"}:
            findings.extend(scan_markdown_file(t))
        else:
            findings.extend(scan_shell_file(t))

    errors = [f for f in findings if f.severity == "error"]
    warns = [f for f in findings if f.severity == "warn"]

    for f in sorted(findings, key=lambda x: (x.path, x.line)):
        print(f.format())

    print(
        f"\nunsafe-shell scan: {len(errors)} error(s), {len(warns)} warning(s)",
        file=sys.stderr,
    )
    if errors or (args.strict and warns):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
