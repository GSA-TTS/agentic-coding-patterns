# model-router-proxy (acq mixin kit — POC)

Runs the **model-router proxy inside the sandbox** and points OpenCode's `usai`
provider at it, so **every prompt is auto-routed** to the best model (graded
reasoning score + a cheap LLM judge), with streaming preserved. This is the
request-path, **auto-switching** counterpart to the advisory
[`model-router`](../model-router/) MCP kit (which only *recommends* a model).

> **POC scope.** Minimal, self-contained in the sandbox: fetch the service at a
> pinned SHA, run it on loopback with the sandbox `python3`, flip OpenCode's
> `baseURL`. It is **not** the production shape — production is the cloud.gov
> deployment in the service repo. See the design proposal in
> [`../model-router/docs/proposals/model-router-proxy-kit.md`](../model-router/docs/proposals/model-router-proxy-kit.md).

## What it does (startup, idempotent, fail-soft)

1. **Fetch** [`btylerburton/model-router-service`](https://github.com/btylerburton/model-router-service)
   at a pinned SHA (public GitHub tarball via `codeload`) into
   `~/model-router-service`, unless already present.
2. **Install** the service's pinned deps (`fastapi`/`uvicorn`/`httpx`/`pydantic`)
   to the user prefix (`~/.local`) — no root, no venv tool.
3. **Run** the proxy in the background on `127.0.0.1:8080`, reusing the
   **usai-provider** kit's injected `USAI_API_KEY` as `ROUTER_UPSTREAM_API_KEY`
   and the sandbox's **CA trust** (the `zscaler-ca-certificate` kit puts the
   proxy root in the system store, so no `ROUTER_CA_BUNDLE` is needed). Wait for
   `/readyz`.
4. **Flip** OpenCode's `usai` `baseURL` → `http://127.0.0.1:8080/v1` via the
   installed `model-router-toggle` CLI (merge-not-clobber; idempotent).

**Fail-soft:** missing `python3`, missing `USAI_API_KEY`, a failed fetch/dep
install, or a proxy that never becomes ready all leave OpenCode on the **direct
USAi gateway** and exit 0 — never a dead sandbox.

## Compose with

| Kit | Why |
|-----|-----|
| `usai-provider` | provides `USAI_API_KEY` and the OpenCode config this kit flips |
| `zscaler-ca-certificate` | puts the Zscaler root in the sandbox trust store so the in-sandbox proxy can reach USAi over an inspected TLS path |

Apply all three together.

## Controls (installed on PATH)

```bash
model-router-toggle status          # routing ON/OFF + proxy /readyz
model-router-toggle off             # stop routing (restart OpenCode session to apply)
model-router-toggle on              # resume routing
model-router feedback --last --model claude_4_8_opus   # correct a bad route
model-router recalibrate            # re-tune reasoning thresholds from feedback
```

> OpenCode reads `baseURL` at provider init, so a routing change needs a session
> restart (the toggle prints this).

## Pins / overrides (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `MODEL_ROUTER_SERVICE_REPO` | `btylerburton/model-router-service` | source repo |
| `MODEL_ROUTER_SERVICE_REF` | pinned SHA | commit to fetch |
| `MODEL_ROUTER_PORT` | `8080` | loopback port |
| `MODEL_ROUTER_JUDGE_MODEL` | `claude_4_5_haiku` | cheap ranking model |
| `MODEL_ROUTER_DEFAULT_MODEL` | `claude_4_5_sonnet` | fail-open landing model |

## Logs (in-sandbox)

```
~/.local/state/model-router-proxy/install.log      # fetch/flip steps
~/.local/state/model-router-proxy/service.log      # the proxy's own stdout
~/.local/state/model-router-proxy/decisions.jsonl  # one line per routed turn
```

## Verifying

```bash
./scripts/verify              # offline: schema/registry + install-script guards
RUN_ACQ=1 ./scripts/verify    # live: create a sandbox, assert proxy up + baseURL flipped
```

## Backend parity

Written in the neutral `hybrid/v1` vocabulary (`files` + a single startup
`command`), no backend shortcut. Both `sbx` and `msb` drop the install script and
run the identical fetch → run → flip step. No published port (loopback only). The
egress allow-list (`codeload.github.com`, `api.github.com`, `pypi.org`,
`files.pythonhosted.org`, `api.gsa.usai.gov`) is emitted per backend from
`caps.network.allow`.
