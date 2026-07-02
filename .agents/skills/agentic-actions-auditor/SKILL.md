---
name: agentic-actions-auditor
id: agentic-actions-auditor
version: "1.0.0"
title: "Agentic Actions Auditor"
type: skill
description: "Audit CI/CD workflows that invoke LLM agents for dangerous trigger, checkout, token-scope, and prompt-construction patterns — flags the injection and blast-radius surface without shipping a working exploit"

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
      - "Approved Autonomy For Irreversible Actions"
      - "Real Tokens Or Tool Credentials"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "pull_request_target"
  - "issue_comment"
  - "workflow_run"
  - "GITHUB_TOKEN"
  - "agent in CI"
  - "LLM in workflow"
  - "prompt injection CI"
  - "permissions write-all"

tags:
  - "security"
  - "ci-cd"
  - "github-actions"
  - "prompt-injection"
  - "least-privilege"
  - "agentic"

categories:
  - "security"
  - "review"
  - "supply-chain"

risk_tier: high
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny

compliance:
  frameworks:
    - "OWASP Top 10 Agentic 2026"
    - "OWASP Top 10 LLM 2025"
    - "NIST SP 800-53"
  nist_controls:
    - "AC-6"
    - "AU-2"
    - "CM-3"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Audit CI/CD workflows that invoke an LLM agent for dangerous triggers"
    - "Flag untrusted PR-head checkout that runs with repo secrets in scope"
    - "Flag agent prompts built from attacker-controlled text (PR title/body, comments)"
    - "Flag over-scoped GITHUB_TOKEN in agent jobs and missing human-approval gates"
  exclusions:
    - "Does NOT cover general permission-scope review — see least-privilege-review"
    - "Does NOT audit the agent's model or its prompt-safety logic itself"
    - "Not a substitute for a full supply-chain or dependency audit"
    - "Does not ship or run a working exploit; defers policy to the playbook"

source_inspiration: []  # OWASP-inspired categories only; no text, config, or prompt copied. Add an intake record if a public source is used.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — audits agent-invoking CI workflows for dangerous trigger/checkout/token/prompt patterns and missing approval gates; describes fixes, ships no working exploit."
---

# Skill: Agentic Actions Auditor

Audit CI/CD workflows that **invoke an LLM agent** for the patterns that turn a
pipeline into an attacker-reachable action surface: dangerous event triggers,
untrusted checkout of pull-request code with secrets in scope, over-scoped
`GITHUB_TOKEN`, agent prompts built from attacker-controlled text, and missing
human-approval gates before the agent writes or takes irreversible actions.

> **This skill is self-limiting.** It audits agent-invoking CI for dangerous
> trigger, checkout, permission, and prompt-construction patterns; it describes
> each pattern and its fix but ships **no working end-to-end exploit**. Minimal
> YAML snippets that show a dangerous trigger are config patterns, not payloads,
> and each is paired with the safer form. Authoritative policy lives in the
> [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook);
> this skill defers all policy there and never restates it.

## When to Use

- Reviewing a GitHub Actions (or similar CI) workflow that calls an LLM agent —
  a code reviewer bot, an issue triager, an auto-fixer, or a chat-ops agent
- A workflow reads PR titles, bodies, or issue comments and feeds them to a model
- Before enabling an agent bot on a public or fork-friendly repository
- When a workflow uses `pull_request_target`, `issue_comment`, `issues`, or
  `workflow_run` and also has access to secrets

## When NOT to Use

- For general permission-scope review of any workflow — use `least-privilege-review`
- To evaluate the agent's own prompt-safety or model choice
- As a full supply-chain / dependency audit
- To *grant* autonomy for irreversible actions — this skill only flags its absence

## Prerequisites

- Read access to the workflow files (usually `.github/workflows/*.yml`)
- Knowledge of which step invokes the LLM agent (an action, a CLI, or an API call)
- Understanding of the repo's trust boundary (does it accept fork PRs?)

## Procedure

### 1. Identify agent-invoking workflows

Scan workflow files for the step that calls an LLM agent: a marketplace action,
a model API call (`curl`/SDK to an LLM endpoint), or an agent CLI. If no step
invokes an agent, this skill does not apply — stop and note it.

### 2. Check the trigger

Inspect the `on:` block. These triggers run with **repository secrets** on
**untrusted content** and are high-risk for agent jobs:

| Trigger | Why high-risk |
|---------|---------------|
| `pull_request_target` | Runs in the base-repo context **with secrets**, but the PR is attacker-authored |
| `issue_comment` / `issues` | Fires on attacker-controlled comment/issue text |
| `workflow_run` | Can inherit secrets while processing artifacts from an untrusted run |

Flag any agent job on these triggers. `pull_request` (no `_target`) runs without
base secrets on fork PRs and is the safer default.

### 3. Check for untrusted checkout with secrets in scope

Look for a checkout of the **PR head** (`ref: ${{ github.event.pull_request.head.sha }}`
or `head.ref`) in a job that also holds secrets. This gives attacker-controlled
code a runner that can read those secrets. Flag it, especially under
`pull_request_target`.

