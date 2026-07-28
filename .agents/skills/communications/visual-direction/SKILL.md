---
id: visual-direction
version: "1.0.0"
title: "Visual Direction"
description: "Turn a storyboard into a concrete visual contract — layout, type scale, color, spacing, and asset rules (USWDS-aligned where federal) — that a renderer can follow to produce an accessible, on-brand artifact."
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
      - "Visual Contract"
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
  - "visual direction"
  - "design direction"
  - "layout and color"
tags:
  - "communications"
  - "design"
  - "visual"
routing:
  task_types:
    - visualize
  input_artifacts:
    - storyboard
  output_artifacts:
    - visual-contract
  aliases:
    - "design system for this artifact"
    - "look and feel"
  prefer_when:
    - "you have a storyboard and need the concrete visual rules before rendering"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Skill: Visual Direction

## Summary

Given a storyboard from [`narrative-architect`](../narrative-architect/SKILL.md),
produce a **visual contract**: the concrete layout, type scale, color roles,
spacing, and asset rules a renderer follows. For federal artifacts, align to
USWDS tokens. The contract is deterministic enough that
`one-pager`/`slide-deck` can render without re-deciding design.

## When to Use

- You have a storyboard and need the look-and-feel pinned before rendering.
- Multiple renderers/formats must stay visually consistent.

## When NOT to Use

- No storyboard yet (run `narrative-architect`).
- You're building a full interactive site (see the `uswds-*` skills).

## Prerequisites

- A storyboard (beats + hierarchy) and the brief's constraints (brand, a11y).

## Procedure

1. **Grid & layout** — pick a layout per beat that reflects its hierarchy
   (primary beats get dominant space).
2. **Type scale** — heading/body/caption sizes with a clear ratio; enough
   contrast for the primary message to dominate.
3. **Color roles** — background, text, accent, and semantic colors as named
   roles (not one-off hex). USWDS tokens where federal. All text/background pairs
   must meet WCAG AA contrast.
4. **Spacing** — a consistent spacing unit; whitespace protects the primary
   message.
5. **Assets** — allowed asset types and the rule that all assets are **locally
   vendored** (no external CDN links; matches explainer skills).
6. **Emit the visual contract** below.

## Visual Contract shape

```yaml
grid: "..."
type_scale:
  heading: "..."
  body: "..."
  caption: "..."
color_roles:
  background: "..."
  text: "..."
  accent: "..."
contrast: "WCAG AA verified"
spacing_unit: "..."
assets: "locally vendored only; no external CDN"
```

## Verification

- Every text/background pair meets WCAG AA (state the ratios).
- Primary beats are visually dominant.
- No external CDN/asset links — all vendored.
- Tokens/roles named, not scattered literals.

## Examples

| Profile | Direction |
|---------|-----------|
| one-pager | single column, big message header, 3 proof cards |
| slide-deck | 16:9, one message per slide, large type, high contrast |

## Human Review Checklist

- [ ] Contrast meets WCAG AA for all text.
- [ ] Assets are locally vendored (no CDN).
- [ ] Visual hierarchy matches the storyboard's primary/supporting split.
- [ ] No secrets, PII, CUI, or internal URLs.

## Notes

Consumes the storyboard; produces the visual contract for `one-pager` /
`slide-deck`. Accessibility is verified end-to-end by `artifact-qa` (and, for
web artifacts, `accessibility-review`).
