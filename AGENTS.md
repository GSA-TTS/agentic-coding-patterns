---
id: agentic-patterns-agent-rules
version: "1.2.0"
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
last_updated: "2026-08-24"
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
owners: ["@GSA-TTS/agentic-coding-team"]
primary_personas: ["developers"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary"]
    prohibited_content: ["Secrets", "PII", "CUI", "Internal URLs"]
quality_gates:
  readability_max_grade: 10
  citations_required: false
---
```

**Recommended fields:**

- `triggers`: Keywords for pattern discovery
- `tags`: Free-form keywords for discovery
- `portability`: Tool compatibility flags
- `scope.intended_use`: What the pattern is for
- `scope.exclusions`: What NOT to use it for

### 4.1 Categories Taxonomy

`categories` is the **canonical taxonomy axis** — a closed, controlled
vocabulary used for INDEX faceting and the security-governance gate. Directory
location is physical/organizational only and does **not** determine taxonomy.
A pattern may carry multiple categories (it is often both `development` and
`review`).

Controlled vocabulary (10 terms, closed enum — see `schemas/skill.schema.json`):

```
security, development, review, testing, documentation,
dependencies, supply-chain, compliance, incident-response, frontend
```

`tags` stays free-form for discovery; `categories` is the controlled axis.

### 4.2 Security-Governance Fields

A **security skill** is any pattern that declares `categories: [security]`. Such
patterns MUST also declare the security-governance fields, enforced by the
validator (a missing field fails validation):

```yaml
categories: ["security", "review"]
risk_tier: moderate            # low | moderate | high
human_review_required: true    # always true for security skills
allowed_tools: []              # deny-by-default allowlist
network_policy: deny           # deny | allowlist | allow
write_policy: deny             # deny | workspace | allow
script_policy: deny            # deny | author-only | allow
# source_inspiration: [...]    # optional; public sources used as inspiration only
```

These fields are **additive and optional at the schema level** (existing
non-security patterns are unaffected) but **required for security skills** via
the validator. The validator also emits an **advisory warning** when a pattern
looks security-relevant (by path segment, tags, or triggers) but does not
declare `categories: [security]`, so the gate cannot be dodged by omitting the
label.

The behavioral authority for security skills is the **playbook**
[`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md);
this repo references it and does not duplicate policy. See
[`docs/security-skill-governance.md`](docs/security-skill-governance.md) for the
full governance model.

### 4.3 Public-Source Inspiration (No Copying)

Patterns may be **inspired** by public skills, blogs, or tools, but MUST NOT copy
scripts, prompt bodies, or full skill bodies from them. Each public source used
as inspiration gets an intake record
([`templates/security-skill-intake.md`](templates/security-skill-intake.md))
referenced from the pattern's PR, and is recorded under `source_inspiration`.

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

### 9.3 Durable References: Cross-Link Code, Docs, and ADRs — Not Trackers

This repository must remain **self-contained and outlive the issue tracker.**
GitHub issue/PR numbers, and internal epic labels ("gap A", "gap K", etc.), are
ephemeral SaaS-dependent tracking artifacts — useful during development, but an
obstacle to review and long-term maintenance once merged. The durable homes for
rationale are **ADRs (`docs/decisions/`, and per-kit `docs/decisions/` under
`integrations/`) and docs**; the durable homes for behavior are the **content
and its test-cases**.

The agent MUST:

- Keep **content and comments self-contained.** Explain *why* in prose. A note
  MAY point to an **ADR** (e.g. "see `docs/decisions/0001-integrations-area.md`")
  — that is the correct durable anchor for a design decision. A note MUST NOT
  rely on a bare `#NNN` / `quickstart#NNN` / `patterns#NNN` issue-or-PR
  reference, or an epic "gap X" label, to carry meaning: rewrite it as prose (and
  cite an ADR if one applies).
- Point **docs → content and ADRs** (what/where it is, why it was decided), and
  point **content → docs and ADRs** (the durable rationale). Prefer docs pointing
  at content over the reverse, except to cite an ADR.
- Before opening a PR, **strip ephemeral tracker references from any pattern,
  comment, or doc it added or touched.** Durable, cross-repo-relevant facts (a
  pinned release SHA, an upstream bug's observable behavior) belong in prose/ADRs,
  not as a bare tracker number.

This rule governs **ephemeral tracker references only** (issue/PR numbers, epic
"gap X" labels). It does **NOT** apply to **NIST SP 800-53 control tags** — a
`> **Control Mapping:**` footer or `<!-- NIST SP 800-53: ... -->` comment is a
durable, standards-anchored reference and is fine to keep where a pattern or
skill maps to a control; never strip one as an "in-code reference."

The agent MAY leave issue/PR references in **ephemeral, non-durable contexts**:
commit messages, PR descriptions, `CHANGELOG.md` (release automation), and an
ADR's own *Links / tracking* section (where issue references are acceptable,
though prose or ADR cross-links are preferred). Test **names** that already encode
a regression's id MAY keep it as a stable identifier.

### 9.4 Fully Qualify Issue/PR References in Anything Durable

Shorthand like `#233` is **fine when talking to a human in this session** — but
it MUST NOT land, unqualified, in anything durable or auto-linked (commit
messages, PR titles/descriptions, review comments, tracking issues, ADRs). Once
auto-linked, a bare `#233` resolves **relative to whatever repository renders
it** — so a `#233` written for `GSA-TTS/agentic-coding-patterns` can silently
point at `GSA-TTS/agentic-coding-quickstart#233` (a different thing) when quoted
or cross-posted.

Therefore, in any durable or cross-posted artifact, the agent MUST write
issue/PR references **fully qualified**:

- Cross-repo, always safe: `GSA-TTS/agentic-coding-patterns#NNN` (or a full URL);
  the same form applies to sibling repos — `GSA-TTS/agentic-coding-quickstart#NNN`,
  `GSA-TTS/agentic-coding-playbook#NNN`. Use this form in every commit message, PR
  body, review comment, and tracking issue — including when referring to the
  current repo — because these are read and auto-linked outside their origin.
- A bare `#NNN` is acceptable **only** within the same repository's PR/issue body
  where the target is unambiguous by construction, and even then the qualified
  form is preferred. When in doubt, fully qualify.

This does not change the durable-reference rule above (content and docs prose
still avoid tracker numbers entirely, qualified or not); it governs the
*ephemeral* contexts where a reference is allowed at all.

> Rationale: this is enforcement of the existing "docs-as-code" / self-contained
> repository discipline. Doing this continuously means no later "de-reference" or
> "re-qualify" cleanup pass is ever needed.

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
| 2026-08-24 | 1.2.0 | Add §9.3 Durable References (cross-link code/docs/ADRs, not trackers) and §9.4 Fully Qualify Issue/PR References; ported from quickstart at maintainer request |
| 2026-06-24 | 1.1.0 | Add §4.1 categories taxonomy, §4.2 security-governance fields, §4.3 public-source no-copy rule; reference playbook authority |
| 2026-05-20 | 0.1.0 | Initial release for patterns repository |

---

> **Note:** This AGENTS.md is adapted from [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook) for community pattern contribution. For policy and compliance requirements, refer to the playbook.
