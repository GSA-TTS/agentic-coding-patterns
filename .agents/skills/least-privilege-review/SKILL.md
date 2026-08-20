---
name: least-privilege-review
id: least-privilege-review
version: "1.0.0"
title: "Least Privilege Review"
type: skill
description: "Review permission scope — GitHub Actions GITHUB_TOKEN, PAT/GitLab token scopes, cloud IAM policies, MCP/tool allowlists, service accounts, and delegated agent authority — and flag over-broad grants, suggesting least-privilege alternatives"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - security

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Real Credentials"
      - "Over-broad Grants Presented As Safe"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "least privilege"
  - "permissions"
  - "GITHUB_TOKEN"
  - "write-all"
  - "IAM policy"
  - "token scope"
  - "over-broad"

tags:
  - "security"
  - "permissions"
  - "iam"
  - "github-actions"
  - "least-privilege"

categories:
  - "security"
  - "review"

risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny

compliance:
  frameworks:
    - "NIST SP 800-53"
  nist_controls:
    - "AC-6"
    - "AC-3"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review GitHub Actions GITHUB_TOKEN `permissions:` blocks for over-broad grants"
    - "Review PAT / GitLab token scopes against what the task actually needs"
    - "Review cloud IAM policy JSON for wildcard actions or resources"
    - "Review MCP / tool allowlists and service-account roles for excess authority"
    - "Suggest the minimal, least-privilege replacement for each flagged grant"
  exclusions:
    - "Does NOT grant, apply, or provision any permission — it only flags and suggests"
    - "Covers permission SCOPE generally; the LLM-in-CI trigger and prompt-injection surface belongs to agentic-actions-auditor"
    - "Does not determine or assert compliance (see compliance-claim-checker)"
    - "Not a substitute for a control assessor or authorizing official"

source_inspiration: []  # No external source copied; grounded in the playbook's own control mappings.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — enumerates permission surfaces, flags over-broad grants, and suggests least-privilege replacements per NIST AC-6/AC-3, without granting any permission itself."

collection: security
routing:
  task_types:
    - "review"
    - "analyze"
  input_artifacts:
    - "ci-workflow"
    - "infrastructure-as-code"
    - "source-code"
  output_artifacts:
    - "security-review"
  prefer_when:
    - "the question is specifically whether permissions/token scopes/IAM grants are minimal"
  avoid_when:
    - "the target is a CI workflow's overall safety (triggers, checkout, prompt construction)"
  aliases:
    - "least privilege"
    - "token scope review"
    - "iam review"
    - "permission minimality"
    - "permissions minimal"
---

# Skill: Least Privilege Review

Review the **permission scope** declared across a change — GitHub Actions
`GITHUB_TOKEN` blocks, personal-access / GitLab token scopes, cloud IAM policy
JSON, MCP or tool allowlists, service-account roles, and delegated agent
authority — and flag any grant **broader than the stated task needs**, suggesting
a tighter least-privilege replacement.

