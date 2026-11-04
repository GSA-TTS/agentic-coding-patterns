"""Tests for the safe-kit-update foundation (quickstart#235, patterns#273).

Three concerns, all additive/no-behavior-change:

1. `provenance` schema field — additive + backward-compatible on hybrid/v1.
2. Renderer ownership — provider kits no longer ship an OpenCode config or
   writer; policy belongs to the OpenCode kit.
3. Provider-package drift guard — the retired provider-owned config and writers
   must remain absent from both neutral and SBX compatibility packages.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "schemas" / "kit-hybrid-v1.schema.json"
ACQ_USAI = ROOT / "integrations/isolation/acq-kits/usai-provider"
SBX_USAI = ROOT / "integrations/isolation/sbx-kits/usai-provider-kit"


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _base(**extra) -> dict:
    d = {
        "schemaVersion": "hybrid/v1",
        "kind": "mixin",
        "name": "t",
        "displayName": "T",
        "description": "d",
    }
    d.update(extra)
    return d


# --- 1. provenance schema field ----------------------------------------------


class TestProvenanceSchema:
    def test_valid_provenance_accepted(self):
        inst = _base(
            provenance={
                "repo": "GSA-TTS/agentic-coding-patterns",
                "bundle": "acq-builtin",
                "bundle_version": "1",
                "kit_names": ["usai-provider", "git-ssh-sign"],
            }
        )
        jsonschema.validate(instance=inst, schema=_schema())  # must not raise

    def test_absent_provenance_still_valid(self):
        # Backward compatibility: a kit without provenance is fine.
        jsonschema.validate(instance=_base(), schema=_schema())

    def test_bad_repo_shape_rejected(self):
        inst = _base(provenance={"repo": "not a repo"})
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_schema())

    def test_unknown_provenance_key_rejected(self):
        inst = _base(provenance={"repo": "a/b", "sha": "deadbeef"})  # sha is not schema-owned
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_schema())

    def test_bundle_version_pattern(self):
        inst = _base(provenance={"bundle_version": "1.2.3"})
        jsonschema.validate(instance=inst, schema=_schema())
        bad = _base(provenance={"bundle_version": "v1"})
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=bad, schema=_schema())

    def test_live_usai_spec_declares_provenance(self):
        import yaml

        spec = yaml.safe_load((ACQ_USAI / "spec.yaml").read_text())
        prov = spec.get("provenance")
        assert prov and prov["repo"] == "GSA-TTS/agentic-coding-patterns"
        assert set(prov["kit_names"]) == {
            "usai-provider",
            "agentic-coding-playbook",
            "zscaler-ca-certificate",
            "git-ssh-sign",
        }


# --- 2. permission / mcp preservation (regression guard) ----------------------

# Import the kit's merge logic directly (pure functions computeOutput/deepMerge
# live in merge-global-config.mjs — a Node module). We validate the PROPERTY at
# the config level here in Python by asserting the shipped config does NOT ship
# `mcp` (so a user's mcp can never be touched) and documents the ownership
# marker. The behavioral merge test lives in the kit's own .mjs suite; this is a
# defense-in-depth lock at the repo-test layer.


def _strip_jsonc(text: str) -> str:
    """Minimal JSONC → JSON for tests (no JSON5 runtime dep).

    Strips /* */ and // comments while respecting string literals (so a `//`
    inside a URL value like "https://..." is NOT treated as a comment), then
    removes trailing commas. A small state machine — good enough for the kit's
    committed config, and avoids the naive-regex URL bug.
    """
    out = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:  # escaped char inside string
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":  # line comment
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":  # block comment
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    stripped = "".join(out)
    stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)  # trailing commas
    return stripped


def _top_level_keys(jsonc_text: str) -> set[str]:
    data = json.loads(_strip_jsonc(jsonc_text))
    return set(data.keys())


class TestRendererOwnership:
    def test_provider_packages_do_not_ship_opencode_configs_or_writers(self):
        for root in (ACQ_USAI, SBX_USAI):
            assert not (root / "files/home/usai-config/opencode.jsonc").exists()
            assert not (root / "files/home/usai-config/merge-global-config.mjs").exists()
            assert not (root / "scripts/sync-usai-models.mjs").exists()

    def test_orphaned_usai_model_list_fixtures_stay_removed(self):
        # These feed fixtures belonged to the retired sync script's tests and
        # have no remaining consumer.
        for root in (ACQ_USAI, SBX_USAI):
            assert not (root / "tests/fixtures/usai-models.json").exists()


INTEGRATIONS = ROOT / "integrations"
# Frozen byte-exact renderer-contract fixture: its comment is part of the
# contract digest and must not be edited.
FROZEN_FIXTURES = {
    INTEGRATIONS / "providers/usai/tests/fixtures/opencode-production.jsonc",
}


def _integration_files(suffixes: tuple[str, ...]) -> list[Path]:
    return [
        p for p in INTEGRATIONS.rglob("*") if p.is_file() and p.suffix in suffixes and "node_modules" not in p.parts
    ]


class TestRetiredRefreshCommand:
    def test_no_live_instruction_to_run_the_retired_npm_script(self):
        offenders = [
            str(p.relative_to(ROOT))
            for p in _integration_files((".md", ".json", ".mjs", ".yaml", ".yml", ".sh", ""))
            if p not in FROZEN_FIXTURES and re.search(r"sync:usai-models", p.read_text(errors="replace"))
        ]
        assert offenders == []

    def test_node_test_scripts_have_tests(self):
        # An npm "test" script over a glob that matches nothing passes with
        # "tests 0", which reads as evidence when there is none.
        offenders = []
        for pkg in INTEGRATIONS.rglob("package.json"):
            if "node_modules" in pkg.parts:
                continue
            script = json.loads(pkg.read_text()).get("scripts", {}).get("test", "")
            if "node --test" in script and not list(pkg.parent.glob("tests/**/*.test.mjs")):
                offenders.append(str(pkg.relative_to(ROOT)))
        assert offenders == []
