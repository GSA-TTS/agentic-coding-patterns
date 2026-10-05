#!/usr/bin/env python3
"""catalog — load the model-routing capability profiles.

The router scores a request against a list of ModelProfile objects. This module
produces that list, in priority order:

  1. If MODEL_ROUTER_CATALOG points at a readable JSON file, load it (operator
     override — e.g. a user-supplied roster, or a generated USAi catalog).
  2. Otherwise fall back to the bundled DEFAULT_CATALOG below — a hand-authored
     capability profile for the GSA USAi model families (Claude / GPT / Gemini /
     Llama / Cohere). This keeps the kit fully functional offline with no
     catalog-refresh egress required.

WHY A HAND-AUTHORED DEFAULT (not auto-derived from the USAi /models endpoint):
the USAi models endpoint returns ids and ownership only — NOT the capability
semantics the router needs (is this a cheap/fast model or a strong-reasoning
one?). Those are a human judgement about model FAMILIES, so they live here as
reviewed data, keyed by a stable id prefix, and are matched to whatever concrete
ids the live catalog exposes. Pricing/limits that models.dev DOES know are the
usai-provider kit's concern (its sync-usai-models.mjs); this router only needs
the coarse capability tier.

The default profiles are deliberately COARSE and conservative. They are a
starting routing policy, not a benchmark ranking — tune cost_rank / capabilities
in a reviewed change (or override via MODEL_ROUTER_CATALOG) as the catalog and
your own measured misroutes evolve.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from model_router import CAPABILITIES, ModelProfile

# ---------------------------------------------------------------------------
# Default capability profiles, keyed by a STABLE ID PREFIX of the USAi model id.
# A live catalog id is matched to the LONGEST matching prefix, so
# "claude_4_8_opus" matches "claude" and the more specific "claude_4_8_opus"
# wins if both are present. cost_rank: 1 = cheapest tier … higher = pricier.
# ---------------------------------------------------------------------------
_DEFAULT_FAMILY_PROFILES: list[dict] = [
    # --- cheap / fast tier -------------------------------------------------
    {
        "prefix": "claude_4_5_haiku",
        "name": "Claude Haiku (fast, cheap)",
        "capabilities": ["coding", "fast", "cheap"],
        "context": 200000,
        "cost_rank": 1,
    },
    {
        "prefix": "gemini-2.5-flash-lite",
        "name": "Gemini Flash Lite (fast, cheap, vision)",
        "capabilities": ["coding", "fast", "cheap", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 1,
    },
    {
        "prefix": "gemini-2.5-flash",
        "name": "Gemini Flash (fast, cheap, long context, vision)",
        "capabilities": ["coding", "fast", "cheap", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 2,
    },
    {
        "prefix": "llama",
        "name": "Llama (open-weight, cheap)",
        "capabilities": ["coding", "fast", "cheap"],
        "context": 128000,
        "cost_rank": 1,
    },
    {
        "prefix": "cohere",
        "name": "Cohere (cheap)",
        "capabilities": ["coding", "cheap", "fast"],
        "context": 128000,
        "cost_rank": 1,
    },
    # --- balanced tier -----------------------------------------------------
    {
        "prefix": "claude_4_5_sonnet",
        "name": "Claude Sonnet (balanced coding + reasoning)",
        "capabilities": ["coding", "reasoning", "vision"],
        "context": 200000,
        "cost_rank": 3,
    },
    {
        "prefix": "claude_4_6_sonnet",
        "name": "Claude 4.6 Sonnet (balanced, long context)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 3,
    },
    {
        "prefix": "claude-sonnet-5",
        "name": "Claude Sonnet 5 (balanced, long context)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 3,
    },
    {
        "prefix": "gemini-2.5-pro",
        "name": "Gemini Pro (reasoning, long context, vision)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 3,
    },
    {
        "prefix": "gpt-5.2",
        "name": "GPT-5.2 (reasoning, coding, long context)",
        "capabilities": ["coding", "reasoning", "long_context", "vision"],
        "context": 400000,
        "cost_rank": 4,
    },
    {
        "prefix": "gpt-5.4",
        "name": "GPT-5.4 (reasoning, coding, long context)",
        "capabilities": ["coding", "reasoning", "long_context", "vision"],
        "context": 1050000,
        "cost_rank": 4,
    },
    {
        "prefix": "gpt-5.5",
        "name": "GPT-5.5 (reasoning, coding, long context)",
        "capabilities": ["coding", "reasoning", "long_context", "vision"],
        "context": 1050000,
        "cost_rank": 4,
    },
    {
        "prefix": "gpt-5",
        "name": "GPT-5 (reasoning, coding, long context)",
        "capabilities": ["coding", "reasoning", "long_context", "vision"],
        "context": 400000,
        "cost_rank": 4,
    },
    # --- strong-reasoning / top tier --------------------------------------
    {
        "prefix": "claude_4_7_opus",
        "name": "Claude 4.7 Opus (strongest reasoning, long context)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 5,
    },
    {
        "prefix": "claude_4_8_opus",
        "name": "Claude 4.8 Opus (strongest reasoning, long context)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 5,
    },
    {
        "prefix": "claude-opus-5",
        "name": "Claude Opus 5 (strongest reasoning, long context)",
        "capabilities": ["coding", "reasoning", "vision", "long_context"],
        "context": 1000000,
        "cost_rank": 5,
    },
    # Generic family fallbacks (lowest-priority prefixes).
    {
        "prefix": "claude",
        "name": "Claude (reasoning, coding)",
        "capabilities": ["coding", "reasoning", "vision"],
        "context": 200000,
        "cost_rank": 3,
    },
]


def _profile_from_dict(d: dict) -> ModelProfile:
    """Build a ModelProfile from a raw dict, ignoring unknown capability tags."""
    caps = frozenset(c for c in d.get("capabilities", []) if c in CAPABILITIES)
    return ModelProfile(
        id=str(d["id"]),
        name=str(d.get("name", d["id"])),
        capabilities=caps,
        context=int(d.get("context", 128000)),
        cost_rank=int(d.get("cost_rank", 3)),
        input_cost=d.get("input_cost"),
    )


def _match_family(model_id: str) -> dict | None:
    """Return the most-specific default family profile for a live model id."""
    best: dict | None = None
    for fam in _DEFAULT_FAMILY_PROFILES:
        if model_id.startswith(fam["prefix"]):
            if best is None or len(fam["prefix"]) > len(best["prefix"]):
                best = fam
    return best


def load_catalog() -> list[ModelProfile]:
    """Load routing profiles — operator override first, else the default."""
    override = os.environ.get("MODEL_ROUTER_CATALOG")
    if override:
        path = Path(override)
        if path.is_file():
            data = json.loads(path.read_text())
            raw = data["models"] if isinstance(data, dict) else data
            return [_profile_from_dict(d) for d in raw]
        # Fail-soft: a bad override path falls back to the bundled default
        # rather than crashing the router.

    # Live-id discovery: if a USAi /models snapshot is present, map each live id
    # to its family profile so the router suggests REAL catalog ids. Otherwise
    # emit the family profiles directly (prefix as a representative id).
    live_ids_path = os.environ.get("MODEL_ROUTER_LIVE_IDS")
    if live_ids_path and Path(live_ids_path).is_file():
        snap = json.loads(Path(live_ids_path).read_text())
        ids = [m["id"] for m in snap.get("data", snap) if isinstance(m, dict) and m.get("id")]
        profiles: list[ModelProfile] = []
        for mid in ids:
            fam = _match_family(mid)
            if not fam:
                continue
            profiles.append(
                ModelProfile(
                    id=mid,
                    name=fam["name"],
                    capabilities=frozenset(fam["capabilities"]),
                    context=int(fam["context"]),
                    cost_rank=int(fam["cost_rank"]),
                )
            )
        if profiles:
            return profiles

    # Pure offline default: one profile per family, id = the family prefix.
    return [
        ModelProfile(
            id=fam["prefix"],
            name=fam["name"],
            capabilities=frozenset(fam["capabilities"]),
            context=int(fam["context"]),
            cost_rank=int(fam["cost_rank"]),
        )
        for fam in _DEFAULT_FAMILY_PROFILES
        if fam["prefix"] != "claude"  # drop the generic fallback from the flat default
    ]
