# Design Notes

> **Purpose:** Explain design decisions and what was adopted from the DSD repository

## Overview

This repository adapts proven patterns from the **Digital Services Delivery (DSD)** repository while removing internal/sensitive content and making it suitable for public community contribution.

## What Was Adopted from DSD

### 1. Universal Skills Format

We adopted DSD's SKILL.md single-file format with optional `tests/` subdirectory. This hybrid approach:

- **Simple for contributors:** Single markdown file with frontmatter
- **Powerful for validation:** Optional test cases in `tests/test-cases.yml`
- **Flexible:** Works for simple prompts and complex skills

### 2. Comprehensive Frontmatter Schema

DSD's schema includes federal-grade governance fields:

- Quality gates (readability, citations)
- Output contracts (required sections, prohibited content)
- Portability flags (tool compatibility)
- Compliance tracking (optional)

**Why this matters:** Ensures patterns are well-documented, safe, and reusable across tools.

### 3. Validation Infrastructure

- JSON Schema validation for frontmatter
- Sensitive terms scanning (secrets, PII, CUI)
- Automated INDEX.yaml generation
- Pre-commit hooks for quality gates

### 4. Safety Patterns

- Prohibited content enforcement
- Input sanitization guidance
- Output contract requirements
- Placeholder-only examples

### 5. Test Framework

Optional `test-cases.yml` format for validating pattern behavior:

```yaml
suite:
  pattern_id: my-pattern
  description: "Test cases for my pattern"
test_cases:
  - id: test-1
    assertions:
      - type: contains
        pattern: "expected output"
```

## What Was NOT Copied from DSD

To ensure this repository is safe for public use, we excluded:

- ❌ Internal URLs, hostnames, endpoints
- ❌ Customer data or project names
- ❌ CUI (Controlled Unclassified Information)
- ❌ PII (Personally Identifiable Information)
- ❌ Secrets, credentials, API keys
- ❌ Federal-specific operational details
- ❌ Internal system names (Cloud.gov, etc.)

**All examples use placeholders** like `example.com`, `your-project`, `[REDACTED]`.

## Key Design Decisions

### Default to `experimental` Status

**Decision:** All new patterns start as `experimental`.

**Rationale:**

- Lowers barrier to contribution
- Encourages community experimentation
- Proven patterns naturally emerge through usage
- Clear upgrade path to `recommended` status

### CC0-1.0 License

**Decision:** Public domain dedication (CC0-1.0).

**Rationale:**

- No licensing friction for federal/commercial use
- Encourages maximum reuse
- Aligns with GSA open source policy
- Compatible with all downstream uses

### GitHub-Only Storage

**Decision:** No artifact registry, S3, or external storage.

**Rationale:**

- Simpler maintenance (one tool)
- Lower operational overhead
- Version control built-in
- Familiar to contributors

### Lean MVP Pattern Set

**Decision:** Start with 3-5 patterns per category.

**Rationale:**

- Quality over quantity
- Easier to maintain
- Community can expand organically
- Validates repository structure before scaling

### Python 3.12+ Baseline

**Decision:** Requires Python 3.12 or newer.

**Rationale:**

- Python 3.11 enters security-only maintenance October 2026
- Modern language features available
- Aligns with current LTS support
- Federal systems can deploy current Python

## Relationship to Playbook and Quickstart

See [docs/repository-ecosystem.md](repository-ecosystem.md) for full details.

**Summary:**

- **Playbook** (upstream): Policy, standards, compliance guidance
- **Patterns** (this repo): Reusable community patterns
- **Quickstart** (downstream): Execution environment setup

This repository **consumes** guidance from playbook but **does not create policy**.

## Schema Evolution

The frontmatter schema is versioned (currently v1.0.0) and tracked in:

- `schemas/skill.schema.json` (canonical)
- Pattern files reference schema version in frontmatter

**Future changes:**

1. Create new schema version (e.g., v1.1.0)
2. Support both old and new versions
3. Migrate patterns gradually
4. Deprecate old version after migration period

## Validation Philosophy

**Fail fast, fail clearly:**

- Pre-commit hooks catch issues before push
- CI catches anything hooks missed
- Clear error messages with fix suggestions
- Validation is helpful, not punitive

**Safety > Convenience:**

- Sensitive terms scanning on all commits
- Prohibited content strictly enforced
- False positives handled with context-aware filtering

## Community Contribution Model

**Open contribution, responsible review:**

1. Anyone can submit `experimental` patterns
2. Self-review required (validation passing)
3. Maintainers spot-check for safety
4. Community feedback drives `recommended` promotion
5. Proven patterns last longer

## References

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Full implementation details
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contributor guide
- [AGENTS.md](../AGENTS.md) - Agent behavioral contract
- DSD repository (internal) - Original source of schema and patterns
