---
id: design-artifact
version: "1.0.0"
title: "Design Artifact Workflow"
description: "End-to-end workflow to produce a QA'd communication artifact — brief, narrative, visual direction, render, validate — selecting an output profile (one-pager or slide-deck) so one shared pipeline serves every format."
type: workflow
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - developers
  - developer-advocates
  - technical-writers
requires:
  anchors: []
  skills:
    - artifact-brief
    - narrative-architect
    - visual-direction
    - one-pager
    - slide-deck
    - artifact-qa
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Outcome"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "External CDN Links"
quality_gates:
  readability_max_grade: 10
  citations_required: false
collection: communications
triggers:
  - "design artifact"
  - "make an executive one-pager"
  - "create a slide deck"
  - "build a communication artifact"
tags:
  - "workflow"
  - "communications"
  - "design"
routing:
  task_types:
    - orchestrate
    - author
    - visualize
    - render
    - review
  input_artifacts:
    - documentation
  output_artifacts:
    - one-pager
    - slide-deck
  aliases:
    - "executive one-pager"
    - "presentation deck"
    - "design pipeline"
  prefer_when:
    - "the request is to create an executive/marketing/explainer artifact (one-pager, deck) end to end"
  priority: 70
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Workflow: Design Artifact

## Summary

Turn a request for a communication artifact into a finished, QA'd deliverable.
The workflow runs one shared pipeline —
[`artifact-brief`](../../skills/communications/artifact-brief/SKILL.md) →
[`narrative-architect`](../../skills/communications/narrative-architect/SKILL.md) →
[`visual-direction`](../../skills/communications/visual-direction/SKILL.md) →
renderer →
[`artifact-qa`](../../skills/communications/artifact-qa/SKILL.md) —
and selects an **output profile** for the render step so the same briefing,
narrative, and QA don't get duplicated across four separate workflows.

## When to Use

- "Create an executive one-pager / slide deck about X."
- Any request to produce a communication artifact from raw material.

## When NOT to Use

- You only need to *review* an existing artifact → `artifact-qa` directly.
- The output is a live website/prototype → the `uswds-*` skills.
- The output is motion/video → `explainer-video` / `explainer-gif`.

## Output profiles

```yaml
profiles:
  - one-pager            # → skills/communications/one-pager
  - slide-deck           # → skills/communications/slide-deck
  - technical-explainer  # (future) longer explanatory doc
  - marketing-kit        # (future) multi-asset outreach bundle
```

The profile is chosen from the brief's `constraints.profile`. `one-pager` and
`slide-deck` are implemented today; the other two are placeholders for future
renderers and should route to the closest implemented profile until they exist.

## Procedure

1. **Brief** — run `artifact-brief` to pin audience, action, core message,
   evidence, constraints (incl. the output profile).
2. **Narrative** — run `narrative-architect` to produce the storyboard (beats +
   hierarchy) for that profile.
3. **Visual direction** — run `visual-direction` to produce the visual contract
   (layout, type, color, spacing, vendored assets).
4. **Render** — dispatch to the profile's renderer:
   - `one-pager` → `one-pager` skill
   - `slide-deck` → `slide-deck` skill
5. **QA** — run `artifact-qa` on the rendered files; if it FAILs, loop back to
   the smallest responsible step (usually render or visual-direction) and
   re-run.
6. **Accessibility** — for web-delivered artifacts, additionally run
   `accessibility-review`.

## Outcome

Report the profile chosen, the produced files, and the `artifact-qa` verdict
(PASS/FAIL with fixes applied).

## Verification

- Exactly one output profile was selected and rendered.
- `artifact-qa` PASSed on the actual rendered files.
- No external requests; all assets vendored.

## Notes

This workflow is why the individual communications skills stay small and
single-purpose: the workflow owns orchestration and profile selection; each
skill owns one step. The `pattern-router` prefers this workflow over assembling
the skills by hand for a full artifact request.
