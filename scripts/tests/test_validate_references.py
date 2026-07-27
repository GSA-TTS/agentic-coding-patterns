"""Tests for validate_references.py — cross-reference & delegation-cycle guard (#240)."""

from scripts.validate_references import _find_cycles, find_reference_errors


class TestDanglingReferences:
    def test_clean_when_all_resolve(self):
        patterns = {
            "a": {"id": "a", "routing": {"delegates": [{"pattern": "b", "when": "x"}]}},
            "b": {"id": "b"},
        }
        assert find_reference_errors(patterns) == []

    def test_dangling_delegate_flagged(self):
        patterns = {"a": {"id": "a", "routing": {"delegates": [{"pattern": "ghost", "when": "x"}]}}}
        errors = find_reference_errors(patterns)
        assert errors and "ghost" in errors[0]

    def test_dangling_replaces_with_flagged(self):
        patterns = {"a": {"id": "a", "deprecated": {"replaces_with": "ghost", "reason": "r", "as_of": "2026-01-01"}}}
        errors = find_reference_errors(patterns)
        assert errors and "replaces_with" in errors[0]

    def test_dangling_requires_flagged(self):
        patterns = {"a": {"id": "a", "requires": {"skills": ["ghost"], "anchors": []}}}
        errors = find_reference_errors(patterns)
        assert errors and "requires.skills" in errors[0]

    def test_valid_replaces_with_ok(self):
        patterns = {
            "old": {"id": "old", "deprecated": {"replaces_with": "new", "reason": "r", "as_of": "2026-01-01"}},
            "new": {"id": "new"},
        }
        assert find_reference_errors(patterns) == []


class TestCycles:
    def test_direct_cycle_detected(self):
        graph = {"a": ["b"], "b": ["a"]}
        errors = _find_cycles(graph)
        assert errors and "cycle" in errors[0]

    def test_self_cycle_detected(self):
        graph = {"a": ["a"]}
        assert _find_cycles(graph)

    def test_acyclic_clean(self):
        graph = {"a": ["b"], "b": ["c"], "c": []}
        assert _find_cycles(graph) == []

    def test_cycle_surfaced_through_find_reference_errors(self):
        patterns = {
            "a": {"id": "a", "routing": {"delegates": [{"pattern": "b", "when": "x"}]}},
            "b": {"id": "b", "routing": {"delegates": [{"pattern": "a", "when": "y"}]}},
        }
        errors = find_reference_errors(patterns)
        assert any("cycle" in e for e in errors)


class TestLiveRepo:
    """The real repository must have no dangling refs or cycles (#240 gate)."""

    def test_repo_references_resolve(self):
        from pathlib import Path

        from scripts.validate_references import collect_patterns

        root = Path(__file__).resolve().parents[2]
        patterns = collect_patterns(root)
        assert patterns, "expected to find patterns"
        errors = find_reference_errors(patterns)
        assert errors == [], f"live repo has reference errors: {errors}"
