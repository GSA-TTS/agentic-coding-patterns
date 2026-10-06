## Summary

Land a new acq mixin kit — **`model-router-proxy`** — that wires a sandbox's
OpenCode at a running **model-router-service** (an OpenAI-compatible routing
proxy that auto-selects the best upstream model per prompt). This is the
request-path counterpart to the existing advisory `model-router` MCP kit: the
MCP kit *recommends* a model via a `model_select` tool; this kit makes routing
**transparent and automatic** by pointing OpenCode's `usai` provider `baseURL`
at the proxy, which inspects each prompt, picks a model (graded reasoning score +
cheap LLM judge), rewrites the request, and forwards to USAi.

> Tracking issue only — do not implement yet. The service it depends on
> (`model-router-service`) is still in development; this kit lands **after** that
> service is ready and deployed (e.g. to cloud.gov). Filing now per the
> "track all identified work, including dependency-blocked work" rule.

## Why a new kit (not an extension of `model-router`)

The existing `model-router` kit is **advisory** — an MCP `model_select` tool the
agent may call for a recommendation. It cannot auto-switch, because OpenCode
gives a tool no hook to change the active model mid-turn. Auto-switching every
prompt requires sitting **in the request path**, which only a proxy can do. The
two are complementary and should remain distinct kits:

| | `model-router` (exists) | `model-router-proxy` (this issue) |
|---|---|---|
| Mechanism | stdio MCP tool | rewrites OpenCode `usai` `baseURL` → proxy |
| Effect | recommends a model (agent decides) | auto-switches the model for every prompt |
| Running service? | no (local, offline) | yes (model-router-service) |
| Needs egress? | none | the proxy host (allow-listed) |

## What the kit should do

- Set the OpenCode `usai` provider `baseURL` to the model-router-service endpoint
  via **config, never a hardcoded host** — e.g. `{env:MODEL_ROUTER_URL}/v1`,
  with the kit merging that into the global config the same "merge, don't
  clobber" way the `usai-provider` kit does.
- Declare `caps.network.allow` for the **proxy host only** (deny-by-default
  elsewhere). The USAi key stays on the proxy; the sandbox talks only to the
  proxy.
- Compose cleanly with `usai-provider`, `opencode`, and the existing
  `model-router` kit (an operator may run both: proxy for auto-switch, MCP tool
  for in-agent visibility).
- Be **opt-in** (not a default kit) and **fail-soft**: if `MODEL_ROUTER_URL` is
  unset or the proxy is unreachable, the sandbox must still come up pointed at
  the plain USAi gateway (no dead sandbox).
- Honor the proxy's **bypass** path so a user can still pin a model
  (`x-model-router-bypass`), and surface the proxy's `x-model-router-decision`
  audit header in docs so routing is observable.

## Dependencies / sequencing

- **Blocked on `model-router-service` being ready** (OpenAI-compatible proxy:
  graded reasoning scorer + LLM judge, streaming, pin-honor, fail-open, audit
  header; TLS/`ROUTER_CA_BUNDLE` handling for inspecting proxies; cloud.gov
  manifest). Pick this up once that service is deployed and reachable from a
  sandbox.
- Reuse the `zscaler-ca-certificate` lesson: on a TLS-inspecting network the
  sandbox must trust the proxy chain to reach the service; document composing
  that kit (service-side, the proxy itself uses `ROUTER_CA_BUNDLE`).

## Acceptance criteria (for the eventual PR)

- [ ] `hybrid/v1` mixin kit `model-router-proxy/` with `spec.yaml`, `README.md`
      (backend-parity note), `TROUBLESHOOTING.md`, `docs/decisions/`, `scripts/verify`.
- [ ] Merges `usai.options.baseURL = {env:MODEL_ROUTER_URL}/v1` into the global
      config without clobbering other keys; no hardcoded host.
- [ ] `caps.network.allow` limited to the proxy host; nothing else added.
- [ ] Fails soft when `MODEL_ROUTER_URL` is unset/unreachable (falls back to the
      direct USAi gateway).
- [ ] `scripts/verify`: offline schema/registry gate + a live check that the
      `baseURL` was rewritten and a routed request returns the
      `x-model-router-decision` header.
- [ ] Registered in `kits.yaml`; `validate-kits.py --strict` passes.
- [ ] README cross-links the advisory `model-router` kit and the
      `model-router-service` repo; documents bypass + audit header.

## Out of scope

- The service itself (lives in its own repo).
- The graded-reasoning / feedback-recalibration design (service-side).
- `large_context` demand type and the lone-`fast` fall-through (tracked
  separately against the service).
