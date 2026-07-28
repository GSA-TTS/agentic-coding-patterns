---
id: artifact-brief
version: "1.0.0"
title: "Artifact Brief"
description: "Capture the audience, action, core message, evidence, and constraints for a communication artifact before any design or drafting begins, producing a small structured brief the rest of the design-artifact pipeline consumes."
type: skill
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - developers
  - developer-advocates
  - technical-writers
requires:
  anchors: []
  skills: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Brief"
      - "Human Review Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
collection: communications
triggers:
  - "artifact brief"
  - "who is the audience"
  - "what is the core message"
tags:
  - "communications"
  - "planning"
  - "briefing"
routing:
  task_types:
    - plan
  input_artifacts:
    - documentation
  output_artifacts:
    - artifact-brief
  aliases:
    - "comms brief"
    - "message brief"
  prefer_when:
    - "starting any executive/marketing/explainer artifact and the audience, action, or core message is not yet pinned down"
  priority: 60
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: Artifact Brief

## Summary

Before designing or drafting any communication artifact (one-pager, slide deck,
explainer), capture the decisions that everything downstream depends on:
**who** it's for, **what** you want them to do, the **one core message**, the
**evidence** that supports it, and the **constraints** (length, format, brand,
deadline). This produces a small structured brief the rest of the
`design-artifact` pipeline reads — so narrative, visuals, and QA all serve the
same goal instead of guessing.

## When to Use

- Kicking off an executive one-pager, slide deck, or explainer.
- The audience, desired action, or core message is fuzzy or unstated.
- Multiple people will contribute and need a shared source of truth.

## When NOT to Use

- The brief already exists (feed it straight to `narrative-architect`).
- You are only reviewing an existing artifact (use `artifact-qa`).

## Prerequisites

- The raw material: what happened, the ask, and any supporting numbers.

## Procedure

1. **Audience.** Name the specific reader and their context (e.g. "an agency
   CIO deciding whether to fund a pilot"), their prior knowledge, and what they
   care about. One primary audience — not "everyone."
2. **Action.** State the single decision or action you want them to take after
   reading. If there are two, split into two artifacts.
3. **Core message.** One sentence they should remember. Everything else supports
   it or is cut.
4. **Evidence.** The 3–5 strongest facts/numbers/quotes that make the core
   message credible. Note the source of each (no fabricated figures).
5. **Constraints.** Output profile (one-pager / slide-deck / explainer), length,
   brand/USWDS requirements, accessibility level, deadline, and any prohibited
   content.
6. **Emit the brief** in the structured shape below.

## Brief shape

```yaml
audience: "..."
action: "..."
core_message: "..."
evidence:
  - claim: "..."
    source: "..."
constraints:
  profile: one-pager | slide-deck | technical-explainer | marketing-kit
  length: "..."
  accessibility: "508 / WCAG AA"
  deadline: "..."
```

## Verification

- Exactly one audience and one action.
- Core message fits in one sentence.
- Every evidence item names a real source (none invented).
- Constraints name a concrete output profile.

## Examples

| Raw ask | Audience | Action | Core message |
|---------|----------|--------|--------------|
| "Tell leadership the pilot worked" | Agency CIO | Fund phase 2 | "The pilot cut review time 40% with no security regressions." |

## Human Review Checklist

- [ ] Audience is one specific reader, not "everyone."
- [ ] The action is a single concrete decision.
- [ ] Every number/quote traces to a real source.
- [ ] No secrets, PII, CUI, or internal URLs.

## Notes

Feeds `narrative-architect` (structure) → `visual-direction` (look) →
`one-pager`/`slide-deck` (render) → `artifact-qa` (validate). The
`design-artifact` workflow orchestrates the whole chain.