> **This skill is self-limiting.** It flags over-broad scope and suggests
> least-privilege alternatives; it does **not** grant, apply, or provision any
> permission. Control authority lives in the
> [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
> `SECURITY-CONTROLS.md`; this skill defers to it and cites NIST AC-6 rather than
> restating the control text.

## When to Use

- Reviewing a workflow that sets `permissions:` on `GITHUB_TOKEN` (or omits it)
- Reviewing a PAT / GitLab token, deploy key, or fine-grained token before it is
  minted or used in CI
- Reviewing cloud IAM policy JSON, a service-account role, or a Terraform grant
- Reviewing an MCP server config or agent tool allowlist for excess authority
- Before delegating authority to an agent or automated job

## When NOT to Use

- To *grant* or *apply* a permission — this skill only flags and suggests
- To audit the LLM-in-CI trigger or prompt-injection surface — use
  `agentic-actions-auditor` for that (this skill is scope, not trigger)
- To decide whether a system is compliant (use `compliance-claim-checker`)
- As a substitute for an authorizing official's risk acceptance

## Prerequisites

- Access to the config being reviewed (workflow YAML, IAM JSON, token scope list,
  MCP/tool config, or role definition)
- A clear statement of what the task actually needs to do (the "job to be done"),
  so "minimum needed" can be judged against a real requirement

## Procedure

### 1. Enumerate the permission surfaces present

Scan the change for every place authority is granted. Common surfaces:

| Surface | Where it appears |
|---------|------------------|
| GitHub Actions token | `permissions:` block on `GITHUB_TOKEN` (workflow or job) |
| PAT / GitLab token | Token scope list (e.g. `repo`, `workflow`, `api`) |
| Cloud IAM policy | JSON `Action` / `Resource` arrays |
| MCP / tool allowlist | `allowed_tools`, tool config, `network_policy`, `write_policy` |
| Service account / role | Role bindings, attached policies, machine identities |
| Delegated agent authority | What an agent or job is permitted to run or reach |

### 2. Determine the minimum needed for the stated task

For each surface, ask: **what is the smallest set of permissions that lets the
task succeed?** A job that reads code and posts a review comment needs
`contents: read` and `pull-requests: write` — not repo write. Write down the
minimum before comparing.

### 3. Flag grants broader than needed

Flag anything wider than the minimum from step 2. Watch for:

- `permissions: write-all` or an omitted block that inherits broad defaults
- `contents: write` where `contents: read` suffices
- IAM `"Action": "*"` or a service-wide `"s3:*"` where a few verbs suffice
- Wildcard resources: `"Resource": "*"` where a specific ARN suffices
- PAT scopes beyond the task (e.g. full `repo` when read-only would do)
- MCP/tool allowlists granting write, network, or script authority not needed
- Standing (long-lived) grants where a short-lived or scoped token would do

### 4. Suggest the least-privilege replacement

For every flagged grant, propose the tighter form:

- `write-all` → an explicit block listing only the scopes used
- `contents: write` → `contents: read` when nothing is pushed
- `"Action": "*"` → the enumerated verbs actually called
- `"Resource": "*"` → the specific ARN(s) touched
- Broad PAT → a fine-grained token scoped to one repo and the needed permissions

### 5. Reference the control, do not restate it

Anchor each finding to **NIST SP 800-53 AC-6 (Least Privilege)** and, where a
grant crosses a boundary between roles or subjects, **AC-3 (Access
Enforcement)** — by citation only. Do not paste control text; point to the
playbook `SECURITY-CONTROLS.md`.

### 6. Report — never grant or apply

Produce the output below. The report flags and suggests; it never presents an
over-broad grant as acceptable, and it never grants, mints, or applies a
permission.

## Output Contract

```markdown
## Summary
<1-3 sentences: how many surfaces reviewed, how many grants flagged, overall over-privilege risk.>

## Findings
For each flagged grant:
- **Surface:** github-token | pat-scope | iam-policy | mcp-tool | service-account | agent-authority
- **Over-broad grant (quoted):** "<the exact line/field>"
- **Location:** <file/section/line>
- **Why flagged:** <one sentence: what task need it exceeds>
- **Least-privilege replacement:** <the minimal grant that still works>
- **Control:** AC-6 (least privilege)[ ; AC-3 (access enforcement)]

## Notes
- This review flags scope only; it grants no permission. LLM-in-CI trigger/injection is out of scope (see agentic-actions-auditor).
- Control authority lives in the playbook SECURITY-CONTROLS.md.
```

## Verification

- Every finding names the over-broad grant **and** a concrete minimal replacement
- No real credentials, tokens, keys, or secrets appear in the output — quoted
  scopes are permission *names*, never secret values
- No finding tells the reader to widen a grant "to be safe"; broadening is never
  the suggested fix
- Each finding cites AC-6 (and AC-3 where roles/subjects cross) without restating
  the control

## Examples

### Example 1 — GITHUB_TOKEN over-broad `write-all`

Input: `permissions: write-all` on a workflow that only checks out code and
comments on a PR.

Finding:
- **Surface:** github-token
- **Over-broad grant:** `permissions: write-all`
- **Why flagged:** grants every scope; the job only reads code and writes a PR
  comment.
- **Least-privilege replacement:** `permissions:\n  contents: read\n  pull-requests: write`
- **Control:** AC-6

### Example 2 — IAM wildcard action and resource

Input: `"Action": "*", "Resource": "*"` on a role that only reads objects from
one bucket.

Finding:
- **Surface:** iam-policy
- **Over-broad grant:** `"Action": "*"` with `"Resource": "*"`
- **Why flagged:** allows every action on every resource; the task only reads one
  bucket.
- **Least-privilege replacement:** `"Action": ["s3:GetObject", "s3:ListBucket"]`
  scoped to the specific bucket ARN(s).
- **Control:** AC-6; AC-3 (the role acts across service boundaries)

### Example 3 — PAT with more scopes than needed (edge)

Input: a PAT with full `repo`, `workflow`, and `admin:org` used only to read one
repository's contents in CI.

Finding:
- **Surface:** pat-scope
- **Over-broad grant:** `repo`, `workflow`, `admin:org`
- **Why flagged:** three broad scopes for a read-only, single-repo task.
- **Least-privilege replacement:** a fine-grained token scoped to that one repo
  with `Contents: Read-only`; drop `workflow` and `admin:org`.
- **Control:** AC-6

### Example 4 — correctly scoped (not flagged)

Input:
```yaml
permissions:
  contents: read
  pull-requests: write
```
on a job that reads code and posts a review comment.

Finding: none — the grant matches the task's minimum (read code, write a PR
comment) and adds nothing extra.

## References

- Authoritative controls (never restated here):
  [playbook `SECURITY-CONTROLS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)
  — AC-6 (Least Privilege), AC-3 (Access Enforcement)
- Least-privilege behavioral rule:
  [playbook `AGENTS.md` §3](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
- GitHub Actions token permissions:
  [Assigning permissions to `GITHUB_TOKEN`](https://docs.github.com/actions/security-guides/automatic-token-authentication)
- Boundary partner (trigger/injection surface):
  `agentic-actions-auditor`
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../../docs/security-skill-governance.md)
