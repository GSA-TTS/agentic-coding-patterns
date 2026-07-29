"""Tests for the safe-kit-update foundation (quickstart#235, patterns#273).

Three concerns, all additive/no-behavior-change:

1. `provenance` schema field — additive + backward-compatible on hybrid/v1.
2. Permission/MCP preservation — lock in that the usai kit's startup merge keeps
   a user's existing `permission.*` sub-keys and `mcp` block (audit found this is
   already the case; this guards against regression).
3. acq/sbx drift guard — the two usai-provider `opencode.jsonc` payloads are
   byte-identical today (only an ownership-marker comment + spec vocabulary
   differ, by ADR-0001 design); fail if the JSON payloads ever diverge.
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


class TestPermissionMcpPreservation:
    def test_kit_does_not_ship_mcp(self):
        # If the kit never ships `mcp`, the startup deep-merge can never overwrite
        # a user's MCP allow-list. Locks in the audited "user MCP untouched" fact.
        keys = _top_level_keys((ACQ_USAI / "files/home/usai-config/opencode.jsonc").read_text())
        assert "mcp" not in keys, f"kit unexpectedly ships mcp; top-level keys={sorted(keys)}"

    def test_kit_shipped_keys_are_the_known_conflict_surface(self):
        # These are the ONLY top-level keys a merge can touch. If this set grows,
        # a reviewer must re-check the "don't clobber user config" property.
        keys = _top_level_keys((ACQ_USAI / "files/home/usai-config/opencode.jsonc").read_text())
        expected = {
            "$schema",
            "enabled_providers",
            "provider",
            "model",
            "small_model",
            "agent",
            "compaction",
            "instructions",
            "permission",
            "watcher",
        }
        assert keys == expected, f"shipped top-level keys changed: {sorted(keys ^ expected)}"

    def test_merge_script_present_for_both_variants(self):
        assert (ACQ_USAI / "files/home/usai-config/merge-global-config.mjs").is_file()
        assert (SBX_USAI / "files/home/usai-config/merge-global-config.mjs").is_file()


# --- 3. acq/sbx drift guard ---------------------------------------------------

_GEN_START = "// BEGIN GENERATED USAI MODELS"
_GEN_END = "// END GENERATED USAI MODELS"


def _generated_models_block(text: str) -> str:
    start = text.index(_GEN_START)
    end = text.index(_GEN_END)
    return text[start:end]


class TestAcqSbxDriftGuard:
    """The two usai-provider opencode.jsonc payloads must not diverge (#273).

    They are byte-identical today except the ownership-marker comment. The most
    important invariant is that the GENERATED MODELS block matches — otherwise a
    `sync:usai-models` run applied to one variant but not the other would ship
    two different model catalogs.
    """

    def test_generated_model_blocks_match(self):
        acq = (ACQ_USAI / "files/home/usai-config/opencode.jsonc").read_text()
        sbx = (SBX_USAI / "files/home/usai-config/opencode.jsonc").read_text()
        assert _generated_models_block(acq) == _generated_models_block(sbx), (
            "acq-kits and sbx-kits usai model catalogs have diverged — run "
            "sync:usai-models against BOTH variants (or converge per ADR-0001 Phase-4)."
        )

    def test_parsed_json_payloads_match(self):
        # Full JSON payload equality (comments differ by design — the ownership
        # marker — so compare parsed JSON, not raw text).
        acq = json.loads(_strip_jsonc((ACQ_USAI / "files/home/usai-config/opencode.jsonc").read_text()))
        sbx = json.loads(_strip_jsonc((SBX_USAI / "files/home/usai-config/opencode.jsonc").read_text()))
        assert acq == sbx, "acq-kits and sbx-kits usai opencode.jsonc JSON payloads have diverged (#273)"

    def test_merge_and_sync_scripts_identical(self):
        for rel in (
            "files/home/usai-config/merge-global-config.mjs",
            "scripts/sync-usai-models.mjs",
        ):
            assert (ACQ_USAI / rel).read_text() == (SBX_USAI / rel).read_text(), (
                f"{rel} differs between acq-kits and sbx-kits variants (#273)"
            )
