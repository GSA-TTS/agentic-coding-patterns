---
id: security-skills-pack-plan
version: "0.1.0"
title: "Internal Agentic Security Skills Pack — Planning Note"
type: skill
description: "Phase 0 planning note for the internal agentic security skills pack: repo layout, validation commands, overlap deconfliction, taxonomy decision, and execution order"
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - security
  - developers
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 12
  citations_required: false
---

# Internal Agentic Security Skills Pack — Planning Note

## Summary

Phase 0 planning artifact for the internal agentic security skills pack. Records
the current repo state, the overlap deconfliction against existing skills, the
taxonomy decision the pack drives, the schema strategy, and the execution order.
This note references the playbook for policy — it does not duplicate it.

> **Authority:** the playbook `AGENTS.md` and `docs/CODING_PRACTICES.md` remain
> the behavioral and policy authority. This repo provides reusable skills and
> references playbook policy rather than restating it.

## Current Repo Layout (confirmed in live repo)

- Canonical skills directory: **`.agents/skills/`** (with a `skills/` → `.agents/skills` symlink).
- Existing skills: `secure-code-review`, `dependency-analysis`, `test-generation`,
  `documentation-review`, and `frontend/` (accessibility-review, plain-language-review,
  federal-service-blueprint, uswds-form-flow, uswds-landing-page, uswds-prototype).
- Pending: `over-engineering-review` (open PR #140).
- Schema: `schemas/skill.schema.json`. Required: `id, version, title, type, status,
  owners, primary_personas, requires, output, quality_gates`. `additionalProperties`
  is unset (defaults to permissive).

## Validation Commands (confirmed)

| Command | Purpose |
|---------|---------|
| `make validate` | Frontmatter + sensitive-terms scan (currently: passing) |
| `make generate` / `make generate-check` | Regenerate / verify INDEX.yaml |
| `make security` | pip-audit CVE scan |
| `make test` | pytest suite |
| `make ci` | Full CI (validate + security + test + pre-commit) |

Health at planning time: `make validate` ✓ all validators passed.

## Overlap Deconfliction (directive: overlap = update unless substantial purpose delta)

| Proposed skill | Verdict | Action |
|----------------|---------|--------|
| untrusted-input-boundary-review | NEW | new skill (agentic trust boundaries / prompt injection) |
| safe-shell-script-author | NEW | new skill (authoring safe Bash; distinct from review) |
| least-privilege-review | NEW | new skill (token/IAM/CI/MCP permission scope) |
| agentic-actions-auditor | NEW | new skill (LLM-in-CI workflow trigger + injection surface) |
| backdoor-review | NEW | new skill (adversarial-insider / persistence hunt) |
| incident-evidence-review | NEW | new skill (evidence discipline for incidents) |
| compliance-claim-checker | NEW | new skill (citation/overclaim check; defers policy to playbook) |
| **security-diff-review** | UPDATE | fold into `secure-code-review` (add diff / IaC / workflow-perm mode) |
| **secrets-handling-review** | UPDATE | extend `secure-code-review` secrets section (non-code surfaces + rotation) |
| **supply-chain-skeptic** | UPDATE | extend `dependency-analysis` (pre-add decision ladder, Action pinning, public-skill intake) |

Net: **7 new skills + 3 updates** to existing skills (instead of 10 net-new).

## Taxonomy Decision (this pack drives it)

Adopt a **`categories` multi-label frontmatter field** as the canonical taxonomy
axis. Directories stay physical/organizational only (e.g. `frontend/` for
locality); the path is no longer the taxonomy. Multi-label avoids the duplication
a directory-per-category scheme forces (a skill is often both `security` and
`development` and `review`).

Controlled vocabulary (closed enum, 10 terms — each exercised by ≥1 skill):

```
security, development, review, testing, documentation,
dependencies, supply-chain, compliance, incident-response, frontend
```

`tags` remains free-form for discovery; `categories` is the controlled axis used
for INDEX faceting and the security-governance validator gate.

## Schema Strategy (additive, non-breaking)

The security-governance fields from the source plan (`risk_tier`,
`human_review_required`, `allowed_tools`, `network_policy`, `write_policy`,
`script_policy`, `source_inspiration`) plus `categories` are added as **optional**
properties with constrained shapes. They are **not** globally required (that would
break the existing skills). Presence is enforced **for security skills only** via a
validator rule keyed on `categories` containing `security`. Land the additive
definitions before ever setting `additionalProperties: false`.

## Execution Order

1. **M1 governance** (EPIC 1): intake checklist, governance standard, `categories`
   taxonomy + schema extension, repo AGENTS.md alignment.
2. **M3 validation** (EPIC 2 + 3): clean-script policy + unsafe-pattern scanner +
   hardened skill CI; security-skill test harness + fixtures.
3. **M2 core skills** (EPIC 4): 7 new skills + 3 updates, one PR per skill,
   `needs-human-review` on each.
4. **M4 docs** (EPIC 5): README overview, examples, agent routing guide.
5. **M5 promotion** (EPIC 6): promotion checklist, PR template, CODEOWNERS, release notes.

## Human-Review Gates

- Every security skill carries `human_review_required: true` and the
  `needs-human-review` label; no security skill is auto-merged.
- Behavioral-contract / AGENTS.md / schema changes are PR-only (never admin-merged)
  per the workspace standing rule.
- Each public source used as inspiration gets an intake record; no public scripts
  or full skill bodies are copied.

## Gaps to Close

- No `categories` taxonomy or controlled vocabulary exists yet (EPIC 1).
- No security-governance frontmatter validation (EPIC 1 / EPIC 3).
- No unsafe-shell-pattern scanner (EPIC 2).
- No security-skill fixtures or assertion types in the test runner (EPIC 3).
- No compliance-claim or incident-evidence skills exist (EPIC 4).
