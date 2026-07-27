---
name: incident-evidence-review
id: incident-evidence-review
version: "1.0.0"
title: "Incident Evidence Review"
type: skill
description: "Review incident and postmortem write-ups for evidence discipline — separating facts, assumptions, hypotheses, and timeline — and flag unsupported claims, without conducting the investigation or determining root cause"

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
      - "Real Incident Data"
      - "Live IOCs Or Victim Identifiers"
      - "Internal Hostnames"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "incident review"
  - "postmortem"
  - "evidence discipline"
  - "root cause"
  - "timeline"
  - "hypothesis"
  - "assumption"

tags:
  - "security"
  - "incident-response"
  - "postmortem"
  - "evidence"

categories:
  - "security"
  - "incident-response"
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
    - "NIST SP 800-61"
  nist_controls:
    - "IR-4"
    - "IR-6"
    - "AU-6"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review an incident write-up or postmortem draft for evidence discipline"
    - "Classify each statement as fact, assumption, hypothesis, or timeline entry"
    - "Flag claims presented as fact that lack a source or log citation"
    - "Flag hypotheses stated as settled conclusions"
    - "Flag real PII, IOCs, or hostnames that should be redacted from the write-up"
  exclusions:
    - "Does NOT conduct the investigation or gather live evidence"
    - "Not a SIEM, log analyzer, or detection tool"
    - "Does NOT determine authoritative root cause — that is the IR team's role"
    - "Not for live incident response; defers process to the agency IR plan"

source_inspiration: []  # No external source; grounded in the playbook and NIST IR guidance.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — enforces evidence discipline on incident/postmortem write-ups by classifying facts, assumptions, hypotheses, and timeline, and flagging unsupported claims; conducts no investigation and asserts no root cause."

collection: security
routing:
  task_types:
    - "review"
    - "analyze"
  input_artifacts:
    - "incident-evidence"
    - "documentation"
  output_artifacts:
    - "security-review"
  prefer_when:
    - "the request is to review incident evidence or a postmortem"
  aliases:
    - "postmortem review"
    - "incident review"
    - "evidence discipline"
---

# Skill: Incident Evidence Review

Review an incident or postmortem write-up for **evidence discipline**. Sort every
statement into **facts**, **assumptions**, **hypotheses**, and **timeline**
entries, then flag anything presented as fact that lacks support and any
hypothesis stated as a settled conclusion.

