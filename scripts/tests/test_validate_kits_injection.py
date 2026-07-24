"""Regression tests for the acq-kits validator's injection guards (#225).

The neutral hybrid/v1 kit spec's files[].path / files[].mode / commands[].user
flow into backend adapters that may interpolate them into a (root) shell — so a
hostile or typo'd value is a command-injection vector. The schema patterns +
validate_kit's defense-in-depth path check must REJECT such values at the gate.
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


# --- schema-level: hostile mode / user / path must not validate ---------------


@pytest.mark.parametrize(
    "instance, why",
    [
        (_base(files=[{"path": "/home/agent/x", "mode": "0644; id", "source": "files/x"}]), "mode injection"),
        (_base(commands=[{"phase": "startup", "user": "0; id", "command": ["sh"]}]), "user injection"),
        (_base(files=[{"path": "/home/agent/x'; id #", "mode": "0644", "source": "files/x"}]), "quote in path"),
        (_base(files=[{"path": "/home/agent/$(id)", "mode": "0644", "source": "files/x"}]), "cmd-subst in path"),
        (_base(files=[{"path": "/home/agent/x y", "mode": "0644", "source": "files/x"}]), "space in path"),
    ],
)
def test_schema_rejects_injection_shaped_values(instance, why):
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=instance, schema=_load_schema())


def test_schema_accepts_valid_file_entry():
    inst = _base(files=[{"path": "/home/agent/x.sh", "mode": "0755", "source": "files/x"}])
    jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise


# --- validate_kit defense-in-depth: unsafe path is reported even if reached ---


def test_validate_kit_flags_unsafe_path(tmp_path):
    validate_kit = _load_validate_kit()
    kit = tmp_path / "evilkit"
    kit.mkdir()
    (kit / "README.md").write_text("# evil\n")
    (kit / "spec.yaml").write_text(
        "schemaVersion: hybrid/v1\n"
        "kind: mixin\n"
        "name: evilkit\n"
        "displayName: Evil\n"
        "description: d\n"
        "files:\n"
        '  - path: "/home/agent/x\'; id #"\n'
        '    mode: "0644"\n'
        "    source: files/x\n"
    )
    errors, _warnings = validate_kit(kit, _load_schema())
    assert any("unsafe character" in e or "does not match" in e for e in errors), errors
