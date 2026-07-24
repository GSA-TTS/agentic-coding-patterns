#!/usr/bin/env python3
"""
Pattern discovery CLI tool for agentic-coding-patterns.

Usage:
    python scripts/search_patterns.py --tag security
    python scripts/search_patterns.py --status recommended
    python scripts/search_patterns.py --query "code review"
    python scripts/search_patterns.py --tag security --status experimental --json
"""

import argparse
import json
import sys
from pathlib import Path

import yaml


def load_index(repo_root: Path) -> dict:
    """Load and parse INDEX.yaml."""
    index_path = repo_root / "INDEX.yaml"

    if not index_path.exists():
        print(f"Error: INDEX.yaml not found at {index_path}", file=sys.stderr)
        print("Run 'make generate' to create it.", file=sys.stderr)
        sys.exit(2)

    try:
        with open(index_path) as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        print(f"Error parsing INDEX.yaml: {e}", file=sys.stderr)
        sys.exit(2)


def load_pattern_details(repo_root: Path, pattern_path: str) -> dict:
    """Load full frontmatter from pattern file."""
    full_path = repo_root / pattern_path

    if not full_path.exists():
        return {}

    try:
        content = full_path.read_text()
        if not content.startswith("---\n"):
            return {}

        parts = content.split("---\n", 2)
        if len(parts) < 3:
            return {}

        return yaml.safe_load(parts[1]) or {}
    except Exception:
        return {}


def matches_filters(
    pattern: dict,
    details: dict,
    tag: str | None,
    status: str | None,
    persona: str | None,
    tool: str | None,
    query: str | None,
    collection: str | None = None,
    ptype: str | None = None,
    task: str | None = None,
    input_artifact: str | None = None,
    output_artifact: str | None = None,
) -> bool:
    """Check if pattern matches all filter criteria."""
    # Status filter
    if status and pattern.get("status") != status:
        return False

    # Collection filter (#238) — read from enriched INDEX, no file reopen needed.
    if collection and (details.get("collection") or pattern.get("collection")) != collection:
        return False

    # Pattern-type filter (#238).
    if ptype and pattern.get("type") != ptype:
        return False

    # Routing-facet filters (#238). Prefer details (source of truth), fall back
    # to the INDEX projection.
    def _routing_values(facet: str) -> list:
        r = details.get("routing") or pattern.get("routing") or {}
        return r.get(facet, []) or []

    if task and task not in _routing_values("task_types"):
        return False
    if input_artifact and input_artifact not in _routing_values("input_artifacts"):
        return False
    if output_artifact and output_artifact not in _routing_values("output_artifacts"):
        return False

    # Tag filter
    if tag:
        tags = details.get("tags", [])
        if tag not in tags:
            return False

    # Persona filter
    if persona:
        personas = details.get("primary_personas", [])
        if persona not in personas:
            return False

    # Tool portability filter
    if tool:
        portability = details.get("portability", {})
        if not portability.get(tool):
            return False

    # Query filter (search in title and description)
    if query:
        query_lower = query.lower()
        title = pattern.get("title", "").lower()
        description = details.get("description", "").lower()

        if query_lower not in title and query_lower not in description:
            return False

    return True


def get_color_code(status: str) -> str:
    """Get ANSI color code for status."""
    colors = {
        "experimental": "\033[33m",  # Yellow
        "recommended": "\033[32m",  # Green
        "deprecated": "\033[31m",  # Red
    }
    return colors.get(status, "")


def format_pattern_human(index: int, pattern: dict, details: dict) -> str:
    """Format pattern for human-readable output."""
    reset = "\033[0m"
    status = pattern.get("status", "unknown")
    color = get_color_code(status)

    output = [
        f"[{index}] {pattern.get('id')} {color}({status.upper()}){reset}",
        f"    Type: {pattern.get('type')}",
        f"    Title: {pattern.get('title')}",
    ]

    # Add optional fields if present
    if tags := details.get("tags"):
        output.append(f"    Tags: {', '.join(tags)}")

    if personas := details.get("primary_personas"):
        output.append(f"    Personas: {', '.join(personas)}")

    if portability := details.get("portability"):
        tools = [tool for tool, enabled in portability.items() if enabled]
        if tools:
            output.append(f"    Tools: {', '.join(tools)}")

    if description := details.get("description"):
        # Truncate long descriptions
        desc = description[:100] + "..." if len(description) > 100 else description
        output.append(f"    Description: {desc}")

    output.append(f"    Path: {pattern.get('path')}")

    return "\n".join(output)


