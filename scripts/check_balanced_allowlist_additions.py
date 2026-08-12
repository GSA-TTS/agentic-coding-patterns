#!/usr/bin/env python3
"""Additions guard for the network-tier `balanced` baseline allowlist (#302).

A DETERMINISTIC, offline, in-repo lint that surfaces review-worthy signals about
the hosts in `integrations/isolation/network-tiers/balanced.yaml`. It runs the
same whether in CI or locally — no network call, no reputation API, no secret,
no flakiness (a multi-model consensus rejected a live reputation feed as
over-engineering + a federal data-sharing concern for a hand-curated ~150-entry
list that already requires a `why` justification + CODEOWNERS review; see the
issue thread and ADR 0002).

It emits WARNINGS (advisory, for the human/CODEOWNERS reviewer) for hosts that
match risk heuristics, and ERRORS only for a genuinely unsafe shape that should
never ship. Because it audits the whole file each run, a NEWLY ADDED risky host
is exactly what a PR surfaces — while the existing curated entries stay quiet.

Heuristics (pure functions of the host string):
  WARN  - IDN / punycode `xn--` label (homograph risk) — decode + note.
  WARN  - uncommon / risk-associated TLD (see _RISKY_TLDS).
  WARN  - deep subdomain nesting (> 4 labels) — unusually specific.
  WARN  - plaintext :80 on a host that is NOT a known CRL/OCSP/cert or OS-mirror
          endpoint.
  ERROR - wildcard breadth: a public-suffix-level wildcard (`*.com`, `**.io`)
          — one entry that opens an entire TLD is never acceptable.
  ERROR - raw IPv4/IPv6 literal (allowlist is by hostname; an IP bypasses
          name-based egress intent and is unauditable).

A typosquat/edit-distance heuristic was deliberately NOT included: on a
co-curated allowlist, legitimate sibling brands (github.com/gitlab.com,
docker.io/docker.com) sit within a small edit distance and would fire every run,
training reviewers to ignore the guard. "Is this host what it claims to be" is
the job of the per-host `why` + CODEOWNERS review, not a distance metric against
the list itself (see the #302 consensus thread).

Exit 0 when there are no ERRORS (warnings alone do not fail — they defer to
review). Exit 1 on any ERROR. Dependency-free (stdlib + PyYAML).
"""

from __future__ import annotations

import ipaddress
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "integrations" / "isolation" / "network-tiers" / "balanced.yaml"

# TLDs disproportionately associated with abuse / not expected in a federal
# toolchain allowlist. Not exhaustive — a signal for the reviewer, not a verdict.
_RISKY_TLDS = frozenset({"zip", "mov", "xyz", "top", "click", "link", "gq", "tk", "ml", "cf", "ga", "cn", "ru", "su"})
# Public-suffix-ish single labels: a wildcard directly on one of these opens a
# whole TLD/registry. (A wildcard on a normal registrable domain like
# `**.github.com` is fine — that's the intended use.)
_PUBLIC_SUFFIXES = frozenset({"com", "org", "net", "io", "dev", "gov", "edu", "co", "us", "app", "sh", "ai", "cloud"})
# Hosts legitimately reached over plaintext :80 (CRL/OCSP/cert distribution must
# be HTTP per the CA/Browser Forum — TLS on a revocation endpoint is circular),
# plus OS package mirrors that serve apt/dnf metadata over :80 by design (the
# packages are signed; the transport need not be TLS).
_CERT_HINT = re.compile(
    r"(?:^|\.)(crl\d*|ocsp\d*|cacerts?|crt|pki|digicert|sectigo|comodoca|globalsign|"
    r"usertrust|identrust|amazontrust|lencr|isrg)\b",
    re.IGNORECASE,
)
_OS_MIRROR_HINT = re.compile(r"(?:^|\.)(ubuntu|debian|alpinelinux|archlinux|fedora|centos|dhi)\b", re.IGNORECASE)


