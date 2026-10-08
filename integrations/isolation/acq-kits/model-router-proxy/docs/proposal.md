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

## Roadmap / deferred work

Tracked here so a reviewer sees the known gaps and their triggers. These are
deferred, not forgotten; each has a concrete unblock condition.

1. **External mode — make it actually usable.** The `MODEL_ROUTER_MODE=external`
   code path exists (flip `baseURL` to a remote service) but is **experimental
   and unverified**, with no working target today:
   - cloud.gov target blocked: cloud.gov egress cannot reach USAi (ADR 0001).
   - host-run target blocked: the microsandbox backend is VM-isolated and a
     host-bound service was unreachable over the VM-NAT interface (empty reply).
   - no end-to-end test exercises external mode (only the flip mechanism is
     tested).
   **Unblock when** either (a) USAi becomes reachable from cloud.gov, or (b) an
   internal GSA-network host can serve a shared service, or (c) a backend offers a
   reliable host bridge. Then add a live external-mode test and promote it from
   experimental.
2. **Shared (non-per-sandbox) deployment.** In-sandbox runs one service per
   sandbox. A shared service needs an internal GSA-network host (not cloud.gov) —
   same unblock as #1(b).
3. **Mid-session routing toggle.** A true on/off *during* a session isn't
   possible from the kit (OpenCode reads `baseURL` at session init; no live-reload
   hook). Candidate upstream OpenCode feature or a PI-harness feature. Today's
   in-session control is the per-turn `x-model-router-bypass` header.
4. **Scorer known-gaps.** The deterministic scorer under-scores a few task
   classes (security review, concurrency root-cause, greenfield design, DB
   migration) — see the service's `tests/fixtures/routing-eval.yaml` `known_gap`
   cases. Addressed by the opt-in LLM judge, a future local model (laya), or
   targeted recalibration from real corrections.
5. **Local distilled decision model (laya).** Deferred pending a benchmark on a
   real target (CPU, where USAi is reachable) — see the service ADR
   `0001-deterministic-scorer-defer-local-model.md`.

## Out of scope (this kit)

- The service itself (its own repo).
- `large_context` demand type and the lone-`fast` fall-through (service-side).
