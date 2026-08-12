"""Tests for the network-tier `balanced` baseline allowlist (#301, ADR 0002).

Covers the schema (host pattern, core required, tier const) and the curation
rules the standalone validator adds (every entry justified, no cross-tier
duplicate host), plus a consistency check on the live data file.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import jsonschema
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "schemas" / "network-tier-baseline-v1.schema.json"
DATA_PATH = ROOT / "integrations" / "isolation" / "network-tiers" / "balanced.yaml"
VALIDATOR_PATH = ROOT / "scripts" / "validate_network_tiers.py"


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _data() -> dict:
    return yaml.safe_load(DATA_PATH.read_text())


def _base(**extra) -> dict:
    d = {"version": "1.0", "tier": "balanced", "core": [{"host": "npmjs.org", "why": "npm"}]}
    d.update(extra)
    return d


# --- schema ------------------------------------------------------------------


class TestBaselineSchema:
    def test_minimal_valid(self):
        jsonschema.validate(_base(), _schema())

    @pytest.mark.parametrize(
        "host",
        [
            "npmjs.org",
            "registry.npmjs.org",
            "**.github.com",
            "*.one.digicert.com:80",
            "crl*.digicert.com:80",
            "archive.ubuntu.com:80",
        ],
    )
    def test_valid_host_forms(self, host):
        jsonschema.validate(_base(core=[{"host": host, "why": "test"}]), _schema())

    def test_tier_must_be_balanced(self):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_base(tier="strict"), _schema())

    def test_entry_requires_why(self):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_base(core=[{"host": "npmjs.org"}]), _schema())

    def test_core_required_nonempty(self):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_base(core=[]), _schema())

    def test_typo_key_rejected(self):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_base(core=[{"host": "npmjs.org", "reason": "x"}]), _schema())

    def test_bad_host_rejected(self):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_base(core=[{"host": "has space.com", "why": "test"}]), _schema())


# --- validator curation rules ------------------------------------------------


def _load_validator():
    spec = importlib.util.spec_from_file_location("vnt", VALIDATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBaselineDataFile:
    def test_live_file_is_schema_valid(self):
        jsonschema.validate(_data(), _schema())

    def test_every_entry_has_why(self):
        data = _data()
        for grp in ("core", "extended"):
            for e in data.get(grp, []):
                assert e.get("why", "").strip(), f"{grp}: {e.get('host')} missing why"

    def test_no_cross_tier_duplicate_host(self):
        data = _data()
        core = {e["host"] for e in data.get("core", [])}
        ext = {e["host"] for e in data.get("extended", [])}
        assert not (core & ext), f"host in both core and extended: {core & ext}"

    def test_core_has_essential_toolchain(self):
        # Sanity: the shipped default must include the core registries + AI API.
        core = {e["host"] for e in _data().get("core", [])}
        for essential in ("registry.npmjs.org", "pypi.org", "api.anthropic.com", "github.com"):
            assert essential in core, f"core baseline missing essential host {essential}"

    def test_saas_convenience_not_in_core(self):
        # The curation decision: dev-convenience SaaS is opt-in (extended), not
        # shipped in the default balanced egress for a prompt-injectable agent.
        core = {e["host"] for e in _data().get("core", [])}
        for opt_in in ("figma.com", "supabase.com", "vercel.com", "**.amazonaws.com"):
            assert opt_in not in core, f"{opt_in} should be extended (opt-in), not core"

    def test_validator_passes_on_live_file(self):
        assert _load_validator().main() == 0
