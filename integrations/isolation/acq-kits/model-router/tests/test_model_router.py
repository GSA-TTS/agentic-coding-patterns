#!/usr/bin/env python3
"""Unit tests for the model-router scorer and catalog.

Run from the kit dir:  python3 -m pytest tests/ -q
Or stdlib-only:         python3 tests/test_model_router.py

These are OFFLINE and deterministic — no sandbox, no network, no ML model. They
assert the routing POLICY (cheapest covering model; abstain on prose; hard
limits honoured) so a regression in the scorer surfaces here, not live in a PR.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

# Make the kit's bundled modules importable regardless of the caller's cwd.
_KIT_ROOT = Path(__file__).resolve().parents[1]
_SERVER_DIR = _KIT_ROOT / "files" / "home" / "model-router"
sys.path.insert(0, str(_SERVER_DIR))

import catalog  # noqa: E402
import model_router  # noqa: E402
from model_router import ModelProfile, detect_demands, route  # noqa: E402

import adapter  # noqa: E402


def _profiles():
    return [
        ModelProfile("haiku", "Haiku", frozenset({"coding", "fast", "cheap"}), 200000, 1),
        ModelProfile("sonnet", "Sonnet", frozenset({"coding", "reasoning", "vision"}), 200000, 3),
        ModelProfile("opus", "Opus", frozenset({"coding", "reasoning", "vision", "long_context"}), 1000000, 5),
    ]


class TestDemandDetection(unittest.TestCase):
    def test_typo_is_fast(self):
        self.assertIn("fast", detect_demands("fix a typo in the comment"))

    def test_architecture_is_reasoning(self):
        self.assertIn("reasoning", detect_demands("help me design the architecture"))

    def test_whole_repo_is_long_context(self):
        self.assertIn("long_context", detect_demands("summarize the whole repository"))

    def test_screenshot_is_vision(self):
        self.assertIn("vision", detect_demands("look at this screenshot and tell me the bug"))


class TestRoutingPolicy(unittest.TestCase):
    def test_trivial_edit_routes_cheapest(self):
        r = route("fix a quick typo", _profiles())
        self.assertEqual(r.decision, "suggest")
        self.assertEqual(r.suggested, "haiku")  # cheapest covering model

    def test_reasoning_excludes_cheap_only_model(self):
        r = route("refactor and redesign the auth architecture", _profiles())
        self.assertEqual(r.decision, "suggest")
        # haiku lacks `reasoning`, so the cheapest COVERING model is sonnet.
        self.assertEqual(r.suggested, "sonnet")
        self.assertTrue(any(e["id"] == "haiku" for e in r.excluded))

    def test_vision_demand_requires_vision_model(self):
        r = route("read the diagram in this screenshot", _profiles())
        self.assertEqual(r.decision, "suggest")
        self.assertIn(r.suggested, {"sonnet", "opus"})
        self.assertTrue(any(e["id"] == "haiku" for e in r.excluded))

    def test_prose_question_abstains(self):
        r = route("what is a cloud function compared to a server?", _profiles())
        self.assertEqual(r.decision, "abstain")

    def test_cost_ceiling_excludes_pricey_models(self):
        r = route("design a complex distributed system", _profiles(), max_cost_rank=3)
        # opus (rank 5) is excluded; sonnet (rank 3) is the top allowed covering model.
        self.assertEqual(r.decision, "suggest")
        self.assertEqual(r.suggested, "sonnet")
        self.assertTrue(any(e["id"] == "opus" for e in r.excluded))

    def test_empty_request_abstains(self):
        self.assertEqual(route("   ", _profiles()).decision, "abstain")

    def test_no_catalog_abstains(self):
        self.assertEqual(route("fix a bug", []).decision, "abstain")

    def test_reason_is_populated_on_suggest(self):
        r = route("implement a sorting function", _profiles())
        self.assertEqual(r.decision, "suggest")
        self.assertTrue(r.reason)
        self.assertTrue(r.shortlist)


class TestCatalog(unittest.TestCase):
    def test_default_catalog_loads(self):
        for key in ("MODEL_ROUTER_CATALOG", "MODEL_ROUTER_LIVE_IDS"):
            os.environ.pop(key, None)
        profiles = catalog.load_catalog()
        self.assertTrue(profiles)
        for p in profiles:
            self.assertTrue(p.capabilities.issubset(model_router.CAPABILITIES))

    def test_override_catalog(self):
        override = _KIT_ROOT / "tests" / "fixtures" / "custom-catalog.json"
        os.environ["MODEL_ROUTER_CATALOG"] = str(override)
        try:
            profiles = catalog.load_catalog()
            self.assertTrue(any(p.id == "my-cheap-model" for p in profiles))
        finally:
            os.environ.pop("MODEL_ROUTER_CATALOG", None)

    def test_live_ids_snapshot_maps_to_real_ids(self):
        snap = _KIT_ROOT / "tests" / "fixtures" / "usai-models.json"
        os.environ.pop("MODEL_ROUTER_CATALOG", None)
        os.environ["MODEL_ROUTER_LIVE_IDS"] = str(snap)
        try:
            profiles = catalog.load_catalog()
            ids = {p.id for p in profiles}
            # Real catalog ids, not family prefixes, when a live snapshot is present.
            self.assertIn("claude_4_5_haiku", ids)
            self.assertIn("gemini-2.5-flash", ids)
        finally:
            os.environ.pop("MODEL_ROUTER_LIVE_IDS", None)


class TestAdapter(unittest.TestCase):
    """Adapter-mode (central server) client, exercised against a local stub HTTP
    server so no real network is touched."""

    def setUp(self):
        for key in ("MODEL_ROUTER_ADAPTER_URL", "MODEL_ROUTER_ADAPTER_TOKEN"):
            os.environ.pop(key, None)

    def tearDown(self):
        for key in ("MODEL_ROUTER_ADAPTER_URL", "MODEL_ROUTER_ADAPTER_TOKEN"):
            os.environ.pop(key, None)

    def test_not_configured_by_default(self):
        self.assertFalse(adapter.adapter_configured())

    def test_configured_when_url_set(self):
        os.environ["MODEL_ROUTER_ADAPTER_URL"] = "http://127.0.0.1:1/route"
        self.assertTrue(adapter.adapter_configured())

    def test_forwards_and_parses_central_decision(self):
        import json as _json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        seen = {}

        class _Stub(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0") or "0")
                body = _json.loads(self.rfile.read(length) or b"{}")
                seen["request"] = body.get("request")
                seen["auth"] = self.headers.get("Authorization")
                payload = _json.dumps({
                    "decision": "suggest",
                    "suggested": "central-model",
                    "reason": "decided centrally",
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        httpd = HTTPServer(("127.0.0.1", 0), _Stub)
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.handle_request)  # serve exactly one request
        t.start()
        try:
            os.environ["MODEL_ROUTER_ADAPTER_URL"] = f"http://127.0.0.1:{port}"
            os.environ["MODEL_ROUTER_ADAPTER_TOKEN"] = "secret-token"
            result = adapter.route_via_adapter("refactor this", max_cost_rank=None)
        finally:
            t.join(timeout=5)
            httpd.server_close()

        self.assertEqual(result["decision"], "suggest")
        self.assertEqual(result["suggested"], "central-model")
        # Optional fields are normalized so downstream can rely on them.
        self.assertEqual(result["suggested_name"], "central-model")
        self.assertEqual(result["demands"], [])
        self.assertEqual(result["via"], "adapter")
        # The request + bearer token were forwarded as the contract requires.
        self.assertEqual(seen["request"], "refactor this")
        self.assertEqual(seen["auth"], "Bearer secret-token")

    def test_unreachable_central_raises_for_local_fallback(self):
        # Port 1 is unreachable; the client must RAISE (so the MCP server falls
        # back to the local scorer) rather than silently returning a bad answer.
        os.environ["MODEL_ROUTER_ADAPTER_URL"] = "http://127.0.0.1:1"
        os.environ["MODEL_ROUTER_ADAPTER_TIMEOUT"] = "1"
        with self.assertRaises(Exception):
            adapter.route_via_adapter("fix a bug", max_cost_rank=None)
        os.environ.pop("MODEL_ROUTER_ADAPTER_TIMEOUT", None)


if __name__ == "__main__":
    unittest.main()
