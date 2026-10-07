# model-router-proxy (acq mixin kit)

Points OpenCode's `usai` provider at an **external** model-router service so
**every prompt is auto-routed** to the best model (graded reasoning score;
optional LLM judge), with streaming preserved. This is the request-path,
**auto-switching** counterpart to the advisory [`model-router`](../model-router/)
MCP kit (which only *recommends* a model).

> **External service shape.** The model-router-service runs **where you deploy
> it** — your localhost during dev (reachable from the sandbox via the host
> bridge) or a **cloud.gov** app in a real environment. This kit does **not** run
> a server in the sandbox: it fetches only the stdlib `model-router-toggle` CLI
> and flips OpenCode's `baseURL` to `MODEL_ROUTER_URL/v1`. See the design
> proposal in
> [`../model-router/docs/proposals/model-router-proxy-kit.md`](../model-router/docs/proposals/model-router-proxy-kit.md).

## What it does (startup, idempotent, fail-soft)

1. **Fetch** only the stdlib toggle modules (`toggle.py` + `adapters/`) from
   [`btylerburton/model-router-service`](https://github.com/btylerburton/model-router-service)
   at a pinned SHA (public GitHub tarball via `codeload`). No pip install, no
   server, no background process.
2. **Install** the `model-router-toggle` CLI on PATH.
3. **Flip** OpenCode's `usai` `baseURL` → `MODEL_ROUTER_URL/v1` via that CLI
   (merge-not-clobber; idempotent; saves the original so `off` restores it).

**Fail-soft:** missing `python3`, a missing `MODEL_ROUTER_URL`, or a failed fetch
all leave OpenCode on the **direct USAi gateway** and exit 0 — never a dead
sandbox. The external service being down is non-fatal too (the toggle warns; set
`MODEL_ROUTER_REQUIRE_READY=1` to instead stay direct until the service answers
`/readyz`).

## Required config

| Var | Required | Meaning |
|-----|----------|---------|
| `MODEL_ROUTER_URL` | **yes** (has a dev default) | External service base URL. The spec ships a default of `http://host.docker.internal:8080` (a service on the developer's host, via the Docker bridge). Change it to `https://<app>.app.cloud.gov` for a deployed service. |

> **It must be in the GUEST environment, not your host shell.** The install
> script runs inside the sandbox, so a host-shell `export MODEL_ROUTER_URL=…`
> does **not** reach it. The kit's `environment:` block injects the default into
> the guest. To override per sandbox, change that block, or set it at runtime:
> ```bash
> acq exec <sbx> -- env MODEL_ROUTER_URL=https://<app>.app.cloud.gov \
>   model-router-toggle --harness opencode on
> # then restart the OpenCode session
> ```

The service holds its **own** upstream key where it is deployed, so this kit
needs neither `USAI_API_KEY` nor the Zscaler CA in the sandbox — the **service**
handles TLS and auth to USAi on its side.

## Compose with

| Kit | Why |
|-----|-----|
| `usai-provider` | owns the OpenCode `usai` provider block this kit flips |

Reaching the external service from the sandbox is **deployment-specific**: a
host-run service on Docker-based acq is reachable at `host.docker.internal`
(loopback bridge, no egress entry needed); a cloud.gov service needs that app's
host added to the sandbox egress (via your project's egress kit). It is not
hardcoded here.

## Controls (installed on PATH)

```bash
model-router-toggle status          # routing ON/OFF + service /readyz
model-router-toggle off             # stop routing (restart OpenCode session to apply)
model-router-toggle on              # resume routing
```

> OpenCode reads `baseURL` at provider init, so a routing change needs a session
> restart (the toggle prints this).

## Pins / overrides (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `MODEL_ROUTER_URL` | `http://host.docker.internal:8080` | external service base URL (guest env; spec default) |
| `MODEL_ROUTER_SERVICE_REPO` | `btylerburton/model-router-service` | source repo (for the toggle code) |
| `MODEL_ROUTER_SERVICE_REF` | pinned SHA | commit to fetch the toggle code from |
| `MODEL_ROUTER_REQUIRE_READY` | `0` | `1` = only flip routing if the service answers `/readyz` |

## Logs (in-sandbox)

```
~/.local/state/model-router-proxy/install.log      # fetch/flip steps
```

(The decision log and the proxy's own stdout live wherever the **service** runs —
on your host or on cloud.gov — not in the sandbox.)

## Verifying

```bash
./scripts/verify              # offline: schema/registry + install-script guards
RUN_ACQ=1 MODEL_ROUTER_URL=... ./scripts/verify    # live: create a sandbox, assert baseURL flipped
```

## Backend parity

Written in the neutral `hybrid/v1` vocabulary (`files` + a single startup
`command`), no backend shortcut. Both `sbx` and `msb` drop the install script and
run the identical fetch → install-CLI → flip step. No published port (no server).
The egress allow-list (`codeload.github.com`, `api.github.com`) is emitted per
backend from `caps.network.allow`.
