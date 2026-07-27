#!/usr/bin/env python3
"""
Generate CATALOG.md — a human-readable pattern catalog (#240, PR3).

Reads INDEX.yaml (the generated manifest) and renders a Markdown catalog grouped
by collection, with each pattern's type, status, and routing facets. Mirrors the
machine index for humans; `--check` verifies it is current (used in CI/pre-commit
the same way INDEX.yaml is).

Usage:
    python scripts/generate_catalog.py [--check]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

COLLECTION_ORDER = ["meta", "engineering", "security", "content", "digital-service", "communications"]
COLLECTION_TITLES = {
    "meta": "Meta",
    "engineering": "Engineering",
    "security": "Security",
    "content": "Content",
    "digital-service": "Digital Service",
    "communications": "Communications",
    None: "Unclassified",
}


def _flatten(index: dict) -> list[dict]:
    out = []
    for items in (index.get("patterns") or {}).values():
        if isinstance(items, list):
            out.extend(items)
    return out


def render_catalog(index: dict) -> str:
    patterns = _flatten(index)
    by_collection: dict[str | None, list[dict]] = {}
    for p in patterns:
        by_collection.setdefault(p.get("collection"), []).append(p)

    stats = index.get("stats", {})
    lines: list[str] = []
    lines.append("# Pattern Catalog")
    lines.append("")
    lines.append(
        "> **Generated file — do not edit by hand.** Run `make generate` "
        "(regenerates INDEX.yaml + CATALOG.md). Source of truth is each pattern's "
        "`SKILL.md`/`AGENTS.md` frontmatter."
    )
    lines.append("")
    lines.append(
        f"{stats.get('total_patterns', len(patterns))} patterns — "
        f"{stats.get('skills', 0)} skills, {stats.get('prompts', 0)} prompts, "
        f"{stats.get('agents', 0)} agents, {stats.get('workflows', 0)} workflows, "
        f"{stats.get('lessons', 0)} lessons."
    )
    lines.append("")
    lines.append(
        "For machine routing use the [`pattern-router`](.agents/skills/meta/pattern-router/SKILL.md) "
        "skill + `scripts/route_patterns.py`; this catalog is the human view."
    )
    lines.append("")

    ordered = [c for c in COLLECTION_ORDER if c in by_collection]
    ordered += [c for c in by_collection if c not in COLLECTION_ORDER and c is not None]
    if None in by_collection:
        ordered.append(None)

    for coll in ordered:
        entries = sorted(by_collection[coll], key=lambda p: p.get("id", ""))
        lines.append(f"## {COLLECTION_TITLES.get(coll, coll)}")
        lines.append("")
        lines.append("| Pattern | Type | Status | Tasks | Consumes | Produces |")
        lines.append("|---------|------|--------|-------|----------|----------|")
        for p in entries:
            routing = p.get("routing") or {}
            tasks = ", ".join(routing.get("task_types", []) or []) or "—"
            inputs = ", ".join(routing.get("input_artifacts", []) or []) or "—"
            outputs = ", ".join(routing.get("output_artifacts", []) or []) or "—"
            pid = p.get("id", "?")
            path = p.get("path", "")
            lines.append(
                f"| [`{pid}`]({path}) | {p.get('type', '?')} | {p.get('status', '?')} "
                f"| {tasks} | {inputs} | {outputs} |"
            )
        lines.append("")

    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate CATALOG.md")
    parser.add_argument("--check", action="store_true", help="Verify CATALOG.md is up to date")
    args = parser.parse_args()

    root = Path.cwd()
    index_path = root / "INDEX.yaml"
    catalog_path = root / "CATALOG.md"

    if not index_path.exists():
        print("✗ INDEX.yaml not found (run 'make generate')", file=sys.stderr)
        return 1

    index = yaml.safe_load(index_path.read_text())
    content = render_catalog(index)

    if args.check:
        if not catalog_path.exists():
            print("✗ CATALOG.md does not exist")
            return 1
        if catalog_path.read_text() != content:
            print("✗ CATALOG.md is out of date\n  Run: make generate")
            return 1
        print("✓ CATALOG.md is up to date")
        return 0

    catalog_path.write_text(content)
    print("✓ Generated CATALOG.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
