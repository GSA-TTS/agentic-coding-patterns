"""End-to-end routing matrix against the LIVE INDEX.yaml (#271).

Unlike test_route_patterns.py (which pins inline fixtures for engine unit tests),
this feeds realistic natural-language requests — decomposed into facets as the
model would — through the router against the *committed* INDEX, and asserts each
lands on the right pattern. It is the regression guard that catches broad
patterns displacing specific ones as the catalog grows (the class of bug found
during the epic-#237 end-to-end test).

Each case: (name, facets, expected_primary_id_or_None, forbidden_ids).
"""

from pathlib import Path

import pytest
import yaml

from scripts.route_patterns import RequestFacets, route_request

REPO_ROOT = Path(__file__).resolve().parents[2]
_INDEX = yaml.safe_load((REPO_ROOT / "INDEX.yaml").read_text())

# fmt: off
CASES = [
    # ── security lane (specificity + a sensible generic default) ──────────
    ("generic security review → secure-code-review",
        dict(task_types=["review"], input_artifacts=["source-code"],
             output_artifacts=["security-review"], keywords=["review this flask app for security issues"]),
        "secure-code-review", []),
    ("owasp vuln review → secure-code-review",
        dict(task_types=["review"], input_artifacts=["source-code"],
             output_artifacts=["security-review"], keywords=["review this code for OWASP vulnerabilities"]),
        "secure-code-review", []),
    ("ci workflow audit → agentic-actions-auditor",
        dict(task_types=["review"], input_artifacts=["ci-workflow"],
             output_artifacts=["security-review"],
             keywords=["audit this github actions workflow pull_request_target"]),
        "agentic-actions-auditor", ["secure-code-review", "least-privilege-review"]),
    ("token minimality → least-privilege-review",
        dict(task_types=["review"], output_artifacts=["security-review"],
             keywords=["are these GITHUB_TOKEN permissions minimal"]),
        "least-privilege-review", ["agentic-actions-auditor"]),
    ("dependency risk → dependency-analysis",
        dict(task_types=["review"], input_artifacts=["dependency-manifest"],
             output_artifacts=["security-review"], keywords=["assess these dependencies for supply-chain risk"]),
        "dependency-analysis", []),
    ("prompt injection → untrusted-input-boundary-review",
        dict(task_types=["review"], input_artifacts=["source-code"],
             output_artifacts=["security-review"],
             keywords=["untrusted input reaches a sink prompt injection trust boundary"]),
        "untrusted-input-boundary-review", []),
    ("backdoor → backdoor-review",
        dict(task_types=["review"], input_artifacts=["source-code"],
             output_artifacts=["security-review"], keywords=["is there a deliberate backdoor or hidden auth bypass"]),
        "backdoor-review", []),
    ("compliance claim → compliance-claim-checker",
        dict(task_types=["review"], input_artifacts=["compliance-claim"],
             output_artifacts=["security-review"], keywords=["verify this FedRAMP compliance claim"]),
        "compliance-claim-checker", []),
    ("incident evidence → incident-evidence-review",
        dict(task_types=["review"], input_artifacts=["incident-evidence"],
             output_artifacts=["security-review"], keywords=["review the incident postmortem evidence"]),
        "incident-evidence-review", []),
    ("scan orchestration → security-scan-review",
        dict(task_types=["orchestrate"], input_artifacts=["source-code"],
             output_artifacts=["security-review"],
             keywords=["run a language-aware security scan and triage the SARIF"]),
        "security-scan-review", []),
    ("deprecated safe-code-review never selected",
        dict(task_types=["review"], input_artifacts=["source-code"],
             output_artifacts=["security-review"], keywords=["security code review vulnerability review"]),
        "secure-code-review", ["safe-code-review"]),
    # ── engineering lane ──────────────────────────────────────────────────
    ("generate tests → test-generation",
        dict(task_types=["test", "author"], input_artifacts=["source-code"],
             keywords=["generate unit tests and improve coverage"]),
        "test-generation", []),
    ("over-engineering → over-engineering-review",
        dict(task_types=["review"], input_artifacts=["pull-request-diff"],
             output_artifacts=["qa-report"], keywords=["is this PR over-engineered unnecessary complexity yagni"]),
        "over-engineering-review", []),
    ("safe shell script → safe-shell-script-author",
        dict(task_types=["author"], output_artifacts=["shell-script"],
             keywords=["write a safe bash automation script"]),
        "safe-shell-script-author", []),
    ("full qa process → qa-workflow",
        dict(task_types=["orchestrate", "test"], output_artifacts=["qa-report"],
             keywords=["run the full QA process end to end preparation testing signoff"]),
        "qa-workflow", ["qa-round"]),
    ("single qa review → qa-round",
        dict(task_types=["review"], input_artifacts=["pull-request-diff"],
             output_artifacts=["qa-report"], keywords=["qa this diff against the acceptance criteria"]),
        "qa-round", []),
    ("implementation plan → implementation-plan",
        dict(task_types=["plan"], output_artifacts=["documentation"],
             keywords=["break this feature into an implementation plan task breakdown"]),
        "implementation-plan", []),
    ("issue to PR → issue-to-merge-request",
        dict(task_types=["orchestrate", "author"], output_artifacts=["pull-request-diff"],
             keywords=["take this issue through to a merge request dev cycle"]),
        "issue-to-merge-request", []),
    # ── content lane ──────────────────────────────────────────────────────
    ("readability → plain-language-review",
        dict(task_types=["review"], input_artifacts=["documentation"],
             keywords=["make this README easier for the public to understand plain language"]),
        "plain-language-review", ["documentation-review"]),
    ("stale docs → documentation-review",
        dict(task_types=["review"], input_artifacts=["documentation"],
             keywords=["check this README for stale commands and broken links"]),
        "documentation-review", ["design-artifact"]),
    # ── digital-service lane ──────────────────────────────────────────────
    ("uswds landing page → uswds-landing-page",
        dict(task_types=["author"], output_artifacts=["landing-page"],
             keywords=["build a uswds landing page"]),
        "uswds-landing-page", []),
    ("uswds form → uswds-form-flow",
        dict(task_types=["author"], output_artifacts=["form"],
             keywords=["build a multi-step uswds form"]),
        "uswds-form-flow", []),
    ("uswds generic prototype → uswds-prototype",
        dict(task_types=["author"], output_artifacts=["web-prototype"],
             keywords=["build a uswds html prototype page"]),
        "uswds-prototype", []),
    ("accessibility → accessibility-review",
        dict(task_types=["review"], input_artifacts=["web-page"],
             output_artifacts=["qa-report"], keywords=["check this page for 508 wcag accessibility"]),
        "accessibility-review", []),
    ("service blueprint → federal-service-blueprint",
        dict(task_types=["plan"], output_artifacts=["service-blueprint"],
             keywords=["map this federal service end to end blueprint"]),
        "federal-service-blueprint", []),
    # ── communications lane (workflow vs skill granularity) ───────────────
    ("executive one-pager → design-artifact workflow",
        dict(task_types=["author", "render"], output_artifacts=["one-pager"],
             keywords=["create an executive one-pager explaining the pilot"]),
        "design-artifact", []),
    ("slide deck (fresh) → design-artifact workflow",
        dict(task_types=["author"], output_artifacts=["slide-deck"],
             keywords=["make a slide deck for the review"]),
        "design-artifact", ["explainer-video"]),
    ("narrow render (has storyboard) → one-pager skill",
        dict(task_types=["render"], input_artifacts=["storyboard"],
             output_artifacts=["one-pager"], keywords=[]),
        "one-pager", ["design-artifact"]),
    ("explainer video → explainer-video",
        dict(task_types=["author", "render"], output_artifacts=["explainer-video"],
             keywords=["make an animated explainer video"]),
        "explainer-video", []),
    ("terminal demo → explainer-gif",
        dict(task_types=["author", "render"], output_artifacts=["terminal-demo"],
             keywords=["record a terminal screencast gif demo"]),
        "explainer-gif", []),
    ("artifact brief → artifact-brief",
        dict(task_types=["plan"], output_artifacts=["artifact-brief"],
             keywords=["what's the audience and core message"]),
        "artifact-brief", []),
    ("artifact qa → artifact-qa",
        dict(task_types=["review"], input_artifacts=["slide-deck"],
             output_artifacts=["qa-report"], keywords=["validate this rendered slide deck"]),
        "artifact-qa", []),
    # ── negative case ─────────────────────────────────────────────────────
    ("true no-match returns nothing",
        dict(output_artifacts=["diagram"], keywords=["draw an architecture diagram"]),
        None, []),
]
# fmt: on


