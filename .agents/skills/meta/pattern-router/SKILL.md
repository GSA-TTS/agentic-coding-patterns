---
name: pattern-router
id: pattern-router
version: "1.0.0"
title: "Pattern Router"
description: "Route a request to the smallest appropriate set of patterns (workflow > skill > prompt) using structured routing metadata and the deterministic route_patterns.py scorer, instead of brittle keyword matching."
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
      - "Route"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
collection: meta
triggers:
  - "which skill"
  - "which pattern"
  - "how do I route"
  - "what should I use for"
tags:
  - "meta"
  - "routing"
  - "discovery"
routing:
  task_types:
    - discover
    - orchestrate
  input_artifacts: []
  output_artifacts: []
  aliases:
    - "pattern selection"
    - "skill router"
  prefer_when:
    - "You are unsure which pattern (workflow, skill, or prompt) best fits a request"
    - "A request bundles several jobs and you need to decompose it into a minimal route"
  avoid_when:
    - "The correct pattern is already obvious from an explicit user instruction"
  priority: 90
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
---

# Pattern Router

## Summary

Given a request, choose the **smallest appropriate route** through the pattern
catalog. The router does not try to understand every procedure itself — it maps
the request to structured routing metadata (`routing.*` in each pattern's
frontmatter, surfaced in `INDEX.yaml`) and lets a deterministic scorer rank the
candidates.

The core rule:

> **Prefer a workflow for an outcome, a skill for an operation, and a prompt only
> when the environment cannot load the corresponding skill.**

Routing **policy** lives in each pattern's metadata. **Orchestration** lives in
workflows. The router only *selects*; it does not execute.

## When to Use

- You have a request and are not sure which pattern fits.
- A request bundles several jobs ("research this, build a deck, check it for
  accessibility") and you need to decompose it into a minimal set of patterns.
- You want an explainable, testable selection instead of keyword guessing.

## When NOT to Use

- The user explicitly named the pattern to run.
- You are executing an already-selected pattern (that is the pattern's job).

## Prerequisites

- A generated `INDEX.yaml` (`make generate`).
- `scripts/route_patterns.py` and `schemas/taxonomy.yaml` present.

## Procedure

### 1. Decompose the request into facets

You (the model) classify the request into controlled facets from
`schemas/taxonomy.yaml`. Do **not** invent facet values — unknown values are
rejected by the scorer.

```yaml
task_types:      [discover, author, visualize, review]   # controlled verbs
input_artifacts: [documentation]                          # controlled slugs
output_artifacts: [slide-deck]                            # controlled slugs
keywords:        ["executive deck", "accessible"]         # free-text phrases
constraints:     ["executive-audience", "accessible"]     # notes for assumptions
```

### 2. Run the deterministic scorer

```bash
python scripts/route_patterns.py \
  --task author --task visualize \
  --output slide-deck \
  --keyword "executive deck" \
  --json
```

or feed a request file:

```bash
python scripts/route_patterns.py --request-file /path/inside/repo/request.yaml --json
```

The scorer performs: **validate facets → filter → score → apply delegation →
rank → explain**. Scoring (weights are tunable; explainability is the invariant):

| Signal | Weight |
|--------|-------:|
| Exact output-artifact match | +40 |
| Exact task-type match | +30 |
| Exact input-artifact match | +15 |
| Alias phrase match | +10 |
| Trigger phrase match | +10 |
| Collection match | +5 |
| `recommended` status | +5 |
| Matched `avoid_when` | −100 (hard exclude) |
| Delegated to another pattern | −100 (hard exclude) |
| Deprecated | −100 (hard exclude) |

A candidate with **no** substantive facet/keyword match scores 0 and is dropped
— the type-nudge and status bonus are tie-breakers, never standalone signals.
This is what stops the router from "selecting every skill sharing a category".

### 3. Read the route

```yaml
route:
  primary:
    id: design-artifact
    type: workflow
    reason: "output match: ['slide-deck']; task match: ['author']"
  supporting:
    - id: accessibility-review          # adds a distinct REQUESTED output
  excluded:
    - id: explainer-video
      reason: "the requested output is a slide deck, not motion video"
  assumptions:
    - "HTML-first deck unless editable PPTX is explicitly required"
```

`supporting` only lists candidates that add a **distinct requested output** the
primary does not cover — this keeps routes minimal.

### 4. Prefer a workflow for an outcome

If a workflow covers the requested outcome, take it. The workflow (not the
router) knows the internal sequence of skills. Fall back to atomic skills only
when no workflow fits, and select the **smallest set** that covers the request.

### 5. Apply hard exclusions honestly

Exclude a candidate when it is deprecated, its `avoid_when` matches, a more
specific pattern owns the lane (`delegates`), required inputs are unavailable,
or governance cannot be honored.

## Verification

- The route's `primary.reason` cites the concrete facet matches.
- No excluded pattern appears as primary or supporting.
- For security lanes, the selected pattern's governance frontmatter still
  applies (`human_review_required: true` means output is advisory).
- Regression cases live in `scripts/tests/router-cases.yaml`; run
  `PYTHONPATH=scripts pytest scripts/tests/test_route_patterns.py`.

## Examples

| Request | Primary | Notably NOT |
|---------|---------|-------------|
| "Audit this GitHub Actions workflow for unsafe `pull_request_target`" | `agentic-actions-auditor` | `least-privilege-review`, `secure-code-review` |
| "Are these `GITHUB_TOKEN` permissions broader than necessary?" | `least-privilege-review` | `agentic-actions-auditor` |
| "Create an executive one-pager explaining the pilot" | `design-artifact` (one-pager) | assembling six skills by hand |
| "Make this README easier for the public to understand" | `plain-language-review` | `documentation-review` |
| "Check this README for stale commands and broken links" | `documentation-review` | `plain-language-review` |

## Notes

- The router is **data-driven** — do not hand-maintain a giant decision tree
  here. New routing knowledge goes into the target pattern's `routing.*`
  metadata, not into this file.
- No embeddings / vector DB: at this catalog's scale explicit metadata is
  cheaper, clearer, and reliably testable.
