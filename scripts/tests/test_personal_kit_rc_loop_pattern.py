"""Regression test for the personal-kit template's `~/.rc.d` loop detection.

The personal-kit startup step (and its commented zsh twin) skips wiring the
`~/.rc.d` loop when any non-comment line in the rc file already names
`~/.rc.d`, so drop-ins are never sourced twice. The check is a `grep -E`
pattern that passes through YAML and shell quoting, and an over-escaped
version (`\\\\.rc\\\\.d`, which looks for literal backslashes) once silently
stopped matching any real loop. This runs each pattern from spec.yaml through
the real `grep -E` against sample rc lines.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "integrations" / "isolation" / "acq-kits" / "examples" / "personal-kit" / "spec.yaml"

# Each `grep -Eqs '<pattern>'` in the spec that looks for `.rc.d`, commented
# examples included (the zsh step ships commented out).
PATTERNS = [p for p in re.findall(r"grep -Eqs '([^']*)'", SPEC.read_text()) if "rc" in p]

LOOP_LINES = [
    'case $- in *i*) for f in "$HOME"/.rc.d/*.sh; do [ -r "$f" ] && . "$f"; done ;; esac',
    'for f in "$HOME"/.rc.d/*.sh(N); do . "$f"; done',
]
NON_LOOP_LINES = [
    "# ~/.rc.d drop-ins (personal kit, interactive shells only)",
    "export PATH=/usr/local/bin:$PATH",
    # Only matches if the dots are unescaped wildcards.
    "alias arcbd=true",
]

pytestmark = pytest.mark.skipif(shutil.which("grep") is None, reason="grep not available")


def _matches(pattern: str, line: str, tmp_path: Path) -> bool:
    rc = tmp_path / "rc"
    rc.write_text(line + "\n")
    return subprocess.run(["grep", "-Eqs", pattern, str(rc)], check=False).returncode == 0


def test_spec_carries_both_patterns():
    # The live bash step and the commented zsh example.
    assert len(PATTERNS) == 2, PATTERNS


@pytest.mark.parametrize("pattern", PATTERNS)
@pytest.mark.parametrize("line", LOOP_LINES)
def test_pattern_matches_a_wired_loop(pattern, line, tmp_path):
    assert _matches(pattern, line, tmp_path)


@pytest.mark.parametrize("pattern", PATTERNS)
@pytest.mark.parametrize("line", NON_LOOP_LINES)
def test_pattern_ignores_comments_and_lookalikes(pattern, line, tmp_path):
    assert not _matches(pattern, line, tmp_path)
