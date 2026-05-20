# Implementation Plan: agentic-coding-patterns Repository

> **Status:** In Progress | **Date:** 2026-05-20 | **Repo:** GSA-TTS/agentic-coding-patterns

## Executive Summary

This plan documents the bootstrap implementation of the agentic-coding-patterns repository based on analysis of `dsd/` and `agentic-coding-playbook/` repositories, adapted for community pattern contribution.

**Key decisions:**
- DSD schema as base (strict, federal-grade governance)
- SKILL.md format with optional tests/ (hybrid approach)
- Lean MVP scope (3-5 patterns per category)
- GitHub-only (simplified maintenance)
- `experimental` status as default (low barrier to contribution)

## Architecture

### Directory Structure

```
agentic-coding-patterns/
├── skills/              # Reusable skills (SKILL.md format)
├── prompts/             # Standalone prompts
├── agents/              # Agent instruction patterns (AGENTS.md)
├── workflows/           # Multi-step workflows
├── lessons-learned/     # Community experiences
├── templates/           # Templates for new content (5 types)
├── examples/            # Tool-specific examples
├── schemas/             # JSON Schemas for validation
├── scripts/             # Python validation tooling
└── docs/                # Documentation
```

### Frontmatter Schema

Based on DSD SKILL_SCHEMA.yml v1.0.0 with full federal governance fields:
- Required: id, version, title, type, status, owners, primary_personas, requires, output, quality_gates
- Recommended: triggers, tags, portability, scope
- Optional: compliance, changelog, deprecated

**Schema file:** `schemas/skill.schema.json` (JSON Schema format)

### Content Lifecycle

```
experimental → recommended → deprecated
```

Default for new contributions: `experimental`

## What Was Adopted from DSD

1. **Universal Skills Format (adapted)** — SKILL.md single-file with optional tests/
2. **Frontmatter schema** — Full DSD schema with quality gates, output contracts, portability flags
3. **Validation approach** — JSON Schema + Python validators
4. **Safety patterns** — Prohibited content enforcement, sensitive term scanning
5. **Quality gates** — Readability max grade, citation requirements
6. **Portability tracking** — Tool compatibility flags (opencode, cursor, claude, chatgpt, generic)
7. **Test framework structure** — test-cases.yml format (optional)

## What Was NOT Copied from DSD

- Internal URLs, hostnames, endpoints
- Customer data or internal references
- CUI, PII, secrets
- Federal-specific operational details
- Internal system names
- Cloud.gov-specific content

All examples use placeholders.

## Implementation Progress

### ✅ Completed

#### Infrastructure (7/7)
- [x] Directory structure created
- [x] .gitignore
- [x] pyproject.toml (Python 3.11+, PyYAML, jsonschema, pytest, ruff)
- [x] Makefile (setup, validate, generate, test, ci, clean)
- [x] .pre-commit-config.yaml (trailing whitespace, yaml/json check, ruff, validation)
- [x] LICENSE (CC0-1.0, already in place)
- [x] INDEX.yaml placeholder (generated via `make generate`)

#### Validation (4/4)
- [x] schemas/skill.schema.json (DSD-based, JSON Schema format)
- [x] scripts/validate_frontmatter.py (JSON Schema validation)
- [x] scripts/validate_sensitive_terms.py (Sensitive term scanning)
- [x] scripts/validate_repo.py (Orchestrator)
- [x] scripts/generate_index.py (INDEX.yaml generator)

#### Documentation (3/3)
- [x] README.md (137 lines - repo positioning, quick start)
- [x] AGENTS.md (375 lines - behavioral contract adapted from playbook)
- [x] CONTRIBUTING.md (329 lines - contributor guide)

#### Templates (1/5)
- [x] templates/skill-template/SKILL.md

### 🚧 In Progress

#### Templates (4 remaining)
- [ ] templates/prompt-template/SKILL.md
- [ ] templates/agent-template/AGENTS.md
- [ ] templates/workflow-template/SKILL.md
- [ ] templates/lesson-template/SKILL.md

### ⏳ Pending

#### Starter Content (Lean MVP)
- [ ] 4 skills: secure-code-review, documentation-review, dependency-analysis, test-generation
- [ ] 3 prompts: implementation-plan, qa-round, safe-code-review
- [ ] 3 agents: general, security-review, documentation
- [ ] 2 workflows: issue-to-merge-request, qa-round
- [ ] 1 lesson: example-agentic-session

#### Documentation
- [ ] docs/design-notes.md (what was adopted from dsd/)
- [ ] docs/safety-guidance.md (security rules)
- [ ] docs/repository-ecosystem.md (relationship to siblings)
- [ ] docs/content-lifecycle.md (status transitions)
- [ ] docs/review-model.md (review expectations)
- [ ] docs/getting-started.md (quick start)

