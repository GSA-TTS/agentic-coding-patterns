# agor-daemon-egress (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that allow-lists outbound egress to the **Agor daemon** control-plane from
inside the sandbox, so an Agor executor running in the sandbox can connect back
to the daemon over WebSocket/Feathers using its scoped JWT.

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

`acq` has **no per-invocation network flag** — `--net-rule`, `--allow`, and
`acq policy` do not exist at the acq level. The **only** acq-native way to open
outbound egress is a kit's `caps.network.allow`. sbx is **default-deny** for
arbitrary hosts, so without an allow entry the in-sandbox `agor-executor` cannot
reach the daemon and the session never streams results. This kit is that entry,
scoped to exactly one host:port — the Agor daemon.

See [`GSA-TTS/agentic-coding-patterns#259`](https://github.com/GSA-TTS/agentic-coding-patterns/issues/259)
(the decision) and the map [#247](https://github.com/GSA-TTS/agentic-coding-patterns/issues/247).

## What it does

- **Network egress** — allow-lists a single host:port,
  `host.docker.internal:3030` by default (the sbx host alias + the Agor default
  daemon port). Nothing else: no files, no commands, no secret.

## Security posture

This kit **widens network egress**, so it is reviewed as a **security-relevant**
kit (`categories: [security]` in intent; `human_review_required`; PR labelled
`needs-human-review`). Its capability is deliberately minimal:

| Field | Value | Why |
|---|---|---|
| Egress | one host:port (the daemon) | least-privilege: only the control-plane the executor must reach |
| Filesystem | none | it drops no files |
| Commands | none | it runs nothing in the guest |
| Secrets | none | the daemon URL is not sensitive |

The `hybrid/v1` kit schema is `additionalProperties: false` and models **no**
security-governance frontmatter fields (those live on *skill* patterns, not kit
specs). The governance posture is therefore recorded here and in the kit's ADR
and enforced by **human review**, not by schema fields — consistent with
[`docs/security-skill-governance.md`](../../../../docs/security-skill-governance.md).

## Backend parity

| Backend | Support | Notes |
|---|---|---|
| **sbx** | Supported (validated) | `caps.network.allow` is synthesized into the sbx-v2 kit; the full `host.docker.internal:3030` is preserved (quoted). |
| **msb** | Works, port-stripped | acq emits `--net-rule allow@host.docker.internal` and **drops the `:port`** (msb keys on domain only). Egress is host-wide for that host on msb — acceptable. A live msb run is tracked at [#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257). |
| **ppp** (later) | Deferred | Same `caps.network.allow` path as sbx. |

No backend shortcut — every backend uses `caps.network.allow`.

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

The wrapper passes it to `acq create … --kit "$AGOR_EGRESS_KIT"`.

## Adjusting the allow entry

The default assumes the **sbx host alias** `host.docker.internal` and the **Agor
default daemon port** `3030`. If your daemon uses a different port, or your
deploy exposes it under a different host alias, **edit the single
`caps.network.allow` entry** in [`spec.yaml`](spec.yaml). A `hybrid/v1` kit
cannot template a dynamic value; the wrapper can read the real `daemonUrl` from
the executor payload, but the allow-list itself is static. (On msb the port is
dropped either way.)

## Verifying

```bash
# Offline, backend-agnostic gate (schema + registry + README):
python ../validate-kits.py

# Live sbx check (needs sbx installed + logged in): creates a throwaway sandbox
# with this kit and confirms the daemon host:port is in the sandbox egress
# allow-list. Whether the sandbox can actually ROUTE to host.docker.internal is
# a Docker-Sandboxes runtime property; the live end-to-end connection is
# validated by the orchestrators/agor integration (#257).
./scripts/verify
```

## Layout

```
agor-daemon-egress/
├── spec.yaml               # the kit (hybrid/v1: caps.network.allow only)
├── README.md               # this file (with the backend-parity + security note)
├── scripts/verify          # host-side check
└── docs/decisions/         # design records
```
