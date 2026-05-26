#!/usr/bin/env python3
"""
Generate INDEX.yaml from pattern files.

Usage:
    python scripts/generate_index.py [--check]
"""

import argparse
import sys
from pathlib import Path

import yaml


def extract_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from markdown."""
    if not content.startswith("---\n"):
        return None

    parts = content.split("---\n", 2)
    if len(parts) < 3:
        return None

    try:
        return yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None


def find_patterns(root: Path) -> dict[str, list[dict]]:
    """Find all patterns organized by type."""
    patterns = {
        "skills": [],
        "prompts": [],
        "agents": [],
        "workflows": [],
        "lessons": [],
    }

    # Map directories to types
    type_map = {
        "skills": "skills",
        "prompts": "prompts",
        "workflows": "workflows",
        "agents": "agents",
        "lessons-learned": "lessons",
    }

    for dir_name, pattern_type in type_map.items():
        dir_path = root / dir_name
        if not dir_path.exists():
            continue

        for skill_file in dir_path.rglob("SKILL.md"):
            content = skill_file.read_text()
            frontmatter = extract_frontmatter(content)

            if frontmatter:
                rel_path = skill_file.relative_to(root)
                patterns[pattern_type].append(
                    {
                        "path": str(rel_path),
                        "id": frontmatter.get("id", "unknown"),
                        "title": frontmatter.get("title", "Untitled"),
                        "type": frontmatter.get("type", pattern_type),
                        "status": frontmatter.get("status", "experimental"),
                    }
                )

        # Also check for AGENTS.md in agents/
        if dir_name == "agents":
            for agents_file in dir_path.rglob("AGENTS.md"):
                content = agents_file.read_text()
                frontmatter = extract_frontmatter(content)

                if frontmatter:
                    rel_path = agents_file.relative_to(root)
                    patterns[pattern_type].append(
                        {
                            "path": str(rel_path),
                            "id": frontmatter.get("id", "unknown"),
                            "title": frontmatter.get("title", "Untitled"),
                            "type": "agent",
                            "status": frontmatter.get("status", "experimental"),
                        }
                    )

    return patterns


def generate_index(root: Path) -> dict:
    """Generate the INDEX.yaml structure."""
    patterns = find_patterns(root)

    # Count patterns
    total = sum(len(items) for items in patterns.values())

    return {
        "schema_version": "1.0",
        "repo": "GSA-TTS/agentic-coding-patterns",
        "description": "Community patterns for agentic coding",
        "patterns": patterns,
        "stats": {
            "total_patterns": total,
            "skills": len(patterns["skills"]),
            "prompts": len(patterns["prompts"]),
            "agents": len(patterns["agents"]),
            "workflows": len(patterns["workflows"]),
            "lessons": len(patterns["lessons"]),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate INDEX.yaml")
    parser.add_argument("--check", action="store_true", help="Check if INDEX.yaml is up to date (don't write)")
    args = parser.parse_args()

    root = Path.cwd()
    index_path = root / "INDEX.yaml"

    # Generate index
    index_data = generate_index(root)
    new_content = yaml.dump(index_data, sort_keys=False, allow_unicode=True)

    if args.check:
        # Check mode - verify file is up to date
        if not index_path.exists():
            print("✗ INDEX.yaml does not exist")
            return 1

        existing_content = index_path.read_text()
        existing_data = yaml.safe_load(existing_content)

        # Normalize both data structures for comparison
        # YAML key ordering can differ between Python versions
        def normalize(d):
            """Recursively sort dict keys for consistent comparison."""
            if isinstance(d, dict):
                return {k: normalize(v) for k, v in sorted(d.items())}
            elif isinstance(d, list):
                return [normalize(item) for item in d]
            return d

        existing_normalized = normalize(existing_data)
        generated_normalized = normalize(index_data)

        if existing_normalized != generated_normalized:
            print("✗ INDEX.yaml is out of date")
            print("  Run: make generate")
            # Deep comparison to find differences
            import json

            print("\n  Existing (normalized):")
            print(json.dumps(existing_normalized, indent=2, default=str)[:500])
            print("\n  Generated (normalized):")
            print(json.dumps(generated_normalized, indent=2, default=str)[:500])
            return 1

        print("✓ INDEX.yaml is up to date")
        return 0
    else:
        # Write mode
        index_path.write_text(new_content)
        print(f"✓ Generated INDEX.yaml with {index_data['stats']['total_patterns']} patterns")
        return 0


if __name__ == "__main__":
    sys.exit(main())
