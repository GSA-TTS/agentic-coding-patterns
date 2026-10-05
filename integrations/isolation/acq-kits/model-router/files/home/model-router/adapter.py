#!/usr/bin/env python3
"""adapter — optional client that forwards a routing request to a CENTRAL
model-router / TypeSafe decision endpoint, instead of scoring locally.

WHY THIS EXISTS: a single sandbox carrying its own scorer is fine, but an
organization running MANY sandboxes may prefer ONE shared decision service — so
routing policy (which model is "cheap"/"strong", any cost ceilings, any
TypeSafe/Jev tuning) lives in ONE place, is updated once, and every sandbox
inherits it. This mirrors the reference jev-skill-router's "adapter mode"
(github.com/ydmw74/jev-skill-router): point the per-sandbox server at a central
URL and it forwards the decision there.

PRECEDENCE (adapter wins when configured):
  - MODEL_ROUTER_ADAPTER_URL set  → forward to it; on ANY failure fall back to
    the local scorer (fail-soft — a central-server outage must never break a
    turn).
  - MODEL_ROUTER_ADAPTER_URL unset → never touch the network; local scorer only.

The adapter speaks a SMALL, STABLE JSON contract so the SAME per-sandbox server
works against either backend behind the central endpoint:

  POST <url>/route
  Authorization: Bearer <MODEL_ROUTER_ADAPTER_TOKEN>   (optional)
  Content-Type: application/json
  body: { "request": "<text>", "max_cost_rank": <int|null> }

  200 response body (the central server's job to produce — whether it scores
  with THIS repo's scorer or forwards to the proprietary TypeSafe Decisions API):
  { "decision": "suggest"|"abstain",
    "suggested": str|null, "suggested_name": str|null,
    "demands": [str], "reason": str, "shortlist": [str], "excluded": [...] }

SECURITY / EGRESS: this module makes an outbound HTTPS call ONLY when
MODEL_ROUTER_ADAPTER_URL is set. The kit's spec.yaml declares NO egress by
default; an operator using adapter mode MUST add the central endpoint host to the
sandbox allow-list (documented in docs/central-server.md). The token, if any, is
read from the environment — never written to disk, never logged.

STANDARD LIBRARY ONLY: urllib, no requests/httpx — keeps the kit dependency-free.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Optional

# Bound a hanging central server so a slow/unreachable endpoint degrades to the
# local scorer quickly rather than stalling the turn. Read at CALL time (not
# import) so it can be tuned per-process via the environment.
def _adapter_timeout_s() -> float:
    try:
        return float(os.environ.get("MODEL_ROUTER_ADAPTER_TIMEOUT", "4"))
    except ValueError:
        return 4.0

# The keys the per-sandbox server expects back from a central decision. A central
# response missing a key is treated as a malformed response (→ local fallback).
_REQUIRED_KEYS = {"decision", "suggested", "reason"}


def adapter_configured() -> bool:
    """True when a central endpoint is configured (adapter mode is active)."""
    return bool(os.environ.get("MODEL_ROUTER_ADAPTER_URL", "").strip())


def route_via_adapter(request: str, max_cost_rank: Optional[int]) -> dict:
    """Forward one routing request to the central endpoint.

    Returns the central server's decision dict on success. Raises on ANY failure
    (network, non-200, malformed body) so the caller can fall back to the local
    scorer — this function never silently returns a bad decision.
    """
    base = os.environ["MODEL_ROUTER_ADAPTER_URL"].strip().rstrip("/")
    url = f"{base}/route"
    token = os.environ.get("MODEL_ROUTER_ADAPTER_TOKEN", "").strip()

    body = json.dumps({"request": request, "max_cost_rank": max_cost_rank}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    with urllib.request.urlopen(req, timeout=_adapter_timeout_s()) as resp:
        if resp.status != 200:
            raise RuntimeError(f"central endpoint returned HTTP {resp.status}")
        payload = resp.read()
    decision = json.loads(payload)

    if not isinstance(decision, dict) or not _REQUIRED_KEYS.issubset(decision):
        raise RuntimeError("central endpoint returned a malformed decision body")

    # Normalize optional fields so downstream (the suggestion_block builder) can
    # rely on them being present, regardless of which backend the central server
    # used (the local scorer or the proprietary TypeSafe API).
    decision.setdefault("suggested_name", decision.get("suggested"))
    decision.setdefault("demands", [])
    decision.setdefault("shortlist", [])
    decision.setdefault("excluded", [])
    decision["via"] = "adapter"
    return decision
