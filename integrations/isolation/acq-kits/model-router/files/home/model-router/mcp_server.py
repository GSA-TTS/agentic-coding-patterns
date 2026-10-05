#!/usr/bin/env python3
"""mcp_server — a stdio MCP server exposing one tool: model_select.

Protocol: Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0).
This is a MINIMAL, dependency-free implementation of just the handshake and the
two calls an MCP host makes — `initialize`, `tools/list`, `tools/call` — so the
kit needs no `mcp` SDK, no pip install, and no network at runtime. The reference
jev-skill-router is a Python stdio MCP server too; this mirrors its SHAPE
(one small tool, suggest-or-abstain) while swapping its paid "Jev" Decisions API
for the local, deterministic scorer in model_router.py.

TOOL:
  model_select(request: str, max_cost_rank?: int)
    → { decision: "suggest"|"abstain",
        suggested: str|null, suggested_name: str|null,
        demands: [str], reason: str, shortlist: [str], excluded: [...],
        suggestion_block: str }   # a ready-to-insert <model_recommendation> block

FAIL-SOFT: any error inside the scorer is caught and returned as an ABSTAIN with
the error noted — the host keeps its own default model. The server never crashes
a turn over a routing hiccup.

SECURITY: `request` is UNTRUSTED input (it is whatever the user/agent typed). It
is only ever treated as DATA for pattern matching — never executed, never
interpolated into a shell. The server performs no file writes and no network I/O.
"""

from __future__ import annotations

import json
import sys

from adapter import adapter_configured, route_via_adapter
from catalog import load_catalog
from model_router import route

SERVER_NAME = "model-router"
SERVER_VERSION = "1.0.0"
PROTOCOL_VERSION = "2024-11-05"

TOOL_SCHEMA = {
    "name": "model_select",
    "description": (
        "Suggest the smallest/cheapest available model that still satisfies a "
        "coding request's demands (reasoning depth, context length, modality), "
        "or abstain when no model switch is warranted. Advisory only: the host "
        "decides whether to adopt the suggestion."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "request": {
                "type": "string",
                "description": "The user's coding request / turn to route.",
            },
            "max_cost_rank": {
                "type": "integer",
                "description": "Optional cost ceiling (1=cheapest tier). Models pricier than this are excluded.",
            },
        },
        "required": ["request"],
    },
}


def _suggestion_block(result: dict) -> str:
    """A ready-to-insert recommendation block the host MAY surface to the model.

    Deliberately framed as a SUGGESTION the agent may ignore (mirrors the
    reference router's '<skill_relevance>' + "ignore if it does not fit" shape).
    """
    if result["decision"] != "suggest":
        return (
            "<model_recommendation>\n"
            "No model switch recommended for this request; keep the current model.\n"
            "</model_recommendation>"
        )
    return (
        "<model_recommendation>\n"
        f"Suggested model: {result['suggested']} ({result['suggested_name']})\n"
        f"Why: {result['reason']}\n"
        "This is advisory — ignore it if it does not fit what the user actually asked for.\n"
        "</model_recommendation>"
    )


def handle_model_select(args: dict) -> dict:
    request = args.get("request", "")
    max_cost_rank = args.get("max_cost_rank")

    # ADAPTER MODE: when a central endpoint is configured, forward the decision
    # there so routing policy lives in ONE shared service (see adapter.py and
    # docs/central-server.md). Any adapter failure falls back to the LOCAL
    # scorer below — a central-server outage must never break a turn.
    if adapter_configured():
        try:
            result = route_via_adapter(request, max_cost_rank)
            result["suggestion_block"] = _suggestion_block(result)
            return result
        except Exception as exc:  # fail-soft: fall through to the local scorer
            sys.stderr.write(f"model-router: adapter failed, using local scorer: {exc}\n")

    try:
        profiles = load_catalog()
        result = route(request, profiles, max_cost_rank=max_cost_rank).to_dict()
    except Exception as exc:  # fail-soft: never crash a turn over routing
        result = {
            "decision": "abstain",
            "suggested": None,
            "suggested_name": None,
            "demands": [],
            "reason": f"router error (abstaining): {exc}",
            "shortlist": [],
            "excluded": [],
        }
    result["suggestion_block"] = _suggestion_block(result)
    return result


def _respond(id_, result=None, error=None) -> None:
    msg = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _dispatch(req: dict) -> None:
    method = req.get("method")
    id_ = req.get("id")
    params = req.get("params") or {}

    # Notifications (no id) require no response.
    if method == "notifications/initialized":
        return

    if method == "initialize":
        _respond(
            id_,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        )
    elif method == "tools/list":
        _respond(id_, {"tools": [TOOL_SCHEMA]})
    elif method == "tools/call":
        name = params.get("name")
        if name != "model_select":
            _respond(id_, error={"code": -32601, "message": f"unknown tool: {name}"})
            return
        result = handle_model_select(params.get("arguments") or {})
        _respond(
            id_,
            {
                "content": [{"type": "text", "text": json.dumps(result)}],
                "structuredContent": result,
                "isError": False,
            },
        )
    elif id_ is not None:
        _respond(id_, error={"code": -32601, "message": f"method not found: {method}"})


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            # Malformed frame: cannot know the id, so cannot reply per JSON-RPC;
            # skip rather than crash the server.
            continue
        _dispatch(req)
    return 0


if __name__ == "__main__":
    sys.exit(main())