def _strip(host: str) -> tuple[str, int | None]:
    """Split `host[:port]` and strip a leading `**.`/`*.` wildcard."""
    port: int | None = None
    if ":" in host and not host.count(":") > 1:  # host:port (not an IPv6 literal)
        h, _, p = host.rpartition(":")
        if p.isdigit():
            host, port = h, int(p)
    bare = host
    for pre in ("**.", "*."):
        if bare.startswith(pre):
            bare = bare[len(pre) :]
            break
    return bare, port


def _labels(bare: str) -> list[str]:
    return [x for x in bare.split(".") if x]


def _is_raw_ip(bare: str) -> bool:
    try:
        ipaddress.ip_address(bare)
        return True
    except ValueError:
        return False


def audit(data: dict) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for every host in core + extended."""
    errors: list[str] = []
    warnings: list[str] = []

    hosts: list[tuple[str, str]] = []  # (group, raw host)
    for grp in ("core", "extended"):
        for e in data.get(grp, []) or []:
            if isinstance(e, dict) and e.get("host"):
                hosts.append((grp, str(e["host"])))

    for grp, raw in hosts:
        bare, port = _strip(raw)
        labels = _labels(bare)

        # ERROR: raw IP literal.
        if _is_raw_ip(bare):
            errors.append(f"{grp}: {raw!r} is a raw IP literal — allowlist by hostname, not IP.")
            continue

        # ERROR: wildcard directly on a public suffix (opens a whole TLD).
        if raw.startswith(("*.", "**.")) and len(labels) == 1 and labels[0] in _PUBLIC_SUFFIXES:
            errors.append(f"{grp}: {raw!r} is a wildcard over a public suffix — far too broad.")

        # WARN: IDN / punycode homograph.
        if "xn--" in bare:
            try:
                decoded = bare.encode("ascii").decode("idna")
            except (UnicodeError, ValueError):
                decoded = "(undecodable)"
            warnings.append(f"{grp}: {raw!r} is an IDN/punycode host (decodes to {decoded!r}) — homograph risk.")

        # WARN: uncommon/risk TLD.
        if labels and labels[-1].lower() in _RISKY_TLDS:
            warnings.append(f"{grp}: {raw!r} uses an uncommon/risk-associated TLD (.{labels[-1]}).")

        # WARN: deep nesting.
        if len(labels) > 4:
            warnings.append(f"{grp}: {raw!r} has deep subdomain nesting ({len(labels)} labels).")

        # WARN: plaintext :80 that isn't a cert/CRL/OCSP endpoint or an OS mirror
        # (both legitimately serve over :80 — signed content, not TLS-dependent).
        if port == 80 and not _CERT_HINT.search(bare) and not _OS_MIRROR_HINT.search(bare):
            warnings.append(f"{grp}: {raw!r} is plaintext :80 but not a known CRL/OCSP/cert/OS-mirror host.")

        # NOTE: a typosquat heuristic that compares each host to OTHER hosts
        # already on the list is intentionally NOT run here. On a co-curated
        # allowlist, legitimate sibling brands (github.com/gitlab.com,
        # docker.io/docker.com, gcr.io/ghcr.io, rust-lang.org/ruby-lang.org) sit
        # within a small edit distance of each other and would fire on every
        # pass — training reviewers to ignore the guard. Typosquat detection is
        # only meaningful against a TRUSTED reference set the added host should
        # NOT resemble, which this list is not. The `why` justification + a
        # CODEOWNERS review are the correct control for "is this host what it
        # claims to be"; see the #302 consensus thread.

    return errors, warnings


def main() -> int:
    if not DATA.is_file():
        print(f"✗ missing {DATA.relative_to(ROOT)}")
        return 1
    data = yaml.safe_load(DATA.read_text()) or {}
    errors, warnings = audit(data)

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    if errors:
        print(f"\n✗ balanced-allowlist additions guard: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    if warnings:
        print(
            f"\n⚠ balanced-allowlist additions guard: {len(warnings)} warning(s) for reviewer "
            "attention (advisory — defer to CODEOWNERS + the per-host `why`)."
        )
    else:
        print("✓ balanced-allowlist additions guard: no risk signals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
