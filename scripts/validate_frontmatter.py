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


def validate_file(file_path: Path, schema: dict[str, Any]) -> tuple[bool, list[str]]:
    """Validate a single file. Returns (success, errors)."""
    # Read file
    try:
        content = file_path.read_text()
    except Exception as e:
        return False, [f"Failed to read file: {e}"]

    # Extract frontmatter
    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        return False, ["No valid YAML frontmatter found"]

    # Validate against schema
    try:
        jsonschema.validate(instance=frontmatter, schema=schema)
    except jsonschema.ValidationError as e:
        return False, [f"Schema validation failed: {e.message}"]
    except jsonschema.SchemaError as e:
        return False, [f"Invalid schema: {e.message}"]

    return True, []


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate pattern frontmatter")
    parser.add_argument("--root", type=Path, default=Path.cwd(),
                        help="Repository root (default: current directory)")
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
    for file_path in files:
        rel_path = file_path.relative_to(root)
        success, errors = validate_file(file_path, schema)

        if success:
            print(f"✓ {rel_path}")
        else:
            print(f"✗ {rel_path}")
            for error in errors:
                print(f"  - {error}")
            failed += 1

    # Summary
    total = len(files)
    passed = total - failed
    print(f"\n{passed}/{total} files passed validation")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
