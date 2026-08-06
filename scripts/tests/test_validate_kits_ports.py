"""Tests for the hybrid/v1 publishedPorts + commands[].background fields.

ADR-0014 (quickstart repo) promotes published-port declarations and a
detached-startup-command flag to the NEUTRAL kit vocabulary; acq consumes both.
This locks in the schema shape and the validator's field-level enforcement:

  - publishedPorts[]: guest (required int 1..65535), host (optional int 1..65535,
    defaults to guest when omitted), protocol (optional tcp|udp, default tcp),
    name (optional, ^[A-Za-z0-9._-]{1,64}$), no additional properties.
  - commands[].background: optional boolean (default false).
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


# --- schema-level: publishedPorts --------------------------------------------


class TestPublishedPortsSchema:
    def test_absent_published_ports_still_valid(self):
        jsonschema.validate(instance=_base(), schema=_load_schema())

    def test_full_valid_entry_accepted(self):
        inst = _base(
            publishedPorts=[
                {"guest": 4096, "host": 14096, "protocol": "tcp", "name": "opencode-server"},
                {"guest": 3000},  # host/protocol/name all optional
            ]
        )
        jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise

    def test_guest_required(self):
        inst = _base(publishedPorts=[{"host": 8080}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize("bad", [0, 65536, -1])
    def test_guest_out_of_range_rejected(self, bad):
        inst = _base(publishedPorts=[{"guest": bad}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_bad_protocol_rejected(self):
        inst = _base(publishedPorts=[{"guest": 80, "protocol": "sctp"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_bad_name_charset_rejected(self):
        inst = _base(publishedPorts=[{"guest": 80, "name": "bad name!"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_additional_property_on_entry_rejected(self):
        inst = _base(publishedPorts=[{"guest": 80, "container": 80}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())


# --- schema-level: commands[].background -------------------------------------


class TestBackgroundSchema:
    def test_background_true_accepted(self):
        inst = _base(commands=[{"phase": "startup", "command": ["sh"], "background": True}])
        jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise

    def test_background_absent_accepted(self):
        inst = _base(commands=[{"phase": "startup", "command": ["sh"]}])
        jsonschema.validate(instance=inst, schema=_load_schema())

    def test_background_non_boolean_rejected(self):
        inst = _base(commands=[{"phase": "startup", "command": ["sh"], "background": "yes"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())


# --- validate_kit field-level enforcement ------------------------------------


class TestValidateKitPortsAndBackground:
    def test_valid_kit_has_no_errors(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "portkit",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: portkit\n"
            "displayName: Port\n"
            "description: d\n"
            "publishedPorts:\n"
            "  - guest: 4096\n"
            "    protocol: tcp\n"
            "    name: opencode-server\n"
            "  - guest: 3000\n"
            "commands:\n"
            "  - phase: startup\n"
            '    command: ["sh", "-c", "loop &"]\n'
            "    background: true\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors

    def test_flags_out_of_range_guest(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badport",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badport\n"
            "displayName: Bad\n"
            "description: d\n"
            "publishedPorts:\n"
            "  - guest: 99999\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("guest must be an integer 1..65535" in e for e in errors), errors

    def test_flags_bad_protocol_and_name(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badproto",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badproto\n"
            "displayName: Bad\n"
            "description: d\n"
            "publishedPorts:\n"
            "  - guest: 80\n"
            "    protocol: sctp\n"
            '    name: "bad name!"\n',
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("protocol must be one of" in e for e in errors), errors
        assert any("name has an unsafe or invalid value" in e for e in errors), errors

    def test_flags_non_boolean_background(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badbg",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badbg\n"
            "displayName: Bad\n"
            "description: d\n"
            "commands:\n"
            "  - phase: startup\n"
            '    command: ["sh"]\n'
            '    background: "yes"\n',
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("background must be a boolean" in e for e in errors), errors
