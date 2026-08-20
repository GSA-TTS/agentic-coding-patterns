---
name: backdoor-review
id: backdoor-review
version: "1.0.0"
title: "Backdoor Review"
type: skill
description: "Read-only adversarial review that flags suspicious-pattern classes (auth bypass, unauthorized persistence, CI tampering, hidden/obfuscated jobs, data exfiltration) using strict Evidence / Hypothesis / Confidence separation — conceptual only, never producing working exploits or intrusion recipes"

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
      - "Working Exploit Payloads"
      - "Weaponized PoC Code"
      - "Step-by-step Intrusion Recipes"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "backdoor"
  - "auth bypass"
  - "persistence"
  - "CI tampering"
  - "obfuscated"
  - "exfiltration"
  - "adversarial review"

tags:
  - "security"
  - "review"
  - "adversarial"
  - "integrity"
  - "supply-chain"

categories:
  - "security"
  - "review"

risk_tier: high
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny

compliance:
  frameworks:
    - "NIST SP 800-53"
  nist_controls:
    - "SI-7"
    - "CM-3"
    - "AC-3"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Read-only adversarial review of code, config, and CI for suspicious-pattern classes"
    - "Flag candidate signs of auth bypass, unauthorized persistence, CI tampering, hidden/obfuscated jobs, or exfiltration"
    - "Separate observed evidence from inferred hypothesis with an explicit confidence level"
    - "Hand human reviewers a lead to investigate, not a verdict to act on"
  exclusions:
    - "Does NOT produce working exploits, weaponized PoC code, or step-by-step intrusion recipes"
    - "Does NOT perform remediation, run code, or make network calls"
    - "Not a substitute for a security assessor, incident responder, or authorizing official"
    - "Does not confirm a backdoor exists — it flags leads for human judgment"

source_inspiration: []  # No external source; grounded in the playbook's own guidance.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — read-only adversarial review of suspicious-pattern classes with strict Evidence/Hypothesis/Confidence separation; conceptual only, no weaponized content."

collection: security
routing:
  task_types:
    - "analyze"
    - "review"
  input_artifacts:
    - "source-code"
    - "pull-request-diff"
    - "ci-workflow"
  output_artifacts:
    - "security-review"
  prefer_when:
    - "the request implies deliberate hidden malice, obfuscation, or an auth-bypass/persistence mechanism"
  avoid_when:
    - "the request is a general vulnerability review with no sign of intentional tampering"
  aliases:
    - "backdoor scan"
    - "adversarial review"
    - "integrity review"
---

# Skill: Backdoor Review

Read code, configuration, and CI definitions with an **adversarial eye** and flag
**suspicious-pattern classes** that could indicate a backdoor: authentication
bypass, unauthorized persistence, CI tampering, hidden or obfuscated jobs, and
data-exfiltration channels. Each finding cleanly separates what is **observed**
from what is **inferred**, with a stated **confidence**.

> **Self-limiting — read this first.** This skill is a **read-only** adversarial
> review. It describes suspicious-pattern **classes** and how a human should
> **investigate** them. It **NEVER** produces a working exploit, weaponized
> proof-of-concept code, or a step-by-step intrusion recipe. Illustrative
> snippets are **descriptions of a suspicious shape**, not runnable attacks.
> Every finding separates **Evidence** (what is literally present) from
> **Hypothesis** (what it might mean) and attaches an explicit **Confidence**.
> A finding is a **lead for a human**, not a verdict. When in doubt, flag less
> and defer to human review.

## When to Use

- Reviewing a PR, dependency update, or fork diff for signs of tampering
- Auditing CI workflows after a suspicious change or a supply-chain alert
- Giving a human reviewer a prioritized list of "look here" leads
- Checking unfamiliar third-party code before adoption

## When NOT to Use

- To *confirm* a system is compromised — that is an incident-response function
- To remediate, patch, or "clean" anything — this skill only flags
- To generate exploit code, payloads, or attack instructions (never)
- To run, execute, or reach out over the network (all denied by policy)

## Prerequisites

- Read access to the diff, files, or CI config under review
- The playbook's authoritative guidance on prohibited actions and incident
  response (see **References**)
- A human reviewer who will receive and act on the findings

## Procedure

Scan for the pattern **classes** below. For **each** candidate, record three
fields — **Evidence**, **Hypothesis**, **Confidence** — then recommend a **human
investigation step**. Do **not** recommend or perform remediation, and do **not**
write anything runnable.

### 1. Authentication bypass class

Look for shapes that could let a caller skip auth:

- A hidden or undocumented admin route or debug endpoint
- A hardcoded credential compare (username/password embedded in a constant)
- "Magic value" checks (a special token, header, or query flag that short-circuits
  the auth path)

Record what is literally present. Do **not** describe how to trigger it as an
attack.

### 2. Unauthorized persistence class

Look for shapes that could survive a restart or re-establish access:

- A cron entry, systemd unit, or CI schedule added without a stated reason
- Unexpected startup hooks, boot scripts, or install-time side effects
- A new scheduled workflow that runs privileged steps

### 3. CI tampering class

Look for workflow edits that could leak secrets or run attacker code:

- A step that reads secrets and sends them somewhere off-platform
- A newly added self-hosted runner of unknown provenance
- A base64- or otherwise obfuscated step whose intent is not readable

### 4. Hidden / obfuscated code class

Look for shapes that hide intent from a reviewer:

- Long base64 (or hex) blobs that are decoded at runtime
- Dynamic `eval`-style execution of constructed strings
- Unusual encodings, string concatenation, or layered decoding

