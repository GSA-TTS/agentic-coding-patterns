# Security Skill Governance Standard

> **Authority:** The [agentic-coding-playbook `AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
> and [`docs/CODING_PRACTICES.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
> are the behavioral and policy authority. This document references that policy;
> it does not duplicate or restate it. Where this standard and the playbook
> appear to differ, the playbook wins.

This standard defines the governance model for **security skills** in this
repository — what they are, the hard safety rules they operate under, and the
review and tool/network/write/script policies they must declare.

## Priority order

Security skills follow the playbook priority order, unchanged:

```
safety > correctness > compliance > simplicity > performance
```

When a security skill's guidance would trade safety for any lower priority, the
skill MUST choose safety.

## What is a "security skill"

A pattern is a **security skill** when its frontmatter declares:

```yaml
categories:
  - security
```

`categories` is the canonical taxonomy axis (closed controlled vocabulary; see
[`schemas/skill.schema.json`](../schemas/skill.schema.json)). Physical directory
location is organizational only and does **not** determine whether a skill is a
security skill — the `categories` label does.

A skill is security-relevant (and SHOULD carry `categories: [security]`) when it
reviews, produces, or reasons about: vulnerabilities, secrets/credentials,
authentication/authorization, supply-chain or dependency risk, least-privilege
and permission scope, prompt-injection / untrusted-input boundaries, incident
evidence, or compliance claims about security controls.

> The validator emits an **advisory warning** when a skill looks
> security-relevant (by path segment, tags, or triggers) but does not declare
> `categories: [security]`. The warning never fails the build; it exists so the
> governance gate below cannot be silently dodged by omitting the label. Either
> add the label (and the required fields) or confirm in review that the skill is
> genuinely out of scope.

## Hard safety rules (non-negotiable)

Every security skill — and every artifact it instructs an agent to produce —
MUST NOT contain:

| Prohibited | Why |
|------------|-----|
| Secrets, API keys, tokens, passwords | Security risk; see playbook prohibited content |
| Real PII, real CUI | Privacy / classification |
| Internal URLs or hostnames | Information disclosure |
| **Working exploit payloads / weaponized PoC code** | Responsible disclosure |
| Live attack tooling or step-by-step intrusion recipes | Responsible disclosure |

**Conceptual vulnerability descriptions and remediation guidance ARE allowed**
(e.g. "this endpoint is vulnerable to SQL injection because input is concatenated
into the query; use parameterized queries"). **A runnable exploit that
demonstrates the vulnerability is NOT** — describe the class and the fix, never
ship the weapon.

## Required governance frontmatter

A security skill (`categories: [security]`) MUST declare all of the following
fields (enforced by the validator — a missing field fails validation):

| Field | Meaning | Default posture |
|-------|---------|-----------------|
| `risk_tier` | `low` \| `moderate` \| `high` — blast radius of the skill's actions | choose the highest plausible tier |
| `human_review_required` | bool — output must be human-reviewed before action | `true` for all security skills |
| `allowed_tools` | allowlist of tools the skill may use | **deny-by-default**: list nothing the skill does not need |
| `network_policy` | `deny` \| `allowlist` \| `allow` | `deny` unless a specific host is justified |
| `write_policy` | `deny` \| `workspace` \| `allow` | `deny` for review skills; `workspace` only if it must write |
| `script_policy` | `deny` \| `author-only` \| `allow` | `deny`; `author-only` for skills that draft (but never execute) scripts |

Optional but recommended:

| Field | Meaning |
|-------|---------|
| `source_inspiration` | public sources used as **inspiration only** (never copied); each entry records `url`, `license`, and a pointer to its intake record — see the [public skill intake checklist](../templates/security-skill-intake.md) |

### Deny-by-default principle

`allowed_tools`, `network_policy`, `write_policy`, and `script_policy` are
**deny-by-default**. A security skill should request the *minimum* capability it
needs and justify any grant above `deny` in its body. This mirrors the playbook's
least-privilege posture.

## Human-review gates

- Every security skill carries `human_review_required: true` **and** the
  `needs-human-review` label on its PR. No security skill is auto-merged or
  admin-merged.
- Behavioral-contract, `AGENTS.md`, and schema changes are **PR-only** (never
  admin-merged) per the workspace standing rule.
- One security skill per PR, so each gets a focused review.

## Public-source inspiration (no copying)

Security skills are frequently inspired by public skills, blog posts, or tools.
Inspiration is allowed; **copying is not**. Before a security skill that draws on
a public source is merged, an intake record (see
[`templates/security-skill-intake.md`](../templates/security-skill-intake.md))
MUST be completed and referenced from the PR. No public scripts, prompt bodies,
or full skill bodies are copied into this repository.

## References

- Playbook behavioral authority: [`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
- Playbook coding/security practices: [`docs/CODING_PRACTICES.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
- Playbook prompt-injection defense: [`docs/PROMPT-INJECTION-DEFENSE.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/PROMPT-INJECTION-DEFENSE.md)
- Schema: [`schemas/skill.schema.json`](../schemas/skill.schema.json)
- Taxonomy + governance fields: [`docs/security-skills-pack-plan.md`](security-skills-pack-plan.md)
- Public-source intake: [`templates/security-skill-intake.md`](../templates/security-skill-intake.md)
