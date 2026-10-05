---
id: model-router-mcp
version: "1.0.0"
title: "Model Router (model_select) — when to ask for a model suggestion"
description: "Tells the agent WHEN to call the model-router MCP server's model_select tool, and that an abstain is a valid answer."
type: skill
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - agents
  - developers
requires:
  anchors: []
  skills: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
    prohibited_content:
      - "Secrets"
      - "PII"
      - "CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
triggers:
  - "which model"
  - "best model for"
  - "cheaper model"
  - "model selection"
  - "route to a model"
tags:
  - "routing"
  - "model-selection"
  - "cost"
portability:
  opencode: true
  cursor: false
  claude_projects: false
  chatgpt: false
  generic_llm: false
---

# Skill: Model Router (model_select)

This sandbox has a **model-router** MCP server registered with OpenCode. It
exposes one tool, `model_select`, that suggests the smallest/cheapest available
model which still satisfies a request's demands — or abstains. This skill tells
you WHEN to call it.

## Summary

Call `model_select` at the **start of a turn** when the right model is not
obvious, to avoid running an expensive model on a trivial edit (or a weak model
on hard reasoning). The suggestion is **advisory** — you keep your own judgement
and may ignore it. An **abstain is a valid answer**: it means "keep the current
model."

## When to Use

- The user starts a **new, materially different task** and you are unsure
  whether the current model is the right size for it.
- A task looks **cheap and mechanical** (a typo, a rename, a one-line fix) and
  you want to confirm a cheaper/faster model would do.
- A task looks **hard** (architecture, cross-file refactor, root-cause debugging,
  a long document) and you want to confirm the model has the needed reasoning or
  context window.
- The user explicitly asks "what's the best model for this?" or "can a cheaper
  model handle this?"

## When NOT to Use

- Mid-task, when you are already executing with a working model — do not thrash
  models turn to turn.
- For a plain prose question ("what is X?"); the tool will abstain anyway.
- When the user has explicitly pinned a model — respect that.

## How to Call It

```
model_select(request: "<the user's request, verbatim or lightly summarized>",
             max_cost_rank?: <optional integer cost ceiling, 1 = cheapest>)
```

The tool returns `decision` (`suggest` or `abstain`), a `suggested` model id, the
`demands` it detected, a `reason`, and a `suggestion_block` you may surface.

## Verification

- On `suggest`, the `reason` names the concrete demands that drove the choice —
  sanity-check it against what the user actually asked for before switching.
- On `abstain`, keep the current model; do not switch for its own sake.
- The tool never executes anything and makes no network call — it only ranks.

## Examples

| Request | Expected | Why |
|---------|----------|-----|
| "fix a typo in this comment" | suggest a fast/cheap model | mechanical edit |
| "redesign the auth architecture across many files" | suggest a strong, long-context model | reasoning + long context |
| "what is a cloud function vs a server?" | abstain | prose question, no switch needed |

## Notes

- The router is deterministic and offline — it uses an explicit per-model
  capability profile, not a paid decision API. Routing policy (which model is
  "cheap" or "strong") lives in the kit's `catalog.py`; tune it there in a
  reviewed change, or override with `MODEL_ROUTER_CATALOG`.
- Model-provider setup and the live model catalog are the separate
  **usai-provider** kit's job; this router only chooses among available models.
