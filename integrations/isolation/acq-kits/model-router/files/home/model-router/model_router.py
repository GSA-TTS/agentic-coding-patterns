#!/usr/bin/env python3
"""model_router — deterministic model-selection core for the model-router kit.

Given a free-text coding request, rank the available USAi models and suggest the
SMALLEST model that still satisfies the request's demands (reasoning depth,
context length, modality, latency/cost ceiling), or ABSTAIN when the request does
not warrant a model switch.

DESIGN (why this shape):

  This is the open-source, offline, zero-dependency replacement for the
  proprietary TypeSafe/"Jev" Decisions API that the jev-skill-router reference
  (github.com/ydmw74/jev-skill-router) uses. That router made two paid LLM calls
  per request. This one makes ZERO network calls and runs no ML model: at a
  ~10-model catalog, an explicit capability profile + a transparent rules scorer
  is cheaper, fully deterministic, and reliably unit-testable — the same
  "explicit metadata, no vector DB" rationale the repo's own
  .agents/skills/meta/pattern-router scorer documents.

  The scoring is INTENTIONALLY explainable: every suggestion carries the concrete
  signals that produced it (matched demands, the tier chosen, why cheaper models
  were excluded), so a human can audit the route rather than trust an opaque
  score. Model routing that silently picks an expensive model is a cost and a
  trust problem; a transparent rule is auditable.

FAIL-SOFT: this module raises only on genuinely malformed input it cannot
interpret. The MCP server wrapping it turns any such error into an ABSTAIN
(let the agent keep its own default model) rather than a hard failure — a model
router that crashes the turn is worse than one that declines to suggest.

NO EXTERNAL DEPENDENCIES: standard library only (re, json, dataclasses). This
keeps the kit install trivial and offline, matching the kit family's small/
pinned/fail-soft convention.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Capability vocabulary
# ---------------------------------------------------------------------------
# A model is described by the capabilities it is GOOD at, plus hard limits
# (context window, modality) and a relative cost rank. A request is reduced to
# the capabilities it DEMANDS. The scorer then picks the cheapest model whose
# capabilities cover every demanded capability and whose hard limits are met.
#
# These are coarse, defensible buckets — not a leaderboard. The point is to
# route a one-line edit to a cheap/fast model and an architecture question to a
# strong-reasoning model, not to litigate micro-benchmark deltas.

# Controlled capability tags. Unknown tags in a profile are ignored (fail-soft),
# but the test-suite asserts profiles only use these.
CAPABILITIES = frozenset(
    {
        "reasoning",      # multi-step reasoning / architecture / hard debugging
        "coding",         # competent code generation & editing
        "fast",           # low-latency, good for trivial/interactive edits
        "cheap",          # low $ per token (relative, within the catalog)
        "long_context",   # usable context window >= 400k tokens
        "vision",         # accepts image input
    }
)

# Request-demand detection. Each demand maps a set of regexes (matched
# case-insensitively against the request) to a capability the request implies.
# Ordering does not matter; a request can raise several demands.
#
# IMPORTANT: these are HEURISTICS over UNTRUSTED request text. They are only used
# to RANK a choice the human can override — never to execute anything — so a
# wrong classification costs at most a sub-optimal (never unsafe) suggestion.
_DEMAND_PATTERNS: dict[str, list[str]] = {
    "reasoning": [
        r"\barchitect(ure|ing)?\b", r"\bdesign\b", r"\brefactor(ing)?\b",
        r"\bdebug(ging)?\b", r"\broot[- ]cause\b", r"\btrade[- ]?off", r"\balgorithm",
        r"\breason(ing)?\b", r"\bprove\b", r"\bcomplex\b", r"\bwhy\b", r"\bplan\b",
        r"\bmigrate|migration\b", r"\bthreat model", r"\bsecurity review",
    ],
    "coding": [
        r"\bcode\b", r"\bimplement", r"\bfunction\b", r"\bclass\b", r"\bbug\b",
        r"\bfix\b", r"\bwrite (a |the )?(script|test|unit test)", r"\bedit\b",
        r"\bpatch\b", r"\bcompile", r"\bsyntax", r"\bprogram\b",
    ],
    "fast": [
        r"\btypo\b", r"\brename\b", r"\bcomment\b", r"\bformat(ting)?\b",
        r"\bone[- ]line", r"\bquick\b", r"\bsimple\b", r"\btrivial\b",
        r"\bsmall (fix|change|edit)\b",
    ],
    "long_context": [
        r"\bwhole (repo|repository|codebase)\b", r"\bentire (repo|file|codebase)\b",
        r"\bacross (the )?(many|all) files\b", r"\blarge (file|document|log)\b",
        r"\blong (document|transcript|log|file)\b", r"\b\d{3,}k tokens?\b",
        r"\bmany files\b", r"\bfull context\b",
    ],
    "vision": [
        r"\bimage\b", r"\bscreenshot\b", r"\bdiagram\b", r"\bphoto\b", r"\bpng\b",
        r"\bjpe?g\b", r"\bpicture\b", r"\bmockup\b", r"\bui (screenshot|mockup)\b",
    ],
}

# A request that raises ZERO coding/reasoning demands is likely plain prose
# ("what is a cloud function?") — the router abstains rather than switch models
# for a question the current model answers fine. These "no action" cues raise an
# abstain bias (mirrors the reference router's gate questions).
_PROSE_PATTERNS = [
    r"^\s*what\s+is\b", r"^\s*what'?s\b", r"^\s*explain\b", r"^\s*describe\b",
    r"^\s*how\s+does\b", r"^\s*tell me about\b", r"\bdifference between\b",
]


@dataclass
class ModelProfile:
    """One candidate model's routing profile."""

    id: str
    name: str
    capabilities: frozenset[str]
    context: int                       # max input tokens (hard limit)
    cost_rank: int                     # relative $ rank; 1 = cheapest tier
    # Raw per-1M-token input cost if known (used only for tie-break / display).
    input_cost: Optional[float] = None

    def covers(self, demands: frozenset[str]) -> bool:
        """True if this model has every demanded capability."""
        return demands.issubset(self.capabilities)


