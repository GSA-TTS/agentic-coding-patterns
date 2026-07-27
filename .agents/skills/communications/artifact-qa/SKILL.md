---
id: artifact-qa
version: "1.0.0"
title: "Artifact QA"
description: "Render, inspect, and validate a produced communication artifact against its brief and visual contract — checking the actual output files (HTML/PDF/PNG), accessibility, offline-safety, and prohibited content — then report pass/fail with concrete fixes."
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
      - "Findings"
      - "Human Review Checklist"
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
  - "artifact qa"
  - "check this deck"
  - "validate this one-pager"
tags:
  - "communications"
  - "qa"
  - "review"
routing:
  task_types:
    - review
    - test
  input_artifacts:
    - one-pager
    - slide-deck
  output_artifacts:
    - qa-report
  aliases:
    - "design qa"
    - "artifact review"
  prefer_when:
    - "a communication artifact (one-pager, deck, explainer) has been produced and needs validation of the actual files"
  delegates:
    - pattern: accessibility-review
      when: "the artifact is a web page/prototype needing a full 508/WCAG audit"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: Artifact QA

## Summary

Validate a **produced** communication artifact, not just a markdown answer:
render it, inspect the **actual output files** (HTML/PDF/PNG), and check it
against its brief and visual contract. Confirms accessibility, offline-safety
(no external requests), and that no prohibited content leaked, then reports
pass/fail with concrete fixes.

## When to Use

- A one-pager, slide deck, or explainer has been produced and needs sign-off.
- You need to confirm the rendered files (not just the source) are correct.

## When NOT to Use

- Nothing has been rendered yet (produce it first).
- A full web-app 508 audit is needed → delegate to `accessibility-review`.

## Prerequisites

- The artifact's output files + its brief and visual contract.
- Offline headless renderer to re-render and inspect.

## Procedure

1. **Re-render** the source and confirm exports regenerate deterministically.
2. **Inspect the actual files** — open the PDF/PNG/HTML; confirm the one-pager is
   one page, the deck has the expected slide count, and the preview matches.
3. **Brief conformance** — the core message leads and is dominant; the closing
   action is present; primary beats are all there.
4. **Accessibility** — WCAG AA contrast on every text/background pair; semantic
   structure; alt text on images; sensible reading order.
5. **Offline-safety** — no external network requests during render; all assets
   vendored.
6. **Prohibited content** — no secrets, real PII, real CUI, internal URLs.
7. **Report** findings with concrete, actionable fixes; mark PASS/FAIL.

## Findings

Report as a table: check | result (pass/fail) | evidence | fix.

## Verification

- The check inspected the **rendered files**, not only the markdown/source.
- Contrast ratios are stated, not assumed.
- A FAIL names the exact file + fix.

## Examples

| Artifact | Typical finding |
|----------|-----------------|
| one-pager | "PDF spills to 2 pages — reduce proof-card padding" |
| slide-deck | "Slide 4 body text 3.9:1 contrast (<4.5 AA) — darken text token" |

## Human Review Checklist

- [ ] Rendered files inspected (not just the source).
- [ ] WCAG AA contrast verified with stated ratios.
- [ ] No external requests; assets vendored.
- [ ] No secrets, PII, CUI, or internal URLs in the artifact.

## Notes

Final stage of the `design-artifact` workflow. For web prototypes/pages, defer
the deep conformance audit to `accessibility-review`.