### 5. Exfiltration channel class

Look for shapes that could move data out:

- Unexpected outbound network calls to unfamiliar hosts
- Patterns consistent with DNS tunneling (data encoded into lookups)
- Data written to an external sink not tied to the feature's purpose

### 6. Record and hand off

For every candidate, write the three-field finding (below) plus a **Suggested
next step** that names a **human investigation**, such as: "ask the author why
this schedule was added," "confirm the runner's provenance with the platform
owner," or "route to incident response per the playbook." **Never** propose an
attack or a code change.

## Evidence Discipline

This separation is the skill's signature. Keep the three ideas apart:

- **Evidence** — what is *literally present* in the reviewed material. Quotable,
  checkable, no interpretation. Example: "a workflow step decodes a base64 env
  var and pipes the result to a shell."
- **Hypothesis** — what the evidence *might* mean. Clearly labeled as inference,
  never stated as fact. Example: "this could be an obfuscated exfiltration or
  code-execution step."
- **Confidence** — **low / medium / high**, with a one-line reason. Confidence
  reflects how strongly the evidence supports the hypothesis, *not* certainty
  that a backdoor exists.

If you cannot state evidence without inferring, you have a hypothesis, not
evidence. Keep them in separate fields.

## Output Contract

```markdown
## Summary
<1-3 sentences: how many candidates reviewed, how many flagged, top concern.
State plainly that these are leads for human review, not confirmed backdoors.>

## Findings
For each flagged candidate:
- **Pattern class:** auth-bypass | persistence | ci-tampering | obfuscation | exfiltration
- **Location:** <file/workflow/line>
- **Evidence:** <what is literally present — no interpretation>
- **Hypothesis:** <what it might mean — clearly labeled as inference>
- **Confidence:** low | medium | high — <one-line reason>
- **Suggested next step:** <a HUMAN investigation, e.g. "ask the author",
  "confirm provenance", "route to incident response" — never an attack or a fix>

## Notes
- These are leads for human judgment; this review confirms nothing.
- Contains no working exploit, payload, or intrusion recipe.
```

## Verification

Before returning, confirm:

- **Every** finding has all three separated fields: Evidence, Hypothesis,
  Confidence — and a human-facing Suggested next step
- Evidence contains **no** interpretation; Hypothesis is clearly labeled as
  inference; Confidence is low/medium/high with a reason
- The output contains **NO** working exploit, weaponized PoC, payload, or
  step-by-step intrusion recipe (check against the prohibited-content rules)
- No secrets, real PII, real CUI, or internal URLs appear in the report
- No remediation actions or code changes are proposed — only human investigation

## Examples

All examples are **synthetic** and **conceptual**. Snippets describe a
*suspicious shape*; none is a runnable attack.

### Example 1 — CI step decodes and pipes to a shell (obfuscation / exfil)

- **Pattern class:** obfuscation / ci-tampering
- **Location:** `.github/workflows/build.yml`, step "prepare"
- **Evidence:** a workflow step base64-decodes an environment variable and pipes
  the decoded output into a shell interpreter.
- **Hypothesis:** the decoded content is hidden from reviewers and could execute
  arbitrary commands or exfiltrate secrets during the run.
- **Confidence:** medium — the shape strongly matches obfuscated execution, but
  the decoded content is not visible, so intent is unconfirmed.
- **Suggested next step:** ask the author to show the decoded content and justify
  the step; if unexplained, route to incident response per the playbook.

### Example 2 — hardcoded credential compare (auth bypass)

- **Pattern class:** auth-bypass
- **Location:** `auth/login.go`, `checkLogin()`
- **Evidence:** the login path compares the supplied username and password
  against a constant string embedded in the source.
- **Hypothesis:** this could be a hidden fixed credential that bypasses normal
  authentication.
- **Confidence:** high — an embedded credential compare in the auth path is
  rarely legitimate.
- **Suggested next step:** ask the author why a constant credential exists;
  treat as a potential backdoor pending their answer.

### Example 3 — new scheduled workflow with privileged step (persistence)

- **Pattern class:** persistence
- **Location:** `.github/workflows/nightly.yml`
- **Evidence:** a new scheduled workflow was added that runs a privileged
  deploy step every night, with no linked issue or description.
- **Hypothesis:** this may be a legitimate nightly deploy, or an unauthorized
  persistence mechanism.
- **Confidence:** low — scheduled privileged jobs are common and often benign;
  the only concern is the missing justification.
- **Suggested next step:** confirm the schedule's purpose and owner in the PR.

### Example 4 — benign base64, NOT a finding (false-positive discipline)

- **Pattern class:** obfuscation (considered, then cleared)
- **Location:** `assets/logo.ts`
- **Evidence:** a long base64 string is assigned to a constant named
  `LOGO_PNG_DATA_URI` and rendered as an inline image.
- **Hypothesis:** base64 can hide code, so this was reviewed.
- **Confidence:** high that this is benign — the value is a documented inline
  image asset, is never decoded to executable code, and is never piped to a
  shell or interpreter.
- **Result:** **not flagged.** Presence of base64 alone is not evidence of a
  backdoor; the decoded use is a static image, not execution.

## References

- Authoritative policy (never restated here): playbook
  [`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
  — §10 Prohibited Actions and §9 Incident Response
- Integrity control (NIST SP 800-53 **SI-7**, Software/Firmware/Information
  Integrity):
  [`SECURITY-CONTROLS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../../docs/security-skill-governance.md)
