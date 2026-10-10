"""Kits deliver `~/.rc.d` drop-ins; acq wires the bash loop.

acq writes `~/.profile` so every bash login shell sources `~/.rc.d/*.sh`, and
that profile also sources `~/.bashrc`. A kit command that adds its own loop to
a bash startup file therefore makes every drop-in run twice. The first test
keeps any such command out of the repo's kits and templates.

The personal-kit template still carries a commented zsh step (acq's loop runs
only in bash) that skips when `~/.zshrc` already names `~/.rc.d`. Its
`grep -E` pattern passes through YAML and shell quoting, and an over-escaped
version (`\\\\.rc\\\\.d`, which looks for literal backslashes) once silently
stopped matching any real loop, so the remaining tests run it through the real
`grep -E`.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
KITS = ROOT / "integrations" / "isolation" / "acq-kits"
SPECS = sorted(KITS.glob("*/spec.yaml")) + sorted(KITS.glob("examples/*/spec.yaml"))
PERSONAL_SPEC = KITS / "examples" / "personal-kit" / "spec.yaml"
BASH_STARTUP_FILES = (".bashrc", ".bash_profile", ".bash_login", ".profile")

# Each `grep -Eqs '<pattern>'` in the spec that looks for `.rc.d`, commented
# examples included (the zsh step ships commented out).
PATTERNS = [p for p in re.findall(r"grep -Eqs '([^']*)'", PERSONAL_SPEC.read_text()) if "rc" in p]

LOOP_LINES = [
    'for f in "$HOME"/.rc.d/*.sh(N); do . "$f"; done',
    'case $- in *i*) for f in "$HOME"/.rc.d/*.sh; do [ -r "$f" ] && . "$f"; done ;; esac',
]
NON_LOOP_LINES = [
    "# ~/.rc.d drop-ins (personal kit)",
    "export PATH=/usr/local/bin:$PATH",
    # Only matches if the dots are unescaped wildcards.
    "alias arcbd=true",
]


def _command_text(command) -> str:
    return " ".join(command) if isinstance(command, list) else str(command)


@pytest.mark.parametrize("spec", SPECS, ids=lambda p: str(p.parent.relative_to(KITS)))
def test_no_kit_wires_rc_d_into_bash(spec):
    commands = (yaml.safe_load(spec.read_text()) or {}).get("commands") or []
    for cmd in commands:
        text = _command_text(cmd.get("command", ""))
        if ".rc.d" in text:
            hit = [f for f in BASH_STARTUP_FILES if f in text]
            assert not hit, f"{cmd.get('description')!r} wires ~/.rc.d into {hit}; acq's ~/.profile already does"


def test_specs_found():
    assert PERSONAL_SPEC in SPECS
    assert len(SPECS) > 2


def _matches(pattern: str, line: str, tmp_path: Path) -> bool:
    rc = tmp_path / "rc"
    rc.write_text(line + "\n")
    return subprocess.run(["grep", "-Eqs", pattern, str(rc)], check=False).returncode == 0


def test_spec_carries_the_zsh_pattern():
    assert len(PATTERNS) == 1, PATTERNS


@pytest.mark.skipif(shutil.which("grep") is None, reason="grep not available")
@pytest.mark.parametrize("pattern", PATTERNS)
@pytest.mark.parametrize("line", LOOP_LINES)
def test_pattern_matches_a_wired_loop(pattern, line, tmp_path):
    assert _matches(pattern, line, tmp_path)


@pytest.mark.skipif(shutil.which("grep") is None, reason="grep not available")
@pytest.mark.parametrize("pattern", PATTERNS)
@pytest.mark.parametrize("line", NON_LOOP_LINES)
def test_pattern_ignores_comments_and_lookalikes(pattern, line, tmp_path):
    assert not _matches(pattern, line, tmp_path)