@pytest.mark.parametrize("name,facets,expect,forbid", CASES, ids=[c[0] for c in CASES])
def test_live_routing(name, facets, expect, forbid):
    route = route_request(REPO_ROOT, _INDEX, RequestFacets(**facets))
    primary = route.get("primary")
    got = primary["id"] if primary else None
    assert got == expect, f"{name}: expected {expect!r}, got {got!r}"
    selected = ({got} if got else set()) | {s["id"] for s in route.get("supporting", [])}
    for f in forbid:
        assert f not in selected, f"{name}: forbidden {f!r} was selected ({selected})"


def test_every_pattern_is_routable():
    """Reachability: every non-deprecated pattern with output artifacts can be
    the primary for at least a request built from its own declared facets."""
    from scripts.route_patterns import load_candidates

    cands = load_candidates(REPO_ROOT, _INDEX)
    unreachable = []
    for c in cands:
        if c.routing.get("_deprecated"):
            continue
        outs = c.routing.get("output_artifacts") or []
        tasks = c.routing.get("task_types") or []
        if not outs or not tasks:
            continue
        facets = RequestFacets(
            task_types=list(tasks),
            input_artifacts=list(c.routing.get("input_artifacts") or []),
            output_artifacts=list(outs),
            keywords=list(c.routing.get("aliases") or []),
        )
        route = route_request(REPO_ROOT, _INDEX, facets)
        prim = route.get("primary")
        sel = ({prim["id"]} if prim else set()) | {s["id"] for s in route.get("supporting", [])}
        if c.id not in sel:
            unreachable.append(c.id)
    # A pattern may legitimately be beaten by a more-specific sibling on its own
    # generic facets; the guard is that MOST patterns are reachable and no whole
    # class disappears. Allow a small documented set beaten by design.
    beaten_by_design = {
        # generic security skills are out-competed by secure-code-review's
        # priority:60 on their shared facets; they win on their SPECIFIC inputs
        # (covered by the explicit cases above).
        "backdoor-review",
        "least-privilege-review",
        "agentic-actions-auditor",
        "untrusted-input-boundary-review",
        "compliance-claim-checker",
        "incident-evidence-review",
        "security-scan-review",
        # renderer skills are out-competed by the design-artifact workflow on a
        # fresh outcome ask; they win mid-pipeline (storyboard input) — covered above.
        "one-pager",
        "slide-deck",
        # lessons (TYPE_NUDGE -50) and agents (-5) are intentionally demoted so
        # they never win over a skill/workflow that does the same work — a lesson
        # is reference material, an agent is a role config, neither is "executed".
        "example-agentic-session",
        "security-review-agent",
    }
    real = [u for u in unreachable if u not in beaten_by_design]
    assert not real, f"unreachable patterns (not beaten-by-design): {real}"
