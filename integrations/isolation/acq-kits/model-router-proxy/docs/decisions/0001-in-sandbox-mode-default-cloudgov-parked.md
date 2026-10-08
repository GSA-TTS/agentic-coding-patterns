# 0001 — In-sandbox is the current mode; cloud.gov is parked (USAi is GSA-network-only)

- Status: accepted
- Date: 2026-10-07
- Deciders: model-router kit maintainers

## Context

`model-router-service` proxies requests to the USAi gateway
(`api.gsa.usai.gov`). The kit evolved to an **external** shape (OpenCode points
at a service running elsewhere — a developer host or a cloud.gov app) to avoid
running a per-prompt LLM judge in-process and to get a clean deployment target.

Two facts, established by live testing, invalidate the external shape **for now**:

1. **USAi is only reachable from inside the GSA network (behind Zscaler).** A
   cloud.gov deployment of the service **starts** but cannot reach USAi: an
   in-container probe to `https://api.gsa.usai.gov/api/v1/models` returned
   `000` (no route), and `/readyz` reports `candidates:0`. cloud.gov egress is
   not on the GSA network, so the one upstream the service exists to proxy is
   unreachable from there.
2. **Host-run + sandbox→host is fragile on the microsandbox backend.** acq's
   `local` backend is VM-isolated (microsandbox). A service bound on the host
   was unreachable even from the host via the VM-NAT interface
   (`172.16.0.225:8080` returned an empty reply while `127.0.0.1:8080` worked),
   and there is no `host.docker.internal`-style bridge that behaves like Docker.

The one place that is **already inside the GSA network, already has USAi egress,
and already trusts the Zscaler CA** is the sandbox itself.

## Decision

Make the kit's **in-sandbox mode the default**: fetch the full service at a
pinned SHA, install its deps wheels-only into a single `--target` directory, run
it on `127.0.0.1` inside the sandbox VM (reusing the usai-provider
`USAI_API_KEY` and the sandbox's Zscaler CA trust), and flip OpenCode's
`baseURL` to the loopback service. OpenCode→service is pure loopback, so none of
the host-boundary wrinkles (VM-NAT empty reply, missing bridge alias, the egress
HTTP proxy / `no_proxy` scope) apply.

Keep the **external mode code path** (`MODEL_ROUTER_MODE=external` +
`MODEL_ROUTER_URL`) as a scaffold for the future, but treat it as
**EXPERIMENTAL and UNSUPPORTED**: it has no working target today (cloud.gov can't
reach USAi; a host-run service is unreachable over the microsandbox VM-NAT) and
is not end-to-end verified. It is retained so that when a target becomes
reachable, promoting it is a mode flag + a verification pass — not a rewrite.
The known blockers and the promotion trigger are tracked in the kit README
("Known blockers") and the proposal roadmap.

The LLM judge stays **off by default**, so the in-sandbox service runs the
sub-millisecond deterministic scorer with no per-prompt USAi round-trip — which
removes the original latency reason for moving away from in-sandbox.

## Consequences

- **Works today**, inside the GSA network, with no host-networking puzzle.
- The service is **per-sandbox** (it lives and dies with the sandbox); it is not
  a shared service. A shared deployment needs a host reachable from the GSA
  network by all sandboxes (an internal host, not cloud.gov) — out of scope now.
- Each sandbox does a wheels-only `pip install` of the service deps at startup
  (fastapi/uvicorn/httpx/pydantic). This requires `pypi.org` + the fastly CDN in
  the egress allow-list, and uses `--only-binary=:all:` + bounded dependency
  ranges so it never falls back to a source build (the Python 3.14/aarch64
  no-wheel/no-compiler failure).
- cloud.gov deploy artifacts (`Procfile`, `runtime.txt`, `deploy/manifest.yml`,
  the README runbook) are **retained, not deleted** — they are correct and will
  be the production shape once USAi is reachable from cloud.gov. This ADR records
  *why* they are parked so the decision is not re-litigated.

## Revisit when

- USAi (or an equivalent gateway) becomes reachable from cloud.gov egress, **or**
- an internal GSA-network host is available to host a shared service for many
  sandboxes.

At that point, flip the default back to `external` and point `MODEL_ROUTER_URL`
at the reachable service.
