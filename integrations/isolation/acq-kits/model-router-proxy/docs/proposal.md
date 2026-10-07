# model-router-proxy — design & status

> **Status: implemented.** This began as a pre-implementation tracking note; it
> now records what the kit does and the decisions behind it. The authoritative
> mode/deployment decision is
> [`docs/decisions/0001-in-sandbox-mode-default-cloudgov-parked.md`](decisions/0001-in-sandbox-mode-default-cloudgov-parked.md).

## Summary

An acq mixin kit that makes model routing **transparent and automatic**: it
points a sandbox's OpenCode `usai` provider at the
[model-router-service](https://github.com/btylerburton/model-router-service) —
an OpenAI-compatible proxy that inspects each prompt, picks the best upstream
model (graded reasoning score; optional LLM judge), rewrites the request, and
forwards to USAi with streaming preserved.

Auto-switching requires sitting **in the request path** (an MCP tool cannot
change the active model mid-turn), which is why this is a proxy rather than a
tool.

## What the kit does

- Points the OpenCode `usai` `baseURL` at the model-router-service via the
  `model-router-toggle` CLI (merge-not-clobber, idempotent), **never a hardcoded
  host**.
- Two modes (`MODEL_ROUTER_MODE`, default `in-sandbox`): run the service on
  `127.0.0.1` inside the sandbox (the shape that works while USAi is
  GSA-network-only), or `external` (flip `baseURL` to a remote service — a
  cloud.gov app or a host-run service via the backend host alias).
- **Opt-in and fail-soft**: any failure (no python3/key, failed fetch/deps/boot,
  service never ready) leaves OpenCode on the direct USAi gateway and exits 0.
- Honors the proxy **bypass** pin (`x-model-router-bypass`) and surfaces the
  `x-model-router-decision` audit header; the decision log records metadata only
  (hash, not raw prompt).

## Composes with

- `usai-provider` — owns the `usai` provider block this kit flips; supplies
  `USAI_API_KEY` (reused in-sandbox).
- `zscaler-ca-certificate` — puts the proxy root in the sandbox trust store so
  the in-sandbox service can reach USAi over an inspected TLS path.

## Key decisions (durable records)

- **In-sandbox is the default; cloud.gov is parked** because USAi is only
  reachable from inside the GSA network today — ADR 0001.
- A local **distilled/encoder decision engine** (e.g. laya) was evaluated as a
  future alternative to the deterministic scorer / LLM judge — see the
  service repo's `docs/decisions/` for that record and the revisit trigger.

## Out of scope

- The service itself (its own repo).
- A shared (non-per-sandbox) deployment — needs an internal GSA-network host;
  tracked via ADR 0001's "revisit when".
- `large_context` demand type and the lone-`fast` fall-through (service-side).
