"""Guard (#339): the pyproject `ruff==` pin and the .pre-commit-config
ruff-pre-commit rev must stay in lockstep.

Divergent ruff versions mean the pre-commit hook lints/formats differently from
CI, so files can pass `git commit` locally yet fail `ruff` in CI (or vice-versa).
This test fails if the two pins drift, closing the gap even before the
dependabot pre-commit ecosystem bumps the hook.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _pyproject_ruff_version() -> str:
    text = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'"ruff==([0-9]+\.[0-9]+\.[0-9]+)"', text)
    assert m, "could not find the ruff== pin in pyproject.toml"
    return m.group(1)


def _precommit_ruff_version() -> str:
    text = (REPO / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    # The repo pins hooks by full SHA with a `# vX.Y.Z` comment; read the version
    # from the ruff-pre-commit block's rev comment.
    m = re.search(
        r"astral-sh/ruff-pre-commit\s+rev:\s*\S+\s*#\s*v([0-9]+\.[0-9]+\.[0-9]+)",
        text,
    )
    assert m, "could not find the ruff-pre-commit rev comment in .pre-commit-config.yaml"
    return m.group(1)


def test_ruff_pins_match():
    py = _pyproject_ruff_version()
    pc = _precommit_ruff_version()
    assert py == pc, (
        f"ruff version drift (#339): pyproject={py} vs ruff-pre-commit={pc}. "
        "Bump .pre-commit-config.yaml rev (SHA + `# vX.Y.Z` comment) to match the "
        "pyproject ruff pin."
    )
