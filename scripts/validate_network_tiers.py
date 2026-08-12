#!/usr/bin/env python3
"""Validate the network-tier baseline egress allowlist (#301, ADR 0002).

Checks integrations/isolation/network-tiers/balanced.yaml against
schemas/network-tier-baseline-v1.schema.json and enforces the curation rules
that JSON Schema alone cannot express:

  - every entry has a non-empty `why` justification (auditable pruning);
  - no duplicate host within core, within extended, or across the two
    (a host must live in exactly one tier so its posture is unambiguous);
  - host syntax matches the schema pattern (wildcards, optional :port).

Governance (documented, not machine-enforceable here): the CONTENTS of the
shipped `balanced` default are a human/CODEOWNERS + security-skill decision. An
agent may PROPOSE entries; it must not self-approve. This validator only keeps
the file well-formed and internally consistent.

Exit 0 on success, 1 on any error. Dependency-free beyond PyYAML + (optional)
jsonschema; falls back to a regex host check when jsonschema is absent.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "integrations" / "isolation" / "network-tiers" / "balanced.yaml"
SCHEMA = ROOT / "schemas" / "network-tier-baseline-v1.schema.json"


def main() -> int:
    if not DATA.is_file():
        print(f"✗ missing {DATA.relative_to(ROOT)}")
        return 1
    if not SCHEMA.is_file():
        print(f"✗ missing {SCHEMA.relative_to(ROOT)}")
        return 1

    schema = json.loads(SCHEMA.read_text())
    data = yaml.safe_load(DATA.read_text()) or {}
    errors: list[str] = []

    # Structural validation (jsonschema if available; else the host pattern).
    try:
        import jsonschema

        try:
            jsonschema.validate(data, schema)
        except jsonschema.ValidationError as e:
            errors.append(f"schema: {e.message} (at {'/'.join(str(p) for p in e.absolute_path)})")
    except ImportError:
        pat = re.compile(schema["$defs"]["entry"]["properties"]["host"]["pattern"])
        for grp in ("core", "extended"):
            for e in data.get(grp, []) or []:
                host = (e or {}).get("host", "")
                if not pat.match(host):
                    errors.append(f"{grp}: host {host!r} fails the schema pattern")

    # Curation rules beyond the schema.
    seen: dict[str, str] = {}
    for grp in ("core", "extended"):
        for e in data.get(grp, []) or []:
            host = (e or {}).get("host", "")
            why = (e or {}).get("why", "")
            if not why or len(why.strip()) < 3:
                errors.append(f"{grp}: entry {host!r} is missing a `why` justification")
            if host in seen:
                errors.append(
                    f"duplicate host {host!r} in {grp} (already in {seen[host]}); a host must live in exactly one tier"
                )
            else:
                seen[host] = grp

    if errors:
        print(f"✗ network-tier baseline: {len(errors)} error(s)")
        for e in errors:
            print(f"  - {e}")
        return 1

    core = len(data.get("core", []) or [])
    ext = len(data.get("extended", []) or [])
    print(f"✓ network-tier baseline valid: {core} core + {ext} extended host(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