#### GitHub Integration
- [ ] .github/ISSUE_TEMPLATE/skill.md
- [ ] .github/ISSUE_TEMPLATE/prompt.md
- [ ] .github/ISSUE_TEMPLATE/workflow.md
- [ ] .github/ISSUE_TEMPLATE/agent-instructions.md
- [ ] .github/ISSUE_TEMPLATE/lesson-learned.md
- [ ] .github/pull_request_template.md

#### Examples
- [ ] examples/opencode/README.md + opencode.example.jsonc
- [ ] examples/claude-code/README.md
- [ ] examples/copilot/README.md
- [ ] examples/cursor/README.md

#### Testing
- [ ] scripts/tests/test_validators.py (pytest suite)

## GitHub Issues to Create

### Epic: Repository Bootstrap (#1)
- #2: Complete remaining templates (4)
- #3: Create starter skills (4)
- #4: Create starter prompts (3)
- #5: Create starter agents (3)
- #6: Create starter workflows (2)
- #7: Create starter lesson (1)

### Epic: Documentation (#8)
- #9: Write docs/design-notes.md
- #10: Write docs/safety-guidance.md
- #11: Write docs/repository-ecosystem.md
- #12: Write docs/content-lifecycle.md
- #13: Write docs/review-model.md
- #14: Write docs/getting-started.md

### Epic: GitHub Integration (#15)
- #16: Create issue templates (5)
- #17: Create PR template
- #18: Set up GitHub Actions CI

### Epic: Examples (#19)
- #20: Create tool-specific examples (4 tools)

### Epic: Testing (#21)
- #22: Add pytest test suite for validators
- #23: Add test coverage for schema validation

### Epic: Future Enhancements (#24)
- #25: Add skill test runner (DSD-style)
- #26: Add multi-platform export (OpenCode, Cursor, Claude)
- #27: Add markdown linting (Vale)
- #28: Add readability validation (Flesch-Kincaid)
- #29: Cross-link from playbook/quickstart

## Validation Commands

```bash
# Setup
make setup              # Install dependencies

# Validation
make validate           # Run all validators
make generate           # Generate INDEX.yaml
make generate-check     # Verify INDEX.yaml is current

# Testing
make test               # Run pytest (when tests exist)
make ci                 # Full CI check

# Cleanup
make clean              # Remove generated files
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| DSD schema as base | Proven, rigorous, supports federal governance |
| SKILL.md format with optional tests/ | Lower barrier than full USF, but extensible |
| `experimental` as default status | Encourages contribution, reserves `recommended` for proven content |
| GitHub-only | Simplifies maintenance, most common platform |
| Lean MVP | Useful on day one, community fills gaps |
| JSON Schema + Python | Enables IDE autocomplete, rigorous validation |
| Separate directories by content type | Clear organization, different types serve different purposes |
| CC0-1.0 license | Maximum reuse (already in place) |
| No federal-specific requirements in core validation | Compliance fields optional for broader community |

## Safety Model

1. **Prohibited content enforcement** via frontmatter `output.contract.prohibited_content`
2. **Sensitive term scanning** via `scripts/validate_sensitive_terms.py`
3. **Pre-commit hooks** run validation automatically
4. **Review checklist** in PR template

**Minimum prohibited content:** Secrets, PII, CUI, Internal URLs

## Next Steps

1. Complete remaining templates (4)
2. Create starter content (Lean MVP: 13 patterns)
3. Write remaining documentation (6 docs)
4. Create GitHub templates (6)
5. Add test suite
6. Create GitHub issues
7. Run full validation
8. Initial commit and push

## Acceptance Criteria

- [x] Repository has usable initial structure
- [x] README clearly explains purpose and ecosystem relationship
- [x] Templates exist for all content types (1/5 done)
- [ ] Starter patterns exist (0/13 done)
- [x] Validation scripts run successfully
- [x] Pre-commit configuration exists
- [x] Contribution and safety guidance exist
- [ ] GitHub templates exist
- [x] No sensitive content from dsd/ was copied
- [ ] Final summary with validation results

## References

- DSD repository: Internal analysis completed
- agentic-coding-playbook: https://github.com/GSA-TTS/agentic-coding-playbook
- agentic-coding-quickstart: https://github.com/GSA-TTS/agentic-coding-quickstart
- DSD SKILL_SCHEMA.yml: Adapted to schemas/skill.schema.json
- Playbook AGENTS.md: Adapted to patterns repo context
