#!/usr/bin/env python3
"""Validate neutral acq kit specs (schemaVersion: hybrid/v1).

Checks each integrations/isolation/acq-kits/<kit>/spec.yaml against
schemas/kit-hybrid-v1.schema.json and enforces the cross-field rules the
JSON Schema cannot express on its own:

  - every files[].source resolves to an existing file under the kit dir
  - every backend_shortcuts / backend_extras key is a known backend
  - a README.md exists (parity note lives there)

Usage:
    python integrations/isolation/acq-kits/validate-kits.py [--root .]

Exit status is non-zero if any kit fails. No network, no sandbox — this is the
backend-agnostic gate; live per-backend verification is each kit's scripts/verify.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import jsonschema
import yaml

KNOWN_BACKENDS = {"sbx", "msb", "ppp"}


def validate_kit(kit_dir: Path, schema: dict) -> list[str]:
    errors: list[str] = []
    spec_path = kit_dir / "spec.yaml"
    if not spec_path.exists():
        return [f"{kit_dir.name}: missing spec.yaml"]

    try:
        spec = yaml.safe_load(spec_path.read_text())
    except yaml.YAMLError as e:  # pragma: no cover - surfaced to user
        return [f"{kit_dir.name}: spec.yaml is not valid YAML: {e}"]

    try:
        jsonschema.validate(instance=spec, schema=schema)
    except jsonschema.ValidationError as e:
        errors.append(f"{kit_dir.name}: schema: {e.message} (at {'/'.join(str(p) for p in e.absolute_path)})")

    for f in spec.get("files", []) or []:
        src = f.get("source")
        if src and not (kit_dir / src).exists():
            errors.append(f"{kit_dir.name}: files[].source not found: {src}")

    for section in ("backend_shortcuts", "backend_extras"):
        for backend in (spec.get(section) or {}):
            if backend not in KNOWN_BACKENDS:
                errors.append(f"{kit_dir.name}: {section}: unknown backend '{backend}'")

    if not (kit_dir / "README.md").exists():
        errors.append(f"{kit_dir.name}: missing README.md (parity note required)")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)

    root = args.root
    schema_path = root / "schemas" / "kit-hybrid-v1.schema.json"
    kits_dir = root / "integrations" / "isolation" / "acq-kits"

    if not schema_path.exists():
        print(f"ERROR: schema not found: {schema_path}", file=sys.stderr)
        return 1
    schema = json.loads(schema_path.read_text())
    jsonschema.Draft202012Validator.check_schema(schema)

    kit_dirs = sorted(d for d in kits_dir.iterdir() if d.is_dir()) if kits_dir.exists() else []
    if not kit_dirs:
        print(f"No kits found under {kits_dir}")
        return 0

    all_errors: list[str] = []
    for kit_dir in kit_dirs:
        errs = validate_kit(kit_dir, schema)
        if errs:
            all_errors.extend(errs)
        else:
            print(f"  OK  {kit_dir.name}")

    if all_errors:
        print("\nFAIL:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"\nAll {len(kit_dirs)} acq-kits valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
