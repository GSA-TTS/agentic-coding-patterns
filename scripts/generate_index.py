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


def _index_routing(routing: dict | None) -> dict:
    """Project the routing block into the compact facets kept in INDEX.yaml.

    Only the shortlist facets are surfaced (task/input/output artifacts +
    aliases); the full prefer_when/avoid_when/delegates prose stays in the
    SKILL.md source of truth. Returns {} when the pattern has no routing block.
    """
    if not isinstance(routing, dict):
        return {}
    projected = {}
    for facet in ("task_types", "input_artifacts", "output_artifacts", "aliases"):
        values = routing.get(facet)
        if values:
            projected[facet] = sorted(values) if isinstance(values, list) else values
    if "priority" in routing:
        projected["priority"] = routing["priority"]
    return projected


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
                        "categories": frontmatter.get("categories", []),
                        "collection": frontmatter.get("collection"),
                        "routing": _index_routing(frontmatter.get("routing")),
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
                            "categories": frontmatter.get("categories", []),
                            "collection": frontmatter.get("collection"),
                            "routing": _index_routing(frontmatter.get("routing")),
                        }
                    )

    # Deterministic ordering (#243): rglob order is filesystem-dependent, so sort
    # every pattern list by id (fallback path) before serialization. Without this
    # INDEX.yaml diffs are unstable across machines and `--check` can spuriously
    # fail after a rename or on a different OS.
    for pattern_type in patterns:
        patterns[pattern_type].sort(key=lambda p: (p.get("id", ""), p.get("path", "")))

    return patterns


# Closed controlled vocabulary for the categories facet (issue #151). Kept in sync
# with schemas/skill.schema.json properties.categories.items.enum.
CATEGORY_VOCAB = [
    "security",
    "development",
    "review",
    "testing",
    "documentation",
    "dependencies",
    "supply-chain",
    "compliance",
    "incident-response",
    "frontend",
]


def facet_by_category(patterns: dict[str, list[dict]]) -> dict[str, list[str]]:
    """Build a category -> [pattern id] facet over all patterns.

    Every term in the controlled vocabulary appears (empty list if unused) so the
    facet is a stable, complete view of the taxonomy.
    """
    facets: dict[str, list[str]] = {term: [] for term in CATEGORY_VOCAB}
    for items in patterns.values():
        for item in items:
            for cat in item.get("categories", []) or []:
                if cat in facets:
                    facets[cat].append(item["id"])
    for term in facets:
        facets[term].sort()
    return facets


def facet_by_collection(patterns: dict[str, list[dict]]) -> dict[str, list[str]]:
    """Build a collection -> [pattern id] reverse facet (#238).

    Only collections that are actually used appear (unlike the closed category
    vocab); empty because no pattern carries `collection` until PR3 (#240).
    """
    facets: dict[str, list[str]] = {}
    for items in patterns.values():
        for item in items:
            coll = item.get("collection")
            if coll:
                facets.setdefault(coll, []).append(item["id"])
    return {k: sorted(v) for k, v in sorted(facets.items())}


def facet_by_routing(patterns: dict[str, list[dict]], key: str) -> dict[str, list[str]]:
    """Build a routing-facet-value -> [pattern id] reverse facet (#238).

    `key` is one of task_types / input_artifacts / output_artifacts. Empty until
    patterns carry routing blocks (PR3 #240).
    """
    facets: dict[str, list[str]] = {}
    for items in patterns.values():
        for item in items:
            routing = item.get("routing") or {}
            for value in routing.get(key, []) or []:
                facets.setdefault(value, []).append(item["id"])
    return {k: sorted(v) for k, v in sorted(facets.items())}


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
        "categories": facet_by_category(patterns),
        "collections": facet_by_collection(patterns),
        "task_types": facet_by_routing(patterns, "task_types"),
        "output_artifacts": facet_by_routing(patterns, "output_artifacts"),
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
