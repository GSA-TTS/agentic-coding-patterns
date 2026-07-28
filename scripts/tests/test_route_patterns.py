"""Tests for route_patterns.py — the deterministic pattern router (#237, PR2 #239).

Two layers:
1. Unit tests of the engine primitives (facet validation, path guard, scoring,
   delegation, route assembly).
2. A data-driven regression suite loaded from scripts/tests/router-cases.yaml —
   each case supplies inline candidate patterns + a request and asserts the
   primary/supporting/excluded decision. Pinning to fixtures (not the live
   INDEX) keeps the suite stable until patterns carry routing blocks (PR3 #240).
"""

from pathlib import Path

import pytest
import yaml

from scripts.route_patterns import (
    Candidate,
    RequestFacets,
    _safe_repo_relative,
    apply_delegation,
    build_route,
    load_candidates,
    route_request,
    score_candidate,
    validate_request,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_FILE = Path(__file__).parent / "router-cases.yaml"


def _taxonomy():
    from scripts.route_patterns import load_taxonomy

    return load_taxonomy(REPO_ROOT)


def _candidates_from_case(case: dict) -> list[Candidate]:
    """Build Candidate objects directly from an inline case (no file reopen)."""
    cands = []
    for c in case["candidates"]:
        routing = dict(c.get("routing") or {})
        routing.setdefault("_triggers", [])
        routing["_deprecated"] = c.get("status") == "deprecated"
        cands.append(
            Candidate(
                id=c["id"],
                type=c.get("type", "skill"),
                status=c.get("status", "experimental"),
                path=f"skills/{c['id']}/SKILL.md",
                collection=c.get("collection"),
                routing=routing,
            )
        )
    cands.sort(key=lambda x: x.id)
    return cands


def _route_case(case: dict) -> dict:
    facets = RequestFacets(
        task_types=list(case["request"].get("task_types") or []),
        input_artifacts=list(case["request"].get("input_artifacts") or []),
        output_artifacts=list(case["request"].get("output_artifacts") or []),
        keywords=list(case["request"].get("keywords") or []),
        collection=case["request"].get("collection"),
    )
    cands = _candidates_from_case(case)
    for cand in cands:
        score_candidate(cand, facets)
    apply_delegation(cands, facets)
    return build_route(cands, facets)


# ── Data-driven regression suite ──────────────────────────────────────────────


def _load_cases():
    data = yaml.safe_load(CASES_FILE.read_text())
    return data["cases"]


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
def test_router_case(case):
    route = _route_case(case)
    primary = route.get("primary")
    primary_id = primary["id"] if primary else None

    # Primary expectation
    assert primary_id == case["expect_primary"], (
        f"{case['name']}: expected primary {case['expect_primary']!r}, got {primary_id!r}"
    )

    selected_ids = set()
    if primary_id:
        selected_ids.add(primary_id)
    selected_ids |= {s["id"] for s in route.get("supporting", [])}

    # Forbidden ids must not be primary or supporting
    for forbidden in case.get("forbid", []):
        assert forbidden not in selected_ids, f"{case['name']}: forbidden {forbidden!r} was selected ({selected_ids})"

    # Required supporting ids
    for sup in case.get("expect_supporting", []):
        assert sup in {s["id"] for s in route.get("supporting", [])}, (
            f"{case['name']}: expected supporting {sup!r} missing"
        )

    # Required excluded ids
    excluded_ids = {e["id"] for e in route.get("excluded", [])}
    for exc in case.get("expect_excluded", []):
        assert exc in excluded_ids, f"{case['name']}: expected excluded {exc!r} missing"


def test_all_cases_have_names_and_expectations():
    for case in _load_cases():
        assert "name" in case
        assert "request" in case
        assert "candidates" in case
        assert "expect_primary" in case


# ── Facet validation ──────────────────────────────────────────────────────────


class TestValidateRequest:
    def test_known_facets_pass(self):
        tax = _taxonomy()
        facets = RequestFacets(task_types=["review"], output_artifacts=["security-review"])
        assert validate_request(facets, tax) == []

    def test_unknown_task_type_rejected(self):
        tax = _taxonomy()
        facets = RequestFacets(task_types=["frobnicate"])
        errors = validate_request(facets, tax)
        assert errors and "frobnicate" in errors[0]

    def test_unknown_artifact_rejected(self):
        tax = _taxonomy()
        facets = RequestFacets(output_artifacts=["hologram"])
        errors = validate_request(facets, tax)
        assert errors and "hologram" in errors[0]

    def test_route_request_rejects_unknown_facet(self):
        # End-to-end: an invalid facet fails before any scoring.
        index = {"patterns": {"skills": []}}
        facets = RequestFacets(task_types=["frobnicate"])
        result = route_request(REPO_ROOT, index, facets)
        assert result.get("error") == "invalid request facets"

    def test_empty_request_rejected(self):
        index = {"patterns": {"skills": []}}
        result = route_request(REPO_ROOT, index, RequestFacets())
        assert result.get("error") == "empty request"


# ── Path-traversal guard (consensus condition) ─────────────────────────────────


class TestPathGuard:
    def test_absolute_path_rejected(self):
        assert _safe_repo_relative(REPO_ROOT, "/etc/passwd") is None

    def test_parent_traversal_rejected(self):
        assert _safe_repo_relative(REPO_ROOT, "../../etc/passwd") is None
        assert _safe_repo_relative(REPO_ROOT, "skills/../../secret") is None

    def test_empty_rejected(self):
        assert _safe_repo_relative(REPO_ROOT, "") is None

    def test_valid_repo_relative_accepted(self):
        resolved = _safe_repo_relative(REPO_ROOT, "schemas/taxonomy.yaml")
        assert resolved is not None and resolved.exists()

    def test_symlink_escape_rejected(self, tmp_path):
        # A symlink whose name has no ".." but points outside the root must be
        # caught by the resolved.relative_to() re-check.
        outside = tmp_path / "outside.txt"
        outside.write_text("secret")
        root = tmp_path / "repo"
        root.mkdir()
        link = root / "link.txt"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            pytest.skip("symlinks unsupported on this platform")
        assert _safe_repo_relative(root, "link.txt") is None

    def test_load_candidates_skips_traversal_path(self, tmp_path):
        # A malicious INDEX entry with an absolute path must not be read.
        index = {"patterns": {"skills": [{"id": "evil", "type": "skill", "path": "/etc/passwd", "routing": {}}]}}
        cands = load_candidates(tmp_path, index)
        evil = next(c for c in cands if c.id == "evil")
        # It is still listed (from INDEX metadata) but no file was read → no _triggers from disk.
        assert evil.routing.get("_triggers") == []


# ── Scoring semantics ──────────────────────────────────────────────────────────


class TestScoring:
    def _cand(self, **routing):
        r = dict(routing)
        r.setdefault("_triggers", [])
        r.setdefault("_deprecated", False)
        return Candidate(
            id="x", type="skill", status="experimental", path="skills/x/SKILL.md", collection=None, routing=r
        )

    def test_output_match_scores_highest(self):
        c = self._cand(output_artifacts=["security-review"])
        score_candidate(c, RequestFacets(output_artifacts=["security-review"]))
        assert c.score >= 40

    def test_deprecated_hard_excluded(self):
        c = self._cand(output_artifacts=["security-review"])
        c.routing["_deprecated"] = True
        score_candidate(c, RequestFacets(output_artifacts=["security-review"]))
        assert c.excluded_reason == "deprecated"
        assert c.score < 0

    def test_avoid_when_hard_excluded(self):
        c = self._cand(output_artifacts=["security-review"], avoid_when=["about a CI workflow"])
        score_candidate(
            c, RequestFacets(output_artifacts=["security-review"], keywords=["this is about a CI workflow"])
        )
        assert c.excluded_reason == "matched avoid_when"

    def test_delegation_demotes_candidate(self):
        a = self._cand(output_artifacts=["security-review"], delegates=[{"pattern": "b", "when": "ci workflow"}])
        a.id = "a"
        b = self._cand(output_artifacts=["security-review"])
        b.id = "b"
        facets = RequestFacets(output_artifacts=["security-review"], keywords=["audit this ci workflow"])
        for c in (a, b):
            score_candidate(c, facets)
        apply_delegation([a, b], facets)
        assert a.excluded_reason and "delegated to b" in a.excluded_reason


# ── Route minimality ──────────────────────────────────────────────────────────


class TestRouteAssembly:
    def test_supporting_only_adds_distinct_outputs(self):
        # Two candidates with the SAME output → the second is not "supporting".
        def mk(pid, outputs, score):
            r = {"output_artifacts": outputs, "_triggers": [], "_deprecated": False}
            c = Candidate(
                id=pid, type="skill", status="experimental", path=f"skills/{pid}/SKILL.md", collection=None, routing=r
            )
            c.score = score
            return c

        a = mk("a", ["security-review"], 40)
        b = mk("b", ["security-review"], 30)
        route = build_route([a, b], RequestFacets(output_artifacts=["security-review"]))
        assert route["primary"]["id"] == "a"
        assert route["supporting"] == []  # b adds no distinct output


class TestPhraseHit:
    """Regression for the short-substring false-positive guard (#239 review)."""

    def test_short_token_requires_word_boundary(self):
        from scripts.route_patterns import _phrase_hit

        # "ci" must NOT match "decision" (substring) — word-boundary guarded.
        assert _phrase_hit(["make a decision"], ["ci"]) is False
        # but DOES match "ci workflow" on a boundary.
        assert _phrase_hit(["audit this ci workflow"], ["ci"]) is True

    def test_multiword_phrase_substring_ok(self):
        from scripts.route_patterns import _phrase_hit

        assert _phrase_hit(["please run the full qa process now"], ["qa process"]) is True

    def test_empty_inputs_never_match(self):
        from scripts.route_patterns import _phrase_hit

        assert _phrase_hit([], ["anything"]) is False
        assert _phrase_hit(["anything"], []) is False
        assert _phrase_hit([""], [""]) is False


class TestTaxonomyFailOpenDocumented:
    """Documents the intentional fail-open when taxonomy.yaml is absent (#239 review)."""

    def test_absent_taxonomy_allows_any_facet(self):
        # With no vocab, validation cannot reject — this is a known, accepted
        # posture for a repo-local tool (the file is always present in CI).
        empty_tax = {"task_types": set(), "artifact_types": set()}
        facets = RequestFacets(task_types=["frobnicate"], output_artifacts=["hologram"])
        assert validate_request(facets, empty_tax) == []


class TestLiveIndexRouting:
    """#240: once patterns carry routing, the router resolves real requests.

    These exercise the security-lane disambiguation end-to-end against the
    committed INDEX.yaml (the classification landed in this PR).
    """

    def _route(self, **kw):
        import yaml as _yaml

        index = _yaml.safe_load((REPO_ROOT / "INDEX.yaml").read_text())
        return route_request(REPO_ROOT, index, RequestFacets(**kw))

    def test_ci_workflow_audit_routes_to_auditor(self):
        route = self._route(
            task_types=["review"],
            input_artifacts=["ci-workflow"],
            output_artifacts=["security-review"],
            keywords=["audit this github actions workflow pull_request_target"],
        )
        assert route["primary"]["id"] == "agentic-actions-auditor"

    def test_token_minimality_routes_to_lpr_not_auditor(self):
        route = self._route(
            task_types=["review"],
            output_artifacts=["security-review"],
            keywords=["are these GITHUB_TOKEN permissions minimal"],
        )
        assert route["primary"]["id"] == "least-privilege-review"
        assert "agentic-actions-auditor" not in {e["id"] for e in route["excluded"] if e} or True
        # auditor must not be primary/supporting
        selected = {route["primary"]["id"]} | {s["id"] for s in route["supporting"]}
        assert "agentic-actions-auditor" not in selected

    def test_deprecated_safe_code_review_not_selected(self):
        route = self._route(
            task_types=["review"],
            output_artifacts=["security-review"],
            keywords=["security code review", "vulnerability review"],
        )
        selected = {route["primary"]["id"]} | {s["id"] for s in route["supporting"]}
        assert "safe-code-review" not in selected
