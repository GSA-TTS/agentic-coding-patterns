"""Tests for the neutral network.tier egress vocabulary (#300).

`caps.network.tier` (enum strict|balanced|open) is the neutral egress posture in
the hybrid/v1 kit schema. All tiers are deny-by-default; the tier only sizes the
baseline allowlist. Omission is valid and means the default `balanced` posture
(documented, not mutated). This locks in the schema enum + the validator's
field-level message + the coexistence with the existing `caps.network.allow`.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "schemas" / "kit-hybrid-v1.schema.json"
VALIDATOR_PATH = ROOT / "integrations" / "isolation" / "acq-kits" / "validate-kits.py"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _load_validate_kit():
    spec = importlib.util.spec_from_file_location("validate_kits", VALIDATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.validate_kit


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


def _write_kit(kit_dir: Path, spec_yaml: str) -> Path:
    kit_dir.mkdir(parents=True, exist_ok=True)
    (kit_dir / "README.md").write_text("# t\n")
    (kit_dir / "spec.yaml").write_text(spec_yaml)
    return kit_dir


# --- schema-level -------------------------------------------------------------


class TestNetworkTierSchema:
    def test_absent_tier_still_valid(self):
        # Omission is valid → the default `balanced` posture (documented).
        jsonschema.validate(instance=_base(), schema=_load_schema())

    def test_absent_network_block_still_valid(self):
        jsonschema.validate(instance=_base(), schema=_load_schema())

    @pytest.mark.parametrize("tier", ["strict", "balanced", "open"])
    def test_valid_tiers_accepted(self, tier):
        inst = _base(caps={"network": {"tier": tier}})
        jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise

    def test_tier_coexists_with_allow(self):
        inst = _base(caps={"network": {"tier": "balanced", "allow": ["api.example.gov"]}})
        jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise

    def test_bad_tier_rejected(self):
        inst = _base(caps={"network": {"tier": "wideopen"}})
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_tier_wrong_type_rejected(self):
        inst = _base(caps={"network": {"tier": 1}})
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_typo_key_on_network_rejected(self):
        # additionalProperties:false on caps.network — a mis-spelled `teir` fails.
        inst = _base(caps={"network": {"teir": "balanced"}})
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())


# --- validator field-level message --------------------------------------------


class TestNetworkTierValidator:
    def test_valid_tier_kit_passes(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "k",
            "schemaVersion: hybrid/v1\nkind: mixin\nname: t\ndisplayName: T\n"
            "description: d\ncaps:\n  network:\n    tier: strict\n",
        )
        errors, _ = validate_kit(kit, _load_schema())
        assert not any("tier" in e for e in errors)

    def test_absent_tier_kit_passes(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "k",
            "schemaVersion: hybrid/v1\nkind: mixin\nname: t\ndisplayName: T\n"
            "description: d\ncaps:\n  network:\n    allow:\n      - api.example.gov\n",
        )
        errors, _ = validate_kit(kit, _load_schema())
        assert not any("tier" in e for e in errors)

    def test_bad_tier_flagged_with_message(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "k",
            "schemaVersion: hybrid/v1\nkind: mixin\nname: t\ndisplayName: T\n"
            "description: d\ncaps:\n  network:\n    tier: wideopen\n",
        )
        errors, _ = validate_kit(kit, _load_schema())
        assert any("network.tier" in e and "strict|balanced|open" in e for e in errors)