def format_pattern_json(pattern: dict, details: dict) -> dict:
    """Format pattern for JSON output."""
    result = {
        "id": pattern.get("id"),
        "title": pattern.get("title"),
        "type": pattern.get("type"),
        "status": pattern.get("status"),
        "path": pattern.get("path"),
    }

    # Add optional fields if present
    if tags := details.get("tags"):
        result["tags"] = tags

    if personas := details.get("primary_personas"):
        result["personas"] = personas

    if portability := details.get("portability"):
        result["portability"] = {tool: enabled for tool, enabled in portability.items() if enabled}

    if description := details.get("description"):
        result["description"] = description

    return result


def search_patterns(
    index_data: dict,
    repo_root: Path,
    tag: str | None,
    status: str | None,
    persona: str | None,
    tool: str | None,
    query: str | None,
    output_json: bool,
    collection: str | None = None,
    ptype: str | None = None,
    task: str | None = None,
    input_artifact: str | None = None,
    output_artifact: str | None = None,
) -> int:
    """Search patterns and print results. Returns exit code."""
    all_patterns = []

    # Collect all patterns from all categories
    patterns_by_type = index_data.get("patterns", {})
    for pattern_type in patterns_by_type.values():
        if isinstance(pattern_type, list):
            all_patterns.extend(pattern_type)

    # Filter patterns
    matching = []
    for pattern in all_patterns:
        details = load_pattern_details(repo_root, pattern.get("path", ""))
        if matches_filters(
            pattern,
            details,
            tag,
            status,
            persona,
            tool,
            query,
            collection,
            ptype,
            task,
            input_artifact,
            output_artifact,
        ):
            matching.append((pattern, details))

    # Output results
    if not matching:
        if not output_json:
            print("No patterns found matching criteria.")
        else:
            print(json.dumps({"count": 0, "patterns": []}, indent=2))
        return 1

    if output_json:
        results = [format_pattern_json(p, d) for p, d in matching]
        print(json.dumps({"count": len(results), "patterns": results}, indent=2))
    else:
        print(f"Found {len(matching)} pattern(s) matching filters:\n")
        for i, (pattern, details) in enumerate(matching, 1):
            print(format_pattern_human(i, pattern, details))
            if i < len(matching):
                print()  # Blank line between patterns

    return 0


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Search and filter patterns in agentic-coding-patterns",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search by tag
  %(prog)s --tag security

  # Filter by status
  %(prog)s --status recommended

  # Search by persona
  %(prog)s --persona developers

  # Check tool portability
  %(prog)s --tool opencode

  # Keyword search
  %(prog)s --query "code review"

  # Faceted routing filters (#238)
  %(prog)s --collection communications
  %(prog)s --task review
  %(prog)s --input ci-workflow
  %(prog)s --output slide-deck
  %(prog)s --type workflow

  # Combined filters
  %(prog)s --tag security --status experimental --tool cursor

  # JSON output
  %(prog)s --tag security --json
        """,
    )

    parser.add_argument(
        "--tag",
        help="Filter by tag (e.g., security, review)",
    )
    parser.add_argument(
        "--status",
        choices=["experimental", "recommended", "deprecated"],
        help="Filter by status",
    )
    parser.add_argument(
        "--persona",
        help="Filter by persona (e.g., developers, security-engineers)",
    )
    parser.add_argument(
        "--tool",
        help="Filter by tool portability (e.g., opencode, cursor)",
    )
    parser.add_argument(
        "--query",
        help="Keyword search in titles and descriptions",
    )
    parser.add_argument(
        "--collection",
        choices=["meta", "engineering", "security", "content", "digital-service", "communications"],
        help="Filter by collection (#238)",
    )
    parser.add_argument(
        "--type",
        dest="ptype",
        choices=["skill", "prompt", "workflow", "agent", "lesson"],
        help="Filter by pattern type (#238)",
    )
    parser.add_argument(
        "--task",
        help="Filter by routing task type (e.g., review, author) (#238)",
    )
    parser.add_argument(
        "--input",
        dest="input_artifact",
        help="Filter by routing input artifact (e.g., ci-workflow) (#238)",
    )
    parser.add_argument(
        "--output",
        dest="output_artifact",
        help="Filter by routing output artifact (e.g., slide-deck) (#238)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results in JSON format",
    )

    args = parser.parse_args()

    # Find repository root
    repo_root = Path(__file__).parent.parent.resolve()

    # Load index
    index_data = load_index(repo_root)

    # Search patterns
    exit_code = search_patterns(
        index_data,
        repo_root,
        args.tag,
        args.status,
        args.persona,
        args.tool,
        args.query,
        args.json,
        args.collection,
        args.ptype,
        args.task,
        args.input_artifact,
        args.output_artifact,
    )

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
