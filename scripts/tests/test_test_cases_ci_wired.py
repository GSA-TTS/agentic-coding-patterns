"""Guard (#337): the pattern test-case assertions must run in CI, and the docs
must describe the real runner CLI.

The 12 test-case suites / 73 assertions are meaningless as a quality gate unless
CI actually runs them. This test asserts (a) the runner exits 0, (b) ci.yml
invokes it, and (c) the docs don't reference a nonexistent flag/workflow.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_runner_exits_zero():
    result = subprocess.run(
        [sys.executable, "scripts/run_test_cases.py"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_ci_workflow_invokes_test_cases():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "make test-cases" in ci or "run_test_cases.py" in ci, (
        "ci.yml must invoke the pattern test-case runner (#337)"
    )


def test_docs_do_not_reference_unsupported_cli():
    doc = (REPO / "docs/test-cases-schema.md").read_text(encoding="utf-8")
    assert "--report" not in doc, "docs reference a nonexistent --report flag"
    assert "workflows/test.yml" not in doc, "docs reference a nonexistent test.yml workflow"
