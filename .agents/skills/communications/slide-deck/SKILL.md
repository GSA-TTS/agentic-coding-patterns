---
id: slide-deck
version: "1.0.0"
title: "Slide Deck"
description: "Render a presentation deck (HTML source plus PDF export and a PNG preview) from a storyboard and visual contract, one beat per slide, with locally vendored assets and accessibility built in."
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
  - "slide deck"
  - "presentation"
  - "slides"
tags:
  - "communications"
  - "design"
  - "slide-deck"
routing:
  task_types:
    - author
    - render
  input_artifacts:
    - storyboard
    - visual-contract
    - artifact-brief
  output_artifacts:
    - slide-deck
  aliases:
    - "presentation deck"
    - "briefing slides"
  prefer_when:
    - "the requested output is a multi-slide presentation"
  avoid_when:
    - "the request is a single-page summary"
    - "the request is motion/video"
  delegates:
    - pattern: one-pager
      when: "the request is a single-page summary, not a deck"
    - pattern: explainer-video
      when: "the request is an animated/narrated video"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: Slide Deck

## Summary

Render a **multi-slide** presentation from a storyboard +
[`visual-direction`](../visual-direction/SKILL.md) contract — one beat per
slide. Output is multi-file: an **HTML source** (editable master, e.g. a
reveal-style deck), a **PDF export**, and a **PNG preview** of the title slide.
All assets are locally vendored (no external CDN).

## When to Use

- The deliverable is a presentation / briefing deck.
- You have a storyboard and visual contract.

## When NOT to Use

- Single-page summary → `one-pager`.
- Motion/video → `explainer-video` / `explainer-gif`.

## Prerequisites

- Storyboard (one beat ≈ one slide), visual contract, brief.
- Offline headless Chromium + PDF/PNG renderer.

## Procedure

1. **One beat per slide** — title/message slide first, then a slide per beat,
   closing on the action.
2. **Author the composition HTML** — self-contained deck, assets inlined/vendored,
   semantic headings per slide, alt text, high-contrast large type.
3. **Check contrast + reading order** meet WCAG AA.
4. **Render exports** — HTML → PDF (one page per slide) and a PNG of slide 1.
5. **Emit** the composition HTML, the render command, and the review checklist.

## Composition HTML

A complete offline deck (e.g. sections as slides) using the visual contract's
tokens; no external requests; alt text on all images.

## Render Command

```bash
# Offline deck -> PDF + title PNG (headless Chromium). Adjust to your renderer.
chromium --headless --print-to-pdf=deck.pdf deck.html
chromium --headless --screenshot=deck-title.png --window-size=1280,720 deck.html
```

## Verification

- One beat per slide; title slide carries the core message.
- WCAG AA contrast; large readable type.
- No external requests during render (all vendored).

## Examples

| Brief | Result |
|-------|--------|
| "Deck for the pilot review" | title/message → problem → approach → proof → ask, HTML+PDF+PNG |

## Human Review Checklist

- [ ] One beat per slide; core message on the title slide.
- [ ] WCAG AA contrast; images have alt text.
- [ ] All assets locally vendored — no CDN, no internal URLs.
- [ ] No secrets, PII, or CUI.

## Notes

Usually invoked by the `design-artifact` workflow and validated by `artifact-qa`.
