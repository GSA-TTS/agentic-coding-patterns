# model-router-proxy (acq mixin kit)

Routes OpenCode's `usai` provider through the **model-router** so **every prompt
is auto-switched** to the best model (graded reasoning score; optional LLM
judge), streaming preserved. This is the request-path, **auto-switching**
counterpart to the advisory [`model-router`](../model-router/) MCP kit (which
only *recommends* a model).

## Two modes (`MODEL_ROUTER_MODE`, default `in-sandbox`)

| Mode | What runs | When to use |
|------|-----------|-------------|
| **`in-sandbox`** (default) | the **full service on `127.0.0.1` inside the sandbox**, then flips OpenCode's `baseURL` to it | **now** — USAi (`api.gsa.usai.gov`) is only reachable from inside the GSA network / behind Zscaler, and the sandbox is already there. OpenCode→service is pure loopback. |
| **`external`** | **no server**; flips `baseURL` to a remote `MODEL_ROUTER_URL` (cloud.gov app, or a host-run service via the backend host alias) | **later** — once USAi is reachable from wherever the service is deployed. |

> **Why in-sandbox is the default:** a cloud.gov deploy of the service *starts*
> but cannot reach USAi from cloud.gov egress (verified: `/models` → `000`,
> `/readyz` → `candidates:0`). The decision service must run where USAi is
> reachable — inside the GSA network, i.e. the sandbox. See
> [`docs/decisions/0001-in-sandbox-mode-default-cloudgov-parked.md`](docs/decisions/0001-in-sandbox-mode-default-cloudgov-parked.md).

## What it does (startup, idempotent, fail-soft)

**in-sandbox mode (default):**
1. **Fetch** [`btylerburton/model-router-service`](https://github.com/btylerburton/model-router-service)
   at a pinned SHA (public GitHub tarball via `codeload`).
2. **Install** its deps **wheels-only** (`--only-binary=:all:`) into one flat
   `--target` dir — no source build (avoids the Python 3.14/aarch64
   no-wheel/no-compiler failure), deterministic import path.
3. **Run** the service in the background on `127.0.0.1:8080`, reusing the
   **usai-provider** `USAI_API_KEY` and the sandbox's **Zscaler CA** trust (the
   `zscaler-ca-certificate` kit put the root in the system store — no
   `ROUTER_CA_BUNDLE` needed). Wait for `/readyz`.
4. **Flip** OpenCode's `usai` `baseURL` → `http://127.0.0.1:8080/v1` via the
   installed `model-router-toggle` CLI.

**external mode:** skip the server; auto-detect the backend host alias (or use
`MODEL_ROUTER_URL`) and flip `baseURL` to it.

**Fail-soft (both modes):** missing `python3`/`USAI_API_KEY`, a failed
fetch/dep-install, or a service that never becomes ready all leave OpenCode on
the **direct USAi gateway** and exit 0 — never a dead sandbox.

## Compose with

| Kit | Why |
|-----|-----|
| `usai-provider` | owns the OpenCode `usai` provider block this kit flips; supplies `USAI_API_KEY` |
| `zscaler-ca-certificate` | puts the Zscaler root in the sandbox trust store so the in-sandbox service can reach USAi over inspected TLS |

Apply all three for in-sandbox mode.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `MODEL_ROUTER_MODE` | `in-sandbox` | `in-sandbox` \| `external` |
| `MODEL_ROUTER_PORT` | `8080` | loopback port (in-sandbox) / host-run port (external) |
| `MODEL_ROUTER_JUDGE_MODEL` | `claude_4_5_haiku` | cheap ranking model (judge is off by default) |
| `MODEL_ROUTER_DEFAULT_MODEL` | `claude_4_5_sonnet` | fail-open landing model |
| `MODEL_ROUTER_SERVICE_REF` | pinned SHA | service commit to fetch |
| `MODEL_ROUTER_URL` | *(external only)* | remote service URL; auto-detects a host alias if unset |
| `MODEL_ROUTER_REQUIRE_READY` | `0` | external: `1` = only flip if the remote `/readyz` answers |

## Controls (installed on PATH)

```bash
model-router-toggle status          # routing ON/OFF + service /readyz
model-router-toggle off             # stop routing (restart OpenCode session to apply)
model-router-toggle on              # resume routing
model-router feedback --last --model claude_4_8_opus   # correct a bad route
model-router recalibrate            # re-tune reasoning thresholds from feedback
```

> OpenCode reads `baseURL` at provider init, so a routing change needs a session
> restart (the toggle prints this).

## Logs (in-sandbox)

```
~/.local/state/model-router-proxy/install.log      # fetch/install/flip steps
~/.local/state/model-router-proxy/service.log      # the service's own stdout
~/.local/state/model-router-proxy/decisions.jsonl  # one line per routed turn
```

## Verifying

```bash
./scripts/verify              # offline: schema/registry + install-script guards
RUN_ACQ=1 ./scripts/verify    # live: create a sandbox, assert in-sandbox service up + baseURL flipped
```

## Backend parity

Neutral `hybrid/v1` (`files` + one startup `command`), no backend shortcut. Both
`sbx` and `msb` run the identical step. No published port (loopback only in
in-sandbox mode; no server in external mode). Egress allow-list:
`codeload.github.com` + `api.github.com` (fetch), `pypi.org` +
`files.pythonhosted.org` (deps, in-sandbox), `api.gsa.usai.gov` (the service's
upstream, in-sandbox).