### 4. Check the GITHUB_TOKEN scope in the agent job

Inspect the job- or workflow-level `permissions:` block. Flag:

- `permissions: write-all` or a missing `permissions:` block (defaults may be broad)
- Any `write` scope the agent step does not actually need (e.g. `contents: write`
  on a read-only reviewer)

The blast radius of an injected instruction equals the token's scope.

### 5. Check whether the prompt is built from attacker-controlled fields

Trace what text flows into the agent's prompt. Flag any prompt assembled from
attacker-controlled fields: `github.event.pull_request.title` / `.body`,
`github.event.comment.body`, `github.event.issue.title` / `.body`, or branch
names. These are **data**, not instructions — treating them as instructions is
prompt injection.

### 6. Check for a human-approval gate

Determine whether the agent can take an **irreversible or writing** action
(merge, push, comment, deploy, call a tool) without a human gate. Flag the
absence of an `environment:` with required reviewers, a manual approval step, or
a dry-run/propose-only mode for such actions.

### 7. Report with severity

Produce the output below. Each finding cites the trigger or line and names the
safer pattern. Rank by blast radius: untrusted-checkout-with-secrets and
write-scoped injection paths are highest.

## Output Contract

```markdown
## Summary
<1-3 sentences: workflows audited, findings count, highest-severity issue.>

## Findings
For each finding:
- **Workflow / job:** <file · job name>
- **Location:** <trigger or line>
- **Pattern:** dangerous-trigger | untrusted-checkout | over-scoped-token | prompt-from-untrusted-input | missing-approval-gate
- **Severity:** high | medium | low
- **Why flagged:** <one sentence>
- **Safer pattern:** <use pull_request not pull_request_target | drop PR-head checkout from secret job | least-privilege token | treat PR/issue text as data | add environment: with required reviewers>

## Notes
- This audit flags patterns only; it does not grant autonomy for irreversible actions. See the playbook for policy.
```

## Verification

- Every finding cites the trigger or line **and** names a concrete safer pattern
- The report proposes no working exploit and endorses no unattended irreversible
  agent action (check against the `Approved Autonomy For Irreversible Actions`
  prohibited-content rule)
- No real tokens, secrets, or tool credentials appear in the output
- Safer-pattern advice matches the finding: `pull_request` over
  `pull_request_target`; `environment:` + required reviewers for writes;
  least-privilege token; PR/issue text handled as data

## Examples

### Example 1 — pull_request_target + untrusted checkout + agent step (flag)

Dangerous config (trigger pattern only, paired with fix):

```yaml
on: pull_request_target          # runs WITH base-repo secrets
jobs:
  review:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # attacker's code
      - run: run-llm-reviewer     # agent step now sees secrets + hostile code
```

Finding:
- **Pattern:** untrusted-checkout (with dangerous-trigger)
- **Severity:** high
- **Why:** `pull_request_target` exposes secrets while checking out attacker code.
- **Safer pattern:** switch to `on: pull_request` (no base secrets on fork PRs);
  if base context is required, do **not** check out or execute PR head in that job.

### Example 2 — agent prompt built from PR/issue text (flag)

```yaml
- run: run-llm-agent --prompt "Review this PR: ${{ github.event.pull_request.body }}"
```

Finding:
- **Pattern:** prompt-from-untrusted-input
- **Severity:** high
- **Why:** the PR body is attacker-controlled and is injected as instructions.
- **Safer pattern:** pass PR text to the model as clearly delimited **data**, not
  instructions; keep the trusted instruction template separate from user content.

### Example 3 — over-scoped token in an agent job (boundary/edge, flag)

```yaml
permissions: write-all           # agent job needs only read + PR comment
```

Finding:
- **Pattern:** over-scoped-token
- **Severity:** medium
- **Why:** an injected instruction inherits full write scope (push, merge, releases).
- **Safer pattern:** set least privilege, e.g. `contents: read` plus only the
  narrow write the step needs (`pull-requests: write` for a comment).

### Example 4 — safe workflow (not flagged)

```yaml
on: pull_request                 # no base secrets on fork PRs
permissions:
  contents: read                 # least privilege
jobs:
  review:
    steps:
      - uses: actions/checkout@v4        # base ref, no PR-head execution with secrets
      - run: run-llm-reviewer --input-as-data pr-diff.txt   # PR content treated as data
```

Finding: none — safer trigger, least-privilege token, PR content handled as data,
and no irreversible write without a gate.

## References

- Authoritative policy (never restated here): playbook
  [`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
  §11 (prompt injection defense), §3 (authorization and least privilege), §7 (supply chain security)
- OWASP Top 10 for Agentic Applications (2026) and OWASP Top 10 for LLM
  Applications (2025) — prompt injection and excessive-agency categories
- GitHub Actions security hardening for untrusted input, `pull_request_target`,
  and `GITHUB_TOKEN` permissions (see GitHub's official docs)
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../docs/security-skill-governance.md)
