---
id: one-pager
version: "1.0.0"
title: "One-Pager"
description: "Render a single-page executive artifact (HTML source plus PDF/PNG exports) from a storyboard and visual contract, following the design-artifact pipeline, with all assets locally vendored and accessibility built in."
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
  format: multi
  artifacts:
    - role: source
      media_type: text/html
      extension: html
    - role: export
      media_type: application/pdf
      extension: pdf
    - role: preview
      media_type: image/png
      extension: png
  contract:
    required_sections:
      - "Summary"
      - "Composition HTML"
      - "Render Command"
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
  - "one-pager"
  - "one page summary"
  - "executive summary"
tags:
  - "communications"
  - "design"
  - "one-pager"
routing:
  task_types:
    - author
    - render
  input_artifacts:
    - storyboard
    - visual-contract
    - artifact-brief
  output_artifacts:
    - one-pager
  aliases:
    - "executive one-pager"
    - "leave-behind"
  prefer_when:
    - "the requested output is a single-page summary artifact"
  avoid_when:
    - "the request is a multi-slide deck"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: One-Pager

## Summary

Render a **single-page** executive artifact from a storyboard +
[`visual-direction`](../visual-direction/SKILL.md) contract. Output is
multi-file: an **HTML source** (the editable master), a **PDF export** (the
share/print copy), and a **PNG preview**. All assets are locally vendored (no
external CDN), and the layout follows the visual contract so it's accessible and
on-brand.

## When to Use

- The requested deliverable is a one-page summary / leave-behind.
- You already have a storyboard and visual contract.

## When NOT to Use

- The ask is a multi-slide deck → `slide-deck`.
- The ask is motion/video → `explainer-video` / `explainer-gif`.

## Prerequisites

- Storyboard (beats + hierarchy), visual contract, and the brief.
- Headless Chromium + a PDF/PNG renderer available offline.

## Procedure

1. **Lay out the beats** on one page per the visual contract: message header,
   supporting proof blocks, closing action.
2. **Author the composition HTML** — self-contained, assets inlined or locally
   vendored, semantic markup (headings, landmarks, alt text).
3. **Verify contrast + reading order** meet WCAG AA before export.
4. **Render exports** — HTML → PDF (print CSS, one page) and a PNG preview.
5. **Emit** the composition HTML, the render command, and the review checklist.

## Composition HTML

Provide a complete, offline, single-file HTML document using the visual
contract's tokens. Semantic structure; alt text on every image; no external
requests.

## Render Command

```bash
# Offline HTML -> PDF + PNG (headless Chromium). Adjust to your renderer.
chromium --headless --print-to-pdf=one-pager.pdf one-pager.html
chromium --headless --screenshot=one-pager.png --window-size=1200,1553 one-pager.html
```

## Verification

- Output fits **one page** in the PDF.
- Every text/background pair meets WCAG AA.
- No external network requests during render (all vendored).
- Core message is the visually dominant element.

## Examples

| Brief | Result |
|-------|--------|
| "Executive one-pager for the pilot" | message header + 3 proof cards + fund-phase-2 ask, HTML+PDF+PNG |

## Human Review Checklist

- [ ] Fits one page; core message dominant.
- [ ] WCAG AA contrast; images have alt text.
- [ ] All assets locally vendored — no CDN, no internal URLs.
- [ ] No secrets, PII, or CUI.

## Notes

Usually invoked by the `design-artifact` workflow after
`artifact-brief` → `narrative-architect` → `visual-direction`, and validated by
`artifact-qa`.
