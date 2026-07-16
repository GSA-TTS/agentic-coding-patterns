# Decision: install OpenChamber at startup, not at create time

**Status:** accepted

> **Neutral-spec note (acq-kits conversion, #223).** This decision carries over
> unchanged to the `hybrid/v1` spec: the neutral `commands[].phase` vocabulary
> has the same `install` (root, create-time once) vs `startup` (every start)
> split, and this kit uses **`startup`** for exactly the reason below. The
> sbx-specific `sbx create` / 500 detail is retained as the original evidence.

## Context

OpenChamber is installed via `npm install -g @openchamber/web`. That package
depends on **better-sqlite3**, a native module whose npm install step runs:

```
prebuild-install || node-gyp rebuild --release
```

i.e. download a prebuilt binary, and only compile from source if the download
fails. The opencode base image (`docker/sandbox-templates:opencode-docker`) has
**no C toolchain** (`cc`/`make` absent), so if the prebuilt download fails, the
source-build fallback also fails and npm exits non-zero.

Placing this in `commands.install` (a **create-time** hook) meant that non-zero
exit crashed `sbx create` itself with a generic
`500 ... failed to run sandbox container` — a dead sandbox, not just a missing
UI. Verified empirically through a field-by-field bisection: bare mixin,
`publishedPorts`-only, `caps.network`-only, and `startup`-only all created fine;
only the `commands.install` running the installer reproduced the 500.

Two things made the prebuilt download fail inside the sandbox (both now handled):

1. **Proxy.** All egress goes through the sandbox proxy. npm honors
   `HTTP(S)_PROXY` automatically, but `prebuild-install` (simple-get /
   tunnel-agent) only proxies when told via npm config — so the script exports
   `npm_config_https_proxy` / `npm_config_proxy`.
2. **TLS.** The proxy presents a TLS chain signed by its own CA that Node does
   not trust by default → `unable to get local issuer certificate` → download
   fails → source-build fallback. The sandbox exposes that CA as
   `PROXY_CA_CERT_B64`; the script decodes it and points Node at it via
   `NODE_EXTRA_CA_CERTS`.

A create-time attempt that trusted only the *system* CA bundle still failed
(the bundle at create time didn't include the inspection root); the sbx proxy CA
from `PROXY_CA_CERT_B64` is the reliable anchor from inside the sandbox. The same
install run **succeeds at startup**.

## Decision

**Do the install in `commands.startup`, not `commands.install`.** The single
startup script installs OpenChamber on first boot (only if missing, proxy- and
CA-aware so it fetches the prebuilt binary), then starts the managed
`opencode serve` and OpenChamber. There is no `commands.install` at all.

## Consequences

- `sbx create` can never be taken down by an OpenChamber install failure — a
  failure degrades to "UI unavailable" (`|| true` + an early `exit 0` after a
  missing-binary check); the terminal agent is unaffected.
- **First boot pays a one-time npm install cost** (a few seconds) before the UI
  is reachable; `scripts/verify` waits up to 150s. Later starts skip it
  (guarded by `command -v openchamber`).
- The install must be idempotent alongside the serve/UI startup, since
  `commands.startup` runs on every container start. It is.
- The kit depends on `PROXY_CA_CERT_B64` and the `HTTP(S)_PROXY` env, both
  provided by sbx. On a non-inspected host the proxy CA alone still anchors the
  chain, so no Zscaler-specific cert is embedded (no drift).

## Links

- docker/sbx-releases #118 — [Kits] Crash on startup with some static files
  (why the script is inlined rather than shipped as a static file)
- [sbx kit spec reference](https://docs.docker.com/ai/sandboxes/customize/kit-reference/)
- WiseLibs/better-sqlite3 — `prebuild-install || node-gyp rebuild` install step
