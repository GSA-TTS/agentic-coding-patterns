#!/usr/bin/env python3
"""Validate neutral acq kit specs (schemaVersion: hybrid/v1).

Checks each integrations/isolation/acq-kits/<kit>/spec.yaml against
schemas/kit-hybrid-v1.schema.json and enforces the cross-field rules the
JSON Schema cannot express on its own:

  - every files[].source resolves to an existing file under the kit dir
  - every backend_shortcuts / backend_extras key is a known backend
  - every environment[] key is a valid POSIX env var NAME, and its value is a
    plain string (defense-in-depth over the schema pattern: env vars reach the
    guest environment and possibly a shell, so a bad name is reported explicitly
    rather than only failing the schema's additionalProperties rule)
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

# Env var NAME must be a POSIX-portable identifier. Env values reach the guest
# environment and possibly a shell; the schema enforces this via patternProperties,
# but we ALSO check it here so a bad name is reported with a clear message at the
# gate (the maintainer of quickstart#202 wants field-level validation here).
#
# NOTE: only the NAME is validated. The VALUE is intentionally NOT sanitized or
# shell-escaped here (it may legitimately contain newlines or shell
# metacharacters). Safety is guaranteed *downstream, by construction*: backends
# MUST pass each value as argv / native env (msb `exec -e NAME=value`; sbx's
# native `environment.variables` block) and MUST NOT interpolate a value into a
# shell string. A new backend adapter must uphold this — do not assume this gate
# sanitized the value.
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Safe charset for a kit-dropped absolute path (#225). Adapters may interpolate
# files[].path into a shell command, so disallow anything that could break out
# of quoting or introduce a metacharacter — only absolute paths of
# alphanumerics and . _ / - are permitted. Mirrors the schema's path pattern.
_SAFE_PATH_RE = re.compile(r"^/[A-Za-z0-9._/-]+$")

# Safe charset for a publishedPorts[].name label. Mirrors the schema's name
# pattern: alphanumerics . _ - only, 1-64 chars. A name may be surfaced by a
# backend adapter (labels, generated primitives), so keep it metacharacter-free.
_PORT_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# Valid transport protocols for a published port (mirrors the schema enum).
_PORT_PROTOCOLS = {"tcp", "udp"}

# Portable byte-size grammar for a volumes[].size (integer or decimal + optional
# bare k/m/g/t/p unit: "20G", "512m", "1.5G"). Mirrors the schema's size
# pattern. Deliberately NO b/ib suffixes ("256MB", "2gib"): sbx's
# units.RAMInBytes accepts them but msb's size parser rejects them (verified on
# msb 0.6.12), so the neutral grammar is the INTERSECTION of the two. A
# volumes[].path reuses _SAFE_PATH_RE above — same charset rule as files[].path
# (#225).
_VOL_SIZE_RE = re.compile(r"^[0-9]+(\.[0-9]+)?[kKmMgGtTpP]?$")

# A size that parses but is zero ("0", "0G", "0.0"). The schema pattern alone
# cannot express non-zero cleanly, so the validator rejects it here.
_VOL_SIZE_ZERO_RE = re.compile(r"^0+(\.0+)?[kKmMgGtTpP]?$")

# Valid backing-storage types for a volume (mirrors the schema enum).
_VOL_TYPES = {"", "tmpfs"}

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


def _is_valid_port(value: object) -> bool:
    """A port is an integer in 1..65535. A bool is not a valid port here."""
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 65535


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
        # Defense-in-depth over the schema's path pattern (#225): a backend
        # adapter may interpolate files[].path into a command (e.g. the msb
        # adapter's `chmod $mode '$path'` in a root `sh -c`). A path carrying a
        # shell metacharacter — or a single quote that breaks out of the
        # adapter's quoting — is a root-command-injection vector. Reject any
        # path outside the safe charset even if the schema check were bypassed.
        path = f.get("path")
        if path is not None and not _SAFE_PATH_RE.match(str(path)):
            errors.append(
                f"{kit_dir.name}: files[].path has an unsafe character "
                f"(allowed: absolute path, alphanumerics . _ / -): {path!r}"
            )

    for section in ("backend_shortcuts", "backend_extras"):
        for backend in spec.get(section) or {}:
            if backend not in KNOWN_BACKENDS:
                errors.append(f"{kit_dir.name}: {section}: unknown backend '{backend}'")

    environment = spec.get("environment") or {}
    if not isinstance(environment, dict):
        errors.append(f"{kit_dir.name}: environment must be a mapping of NAME -> value")
    else:
        for name, value in environment.items():
            if not _ENV_NAME_RE.match(str(name)):
                errors.append(
                    f"{kit_dir.name}: environment: invalid env var name '{name}' (must match [A-Za-z_][A-Za-z0-9_]*)"
                )
            if not isinstance(value, str):
                errors.append(
                    f"{kit_dir.name}: environment['{name}']: value must be a string (got {type(value).__name__})"
                )

    if not (kit_dir / "README.md").exists():
        errors.append(f"{kit_dir.name}: missing README.md (parity note required)")

    # publishedPorts[] field-level checks (ADR-0014, quickstart repo). The
    # schema already constrains these, but — as with environment/path above —
    # we ALSO check them here so a bad value is reported with a clear per-entry
    # message at the gate (rather than only a terse jsonschema path). A port
    # published to the host is a boundary primitive: report offenders, reject.
    published_ports = spec.get("publishedPorts")
    if published_ports is not None:
        if not isinstance(published_ports, list):
            errors.append(
                f"{kit_dir.name}: publishedPorts must be an array of port-mapping objects "
                f"(got {type(published_ports).__name__})"
            )
        else:
            for i, entry in enumerate(published_ports):
                if not isinstance(entry, dict):
                    errors.append(f"{kit_dir.name}: publishedPorts[{i}] must be an object (got {type(entry).__name__})")
                    continue
                # guest: required int in 1..65535.
                if "guest" not in entry:
                    errors.append(f"{kit_dir.name}: publishedPorts[{i}]: missing required 'guest' port")
                else:
                    guest = entry["guest"]
                    if not _is_valid_port(guest):
                        errors.append(
                            f"{kit_dir.name}: publishedPorts[{i}].guest must be an integer 1..65535 (got {guest!r})"
                        )
                # host: optional int in 1..65535 (defaults to guest when omitted).
                if "host" in entry and not _is_valid_port(entry["host"]):
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].host must be an integer 1..65535 (got {entry['host']!r})"
                    )
                # protocol: optional, tcp|udp (defaults to tcp when omitted).
                if "protocol" in entry and entry["protocol"] not in _PORT_PROTOCOLS:
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].protocol must be one of "
                        f"{sorted(_PORT_PROTOCOLS)} (got {entry['protocol']!r})"
                    )
                # name: optional, safe charset only.
                if "name" in entry and not _PORT_NAME_RE.match(str(entry["name"])):
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].name has an unsafe or invalid value "
                        f"(allowed: alphanumerics . _ -, 1-64 chars): {entry['name']!r}"
                    )

    # volumes[] field-level checks (quickstart ADR-0022). The jsonschema pass
    # above already enforces these; we ALSO check them here so a bad value is
    # reported with a clear per-entry message at the gate. path/size reach a
    # generated backend spec and an msb create argv (SI-10), so both are
    # charset-gated; size is REQUIRED (no unsized default).
    volumes = spec.get("volumes")
    if volumes is not None:
        if not isinstance(volumes, list):
            errors.append(f"{kit_dir.name}: volumes must be an array of volume objects")
        else:
            for i, v in enumerate(volumes):
                if not isinstance(v, dict):
                    errors.append(f"{kit_dir.name}: volumes[{i}] must be an object")
                    continue
                path = v.get("path")
                if not isinstance(path, str) or not _SAFE_PATH_RE.match(path):
                    errors.append(
                        f"{kit_dir.name}: volumes[{i}].path must be an absolute path "
                        f"in the safe charset [A-Za-z0-9._/-] (got {path!r})"
                    )
                size = v.get("size")
                if not isinstance(size, str) or not _VOL_SIZE_RE.match(size):
                    errors.append(
                        f"{kit_dir.name}: volumes[{i}].size is required and must be a "
                        f'portable byte-size string like "20G" or "512m" — no b/ib '
                        f"suffix, msb rejects them (got {size!r})"
                    )
                elif _VOL_SIZE_ZERO_RE.match(size):
                    errors.append(f"{kit_dir.name}: volumes[{i}].size must be non-zero (got {size!r})")
                vtype = v.get("type", "")
                if vtype not in _VOL_TYPES:
                    errors.append(f'{kit_dir.name}: volumes[{i}].type must be "" (block) or "tmpfs" (got {vtype!r})')
            # Duplicate mount paths within one kit are an authoring error: the
            # "union by path, last wins" composition rule exists for cross-kit
            # merging, not for silently resolving a same-kit copy-paste typo.
            vol_paths = [v.get("path") for v in volumes if isinstance(v, dict) and isinstance(v.get("path"), str)]
            for dup in sorted({p for p in vol_paths if vol_paths.count(p) > 1}):
                errors.append(
                    f"{kit_dir.name}: volumes: duplicate path {dup!r} (declared {vol_paths.count(dup)} times)"
                )

    # commands[].background field-level check (ADR-0014, quickstart repo). Marks
    # a startup command that must be detached rather than awaited. Optional; when
    # present it MUST be a boolean (default false when omitted).
    for i, c in enumerate(spec.get("commands", []) or []):
        if isinstance(c, dict) and "background" in c and not isinstance(c["background"], bool):
            errors.append(
                f"{kit_dir.name}: commands[{i}].background must be a boolean (got {type(c['background']).__name__})"
            )

    # caps.network.tier field-level check (#300). Optional; when present it MUST
    # be one of the neutral egress tiers. Omission is valid and means the default
    # `balanced` posture (documented in the schema; not mutated here). The schema
    # enum already rejects bad values — this adds a clearer, kit-scoped message.
    _net = (spec.get("caps") or {}).get("network") or {}
    if "tier" in _net and _net["tier"] not in ("strict", "balanced", "open"):
        errors.append(f"{kit_dir.name}: caps.network.tier must be one of strict|balanced|open (got {_net['tier']!r})")

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
