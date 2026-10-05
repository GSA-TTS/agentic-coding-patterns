# Decision: a local deterministic scorer, not the TypeSafe/Jev Decisions API

**Status:** accepted
**Date:** 2026-10-05

## Context

This kit is modeled on the public `jev-skill-router`
(github.com/ydmw74/jev-skill-router): a small stdio MCP server that, before an
agent commits, suggests at most one choice. That reference project makes its
decision by calling the proprietary **TypeSafe "Jev" Decisions API** — a paid,
hosted LLM-as-judge service — **twice per request** (rank, then rerank).

Our requirement is the same SHAPE (suggest-one-or-abstain, over stdio MCP) but a
different target: route among **models** (the GSA USAi catalog), not skills. And
we want an **open-source alternative** to the proprietary decision engine.

## Decision Drivers

- **No paid, hosted decision API.** A federal sandbox should not depend on an
  external LLM-judge service for routine model selection, and should not require
  a per-request egress + API key for it.
- **Offline / fail-soft.** The kit family's convention is small, pinned, and
  fail-soft (see `pi-coding-agent`, `opencode` kits). A router that needs the
  network to answer violates that.
- **Explainable + testable.** Model routing that silently picks an expensive
  model is a cost and trust problem; the choice must be auditable and
  unit-testable.
- **Catalog scale.** The USAi catalog is ~10 model families. Semantic ranking
  with embeddings earns its keep at hundreds of near-duplicate items (the
  reference router's problem: 190+ skills with 60-char truncated descriptions).
  At ten families, an explicit capability profile is clearer and cheaper.

## Decision

Replace the proprietary decision engine with a **local, deterministic,
zero-dependency Python scorer** (`model_router.py`):

- A request is reduced to the **capabilities it demands** (reasoning, coding,
  fast, long-context, vision) by transparent regex cues.
- Each model family carries an explicit **capability profile + cost rank**
  (`catalog.py`), reviewed as data.
- The scorer suggests the **cheapest model that covers every demanded
  capability** and meets hard limits, or **abstains** on plain prose.

This mirrors the rationale already documented in the repo's own
`.agents/skills/meta/pattern-router` scorer: *"No embeddings / vector DB: at this
catalog's scale explicit metadata is cheaper, clearer, and reliably testable."*

**Inspiration, not copy.** No scripts, prompt bodies, or skill bodies are copied
from `jev-skill-router`; only the public, high-level interaction shape (stdio
MCP, suggest-one-or-abstain, an advisory block the host may ignore) is reused.

## Consequences

- **Positive:** no runtime network, no API key, no paid service; fully offline;
  deterministic and unit-tested; trivial install (stdlib only).
- **Negative:** no semantic paraphrase matching — a request whose wording shares
  no cue with any capability pattern may under-detect demands and abstain. This
  is a deliberate, safe failure (keep the current model) and is acceptable at
  this catalog scale.
- **Reversible:** the scorer is isolated behind the `route()` function and the
  `model_select` tool. A future embeddings-based scorer (e.g. an Ollama-served
  GGUF embedding model, or an ONNX model) can be added as an opt-in behind an
  env flag without changing the tool contract — see the README "Future: optional
  semantic scoring". We ship the deterministic scorer first and add embeddings
  only if measured misroutes justify the added weight and egress.
