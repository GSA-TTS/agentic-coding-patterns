#!/usr/bin/env python3
"""Validate neutral acq kit specs (schemaVersion: hybrid/v1).

Checks each integrations/isolation/acq-kits/<kit>/spec.yaml against
schemas/kit-hybrid-v1.schema.json and enforces the cross-field rules the
JSON Schema cannot express on its own:

  - every files[].source resolves to an existing file under the kit dir
  - every backend_shortcuts / backend_extras key is a known backend
  - a README.md exists (parity note lives there)

It also emits WARN-level advisories (non-fatal by default) for likely re-home
regressions the schema can't catch:

  - a commands[] argv that references a kit-provided script/payload path
    (a /home/... .sh / .mjs / .py / .crt) that no files[] entry drops.

Usage:
    python integrations/isolation/acq-kits/validate-kits.py [--root .]
                                                            [--strict]

Exit status is non-zero if any kit has ERRORS. With --strict, WARN advisories
also fail the run. No network, no sandbox — this is the backend-agnostic gate;
live per-backend verification is each kit's scripts/verify.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import jsonschema
import yaml

KNOWN_BACKENDS = {"sbx", "msb", "ppp"}

# Extensions that indicate a kit-provided payload/script a command expects to
# have been dropped by files[] (as opposed to a base-image binary, a runtime-
# generated file, or a system destination path).
_PAYLOAD_SUFFIXES = (".sh", ".mjs", ".py", ".crt", ".pem", ".cjs", ".js")
# In-guest absolute paths the kit itself owns (agent home / config). We only
# flag missing drops under these roots to avoid false positives on system
# destinations like /usr/local/share/ca-certificates/… (a copy TARGET) or
# base-image binaries on PATH.
_KIT_OWNED_ROOTS = ("/home/",)
# Token → absolute-path finder: matches kit-owned absolute paths ending in a
# payload suffix, wherever they appear in an argv element (incl. inside sh -c).
_PATH_RE = re.compile(r"/home/[A-Za-z0-9._/-]+?(?:" + "|".join(re.escape(s) for s in _PAYLOAD_SUFFIXES) + r")\b")


def _referenced_payload_paths(commands: list) -> set[str]:
    """Kit-owned payload paths referenced anywhere in commands[] argv."""
    found: set[str] = set()
    for c in commands or []:
        for token in c.get("command", []) or []:
            if not isinstance(token, str):
                continue
            found.update(_PATH_RE.findall(token))
    return found


def validate_kit(kit_dir: Path, schema: dict) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for one kit."""
    errors: list[str] = []
    warnings: list[str] = []
    spec_path = kit_dir / "spec.yaml"
    if not spec_path.exists():
        return [f"{kit_dir.name}: missing spec.yaml"], warnings

    try:
        spec = yaml.safe_load(spec_path.read_text())
    except yaml.YAMLError as e:  # pragma: no cover - surfaced to user
        return [f"{kit_dir.name}: spec.yaml is not valid YAML: {e}"], warnings

    try:
        jsonschema.validate(instance=spec, schema=schema)
    except jsonschema.ValidationError as e:
        errors.append(f"{kit_dir.name}: schema: {e.message} (at {'/'.join(str(p) for p in e.absolute_path)})")

    # A spec that is empty (None) or a non-dict scalar fails schema validation
    # above; bail out before the dict-shaped checks below so a malformed spec is
    # reported as an invalid kit rather than crashing the whole run.
    if not isinstance(spec, dict):
        if not errors:
            errors.append(f"{kit_dir.name}: spec.yaml must be a mapping (got {type(spec).__name__})")
        return errors, warnings

    files = spec.get("files", []) or []
    for f in files:
        src = f.get("source")
        if src and not (kit_dir / src).exists():
            errors.append(f"{kit_dir.name}: files[].source not found: {src}")

    for section in ("backend_shortcuts", "backend_extras"):
        for backend in (spec.get(section) or {}):
            if backend not in KNOWN_BACKENDS:
                errors.append(f"{kit_dir.name}: {section}: unknown backend '{backend}'")

    if not (kit_dir / "README.md").exists():
        errors.append(f"{kit_dir.name}: missing README.md (parity note required)")

    # Best-effort commands[] ↔ files[] consistency: a kit-owned payload path
    # (e.g. /home/agent/foo.sh) referenced by a command but dropped by no
    # files[] entry is almost always a re-home typo. WARN, don't ERROR: this is
    # a heuristic (a command could legitimately create a script at runtime), so
    # it flags for human eyes rather than failing the gate outright.
    dropped = {f.get("path") for f in files if f.get("path")}
    for ref in sorted(_referenced_payload_paths(spec.get("commands", []))):
        if ref not in dropped:
            warnings.append(
                f"{kit_dir.name}: commands[] reference '{ref}' but no files[] entry drops it "
                f"(re-home typo? add a files[] entry, or ignore if created at runtime)"
            )

    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat WARN advisories as failures (non-zero exit).",
    )
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
    all_warnings: list[str] = []
    kit_names: list[str] = []
    for kit_dir in kit_dirs:
        errs, warns = validate_kit(kit_dir, schema)
        all_warnings.extend(warns)
        if errs:
            all_errors.extend(errs)
        else:
            print(f"  OK  {kit_dir.name}")
        # Record the spec's own name for the registry cross-check. A malformed
        # spec was already reported by validate_kit() above, so here we only need
        # to skip name collection for it — but narrow the catch to expected
        # parse/IO errors rather than swallowing everything (no silent failures).
        try:
            spec = yaml.safe_load((kit_dir / "spec.yaml").read_text())
            if isinstance(spec, dict) and spec.get("name"):
                kit_names.append(spec["name"])
        except (yaml.YAMLError, OSError):
            pass

    # Registry cross-check: kits.yaml must list exactly the kits present.
    registry_path = kits_dir / "kits.yaml"
    if registry_path.exists():
        try:
            registry = yaml.safe_load(registry_path.read_text())
            if not isinstance(registry, dict):
                raise ValueError("registry root must be a mapping")
            listed = set((registry.get("kits") or {}).keys())
            present = set(kit_names)
            missing = present - listed
            extra = listed - present
            for name in sorted(missing):
                all_errors.append(f"kits.yaml: missing registry entry for kit '{name}'")
            for name in sorted(extra):
                all_errors.append(f"kits.yaml: registry lists unknown kit '{name}'")
        except (yaml.YAMLError, ValueError) as e:
            all_errors.append(f"kits.yaml: not valid: {e}")
    else:
        all_errors.append("kits.yaml registry not found")

    if all_warnings:
        print("\nWARN:", file=sys.stderr)
        for w in all_warnings:
            print(f"  - {w}", file=sys.stderr)

    if all_errors:
        print("\nFAIL:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    if all_warnings and args.strict:
        print("\nFAIL: warnings present and --strict set.", file=sys.stderr)
        return 1

    suffix = f" ({len(all_warnings)} warning(s))" if all_warnings else ""
    print(f"\nAll {len(kit_dirs)} acq-kits valid.{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
