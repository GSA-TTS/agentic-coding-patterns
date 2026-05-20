#!/usr/bin/env python3
"""
Run all validators.

Usage:
    python scripts/validate_repo.py
"""

import subprocess
import sys
from pathlib import Path


def run_validator(script: str, description: str) -> bool:
    """Run a validation script. Returns True if passed."""
    print(f"\n{'=' * 60}")
    print(f"Running: {description}")
    print(f"{'=' * 60}")

    result = subprocess.run(
        [sys.executable, script],
        cwd=Path(__file__).parent.parent,
    )

    return result.returncode == 0


def main() -> int:
    validators = [
        ("scripts/validate_frontmatter.py", "Frontmatter schema validation"),
        ("scripts/validate_sensitive_terms.py", "Sensitive terms scan"),
    ]

    failed = []

    for script, description in validators:
        if not run_validator(script, description):
            failed.append(description)

    # Summary
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")

    if not failed:
        print("✓ All validators passed")
        return 0
    else:
        print(f"✗ {len(failed)} validator(s) failed:")
        for name in failed:
            print(f"  - {name}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
