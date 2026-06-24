#!/usr/bin/env python3
"""
Validate frontmatter in pattern files against JSON Schema.

Usage:
    python scripts/validate_frontmatter.py [--root PATH]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import jsonschema
import yaml

# Security-governance fields required when a skill declares categories: [security].
# Additive gate (issue #151): only enforced for security skills, so the existing
# non-security skills keep validating.
SECURITY_GOVERNANCE_FIELDS = [
    "risk_tier",
    "human_review_required",
    "allowed_tools",
    "network_policy",
    "write_policy",
    "script_policy",
]

# Heuristic signals that a skill is security-relevant even if it did NOT self-label
# categories: [security] (recon finding S4 — prevents dodging the governance gate
# by simply omitting the label). This is advisory (warning), not a hard failure.
SECURITY_SIGNAL_KEYWORDS = {
    "security",
    "secure",
    "vulnerability",
    "vuln",
    "exploit",
    "injection",
    "secrets",
    "secret",
    "credential",
    "backdoor",
    "least-privilege",
    "privilege",
    "owasp",
    "cve",
    "threat",
    "incident",
    "malware",
    "supply-chain",
}


def _collect_signal_text(frontmatter: dict[str, Any]) -> set[str]:
    """Lowercased token set from tags + triggers for the S4 heuristic."""
    tokens: set[str] = set()
    for field in ("tags", "triggers"):
        values = frontmatter.get(field) or []
        if isinstance(values, list):
            for v in values:
                tokens.add(str(v).lower())
    return tokens


def check_security_governance(file_path: Path, frontmatter: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Apply the categories-gated security-governance rules.

    Returns (errors, warnings):
    - error  if categories contains 'security' but a governance field is missing
    - warning if the skill looks security-relevant (dir/trigger/tag) but did NOT
      declare categories: [security] (recon S4 — self-label dodge).
    """
    errors: list[str] = []
    warnings: list[str] = []

    categories = frontmatter.get("categories") or []
    is_security = isinstance(categories, list) and "security" in categories

    if is_security:
        missing = [f for f in SECURITY_GOVERNANCE_FIELDS if frontmatter.get(f) is None]
        if missing:
            errors.append(
                "categories includes 'security' but missing required "
                f"security-governance field(s): {', '.join(missing)}"
            )
        return errors, warnings

    # S4 heuristic: not self-labeled security — does it look security-relevant?
    signals: set[str] = set()
    # Match a `security`/`secure` path *segment* (e.g. agents/security-review/),
    # not any substring (tmp dirs etc. can contain "security" incidentally).
    for part in file_path.parts[:-1]:
        seg = part.lower()
        if seg == "security" or seg.startswith("security-") or seg.startswith("secure-"):
            signals.add("path:security")
            break
    signals |= _collect_signal_text(frontmatter) & SECURITY_SIGNAL_KEYWORDS
    if signals:
        warnings.append(
            "looks security-relevant (" + ", ".join(sorted(signals)) + ") but does not declare categories: [security]; "
            "add it (and the security-governance fields) or confirm it is out of scope"
        )

    return errors, warnings


def load_schema(schema_path: Path) -> dict[str, Any]:
    """Load JSON Schema from file."""
    with open(schema_path) as f:
        return json.load(f)


def extract_frontmatter(content: str) -> dict[str, Any] | None:
    """Extract YAML frontmatter from markdown content."""
    if not content.startswith("---\n"):
        return None

    parts = content.split("---\n", 2)
    if len(parts) < 3:
        return None

    try:
        return yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None


def find_pattern_files(root: Path) -> list[Path]:
    """Find all SKILL.md and AGENTS.md files."""
    patterns = []
    for pattern in ["**/SKILL.md", "**/AGENTS.md"]:
        patterns.extend(root.glob(pattern))
    return sorted(patterns)


def validate_file(file_path: Path, schema: dict[str, Any]) -> tuple[bool, list[str], list[str]]:
    """Validate a single file. Returns (success, errors, warnings)."""
    # Read file
    try:
        content = file_path.read_text()
    except Exception as e:
        return False, [f"Failed to read file: {e}"], []

    # Extract frontmatter
    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        return False, ["No valid YAML frontmatter found"], []

    # Validate against schema
    try:
        jsonschema.validate(instance=frontmatter, schema=schema)
    except jsonschema.ValidationError as e:
        return False, [f"Schema validation failed: {e.message}"], []
    except jsonschema.SchemaError as e:
        return False, [f"Invalid schema: {e.message}"], []

    # Categories-gated security-governance checks (issue #151 + recon S4)
    gov_errors, gov_warnings = check_security_governance(file_path, frontmatter)
    if gov_errors:
        return False, gov_errors, gov_warnings

    return True, [], gov_warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate pattern frontmatter")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Repository root (default: current directory)")
    args = parser.parse_args()

    root = args.root
    schema_path = root / "schemas" / "skill.schema.json"

    # Load schema
    if not schema_path.exists():
        print(f"ERROR: Schema not found: {schema_path}", file=sys.stderr)
        return 1

    schema = load_schema(schema_path)

    # Find all pattern files
    files = find_pattern_files(root)
    if not files:
        print("No pattern files found")
        return 0

    # Validate each file
    failed = 0
    warned = 0
    for file_path in files:
        rel_path = file_path.relative_to(root)
        success, errors, warnings = validate_file(file_path, schema)

        if success:
            print(f"✓ {rel_path}")
        else:
            print(f"✗ {rel_path}")
            for error in errors:
                print(f"  - {error}")
            failed += 1

        for warning in warnings:
            print(f"  ⚠ {rel_path}: {warning}")
            warned += 1

    # Summary
    total = len(files)
    passed = total - failed
    print(f"\n{passed}/{total} files passed validation")
    if warned:
        print(f"{warned} warning(s) (advisory; do not fail the build)")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
