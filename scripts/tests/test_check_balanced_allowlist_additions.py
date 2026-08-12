"""Tests for the balanced-allowlist additions guard (#302).

Deterministic, offline heuristic lint: warnings are advisory (exit 0), errors
fail (exit 1). Covers each heuristic + the live-file invariant (no ERRORS).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECK = ROOT / "scripts" / "check_balanced_allowlist_additions.py"


def _mod():
    spec = importlib.util.spec_from_file_location("cbaa", CHECK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _audit(core=None, extended=None):
    data = {"version": "1.0", "tier": "balanced", "core": core or [], "extended": extended or []}
    return _mod().audit(data)


# --- ERROR cases (fail closed) -----------------------------------------------


def test_raw_ipv4_is_error():
    e, _ = _audit(core=[{"host": "10.0.0.5", "why": "x"}])
    assert any("raw IP" in x for x in e)


def test_raw_ipv6_is_error():
    e, _ = _audit(core=[{"host": "2606:4700:4700::1111", "why": "x"}])
    assert any("raw IP" in x for x in e)


def test_wildcard_over_public_suffix_is_error():
    e, _ = _audit(core=[{"host": "**.com", "why": "x"}])
    assert any("public suffix" in x for x in e)
    e2, _ = _audit(core=[{"host": "*.io", "why": "x"}])
    assert any("public suffix" in x for x in e2)


def test_wildcard_over_real_domain_is_ok():
    # `**.github.com` is the intended use — not an error.
    e, _ = _audit(core=[{"host": "**.github.com", "why": "x"}])
    assert e == []


# --- WARN cases (advisory) ---------------------------------------------------


def test_punycode_warns():
    _, w = _audit(core=[{"host": "xn--80ak6aa92e.com", "why": "x"}])
    assert any("IDN/punycode" in x for x in w)


def test_risky_tld_warns():
    _, w = _audit(core=[{"host": "evil.zip", "why": "x"}])
    assert any("risk-associated TLD" in x for x in w)


def test_deep_nesting_warns():
    _, w = _audit(core=[{"host": "a.b.c.d.e.example.com", "why": "x"}])
    assert any("deep subdomain nesting" in x for x in w)


def test_plaintext_80_non_cert_warns():
    _, w = _audit(core=[{"host": "api.example.com:80", "why": "x"}])
    assert any("plaintext :80" in x for x in w)


def test_plaintext_80_cert_host_is_quiet():
    _, w = _audit(core=[{"host": "ocsp.digicert.com:80", "why": "x"}])
    assert not any("plaintext :80" in x for x in w)


def test_plaintext_80_os_mirror_is_quiet():
    _, w = _audit(core=[{"host": "archive.ubuntu.com:80", "why": "x"}])
    assert not any("plaintext :80" in x for x in w)


def test_clean_host_no_signal():
    e, w = _audit(core=[{"host": "registry.npmjs.org", "why": "x"}])
    assert e == [] and w == []


def test_sibling_brands_do_not_warn():
    # The deliberately-omitted typosquat heuristic: sibling brands must be quiet.
    e, w = _audit(
        core=[
            {"host": "github.com", "why": "x"},
            {"host": "gitlab.com", "why": "x"},
            {"host": "docker.io", "why": "x"},
            {"host": "docker.com", "why": "x"},
        ]
    )
    assert e == [] and w == []


# --- live file ---------------------------------------------------------------


def test_live_balanced_has_no_errors():
    import yaml

    data = yaml.safe_load((ROOT / "integrations" / "isolation" / "network-tiers" / "balanced.yaml").read_text())
    errors, _ = _mod().audit(data)
    assert errors == [], f"live balanced.yaml has hard errors: {errors}"


def test_main_exit_zero_on_live_file():
    assert _mod().main() == 0
