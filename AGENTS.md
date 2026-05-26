---
id: agentic-patterns-agent-rules
version: "1.0.0"
title: "Agentic Coding Patterns — Agent Behavior Rules"
description: "Behavioral contract for AI agents contributing to and using community patterns for agentic coding"
type: agent
status: experimental
owners: ["@GSA-TTS"]
primary_personas: ["developers", "agents"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Quick Reference", "Core Principles"]
    prohibited_content: ["Secrets", "Real PII", "Real CUI", "Internal URLs"]
quality_gates:
  readability_max_grade: 10
  citations_required: false
last_updated: "2026-05-20"
---

# AGENTS.md — Agentic Coding Patterns Repository

> **Scope:** Community patterns repository | **License:** CC0-1.0

## Quick Reference

| Rule | Requirement |
|------|-------------|
| Priority | safety > correctness > contribution-friendliness > simplicity |
| Identity | Document AI usage with `Co-authored-by:` trailer |
| Status | Default to `experimental` for new patterns |
| Prohibited | No secrets, PII, CUI, internal URLs, customer data |
| Validation | `make validate` before commit |
| Frontmatter | All patterns MUST have valid YAML frontmatter |
| Safety | Define `prohibited_content` in every pattern |
| References | Reference playbook for policy, don't duplicate |
| Testing | Patterns SHOULD include test-cases.yml when applicable |

---

## 1. Core Principles

The agent operates under these principles:

```
safety > correctness > contribution-friendliness > simplicity
```

1. **Safety** — Never include sensitive data or create unsafe patterns
2. **Correctness** — Patterns must be technically accurate and tested
3. **Contribution-friendliness** — Lower barrier to contribution, use `experimental` status liberally
4. **Simplicity** — Prefer clear, reusable patterns over complex ones

---

## 2. Identity and Attribution

### 2.1 Commit Attribution

The agent MUST include `Co-authored-by:` trailer in all commits:

```
feat(skills): add secure code review pattern

Add pattern for security-focused code review with
OWASP Top 10 checks.

Co-authored-by: OpenCode Agent <user@gsa.gov>
```

---

## 3. Pattern Contribution Rules

### 3.1 Content Types

This repository contains five content types:

| Type | Directory | Format | Purpose |
|------|-----------|--------|---------|
| **Skills** | `skills/` | SKILL.md | Reusable procedures |
| **Prompts** | `prompts/` | SKILL.md | Standalone prompts |
| **Agents** | `agents/` | AGENTS.md | Agent instructions |
| **Workflows** | `workflows/` | SKILL.md | Multi-step processes |
| **Lessons** | `lessons-learned/` | SKILL.md | Community experiences |

### 3.2 Pattern Status Lifecycle

```
experimental → recommended → deprecated
```

| Status | Meaning | Review Required |
|--------|---------|-----------------|
| `experimental` | New, untested | Self-review |
| `recommended` | Proven useful | Peer review |
| `deprecated` | Superseded | Must include `replaces_with` |

**Default for new contributions:** `experimental`

The agent SHOULD:

- Use `experimental` status for all new patterns
- Wait for community feedback before promoting to `recommended`
- Never self-promote patterns to `recommended` status

---

## 4. Frontmatter Requirements

All pattern files MUST include valid YAML frontmatter per `schemas/skill.schema.json`.

**Minimum required fields:**

```yaml
---
id: pattern-name                      # kebab-case, immutable
version: "1.0.0"                      # semver
title: "Pattern Title"
type: skill                           # skill|prompt|workflow|agent|lesson
status: experimental
owners: ["@community"]
primary_personas: ["developers"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary"]
    prohibited_content: ["Secrets", "PII", "CUI"]
quality_gates:
  readability_max_grade: 10
  citations_required: false
---
```

**Recommended fields:**

- `triggers`: Keywords for pattern discovery
- `tags`: For categorization
- `portability`: Tool compatibility flags
- `scope.intended_use`: What the pattern is for
- `scope.exclusions`: What NOT to use it for

---

## 5. Prohibited Content

The agent MUST NEVER include in patterns:

| Prohibited | Why |
|------------|-----|
| Secrets, API keys, tokens, passwords | Security risk |
| PII (names, emails, SSNs) | Privacy violation |
| CUI | Classification violation |
| Internal URLs or hostnames | Information disclosure |
| Customer data | Privacy violation |
| Vulnerability details | Responsible disclosure |

All patterns MUST define `prohibited_content` in frontmatter output contract.

---

## 6. Safety Requirements

### 6.1 Input Sanitization

Patterns that accept user input MUST:

- Define clear input boundaries
- Include input validation guidance
- Use delimiters like `--- USER INPUT START ---`
- Warn about prompt injection risks

### 6.2 Output Contracts

Every pattern MUST define:

- `required_sections`: Sections expected in output
- `prohibited_content`: Content that must never appear
- `format`: Expected output format

---

## 7. Tool Compatibility Tracking

Patterns SHOULD declare compatibility via `portability` frontmatter:

```yaml
portability:
  opencode: true          # OpenCode SKILL.md format
  cursor: true            # Cursor .cursorrules
  claude_projects: true   # Claude Projects
  chatgpt: true           # ChatGPT custom instructions
  generic_llm: true       # Generic prompting
```

The agent SHOULD test portability claims when possible.

---

## 8. Validation Workflow

### 8.1 Required Commands

Before committing, the agent MUST run:

```bash
make validate    # Validate frontmatter and scan for sensitive terms
```

The agent SHOULD run:

```bash
make test        # Run test suite if applicable
make ci          # Full CI check
```

### 8.2 Validation Failures

The agent MUST:

- Stop on validation failure
- Report the specific error
- Not commit invalid patterns
- Suggest fixes when possible

---

## 9. Pattern References

### 9.1 Referencing Other Patterns

Patterns MAY depend on other patterns via `requires.anchors` or `requires.skills`.

The agent MUST:

- Verify referenced patterns exist
- Document dependency relationships
- Not create circular dependencies

### 9.2 Referencing Playbook

Patterns SHOULD reference the playbook for policy rather than duplicating it:

```markdown
For security controls, see [SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md) in the playbook.
```

The agent MUST NOT:

- Copy policy content from playbook
- Make compliance claims without citing source
- Duplicate standards that belong in playbook

---

## 10. Testing Patterns

### 10.1 Optional Test Cases

Patterns MAY include `tests/test-cases.yml` for validation:

```yaml
suite:
  pattern_id: secure-code-review
  pattern_version: "1.0.0"
  description: "Test cases for secure code review pattern"

test_cases:
  - id: sql-injection-detection
    name: "Detects SQL injection vulnerability"
    input:
      type: literal
      content: |
        query = "SELECT * FROM users WHERE id = " + user_input
    assertions:
      - type: contains
        pattern: "SQL injection"
        min_count: 1
```

The agent SHOULD:

- Create test cases for complex patterns
- Run tests before marking patterns as `recommended`

---

## 11. Documentation Requirements

### 11.1 Pattern Structure

All SKILL.md patterns SHOULD include:

1. **Brief description** (2-3 sentences)
2. **When to Use** (bullet list of scenarios)
3. **Prerequisites** (required tools, knowledge)
4. **Procedure** (numbered steps)
5. **Verification** (how to confirm success)
6. **Examples** (concrete use cases)

### 11.2 Clarity Requirements

Patterns SHOULD:

- Use plain language (Grade 10 or below preferred)
- Define technical terms
- Include examples
- Explain the "why" not just the "what"

---

## 12. Pull Request Requirements

When submitting patterns, the agent MUST:

1. Use the PR template
2. Complete the safety checklist
3. Run validation before submitting
4. Reference any related issues
5. Explain what problem the pattern solves

The agent MUST NOT:

- Self-approve pull requests
- Skip review for patterns marked `experimental`
- Merge without passing CI

---

## 13. Prohibited Actions

The agent MUST NEVER:

| Action | Rationale |
|--------|-----------|
| Include secrets in patterns | Security violation |
| Bypass validation checks | Quality gate evasion |
| Self-promote patterns to `recommended` | Community review required |
| Copy internal/sensitive content from other repos | Information disclosure |
| Make uncited compliance claims | Accuracy requirement |

---

## 14. Self-Check Gate

Before completing any task, verify:

### Pattern Changes

- [ ] `make validate` passes
- [ ] Frontmatter includes all required fields
- [ ] Status is `experimental` for new patterns
- [ ] `prohibited_content` is defined
- [ ] No secrets, PII, or CUI included
- [ ] Tool compatibility flags set if applicable

### Repository Changes

- [ ] `Co-authored-by:` trailer in commit
- [ ] INDEX.yaml regenerated if patterns changed
- [ ] No internal URLs or references
- [ ] Templates used for new content

---

## Repository-Specific Commands

```bash
# Setup
make setup              # Install dependencies

# Validation
make validate           # Run all validators
make generate           # Generate INDEX.yaml
make generate-check     # Verify INDEX.yaml is current

# Testing
make test               # Run pytest
make ci                 # Full CI check

# Cleanup
make clean              # Remove generated files
```

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-05-20 | 0.1.0 | Initial release for patterns repository |

---

> **Note:** This AGENTS.md is adapted from [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook) for community pattern contribution. For policy and compliance requirements, refer to the playbook.
