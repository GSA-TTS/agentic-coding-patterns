# model-router-proxy (acq mixin kit)

Routes OpenCode's `usai` provider through the **model-router** so **every prompt
is auto-switched** to the best model (graded reasoning score; optional LLM
judge), streaming preserved. The proxy sits transparently in the request path:
OpenCode's `baseURL` points at the [model-router-service](https://github.com/btylerburton/model-router-service),
which rewrites the model per request and forwards to USAi. See the design
[proposal](docs/proposal.md).

## Mode (`MODEL_ROUTER_MODE`)

**`in-sandbox` (default, the supported mode):** runs the full service on
`127.0.0.1` inside the sandbox, then flips OpenCode's `baseURL` to it. USAi
(`api.gsa.usai.gov`) is reachable only from inside the GSA network / behind
Zscaler, and the sandbox is already there, so the decision service runs here;
OpenCode→service is pure loopback. This is the mode that is live-verified.

> `MODEL_ROUTER_MODE=external` also exists in the code (flip `baseURL` to a
> remote service instead of running one in-sandbox) but is **experimental and
> not yet supported** — see "Known blockers" below. Do not rely on it yet.

> **Why in-sandbox:** a cloud.gov deploy of the service *starts* but cannot reach
> USAi from cloud.gov egress (verified: `/models` → `000`, `/readyz` →
> `candidates:0`). The decision service must run where USAi is reachable — inside
> the GSA network, i.e. the sandbox. See
> [`docs/decisions/0001-in-sandbox-mode-default-cloudgov-parked.md`](docs/decisions/0001-in-sandbox-mode-default-cloudgov-parked.md).

## Known blockers (external mode / shared deployment)

External mode has **no working target today** and is unverified end-to-end:

- **cloud.gov cannot reach USAi.** USAi is GSA-network-only; a cloud.gov-hosted
  service starts but every upstream call fails (`candidates:0`). Blocks the
  cloud.gov external target. (ADR 0001.)
- **Host-run service is unreachable from the microsandbox backend.** acq's
  `local`/microsandbox backend is VM-isolated; a service bound on the developer's
  host returned an *empty reply* over the VM-NAT interface even from the host, and
  there is no Docker-style bridge that behaves reliably. Blocks the host-run
  external target.
- **No end-to-end test exercises external mode.** The flip mechanism (the toggle)
  is tested, but `MODE=external` flipping to a reachable remote and round-tripping
  a request has never been validated.

Until at least one external target is reachable, use the default in-sandbox mode.

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

**external mode (experimental, unsupported):** skip the server; auto-detect the backend host alias (or use
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
| `MODEL_ROUTER_MODE` | `in-sandbox` | `in-sandbox` (supported) \| `external` (experimental, unsupported — see Known blockers) |
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