@dataclass
class RouteResult:
    """The router's answer for one request."""

    decision: str                      # "suggest" | "abstain"
    suggested: Optional[str] = None    # model id, when decision == "suggest"
    suggested_name: Optional[str] = None
    demands: list[str] = field(default_factory=list)
    reason: str = ""
    shortlist: list[str] = field(default_factory=list)  # ranked candidate ids
    excluded: list[dict] = field(default_factory=list)  # {id, reason}

    def to_dict(self) -> dict:
        return {
            "decision": self.decision,
            "suggested": self.suggested,
            "suggested_name": self.suggested_name,
            "demands": self.demands,
            "reason": self.reason,
            "shortlist": self.shortlist,
            "excluded": self.excluded,
        }


def detect_demands(request: str) -> frozenset[str]:
    """Reduce a free-text request to the capabilities it demands."""
    text = request.lower()
    demands: set[str] = set()
    for capability, patterns in _DEMAND_PATTERNS.items():
        if any(re.search(p, text) for p in patterns):
            demands.add(capability)
    return frozenset(demands)


def _looks_like_prose(request: str) -> bool:
    text = request.strip().lower()
    return any(re.search(p, text) for p in _PROSE_PATTERNS)


def route(
    request: str,
    profiles: list[ModelProfile],
    *,
    max_cost_rank: Optional[int] = None,
) -> RouteResult:
    """Choose the smallest model that satisfies the request's demands.

    Policy (least-privilege for cost): prefer the CHEAPEST model (lowest
    cost_rank) that covers all demanded capabilities and meets any hard limit.
    Abstain when the request raises no actionable demand (plain prose) or when
    no candidate can satisfy a hard requirement.

    `max_cost_rank` is an optional operator cost ceiling: models above it are
    excluded (so a user can cap routing to cheaper tiers).
    """
    if not request or not request.strip():
        return RouteResult(decision="abstain", reason="empty request")
    if not profiles:
        return RouteResult(decision="abstain", reason="no model catalog available")

    demands = detect_demands(request)

    # Abstain on clear prose: a "what is X?"/"explain X" question wants an
    # answer from the current model, not a model switch (the reference router's
    # gate behaviour). A WEAK coding/fast hit does NOT override the prose cue —
    # "what is a cloud function?" trips the `function` keyword but is still
    # prose. Only a STRONG action signal (an explicit reasoning/long-context/
    # vision demand) overrides prose, because those name a real capability need
    # the current model might not meet.
    strong = demands & {"reasoning", "long_context", "vision"}
    if _looks_like_prose(request) and not strong:
        return RouteResult(
            decision="abstain",
            demands=sorted(demands),
            reason="prose question with no strong coding/reasoning demand",
        )
    # A request with NO actionable demand at all (neither prose-shaped nor any
    # coding/reasoning cue) is also an abstain — nothing to route on.
    actionable = demands & {"reasoning", "coding", "long_context", "vision"}
    if not actionable:
        return RouteResult(
            decision="abstain",
            demands=sorted(demands),
            reason="no actionable coding/reasoning demand detected",
        )

    excluded: list[dict] = []
    candidates: list[ModelProfile] = []
    for p in profiles:
        if max_cost_rank is not None and p.cost_rank > max_cost_rank:
            excluded.append({"id": p.id, "reason": f"cost_rank {p.cost_rank} > ceiling {max_cost_rank}"})
            continue
        if "vision" in demands and "vision" not in p.capabilities:
            excluded.append({"id": p.id, "reason": "request needs vision; model has none"})
            continue
        if not p.covers(demands):
            missing = sorted(demands - p.capabilities)
            excluded.append({"id": p.id, "reason": f"missing capabilities: {', '.join(missing)}"})
            continue
        candidates.append(p)

    if not candidates:
        return RouteResult(
            decision="abstain",
            demands=sorted(demands),
            reason="no model in the catalog covers the demanded capabilities",
            excluded=excluded,
        )

    # Rank: cheapest tier first; break ties by raw input cost (if known), then by
    # a NARROWER capability set (prefer the more specialized/leaner model over a
    # heavyweight when both qualify), then by id for determinism.
    def sort_key(p: ModelProfile) -> tuple:
        return (
            p.cost_rank,
            p.input_cost if p.input_cost is not None else float("inf"),
            len(p.capabilities),
            p.id,
        )

    candidates.sort(key=sort_key)
    winner = candidates[0]

    demand_str = ", ".join(sorted(demands)) if demands else "general coding"
    reason = (
        f"demands [{demand_str}] satisfied by the cheapest covering model "
        f"(cost_rank {winner.cost_rank})"
    )
    return RouteResult(
        decision="suggest",
        suggested=winner.id,
        suggested_name=winner.name,
        demands=sorted(demands),
        reason=reason,
        shortlist=[c.id for c in candidates],
        excluded=excluded,
    )
