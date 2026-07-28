#!/usr/bin/env python3
"""
Deterministic pattern-router engine (#237, PR2 #239).

The MODEL classifies a request into structured facets (task_types, output/input
artifacts, constraints). THIS SCRIPT does the mechanical part: filter → score →
rank → explain. Keeping selection deterministic makes it testable, reproducible,
cheap (no per-call model variance), and immune to hallucinated pattern ids.

Design contract (epic #237):
  * Prefer a workflow for an outcome, a skill for an operation, a prompt only as
    an environment fallback.
  * Choose the SMALLEST appropriate route, never "every skill sharing a category".
  * Every decision is explainable: excluded candidates carry a reason.

Security (consensus conditions, #237):
  * All pattern references stay repo-relative — reject absolute paths / `..`
    (path-traversal guard) when reading pattern files.
  * Request facets are validated against schemas/taxonomy.yaml; unknown facets
    are rejected, not silently scored (prevents dodging avoid/delegate penalties).

Usage:
    python scripts/route_patterns.py --task review --output security-review
    python scripts/route_patterns.py --request-file req.yaml --json
    python scripts/route_patterns.py --task author --output slide-deck --explain
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# ── Deterministic scoring weights ───────────────────────────────────────────
# Exact weights matter less than the decision being explainable and testable.
# Positive signals accumulate; the three −100 penalties act as hard exclusions.
W_OUTPUT_MATCH = 40
W_TASK_MATCH = 30
W_INPUT_MATCH = 15
W_ALIAS_MATCH = 10
W_TRIGGER_MATCH = 10
W_COLLECTION_MATCH = 5
W_RECOMMENDED = 5
P_AVOID = -100
P_DELEGATED = -100
P_DEPRECATED = -100

# A workflow that covers the requested outcome is preferred over assembling
# skills; a prompt is only a fallback. Encoded as a small type nudge so ties
# resolve toward the right granularity without overriding real facet matches.
TYPE_NUDGE = {"workflow": 3, "skill": 0, "prompt": -3, "agent": -5, "lesson": -50}


@dataclass
class RequestFacets:
    """Structured request the model produced (or CLI flags supplied)."""

    task_types: list[str] = field(default_factory=list)
    input_artifacts: list[str] = field(default_factory=list)
    output_artifacts: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    collection: str | None = None

    def is_empty(self) -> bool:
        return not (
            self.task_types or self.input_artifacts or self.output_artifacts or self.keywords or self.collection
        )


@dataclass
class Candidate:
    """A pattern under consideration with its running score + trace."""

    id: str
    type: str
    status: str
    path: str
    collection: str | None
    routing: dict
    score: int = 0
    reasons: list[str] = field(default_factory=list)
    excluded_reason: str | None = None


# ── Loading (repo-relative, path-traversal safe) ────────────────────────────


def load_taxonomy(repo_root: Path) -> dict[str, set[str]]:
    """Load controlled vocab for facet validation. Empty sets if file absent."""
    path = repo_root / "schemas" / "taxonomy.yaml"
    if not path.exists():
        return {"task_types": set(), "artifact_types": set()}
    data = yaml.safe_load(path.read_text()) or {}
    return {
        "task_types": set((data.get("task_types") or {}).keys()),
        "artifact_types": set((data.get("artifact_types") or {}).keys()),
    }


def _safe_repo_relative(repo_root: Path, rel_path: str) -> Path | None:
    """Resolve rel_path under repo_root, rejecting absolute paths and traversal.

    Returns the resolved Path if it stays inside repo_root, else None. This is
    the consensus path-traversal guard: a pattern `path` in INDEX.yaml is data
    and must never escape the repo.
    """
    if not rel_path:
        return None
    candidate = Path(rel_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return None
    resolved = (repo_root / candidate).resolve()
    try:
        resolved.relative_to(repo_root.resolve())
    except ValueError:
        return None
    return resolved


def _extract_frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    parts = text.split("---\n", 2)
    if len(parts) < 3:
        return {}
    return yaml.safe_load(parts[1]) or {}


def load_candidates(repo_root: Path, index_data: dict) -> list[Candidate]:
    """Build candidates from INDEX.yaml, enriching from each SKILL.md.

    The INDEX carries the shortlist facets; prefer_when/avoid_when/delegates live
    in the source file, so we reopen it (guarded). A pattern whose path fails the
    traversal guard is skipped defensively.
    """
    candidates: list[Candidate] = []
    for items in (index_data.get("patterns") or {}).values():
        if not isinstance(items, list):
            continue
        for entry in items:
            rel = entry.get("path", "")
            safe = _safe_repo_relative(repo_root, rel)
            routing = dict(entry.get("routing") or {})
            if safe and safe.exists():
                fm = _extract_frontmatter(safe.read_text())
                # Merge full routing (prefer_when/avoid_when/delegates) from source.
                fm_routing = fm.get("routing")
                if isinstance(fm_routing, dict):
                    routing = fm_routing
                collection = fm.get("collection") or entry.get("collection")
                triggers = fm.get("triggers") or []
                deprecated = fm.get("status") == "deprecated" or bool(fm.get("deprecated"))
            else:
                collection = entry.get("collection")
                triggers = []
                deprecated = entry.get("status") == "deprecated"
            routing.setdefault("_triggers", triggers)
            cand = Candidate(
                id=entry.get("id", "unknown"),
                type=entry.get("type", "skill"),
                status=entry.get("status", "experimental"),
                path=rel,
                collection=collection,
                routing=routing,
            )
            cand.routing["_deprecated"] = deprecated
            candidates.append(cand)
    # Stable order for deterministic tie-breaking.
    candidates.sort(key=lambda c: c.id)
    return candidates


# ── Facet validation ────────────────────────────────────────────────────────


def validate_request(facets: RequestFacets, taxonomy: dict[str, set[str]]) -> list[str]:
    """Reject request facets that are not in the controlled vocabulary.

    Consensus condition: an unknown task_type/artifact must fail loudly rather
    than silently scoring nothing (which could let a crafted request dodge the
    avoid/delegate penalties by never matching them).
    """
    errors: list[str] = []
    task_vocab = taxonomy.get("task_types", set())
    art_vocab = taxonomy.get("artifact_types", set())
    if task_vocab:
        for t in facets.task_types:
            if t not in task_vocab:
                errors.append(f"unknown task_type: {t!r}")
    if art_vocab:
        for a in facets.input_artifacts:
            if a not in art_vocab:
                errors.append(f"unknown input_artifact: {a!r}")
        for a in facets.output_artifacts:
            if a not in art_vocab:
                errors.append(f"unknown output_artifact: {a!r}")
    return errors


# ── Scoring ──────────────────────────────────────────────────────────────────


def _phrase_hit(keywords: list[str], phrases: list[str]) -> bool:
    """True if any request keyword and any pattern phrase overlap.

    Request keywords are often whole sentences ("audit this GitHub Actions
    workflow…") while pattern phrases are short ("agent-invoking CI workflow").
    We therefore test containment in BOTH directions (keyword-in-phrase OR
    phrase-in-keyword) so a short pattern phrase can match a long request.

    Guard against short-substring false positives (a 2-char alias like "ci"
    matching "de*ci*sion"): the side being searched *for* must be at least
    MIN_MATCH_LEN chars AND, when it is a single token, match on a word boundary
    rather than a bare substring. This prevents a poorly chosen short alias from
    promoting an irrelevant candidate.
    """
    kws = [k.lower() for k in keywords if k]
    for phrase in phrases:
        pl = str(phrase).lower()
        if not pl:
            continue
        for kw in kws:
            if not kw:
                continue
            if _contains(pl, kw) or _contains(kw, pl):
                return True
    return False


MIN_MATCH_LEN = 4


def _contains(haystack: str, needle: str) -> bool:
    """Substring test with a false-positive guard for short single tokens.

    - needle shorter than MIN_MATCH_LEN and containing no space → require a
      word-boundary match (so "ci" matches "ci workflow" but not "decision").
    - otherwise → ordinary substring containment (multi-word phrases are already
      specific enough).
    """
    if not needle:
        return False
    if len(needle) < MIN_MATCH_LEN and " " not in needle:
        return re.search(rf"\b{re.escape(needle)}\b", haystack) is not None
    return needle in haystack


def score_candidate(cand: Candidate, facets: RequestFacets) -> Candidate:
    """Apply deterministic scoring. Sets score, reasons, and excluded_reason."""
    routing = cand.routing
    r_outputs = routing.get("output_artifacts") or []
    r_inputs = routing.get("input_artifacts") or []
    r_tasks = routing.get("task_types") or []
    r_aliases = routing.get("aliases") or []
    r_triggers = routing.get("_triggers") or []

    # ── Hard exclusions first ────────────────────────────────────────────────
    if routing.get("_deprecated"):
        cand.score = P_DEPRECATED
        cand.excluded_reason = "deprecated"
        return cand

    # avoid_when: if any request keyword matches an avoid phrase, exclude.
    if facets.keywords and _phrase_hit(facets.keywords, routing.get("avoid_when") or []):
        cand.score = P_AVOID
        cand.excluded_reason = "matched avoid_when"
        return cand

    # ── Positive signals ─────────────────────────────────────────────────────
    matched_outputs = set(r_outputs) & set(facets.output_artifacts)
    if matched_outputs:
        cand.score += W_OUTPUT_MATCH * len(matched_outputs)
        cand.reasons.append(f"output match: {sorted(matched_outputs)}")

    matched_tasks = set(r_tasks) & set(facets.task_types)
    if matched_tasks:
        cand.score += W_TASK_MATCH * len(matched_tasks)
        cand.reasons.append(f"task match: {sorted(matched_tasks)}")

    matched_inputs = set(r_inputs) & set(facets.input_artifacts)
    if matched_inputs:
        cand.score += W_INPUT_MATCH * len(matched_inputs)
        cand.reasons.append(f"input match: {sorted(matched_inputs)}")

    if facets.keywords and _phrase_hit(facets.keywords, r_aliases):
        cand.score += W_ALIAS_MATCH
        cand.reasons.append("alias match")

    if facets.keywords and _phrase_hit(facets.keywords, r_triggers):
        cand.score += W_TRIGGER_MATCH
        cand.reasons.append("trigger match")

    if facets.collection and cand.collection == facets.collection:
        cand.score += W_COLLECTION_MATCH
        cand.reasons.append("collection match")

    if cand.status == "recommended":
        cand.score += W_RECOMMENDED
        cand.reasons.append("recommended status")

    # The type-nudge and recommended bonus are TIE-BREAKERS, not signals — they
    # only apply once the candidate has a real facet/keyword match. Otherwise a
    # workflow with zero relevance would score +3 and be "selected" (e.g. against
    # a not-yet-classified INDEX). Require a substantive match first.
    has_real_match = bool(cand.reasons) and any(
        r.startswith(("output match", "task match", "input match", "alias match", "trigger match"))
        for r in cand.reasons
    )
    if has_real_match:
        cand.score += TYPE_NUDGE.get(cand.type, 0)
    else:
        cand.score = 0
        cand.reasons.clear()
    return cand


def apply_delegation(candidates: list[Candidate], facets: RequestFacets) -> None:
    """Demote a candidate that delegates a matching lane to a more specific one.

    If pattern A declares `delegates: [{pattern: B, when: "..."}]` and the
    request keywords match B's `when` clause, A is excluded in favor of B — this
    is how the security disambiguation lanes stay out of prose.
    """
    by_id = {c.id: c for c in candidates}
    for cand in candidates:
        if cand.excluded_reason:
            continue
        for deleg in cand.routing.get("delegates") or []:
            target = deleg.get("pattern")
            when = deleg.get("when", "")
            if not target or target not in by_id:
                continue
            if facets.keywords and _phrase_hit(facets.keywords, [when]):
                cand.score = P_DELEGATED
                cand.excluded_reason = f"delegated to {target} ({when})"
                break


# ── Route assembly ────────────────────────────────────────────────────────────


def build_route(candidates: list[Candidate], facets: RequestFacets | None = None) -> dict:
    """Rank scored candidates and assemble the explainable route object."""
    included = [c for c in candidates if c.excluded_reason is None and c.score > 0]
    excluded = [c for c in candidates if c.excluded_reason is not None]

    # Deterministic ranking: score desc, then routing.priority desc, then id asc.
    def sort_key(c: Candidate):
        priority = c.routing.get("priority", 50)
        return (-c.score, -priority, c.id)

    included.sort(key=sort_key)

    requested_outputs = set(facets.output_artifacts) if facets else set()

    route: dict[str, Any] = {"primary": None, "supporting": [], "excluded": [], "assumptions": []}
    if included:
        top = included[0]
        route["primary"] = {
            "id": top.id,
            "type": top.type,
            "score": top.score,
            "reason": "; ".join(top.reasons) or "best facet match",
        }
        # Supporting = other included candidates that add a distinct REQUESTED
        # output the primary does not cover. Restricting to requested outputs
        # keeps routes minimal — a candidate producing an artifact nobody asked
        # for (e.g. a video when a deck was requested) is never dragged in.
        primary_outputs = set(top.routing.get("output_artifacts") or [])
        for c in included[1:]:
            c_outputs = set(c.routing.get("output_artifacts") or [])
            distinct_requested = (c_outputs & requested_outputs) - primary_outputs
            if distinct_requested:
                route["supporting"].append(
                    {"id": c.id, "type": c.type, "score": c.score, "reason": "; ".join(c.reasons)}
                )
                primary_outputs |= c_outputs

    # Only surface excluded candidates that ALMOST matched (avoid/delegated),
    # not the long tail of irrelevant patterns.
    for c in excluded:
        if c.excluded_reason and c.excluded_reason != "deprecated":
            route["excluded"].append({"id": c.id, "reason": c.excluded_reason})

    return route


def route_request(repo_root: Path, index_data: dict, facets: RequestFacets) -> dict:
    """Full pipeline: validate → score → delegate → rank → explain."""
    taxonomy = load_taxonomy(repo_root)
    errors = validate_request(facets, taxonomy)
    if errors:
        return {"error": "invalid request facets", "details": errors}
    if facets.is_empty():
        return {"error": "empty request", "details": ["provide at least one facet"]}

    candidates = load_candidates(repo_root, index_data)
    for cand in candidates:
        score_candidate(cand, facets)
    apply_delegation(candidates, facets)
    return build_route(candidates, facets)


# ── CLI ────────────────────────────────────────────────────────────────────


def _load_index(repo_root: Path) -> dict:
    path = repo_root / "INDEX.yaml"
    if not path.exists():
        print("Error: INDEX.yaml not found (run 'make generate')", file=sys.stderr)
        sys.exit(2)
    return yaml.safe_load(path.read_text()) or {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic pattern router (#237)")
    parser.add_argument("--task", action="append", default=[], help="Request task type (repeatable)")
    parser.add_argument(
        "--input", dest="input_artifact", action="append", default=[], help="Input artifact (repeatable)"
    )
    parser.add_argument(
        "--output", dest="output_artifact", action="append", default=[], help="Output artifact (repeatable)"
    )
    parser.add_argument("--keyword", action="append", default=[], help="Free-text keyword/phrase (repeatable)")
    parser.add_argument("--collection", default=None, help="Preferred collection")
    parser.add_argument(
        "--request-file",
        type=Path,
        default=None,
        help="YAML file with task_types/input_artifacts/output_artifacts/keywords/collection",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent.resolve()

    if args.request_file:
        # A --request-file is an OPERATOR-supplied CLI argument (same trust level
        # as `cat`), so an absolute path is permitted here. Deliberately
        # asymmetric with pattern `path` values from INDEX.yaml, which are DATA
        # and stay guarded by _safe_repo_relative.
        safe = (
            _safe_repo_relative(repo_root, str(args.request_file))
            if not args.request_file.is_absolute()
            else args.request_file
        )
        if safe is None or not safe.exists():
            print(f"Error: request file not found or unsafe: {args.request_file}", file=sys.stderr)
            return 2
        data = yaml.safe_load(safe.read_text()) or {}
        facets = RequestFacets(
            task_types=list(data.get("task_types") or []),
            input_artifacts=list(data.get("input_artifacts") or []),
            output_artifacts=list(data.get("output_artifacts") or []),
            keywords=list(data.get("keywords") or []),
            collection=data.get("collection"),
        )
    else:
        facets = RequestFacets(
            task_types=args.task,
            input_artifacts=args.input_artifact,
            output_artifacts=args.output_artifact,
            keywords=args.keyword,
            collection=args.collection,
        )

    index_data = _load_index(repo_root)
    route = route_request(repo_root, index_data, facets)

    if args.json:
        print(json.dumps(route, indent=2))
    else:
        if "error" in route:
            print(f"✗ {route['error']}: {', '.join(route['details'])}")
            return 1
        primary = route.get("primary")
        if not primary:
            print("No pattern matched the request facets.")
            return 1
        print(f"→ primary: {primary['id']} ({primary['type']}) [score {primary['score']}]")
        print(f"  reason: {primary['reason']}")
        for s in route["supporting"]:
            print(f"  + supporting: {s['id']} ({s['type']}) [score {s['score']}]")
        for e in route["excluded"]:
            print(f"  − excluded: {e['id']} — {e['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
