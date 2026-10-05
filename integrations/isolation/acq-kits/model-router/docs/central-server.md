# Running a central decision server for all sandbox consumers

By default the `model-router` kit scores **locally** inside each sandbox — no
server, no network, no shared state. That is the right default for a single user
or a handful of sandboxes.

When you run **many** sandboxes, you may want routing policy to live in **one
place**: update the policy once, and every sandbox inherits it. This is what the
public [`jev-skill-router`](https://github.com/ydmw74/jev-skill-router) calls
**adapter mode** — point each per-sandbox server at a central URL and it forwards
the decision there.

This doc describes two ways to run that central server, and exactly how a sandbox
consumer reaches it. Both expose the **same small HTTP contract**, so the
per-sandbox client (`adapter.py`) is identical either way.

```
                      ┌────────────────────────────────────────────┐
   sandbox A ─┐       │           CENTRAL DECISION SERVER            │
   sandbox B ─┼──────▶│  POST /route {request, max_cost_rank}        │
   sandbox C ─┘  TLS  │  → {decision, suggested, reason, …}          │
   (adapter mode)     │                                              │
                      │  Option 1: open-source (http_server.py)      │
                      │  Option 2: TypeSafe/Jev adapter (your shim)  │
                      └────────────────────────────────────────────┘
```

Each sandbox runs the kit in **adapter mode** by setting two env vars; nothing
else about the kit changes:

| Env var | Meaning |
|---------|---------|
| `MODEL_ROUTER_ADAPTER_URL` | Base URL of the central server (e.g. `https://model-router.internal`). When set, the sandbox forwards decisions here. |
| `MODEL_ROUTER_ADAPTER_TOKEN` | Optional bearer token sent as `Authorization: Bearer …`. |
| `MODEL_ROUTER_ADAPTER_TIMEOUT` | Optional per-call timeout seconds (default `4`). |

**Fail-soft is preserved:** if the central server is slow, unreachable, returns
non-200, or returns a malformed body, the per-sandbox server logs the failure and
**falls back to its local scorer** for that turn. A central-server outage never
breaks a turn.

---

## The HTTP contract

Both server options implement this identical contract (so you can switch the
backend behind it without touching any sandbox):

```
GET  /healthz   → 200 {"status":"ok"}

POST /route
  Authorization: Bearer <token>        # required only if the server sets a token
  Content-Type: application/json
  body: { "request": "<the user's turn>", "max_cost_rank": <int|null> }

  200 → {
    "decision": "suggest" | "abstain",
    "suggested": "<model-id>" | null,
    "suggested_name": "<label>" | null,
    "demands": ["reasoning", ...],
    "reason": "<why>",
    "shortlist": ["<model-id>", ...],
    "excluded": [{"id": "...", "reason": "..."}]
  }
  401 → {"error":"unauthorized"}   # bad/missing token when a token is configured
```

Only `decision`, `suggested`, and `reason` are strictly required in a response;
the client normalizes the rest.

---

## Option 1 — open-source central server (recommended)

Promote the kit's own deterministic scorer to a shared HTTP service. The server
is `files/home/model-router/http_server.py` — the **same** `model_router.route` +
`catalog.load_catalog` the per-sandbox server uses, exposed over HTTP. It is
pure standard library (`http.server`), stateless, and horizontally scalable.

### Run it

```bash
# On a host/container reachable by your sandboxes:
MODEL_ROUTER_CATALOG=/etc/model-router/roster.json \
MODEL_ROUTER_SERVER_TOKEN="$(cat /etc/model-router/token)" \
python3 http_server.py --host 0.0.0.0 --port 8080
```

- `MODEL_ROUTER_CATALOG` (optional) — a JSON roster file so the WHOLE fleet
  shares one capability profile / cost policy. Edit it once, every sandbox
  inherits the change on its next call. (Same format as the per-sandbox override;
  see the kit README "Candidate roster".)
- `MODEL_ROUTER_SERVER_TOKEN` (optional) — when set, `/route` requires the bearer
  token. Leave unset only on a fully trusted internal network.

### Package it as a container (sketch)

```dockerfile
FROM python:3.12-slim
COPY model-router/ /app/model-router/
WORKDIR /app/model-router
ENV MODEL_ROUTER_SERVER_HOST=0.0.0.0 MODEL_ROUTER_SERVER_PORT=8080
EXPOSE 8080
CMD ["python3", "http_server.py"]
```

Run several replicas behind a load balancer / your platform's service — the
scorer is stateless, so scaling is trivial. Put TLS termination (and, ideally,
mTLS or a network policy) in front of it; see **Hardening** below.

### Point sandboxes at it

```bash
# per-sandbox env (how you set env depends on your acq backend):
MODEL_ROUTER_ADAPTER_URL=https://model-router.internal
MODEL_ROUTER_ADAPTER_TOKEN=<the shared token>
```

and allow-list the central host for the sandbox (see **Egress** below).

---

## Option 2 — TypeSafe / Jev central server

If you specifically want the proprietary **TypeSafe "Jev" Decisions API** as the
decision engine (the engine the original `jev-skill-router` uses), run a thin
**adapter shim** centrally that implements the same `/route` contract above and
forwards each request to TypeSafe. The per-sandbox client is unchanged — it does
not know or care which engine is behind the endpoint.

A minimal shim (illustrative — you own this service; keep the TypeSafe key only
here, never in a sandbox):

```python
# central-typesafe-adapter.py  (sketch — stdlib http.server + your TypeSafe call)
#
# POST /route {request, max_cost_rank}
#   → build the TypeSafe Decisions "state + questions" payload for model choice
#   → POST it to api.typesafe.ai/v1/systemone with your SERVER-SIDE key
#   → translate TypeSafe's answer into the {decision, suggested, reason, …} shape
#   → return that JSON
#
# The TypeSafe API key lives ONLY in this central service's environment
# (TYPESAFE_API_KEY) — it is never shipped to, or reachable from, any sandbox.
```

Why centralize the TypeSafe path specifically:

- **One key, server-side.** The paid API key stays on one trusted host, rotated
  in one place. No sandbox ever holds it (sandboxes only hold the shim's bearer
  token, if any).
- **One egress hole.** Only the central service talks to `api.typesafe.ai`;
  sandboxes talk only to the central service. The sandbox fleet's egress surface
  does not grow by one-paid-API-per-sandbox.
- **Cost control + caching.** You can cache, rate-limit, and meter TypeSafe usage
  centrally instead of per sandbox.
- **Swap without redeploying sandboxes.** Because the shim implements the same
  `/route` contract as Option 1, you can move between the open-source scorer and
  the TypeSafe engine (or run both, A/B) without changing anything in the
  sandboxes.

> This repo does **not** ship a TypeSafe shim or any TypeSafe credentials — the
> proprietary API is out of scope for the kit itself. Option 2 is the integration
> pattern for teams that already license TypeSafe. See the kit's
> `docs/decisions/0001-local-scorer-not-proprietary-api.md` for why the kit's
> default is the open-source scorer.

---

## Egress: allow-listing the central host from a sandbox

The `model-router` kit declares **no** `caps.network.allow` by default (it is
offline). Adapter mode is the only path that makes a network call, so when you
use it you MUST let the sandbox reach the central host. Do **not** fork the kit —
compose a tiny mixin, exactly as the kit README recommends for stricter
permissions:

```yaml
# spec.yaml — model-router-central (a tiny companion mixin)
schemaVersion: "hybrid/v1"
kind: mixin
name: model-router-central
displayName: Model Router — central endpoint egress
description: >
  Allow-list the central model-router decision endpoint and set adapter-mode env
  for the model-router kit.
caps:
  network:
    allow:
      - model-router.internal        # <-- your central host (NO scheme, NO path)
environment:
  MODEL_ROUTER_ADAPTER_URL: "https://model-router.internal"
  # MODEL_ROUTER_ADAPTER_TOKEN is a SECRET — do NOT put it here (environment: is
  # plain, non-secret config). Inject it via the backend credential/secret path
  # instead (see your acq backend's secret docs), the same way usai-provider's
  # USAI_API_KEY is injected.
```

Apply it alongside the router kit:

```bash
acq create --name dev opencode /path/to/project
# compose: ... --kit model-router  --kit model-router-central  (acq extra-kit mechanism)
```

> Keep the token out of `environment:` — that block is for non-secret values and
> can reach a shell. Use the backend secret path for `MODEL_ROUTER_ADAPTER_TOKEN`
> (microsandbox/sbx both inject secrets without the container holding the raw
> value), consistent with how the `usai-provider` kit handles `USAI_API_KEY`.

---

## Hardening

The bundled HTTP server is intentionally minimal and is **not** meant to face the
public internet unprotected. For a shared deployment:

- **TLS everywhere.** Terminate TLS at an ingress in front of the server; the
  sandbox client always uses `https://` and validates certificates (it does not
  disable verification).
- **Authn beyond a shared secret.** The bearer token is a coarse gate. Prefer
  mTLS or your platform's service-to-service identity for anything past a trusted
  internal network; keep the token as a secondary gate.
- **Network policy.** Restrict who can reach the server to your sandbox
  egress ranges; the scorer has no reason to be world-reachable.
- **No sensitive data in requests.** The `request` text is UNTRUSTED and is only
  pattern-matched (local scorer) or forwarded (TypeSafe shim). Do not log full
  request bodies centrally if they may contain user content; log decisions +
  metadata instead.
- **Rate-limit + time out.** Protect the central service (and, for Option 2, your
  paid API budget) with rate limits and short timeouts; the client already bounds
  its own call with `MODEL_ROUTER_ADAPTER_TIMEOUT` and fails soft.

> Security/behavioral authority for federal use lives in the
> [playbook](https://github.com/GSA-TTS/agentic-coding-playbook) — this doc is a
> reusable integration pattern, not compliance guidance.

---

## Decision model: when to centralize

| You have… | Prefer |
|-----------|--------|
| One user / a few sandboxes | **Local scorer** (the kit default) — no server to run |
| Many sandboxes, want one policy to tune | **Option 1** (central open-source server) |
| An existing TypeSafe/Jev license you want to use fleet-wide | **Option 2** (central TypeSafe shim) |
| Both, during an evaluation | Run Option 1 and Option 2 side by side; point subsets of sandboxes at each via `MODEL_ROUTER_ADAPTER_URL` and compare |

See [`docs/decisions/0003-central-shared-server.md`](decisions/0003-central-shared-server.md)
for the recorded rationale.
