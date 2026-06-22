# Outreach Skills

Skills for producing developer-relations and outreach media — explainer videos,
terminal screencasts, and similar artifacts that show what a tool or service
does.

> **Status:** Experimental | **License:** CC0-1.0

## Overview

These skills help AI coding agents produce **outreach media drafts** — animated
explainers, demo GIFs, and the like — for slide decks, READMEs, and landing
pages. They produce drafts and review aids, not publish-ready artifacts. Human
review is always required before publishing.

## The `explainer-*` Family

Outreach explainer skills share a naming convention so the namespace stays
predictable as it grows:

| Skill | Use When |
|-------|----------|
| [explainer-video](explainer-video/SKILL.md) | Producing an animated MP4 explainer from a hand-authored HTML composition (slide decks, landing pages) |
| [explainer-gif](explainer-gif/SKILL.md) | Recording a CLI tool as a deterministic, accessible terminal-screencast GIF (README heroes, quick previews) |
| explainer-html *(planned)* | An interactive or embeddable HTML explainer (not yet authored) |

Pick by where the artifact will live: a GIF embeds inline anywhere (including a
committed repo path), while an MP4 is smaller and higher fidelity but needs
hosting to play inline. The two skills cross-reference each other.

## Design Principles

1. **Accessible by default** — Pair every motion/color artifact with a text
   summary and a poster or alt text; meet WCAG contrast and use-of-color
   guidance so meaning survives without playback.
2. **Deterministic and reproducible** — Script the artifact (a composition or a
   tape) and pin tool versions so renders are repeatable in CI.
3. **Offline and supply-chain safe** — Vendor assets locally; pin and review
   any rendering tool; never send content to a hosted renderer.
4. **Source of truth** — Draw any real numbers from a documented source so the
   artifact can be refreshed when they change.
5. **Drafts, not final media** — A human reviews and approves before publishing.

## Contributing

Add a new outreach skill under `skills/outreach/<id>/SKILL.md` following the
[skill schema](../../schemas/skill.schema.json), keep the `explainer-*` naming
for explainer artifacts, and register it in `INDEX.yaml` (run `make validate`).
