"""Regression coverage for the team-kit OpenCode instructions boundary."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
VERIFY = ROOT / "integrations/isolation/acq-kits/examples/team-kit/scripts/verify"


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("1.19.0", "supported"),
        ("opencode 1.18.32", "supported"),
        ("2.0.0", "affected"),
        ("2.0.29", "affected"),
        ("2.0.30", "supported"),
        ("2.1.0", "supported"),
        ("v2.0.30+build.1", "supported"),
        ("", "unreadable"),
        ("not-a-version", "unreadable"),
        ("2.0", "unreadable"),
        ("2.0.30junk", "unreadable"),
    ],
)
def test_opencode_instructions_version_boundary(version: str, expected: str) -> None:
    result = subprocess.run(
        ["bash", str(VERIFY), "--classify-opencode-version", version],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


def test_classifier_requires_exactly_one_version_argument() -> None:
    result = subprocess.run(
        ["bash", str(VERIFY), "--classify-opencode-version"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert "usage:" in result.stderr
