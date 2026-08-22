"""Tests for the hybrid/v1 volumes vocabulary.

Quickstart ADR-0022 promotes sized guest storage volumes to the NEUTRAL kit
vocabulary (sbx: kit-spec v2 §5.7 pass-through; msb: derived named disk volume
or --tmpfs); acq consumes them. This locks in the schema shape and the
validator's field-level enforcement:

  - volumes[]: path (required, absolute, safe charset [A-Za-z0-9._/-] — same
    rule as files[].path), size (required non-zero PORTABLE byte-size string,
    e.g. "20G", "512m", "1.5G" — no b/ib suffixes, which msb rejects; no
    unsized default; non-zero is validator-enforced), type (optional, ""
    block | "tmpfs"), no additional properties. Duplicate paths within one
    kit are a validator-level authoring error.
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


# --- schema-level: volumes ----------------------------------------------------


class TestVolumesSchema:
    def test_absent_volumes_still_valid(self):
        jsonschema.validate(instance=_base(), schema=_load_schema())

    def test_block_and_tmpfs_entries_accepted(self):
        inst = _base(
            volumes=[
                {"path": "/nix", "size": "20G"},  # type optional, defaults to block
                {"path": "/scratch", "size": "512m", "type": "tmpfs"},
                {"path": "/data", "size": "1.5G", "type": ""},
            ]
        )
        jsonschema.validate(instance=inst, schema=_load_schema())  # must not raise

    def test_path_required(self):
        inst = _base(volumes=[{"size": "1G"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_size_required(self):
        inst = _base(volumes=[{"path": "/nix"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize("bad", ["nix", "relative/path", "/bad path", "/tick'"])
    def test_bad_path_rejected(self, bad):
        inst = _base(volumes=[{"path": bad, "size": "1G"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize(
        "bad",
        [
            "",
            "G",
            "2G; rm -rf /",
            "20 G",
            ".5G",
            "1..5G",
            # b/ib suffixes are deliberately non-portable: sbx accepts them,
            # msb's size parser rejects them (verified on msb 0.6.12).
            "256MB",
            "2gib",
            "3kB",
            "4Ti",
        ],
    )
    def test_bad_size_rejected(self, bad):
        inst = _base(volumes=[{"path": "/nix", "size": bad}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize("good", ["20G", "512m", "1.5G", "100", "3k", "4T"])
    def test_good_size_accepted(self, good):
        inst = _base(volumes=[{"path": "/nix", "size": good}])
        jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize("bad", ["block", "disk", "ramfs", "TMPFS"])
    def test_bad_type_rejected(self, bad):
        inst = _base(volumes=[{"path": "/nix", "size": "1G", "type": bad}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_mode_field_rejected(self):
        # There is deliberately NO mode field (no msb equivalent; kits chmod in
        # a startup step) — additionalProperties: false must reject it.
        inst = _base(volumes=[{"path": "/nix", "size": "1G", "mode": "0755"}])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())


# --- validate_kit field-level enforcement ------------------------------------


class TestValidateKitVolumes:
    def test_valid_kit_has_no_errors(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "volkit",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: volkit\n"
            "displayName: Vol\n"
            "description: d\n"
            "volumes:\n"
            "  - path: /nix\n"
            "    size: 20G\n"
            "  - path: /scratch\n"
            "    size: 512m\n"
            "    type: tmpfs\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors

    def test_flags_relative_and_unsafe_paths(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badpath",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badpath\n"
            "displayName: Bad\n"
            "description: d\n"
            "volumes:\n"
            "  - path: relative/path\n"
            "    size: 1G\n"
            '  - path: "/bad;path"\n'
            "    size: 1G\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        path_errors = [e for e in errors if "path must be an absolute path" in e]
        assert len(path_errors) == 2, errors
        assert any("volumes[0].path" in e for e in path_errors), errors
        assert any("volumes[1].path" in e for e in path_errors), errors

    def test_flags_missing_metacharacter_and_nonportable_size(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badsize",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badsize\n"
            "displayName: Bad\n"
            "description: d\n"
            "volumes:\n"
            "  - path: /nix\n"
            "  - path: /data\n"
            '    size: "2G; rm -rf /"\n'
            "  - path: /cache\n"
            "    size: 2gib\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("volumes[0].size is required" in e for e in errors), errors
        assert any("volumes[1].size is required" in e for e in errors), errors
        assert any("volumes[2].size is required" in e and "no b/ib suffix" in e for e in errors), errors

    @pytest.mark.parametrize("zero", ["0", "0G", "0.0", "00m"])
    def test_flags_zero_size(self, tmp_path, zero):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "zerosize",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: zerosize\n"
            "displayName: Zero\n"
            "description: d\n"
            "volumes:\n"
            "  - path: /nix\n"
            f'    size: "{zero}"\n',
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("volumes[0].size must be non-zero" in e for e in errors), errors

    def test_flags_duplicate_paths(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "duppath",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: duppath\n"
            "displayName: Dup\n"
            "description: d\n"
            "volumes:\n"
            "  - path: /data\n"
            "    size: 1G\n"
            "  - path: /data\n"
            "    size: 20G\n"
            "  - path: /scratch\n"
            "    size: 512m\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("volumes: duplicate path '/data' (declared 2 times)" in e for e in errors), errors
        assert not any("'/scratch'" in e for e in errors), errors

    def test_flags_bad_type(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badtype",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badtype\n"
            "displayName: Bad\n"
            "description: d\n"
            "volumes:\n"
            "  - path: /nix\n"
            "    size: 1G\n"
            "    type: block\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any('volumes[0].type must be "" (block) or "tmpfs"' in e for e in errors), errors
