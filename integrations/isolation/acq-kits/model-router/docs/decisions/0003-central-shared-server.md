# Decision: support an optional central decision server (adapter mode), with two interchangeable backends

**Status:** accepted
**Date:** 2026-10-05

## Context

The kit scores locally by default (ADR 0001). For a fleet of sandboxes, an
organization may want ONE shared routing policy instead of N local copies: tune
once, every sandbox inherits it. The reference `jev-skill-router` supports this
as "adapter mode" — point the per-sandbox server at a central URL. We were asked
to document (and implement) running such a central "type-safe server" accessible
to all sandbox consumers, covering both the proprietary TypeSafe/Jev engine and
an open-source equivalent.

## Decision

Add an **optional adapter mode** and a **stable HTTP decision contract** so the
per-sandbox server can forward decisions to a central endpoint, with two
interchangeable server backends behind that contract.

### The contract (one shape, two backends)

`POST /route {request, max_cost_rank}` → `{decision, suggested, suggested_name,
demands, reason, shortlist, excluded}`, plus `GET /healthz`. Optional bearer-token
auth. Because the contract is fixed, the per-sandbox client (`adapter.py`) is
identical regardless of which backend answers.

### Client: adapter wins when configured, else local; always fail-soft

- `MODEL_ROUTER_ADAPTER_URL` set → forward to it; on ANY failure (network,
  non-200, malformed body, timeout) fall back to the LOCAL scorer for that turn.
- Unset → never touch the network (the offline default).

A central-server outage must never break a turn — the local scorer is always the
backstop. The client bounds each call with `MODEL_ROUTER_ADAPTER_TIMEOUT`.

### Backend option 1 — open-source central server (`http_server.py`)

The SAME `model_router.route` + `catalog.load_catalog`, exposed over stdlib
`http.server`. Stateless, horizontally scalable, zero dependencies. A central
`MODEL_ROUTER_CATALOG` lets the whole fleet share one capability/cost policy.
This is the recommended default — no proprietary dependency.

### Backend option 2 — TypeSafe/Jev central shim (documented, not shipped)

A thin central service the operator owns, implementing the same `/route`
contract and forwarding to the proprietary TypeSafe Decisions API. The paid API
key lives ONLY on that central host; no sandbox holds it. We document the pattern
but do NOT ship a shim or any TypeSafe credentials — the proprietary API stays
out of the kit (consistent with ADR 0001).

### Egress + secrets

The kit still declares NO egress by default. Adapter mode requires the operator
to allow-list the central host via a tiny companion mixin (documented), not a
fork. The adapter token is a SECRET and must be injected via the backend
credential path, never via the plain `environment:` block — the same rule the
`usai-provider` kit follows for `USAI_API_KEY`.

## Consequences

- **Positive:** fleets get one tunable policy; the TypeSafe path is centralized
  (one key, one egress hole, central caching/rate-limiting); backends are
  swappable behind one contract without redeploying sandboxes; local-first
  default and fail-soft are preserved.
- **Negative:** adapter mode adds a network dependency and an egress hole the
  operator must manage; the bundled HTTP server is intentionally minimal and
  needs TLS/authn/network-policy in front of it for anything beyond a trusted
  internal network (documented under "Hardening").
- **Reversible:** adapter mode is opt-in and additive. Unset the env and the kit
  is exactly the offline local-scorer kit from ADR 0001.

## Links

- Operator guide: [`../central-server.md`](../central-server.md)
- Local-scorer default: [`0001-local-scorer-not-proprietary-api.md`](0001-local-scorer-not-proprietary-api.md)
- Server registration: [`0002-stdio-mcp-server-merged-into-opencode-config.md`](0002-stdio-mcp-server-merged-into-opencode-config.md)
