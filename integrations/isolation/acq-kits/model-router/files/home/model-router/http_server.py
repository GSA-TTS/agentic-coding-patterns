#!/usr/bin/env python3
"""http_server — run the model-router scorer as a CENTRAL HTTP decision service.

This is the OPEN-SOURCE "central server" option: the SAME deterministic scorer
the per-sandbox MCP server uses (model_router.route + catalog.load_catalog),
exposed over a tiny HTTP endpoint so MANY sandboxes can share ONE routing policy.
Each sandbox's model-router kit then runs in ADAPTER MODE
(MODEL_ROUTER_ADAPTER_URL=https://<this-host>/…) and forwards decisions here
instead of scoring locally — see adapter.py and docs/central-server.md.

CONTRACT (the stable shape adapter.py speaks; identical to what a TypeSafe/Jev
adapter would also implement, so the per-sandbox client is backend-agnostic):

  GET  /healthz              → 200 {"status":"ok"}
  POST /route                → 200 {decision, suggested, suggested_name,
                                    demands, reason, shortlist, excluded}
       body: {"request": str, "max_cost_rank": int|null}

AUTH: if MODEL_ROUTER_SERVER_TOKEN is set, /route requires
`Authorization: Bearer <token>` and returns 401 otherwise. /healthz is always
open (for load-balancer probes). This is a SHARED-SECRET gate, not identity — put
it behind your own TLS-terminating ingress / mTLS / network policy for anything
beyond a trusted internal network. See docs/central-server.md "Hardening".

RUN:
  MODEL_ROUTER_CATALOG=/path/roster.json \
  MODEL_ROUTER_SERVER_TOKEN=... \
  python3 http_server.py --host 0.0.0.0 --port 8080

STANDARD LIBRARY ONLY (http.server) — zero dependencies, same as the rest of the
kit. For production throughput, front it with a real WSGI/ASGI server or run
several replicas behind a load balancer; the scorer is stateless, so horizontal
scaling is trivial. The HTTP layer here is intentionally minimal and NOT meant to
face the public internet unprotected.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from catalog import load_catalog
from model_router import route

# Cap request bodies so a malformed/oversized POST can't exhaust memory.
_MAX_BODY_BYTES = 64 * 1024


class _Handler(BaseHTTPRequestHandler):
    # Quieter default logging; override via a real logger in production.
    def log_message(self, fmt, *args):  # noqa: N802 (stdlib signature)
        sys.stderr.write("model-router-http: " + (fmt % args) + "\n")

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        token = os.environ.get("MODEL_ROUTER_SERVER_TOKEN", "").strip()
        if not token:
            return True  # no token configured → open (trusted-network mode)
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {token}"

    def do_GET(self):  # noqa: N802
        if self.path == "/healthz":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/route":
            self._send_json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._send_json(401, {"error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > _MAX_BODY_BYTES:
            self._send_json(413, {"error": "request body too large"})
            return
        try:
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw or b"{}")
            request_text = str(data.get("request", ""))
            max_cost_rank = data.get("max_cost_rank")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "malformed JSON body"})
            return

        try:
            profiles = load_catalog()
            result = route(request_text, profiles, max_cost_rank=max_cost_rank).to_dict()
        except Exception as exc:  # fail-soft: a scorer error → abstain, HTTP 200
            result = {
                "decision": "abstain",
                "suggested": None,
                "suggested_name": None,
                "demands": [],
                "reason": f"router error (abstaining): {exc}",
                "shortlist": [],
                "excluded": [],
            }
        self._send_json(200, result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("MODEL_ROUTER_SERVER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MODEL_ROUTER_SERVER_PORT", "8080")))
    args = parser.parse_args(argv)

    httpd = ThreadingHTTPServer((args.host, args.port), _Handler)
    sys.stderr.write(f"model-router-http: listening on http://{args.host}:{args.port} (POST /route)\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
