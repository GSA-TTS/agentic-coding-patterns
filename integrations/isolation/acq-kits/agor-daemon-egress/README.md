# agor-daemon-egress (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that, applied inside an `acq` sandbox, (1) allow-lists outbound egress to
the **Agor daemon** control-plane and (2) installs the **Agor executor**
(`agor-executor`) into the guest — so an Agor executor running in the sandbox can
connect back to the daemon over WebSocket/Feathers using its scoped JWT.

> **Consumed by the [`orchestrators/agor`](../../../orchestrators/agor/)
> integration.** That wrapper *drives* `acq`; this kit is *applied inside* the
> sandbox. Per the
> [orchestrators area boundary](../../../orchestrators/docs/decisions/0001-orchestrators-area-and-agor-acq.md)
> (drives-vs-applied), a kit lives here under `acq-kits/` even when its only
> consumer is an orchestrator — the orchestrator merely references it.
>
> **Neutral (backend-agnostic) kit** (`schemaVersion: "hybrid/v1"`), consumed by
> `acq`, which selects a backend. See
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## Why this kit exists

Two things the `orchestrators/agor` wrapper needs from the sandbox, neither of
which `acq` provides natively:

1. **Daemon egress.** `acq` has **no per-invocation network flag** (`--net-rule`,
   `--allow`, `acq policy` do not exist at the acq level). The only acq-native way
   to open outbound egress is a kit's `caps.network.allow`, and backends are
   deny-by-default for arbitrary hosts. Without an allow entry the executor cannot
   reach the daemon and the session never streams results.
2. **The executor itself.** The wrapper runs `agor-executor --stdin` inside the
   sandbox, but `agor-live`'s npm `bin` exposes only `agor`/`agor-daemon` — not
   `agor-executor` (which is `dist/executor/cli.js`). The kit's install phase
   installs `agor-live` from npm and shims `agor-executor` onto PATH.

See [`GSA-TTS/agentic-coding-patterns#259`](https://github.com/GSA-TTS/agentic-coding-patterns/issues/259)
(the decision) and the map [#247](https://github.com/GSA-TTS/agentic-coding-patterns/issues/247).

## What it does

- **Network egress** — allow-lists the daemon control-plane on **both** backend
  host aliases (`host.docker.internal:3030` for sbx, `host.microsandbox.internal:3030`
  for msb, the default backend), plus `registry.npmjs.org` for the install-time
  fetch.
- **Executor install** — a create-time (`install`) command runs
  [`files/home/agor-executor-install.sh`](files/home/agor-executor-install.sh),
  which `npm install -g --ignore-scripts agor-live@0.26.8` (BUSL; fetched at
  runtime, never committed) and writes an `agor-executor` shim.
- No secret.

## Security posture

This kit **widens network egress** and **runs a create-time install command**, so
it is reviewed as a **security-relevant** kit (`human_review_required`; PR labelled
`needs-human-review`). Its capability is deliberately minimal:

| Field | Value | Why |
|---|---|---|
| Egress | daemon control-plane (one alias/backend) + npm registry | least-privilege: the control-plane the executor must reach + its install source |
| Filesystem | one committed installer script | the executor runtime is fetched at runtime, not committed |
| Commands | one create-time `install` (root) | `npm install -g --ignore-scripts agor-live@0.26.8` + shim |
| Secrets | none | the daemon URL is not sensitive |

The `hybrid/v1` kit schema is `additionalProperties: false` and models **no**
security-governance frontmatter fields (those live on *skill* patterns, not kit
specs). The governance posture is therefore recorded here and in the kit's ADR
and enforced by **human review**, not by schema fields — consistent with
[`docs/security-skill-governance.md`](../../../../docs/security-skill-governance.md).

## Backend parity

| Backend | Support | Notes |
|---|---|---|
| **msb** (default) | Works, port-stripped | acq emits msb `--net-rule allow@<host>` entries and **drops `:port`** (msb keys on domain only). Because the static kit includes both backend aliases, generated msb policy may allow host-wide egress to both `host.microsandbox.internal` and `host.docker.internal`. This is an msb/static-kit limitation, not desired policy; keep these aliases narrow and do not add broad hostnames. A live msb run is tracked at [#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257). |
| **sbx** | Supported | `caps.network.allow` is synthesized into the sbx-v2 kit; the full `host.docker.internal:3030` is preserved (quoted). |
| **ppp** (later) | Deferred | Same `caps.network.allow` path as sbx. |

The executor install is backend-agnostic (one `install`-phase command). No backend
shortcut.

## Usage

Reference it from the `orchestrators/agor` wrapper via `AGOR_EGRESS_KIT`, either
as a **local directory** (bypasses the source allowlist) or a **git ref**
(`GSA-TTS/` is on acq's default kit-source allowlist):

```bash
# local dir
AGOR_EGRESS_KIT=integrations/isolation/acq-kits/agor-daemon-egress

# or git ref (full 40-char SHA required)
AGOR_EGRESS_KIT="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/agor-daemon-egress"
```

The wrapper passes it to `acq create … --kit "$AGOR_EGRESS_KIT"`, and the
install-phase command installs the executor at create time.

## Adjusting the allow entry / executor version

The allow-list carries **both** backend aliases on the **Agor default daemon
port** `3030`. If your daemon uses a different port or alias, edit
`caps.network.allow` in [`spec.yaml`](spec.yaml). (On msb the port is dropped
either way.)

The executor version defaults to **`0.26.8`** (the `AGOR_EXECUTOR_VERSION` entry
in the spec's `environment`). Set that value to a different concrete `agor-live`
version to lock the executor to your daemon. `latest` is supported only as an
explicit reproducibility opt-out and the installer warns when it is used.

## Verifying

```bash
# Offline, backend-agnostic gate (schema + registry + README); run from the
# repo root so `--root` (default: cwd) finds schemas/:
python integrations/isolation/acq-kits/validate-kits.py

# Live sbx check (needs sbx installed + logged in): creates a throwaway sandbox
# with this kit and confirms the daemon host:port is in the sandbox egress
# allow-list. Whether the sandbox can actually ROUTE to the host alias is a
# runtime property; the live end-to-end connection is validated by the
# orchestrators/agor integration (#257).
./scripts/verify
```

## Layout

```
agor-daemon-egress/
├── spec.yaml                           # the kit (hybrid/v1: egress + install)
├── files/home/agor-executor-install.sh # installs agor-live + shims agor-executor
├── README.md                           # this file
├── scripts/verify                      # host-side check
└── docs/decisions/                     # design records
```
