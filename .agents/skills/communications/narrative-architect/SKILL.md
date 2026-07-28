---
id: narrative-architect
version: "1.0.0"
title: "Narrative Architect"
description: "Turn an artifact brief into an information hierarchy and argument sequence — the order in which points are made and how they build to the core message — before any visual design or rendering."
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
      - "Narrative"
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
  - "narrative structure"
  - "information hierarchy"
  - "argument sequence"
tags:
  - "communications"
  - "narrative"
  - "structure"
routing:
  task_types:
    - plan
    - visualize
  input_artifacts:
    - artifact-brief
  output_artifacts:
    - storyboard
  aliases:
    - "story structure"
    - "outline the argument"
  prefer_when:
    - "you have a brief and need the order + hierarchy of points before choosing visuals"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: Narrative Architect

## Summary

Given an [`artifact-brief`](../artifact-brief/SKILL.md), decide the
**information hierarchy** (what's primary vs supporting) and the **argument
sequence** (the order that builds to the core message). Output a storyboard the
visual and rendering skills follow — so the artifact leads with the point, not
with background.

## When to Use

- You have a brief and need the structure before visuals or slides exist.
- An artifact feels like a data dump with no through-line.

## When NOT to Use

- The brief doesn't exist yet (run `artifact-brief` first).
- You're choosing colors/layout (that's `visual-direction`).

## Prerequisites

- A completed artifact brief (audience, action, core message, evidence).

## Procedure

1. **Lead with the core message.** The first beat states the takeaway; do not
   bury it after setup.
2. **Order the evidence** to build the argument — strongest support first for a
   skeptical audience, or problem→solution→proof for a narrative one.
3. **Assign hierarchy** — mark each beat primary (must land) or supporting
   (cut first if space runs out).
4. **Map beats to the output profile** — a one-pager gets ~3–5 beats; a slide
   deck gets one beat per slide; an explainer gets a scene per beat.
5. **End on the action** from the brief.
6. **Emit the storyboard** below.

## Narrative shape

```yaml
core_message: "..."
beats:
  - id: 1
    point: "..."
    role: primary | supporting
    evidence_ref: "which brief evidence item"
closing_action: "..."
```

## Verification

- Beat 1 is the core message, not background.
- Every beat maps to a brief evidence item or the action.
- Primary beats alone still tell the whole story (supporting are droppable).
- Beat count fits the target profile.

## Examples

| Profile | Beats |
|---------|-------|
| one-pager | message → 3 proofs → ask |
| slide-deck | title/message → problem → approach → proof → ask |

## Human Review Checklist

- [ ] The core message leads.
- [ ] Cutting supporting beats still leaves a coherent argument.
- [ ] The closing is the brief's action.
- [ ] No secrets, PII, CUI, or internal URLs.

## Notes

Consumes the brief; produces a storyboard for `visual-direction` and the
renderers. Orchestrated by `design-artifact`.
