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


def load_taxonomy(taxonomy_path: Path) -> dict[str, set[str]] | None:
    """Load the routing taxonomy controlled vocabularies (schemas/taxonomy.yaml).

    Returns {"task_types": {...}, "artifact_types": {...}} of allowed slugs, or
    None if the file is absent (routing validation is then skipped — the JSON
    Schema still enforces structure).
    """
    if not taxonomy_path.exists():
        return None
    data = yaml.safe_load(taxonomy_path.read_text()) or {}
    return {
        "task_types": set((data.get("task_types") or {}).keys()),
        "artifact_types": set((data.get("artifact_types") or {}).keys()),
    }


def check_routing_taxonomy(frontmatter: dict[str, Any], taxonomy: dict[str, set[str]] | None) -> list[str]:
    """Cross-check routing.* facet values against the controlled vocabularies.

    REJECTS unknown values (does not silently pass) — closes the classifier
    injection path where an unknown facet could dodge avoid/delegated scoring.
    No-op if the pattern has no `routing` block or the taxonomy file is absent.
    """
    if taxonomy is None:
        return []
    routing = frontmatter.get("routing")
    if not isinstance(routing, dict):
        return []

    errors: list[str] = []
    facet_vocab = {
        "task_types": ("task_types", taxonomy["task_types"]),
        "input_artifacts": ("artifact_types", taxonomy["artifact_types"]),
        "output_artifacts": ("artifact_types", taxonomy["artifact_types"]),
    }
    for facet, (vocab_name, allowed) in facet_vocab.items():
        values = routing.get(facet) or []
        if not isinstance(values, list):
            continue
        unknown = [v for v in values if v not in allowed]
        if unknown:
            errors.append(
                f"routing.{facet} contains value(s) not in taxonomy.yaml "
                f"{vocab_name}: {', '.join(sorted(map(str, unknown)))}"
            )
    return errors


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
    """Find all SKILL.md and AGENTS.md files.

    Excludes non-pattern payloads: `fixtures/` (test data) and acq-kit
    `files/` trees. A kit may VENDOR a third-party skill (e.g. an obot-format
    SKILL.md the kit drops into a sandbox) under `.../files/...`; those are guest
    payloads in a foreign schema, not repo pattern skills, so they are not
    validated against this repo's skill.schema.json. This mirrors the scoping in
    validate_references.py (skills/prompts/workflows/agents/lessons-learned +
    fixtures skip)."""
    patterns = []
    for pattern in ["**/SKILL.md", "**/AGENTS.md"]:
        patterns.extend(root.glob(pattern))
    return sorted(
        p
        for p in patterns
        if "fixtures" not in p.parts and "files" not in p.parts
    )


# The four mandated prohibited_content categories, each matched by a
# substring so richer phrasings satisfy it ("Real PII" covers PII, "Internal
# Hostnames" covers the internal-URL category). The CONTRIBUTING MUST and
# AGENTS.md §5 name these four as the minimum; the schema enforces the >=4 count,
# this enforces they are the RIGHT four categories.
_PROHIBITED_CONTENT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "secrets": ("secret", "credential", "token", "password", "api key"),
    "PII": ("pii",),
    "CUI": ("cui",),
    "internal URLs": ("internal url", "internal hostname", "internal host"),
}


def check_prohibited_content_coverage(frontmatter: dict[str, Any]) -> list[str]:
    """Ensure output.contract.prohibited_content covers the four mandated
    categories. Case-insensitive substring match, so intentional richer
    phrasings ("Real PII", "Real CUI", "Internal Hostnames") count. No-op if the
    pattern has no output contract."""
    output = frontmatter.get("output")
    contract = output.get("contract") if isinstance(output, dict) else None
    if not isinstance(contract, dict):
        return []
    items = contract.get("prohibited_content")
    if not isinstance(items, list):
        return []
    haystack = " ".join(str(i).lower() for i in items)
    missing = [
        label for label, needles in _PROHIBITED_CONTENT_CATEGORIES.items() if not any(n in haystack for n in needles)
    ]
    if missing:
        return [
            "output.contract.prohibited_content must cover the four mandated categories "
            f"(secrets, PII, CUI, internal URLs); missing: {', '.join(missing)}"
        ]
    return []


def validate_file(
    file_path: Path, schema: dict[str, Any], taxonomy: dict[str, set[str]] | None = None
) -> tuple[bool, list[str], list[str]]:
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

    # Routing facet vocabulary check (#238): reject unknown task/artifact slugs.
    routing_errors = check_routing_taxonomy(frontmatter, taxonomy)
    if routing_errors:
        return False, routing_errors, gov_warnings

    # Multi-artifact output check (#241): format: multi must list artifacts.
    output = frontmatter.get("output")
    if isinstance(output, dict) and output.get("format") == "multi":
        artifacts = output.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            return (
                False,
                ["output.format is 'multi' but output.artifacts is empty (list at least one produced file)"],
                gov_warnings,
            )

    # prohibited_content coverage: the schema enforces the COUNT (minItems
    # 4); this enforces that the four mandated CATEGORIES are actually covered —
    # secrets, PII, CUI, and internal URLs — so a skill can't satisfy the count
    # with four unrelated items. Matches the richer phrasings in use ("Real PII",
    # "Real CUI", "Internal Hostnames") rather than requiring literal bare strings.
    pc_errors = check_prohibited_content_coverage(frontmatter)
    if pc_errors:
        return False, pc_errors, gov_warnings

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
    taxonomy = load_taxonomy(root / "schemas" / "taxonomy.yaml")

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
        success, errors, warnings = validate_file(file_path, schema, taxonomy)

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