> **Self-limiting: this skill reviews incident write-ups; it does not run the
> investigation.** It never gathers live evidence, never determines authoritative
> root cause, and never handles live incident data. All examples here are
> synthetic. The investigation process itself belongs to the
> [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
> and your agency incident-response (IR) plan; this skill defers to both.

## When to Use

- Reviewing a postmortem or incident report draft before it is shared
- Checking whether a write-up's conclusions are actually supported by evidence
- Separating what was observed from what was guessed after an incident
- Confirming a timeline is complete and ordered before publication

## When NOT to Use

- During a live incident — follow the IR plan, not a document review
- To *decide* root cause — that is the IR team's determination, not this skill's
- As a log-analysis or detection tool (this skill reads prose, not telemetry)
- To handle real incident data, IOCs, or victim details — those must be redacted
  before any review

## Prerequisites

- Access to the incident write-up or postmortem text being reviewed
- The text should already be sanitized: no live IOCs, real hostnames/IPs, or
  victim identifiers. If it is not, redaction is the first finding.
- Familiarity with the agency IR plan and the playbook IR guidance (referenced,
  not restated here)

## Procedure

### 1. Read the material

Read the full incident or postmortem write-up before classifying anything.
Note the section structure (summary, narrative, timeline, root cause,
remediation) so each statement is judged in context.

### 2. Classify each statement

Sort every substantive statement into exactly one class:

| Class | Definition |
|-------|------------|
| **FACT** | An observed event backed by a source — a log line, alert, ticket, or artifact citation |
| **ASSUMPTION** | Taken as given but not verified — a working premise, not evidence |
| **HYPOTHESIS** | A proposed explanation not yet confirmed by evidence |
| **TIMELINE** | A time-ordered event entry (timestamp + what happened) |

### 3. Flag facts without evidence

Flag any statement presented as a **fact** that names no source. A claim like
"the outage began at 02:00" is a fact only if a log, alert, or ticket supports
it. With no citation, downgrade it to an **assumption** or require the source.

### 4. Flag hypotheses stated as conclusions

Flag any **hypothesis** written as settled fact — for example, "the attacker
used stolen credentials" stated with certainty but no supporting evidence. A
hypothesis MUST read as a proposed explanation until evidence confirms it.

### 5. Check the timeline

Review the timeline for **gaps** (unexplained jumps between events) and
**ordering** problems (events out of sequence, or effects listed before their
causes). Note any timestamp that is asserted without a source.

### 6. Flag data that must be redacted

Flag any **real** PII, IOC (IP, domain, hash), hostname, or victim identifier
that appears in the write-up and should be redacted before sharing. Recommend a
synthetic placeholder in its place.

### 7. Report — do not conclude root cause

Produce the output below. The report classifies statements, flags unsupported
claims, and recommends fixes. It **never** asserts the authoritative root cause
and **never** reproduces real incident data.

## Evidence Discipline

This is the heart of the skill: keep the four classes distinct and never let one
masquerade as another.

- A **fact** is something that was *observed* and can be *pointed to* — "the auth
  service returned 500s from 02:00–02:14 (per app log)." No source, not a fact.
- An **assumption** is a premise *taken as true to move forward* — "we assume the
  config change deployed cleanly." Useful, but unverified, and must be labeled so.
- A **hypothesis** is a *proposed explanation* under test — "the 500s were caused
  by the config change." It stays a hypothesis until evidence confirms it.
- The classic failures are a **hypothesis dressed as a conclusion** ("the config
  change caused the outage") and an **assumption dressed as a fact** ("the change
  deployed cleanly"). Flag both. Naming the class is the discipline.

## Output Contract

```markdown
## Summary
<1-3 sentences: how many statements reviewed, how many flagged, and whether any
real data needs redaction.>

## Findings
For each reviewed statement:
- **Statement (quoted):** "<the exact text>"
- **Class:** FACT | ASSUMPTION | HYPOTHESIS | TIMELINE
- **Evidence:** <cited source, or "none given">
- **Flag:** unsupported-fact | hypothesis-as-conclusion | timeline-gap |
  needs-redaction | none
- **Suggested fix:** <cite the log | downgrade to assumption/hypothesis | add the
  missing timeline entry | redact and use a synthetic placeholder>

## Notes
- This review checks evidence discipline only; it does not determine root cause.
  See the playbook and the agency IR plan for the investigation process.
```

## Verification

- Every reviewed statement is classified (FACT / ASSUMPTION / HYPOTHESIS /
  TIMELINE) — nothing is left unlabeled
- Every statement presented as a fact without a source is flagged
  `unsupported-fact`, and every hypothesis stated as certain is flagged
  `hypothesis-as-conclusion`
- The output contains **no** real incident data, PII, IOCs, or hostnames — every
  example is synthetic (check against the prohibited-content rules)
- The report makes no authoritative root-cause determination of its own

## Examples

All examples use **synthetic** incident data only.

### Example 1 — fact without evidence

Input: `> The breach started at 02:00.`

Finding:
- **Class:** FACT (as written)
- **Evidence:** none given
- **Flag:** unsupported-fact
- **Suggested fix:** cite the log or alert that shows the 02:00 start, or
  downgrade to an assumption ("we believe it started around 02:00") until a
  source is attached.

### Example 2 — hypothesis stated as a conclusion

Input: `> The attacker used stolen credentials to log in.`

Finding:
- **Class:** HYPOTHESIS
- **Evidence:** none given
- **Flag:** hypothesis-as-conclusion
- **Suggested fix:** reword as a hypothesis under test ("a leading hypothesis is
  stolen-credential reuse; pending auth-log review") until an authentication log
  confirms it.

### Example 3 — well-supported fact (not flagged)

Input: `> The auth service returned HTTP 500s from 02:00–02:14 (per the
application log, request IDs redacted).`

Finding:
- **Class:** FACT
- **Evidence:** application log (cited), sensitive fields redacted
- **Flag:** none — observed, sourced, and scoped. Correctly not flagged.

### Example 4 — timeline gap

Input:
```
02:00 — errors begin
02:45 — service restored
```

Finding:
- **Class:** TIMELINE
- **Flag:** timeline-gap
- **Suggested fix:** the 45-minute span between "errors begin" and "restored"
  has no intervening entries; add the detection, escalation, and mitigation
  events (with sources) to close the gap.

## References

- Authoritative IR process (never restated here): playbook
  [`AGENTS.md` §9 Incident Response](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
- NIST SP 800-61, *Computer Security Incident Handling Guide* (IR guidance)
- NIST SP 800-53 IR-4 (Incident Handling), IR-6 (Incident Reporting), AU-6
  (Audit Record Review) — controls this review supports
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../docs/security-skill-governance.md)
