#!/usr/bin/env python3
"""
Validate cross-references between patterns (#240, PR3).

Every reference a pattern makes to another pattern by id must resolve to a real
pattern, and delegation must not form a cycle. Guards against:
  * `deprecated.replaces_with` pointing at a missing id
  * `routing.delegates[].pattern` pointing at a missing id
  * `requires.skills[]` / `requires.anchors[]` pointing at a missing id
  * a delegation cycle (A delegates to B delegates to A)

Read-only. Exit 1 on any dangling or cyclic reference.

Usage:
    python scripts/validate_references.py [--root PATH]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml


def extract_frontmatter(content: str) -> dict[str, Any] | None:
    if not content.startswith("---\n"):
        return None
    parts = content.split("---\n", 2)
    if len(parts) < 3:
        return None
    try:
        return yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None


def collect_patterns(root: Path) -> dict[str, dict]:
    """Map pattern id -> frontmatter across all pattern dirs."""
    patterns: dict[str, dict] = {}
    for base in ("skills", "prompts", "workflows", "agents", "lessons-learned"):
        d = root / base
        if not d.exists():
            continue
        for name in ("SKILL.md", "AGENTS.md"):
            for f in d.rglob(name):
                if "fixtures" in f.parts:
                    continue
                try:
                    text = f.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue  # unreadable/binary file → skip, don't crash the run
                fm = extract_frontmatter(text)
                if fm and fm.get("id"):
                    patterns[fm["id"]] = fm
    return patterns


def _delegate_targets(fm: dict) -> list[str]:
    routing = fm.get("routing") or {}
    out = []
    for d in routing.get("delegates") or []:
        if isinstance(d, dict) and d.get("pattern"):
            out.append(d["pattern"])
    return out


def find_reference_errors(patterns: dict[str, dict]) -> list[str]:
    """Return a list of dangling/cyclic reference errors (empty = clean)."""
    ids = set(patterns)
    errors: list[str] = []

    for pid, fm in sorted(patterns.items()):
        # replaces_with
        dep = fm.get("deprecated") or {}
        rw = dep.get("replaces_with")
        if rw and rw not in ids:
            errors.append(f"{pid}: deprecated.replaces_with -> unknown pattern {rw!r}")

        # requires.skills / requires.anchors
        req = fm.get("requires") or {}
        for field in ("skills", "anchors"):
            for ref in req.get(field) or []:
                if ref not in ids:
                    errors.append(f"{pid}: requires.{field} -> unknown pattern {ref!r}")

        # routing.delegates
        for target in _delegate_targets(fm):
            if target not in ids:
                errors.append(f"{pid}: routing.delegates -> unknown pattern {target!r}")

    # Delegation cycles (only over resolvable edges).
    graph = {pid: [t for t in _delegate_targets(fm) if t in ids] for pid, fm in patterns.items()}
    errors.extend(_find_cycles(graph))
    return errors


def _find_cycles(graph: dict[str, list[str]]) -> list[str]:
    """Detect cycles in the delegation graph via DFS. Deterministic output."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    errors: list[str] = []

    def visit(node: str, stack: list[str]) -> None:
        color[node] = GRAY
        for nxt in graph.get(node, []):
            if color.get(nxt) == GRAY:
                cycle = stack[stack.index(nxt) :] + [nxt] if nxt in stack else [node, nxt]
                errors.append("delegation cycle: " + " -> ".join(cycle))
            elif color.get(nxt) == WHITE:
                visit(nxt, stack + [nxt])
        color[node] = BLACK

    for node in sorted(graph):
        if color[node] == WHITE:
            visit(node, [node])
    # De-dup while keeping deterministic order.
    seen = set()
    unique = []
    for e in errors:
        if e not in seen:
            seen.add(e)
            unique.append(e)
    return unique


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate pattern cross-references (#240)")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    patterns = collect_patterns(args.root)
    if not patterns:
        print("No patterns found")
        return 0

    errors = find_reference_errors(patterns)
    if errors:
        print(f"✗ {len(errors)} reference error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"✓ {len(patterns)} patterns: all cross-references resolve, no delegation cycles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
