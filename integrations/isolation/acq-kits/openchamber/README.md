# openchamber (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that runs [OpenChamber](https://github.com/openchamber/openchamber) — a
browser UI for OpenCode — inside the sandbox, alongside the terminal TUI.

This kit is **opt-in**. It is *not* one of the default GSA kits; you add it
explicitly (see [Usage](#usage)).

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend. It replaces the
> former `sbx-kits/openchamber/` sbx-only spec. See
> [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## What it does

- **Network egress** — allow-lists the npm registry (`registry.npmjs.org`,
  `*.npmjs.org`), the install-script host (`raw.githubusercontent.com`), and the
  GitHub release-asset hosts (`github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`) that the prebuilt `better-sqlite3`
  native binary is downloaded from (`caps.network`). Default-deny otherwise.
- **Install + supervise (one script)** — a `startup`-phase command runs
  [`files/home/openchamber-start.sh`](files/home/openchamber-start.sh) in the
  background on every sandbox start. That script:
  1. installs the OpenChamber CLI on first boot (only if missing) from a
     **pinned release tag whose `install.sh` is SHA-256-verified before it
     runs** (`OPENCHAMBER_REF` / `OPENCHAMBER_INSTALL_SHA256`, exported by the
     startup command — not `main`), routing the install through the sandbox
     proxy and trusting the sandbox proxy CA so the prebuilt native binary
     downloads instead of trying to compile;
  2. supervises a headless `opencode serve` on `127.0.0.1:4096` (the OpenCode
     server the browser drives); and
  3. supervises OpenChamber bound to `0.0.0.0`, pointed at that managed server
     via `OPENCODE_SKIP_START=true` + `OPENCODE_PORT=4096`.
  Each step no-ops when already done. Both services (2 and 3) run under a tiny
  respawn loop — if either process exits (e.g. after an interactive self-update,
  which needs a restart to apply, or a crash) it is restarted after a few
  seconds (`OPENCHAMBER_RESTART_DELAY`, default `5`). No systemd.
- **Published port** — the sbx backend publishes container port `3000`, mapped
  to an ephemeral host loopback port at sandbox start
  (`backend_extras.sbx.publishedPorts`).

> **Why install at startup, not at create?** OpenChamber's `better-sqlite3`
> dependency is a native module; on the toolchain-free opencode base image, a
> create-time install failure would crash sandbox create. Running it at startup
> keeps a failure to "UI unavailable" instead of a dead sandbox. The first boot
> therefore does a one-time npm install (a few extra seconds); later starts skip
> it.

## Backend parity

| Backend | Support | Notes |
|---------|---------|-------|
| **sbx** | Supported | Publishes container port 3000 → an ephemeral host **loopback** port per sandbox, and runs the startup script as a background hook — both via `backend_extras.sbx` (`publishedPorts` + `background`). |
| **msb** | Not yet | Deferred: the neutral spec models neither port publishing nor a background-command flag, and no equivalent `backend_extras.msb` is wired. The install+supervise script is backend-agnostic; only the port/background plumbing is missing. |
| **ppp** (later) | Not yet | Same gap as msb. |

The one backend-specific dependency is **exposing the in-container UI port to
the host** and **running the startup command in the background**. Those live in
`backend_extras.sbx` because `hybrid/v1` does not (yet) model published ports or
a background flag. Extending `openchamber` to `msb`/`ppp` is tracked as a
follow-up on [#223](https://github.com/GSA-TTS/agentic-coding-patterns/issues/223);
it needs either a neutral port-publish + background vocabulary in `acq` or an
`msb`-native equivalent extra.

## Usage

The kit is applied by remote reference. Apply it as an **extra kit** on top of
the default GSA kits:

```bash
# acq:
export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/openchamber"
acq run opencode /path/to/your/project
```

`GSA-TTS/` is already in the default kit-source allowlist, so no
`ACQ_EXTRA_KIT_SOURCES` change is needed. `<sha>` must be a full 40-character
commit SHA of this repo (branches and tags are rejected for git kit refs).

> **Apply at create time.** The published port is fixed when the container is
> created. Adding this kit to a *running* sandbox skips the port mapping, so add
> it at create time (recreate the sandbox if it already exists).
>
> **On HTTPS-inspected networks (e.g. Zscaler).** OpenChamber's first-boot
> install downloads a prebuilt native binary; behind an inspecting proxy that
> download only validates if the inspection CA is in the sandbox's system trust
> store. Pair this kit with the `zscaler-ca-certificate` kit (part of the default
> GSA setup) so the CA is present. On a non-inspected network the sandbox proxy
> CA alone suffices and no extra kit is needed.

## Reaching it from the host

The kit publishes **container** port `3000`, mapped to an **ephemeral host port
on `127.0.0.1`, allocated per sandbox** — so running this kit in several
sandboxes at once is fine: each gets its own distinct host port and they don't
collide. Find the assigned port and open it:

```bash
acq ports <sandbox>        # (sbx ports <sandbox>) — lists the host port for container 3000
# then open http://127.0.0.1:<host-port> in a browser
```

Want a **stable** host port (e.g. always `3000`), or want to pin each sandbox to
a different port of your choosing? Publish it explicitly on top of the kit's
declaration:

```bash
sbx ports <sandbox> --publish 3000:3000        # first sandbox → host 3000
sbx ports <other-sandbox> --publish 3001:3000  # second sandbox → host 3001
```

## Session sharing (important)

The terminal TUI you get from `acq run opencode` starts its **own** in-process
OpenCode server. It does **not** share live session state with the OpenChamber
browser, which uses the managed server on `:4096`. Session *history* is on disk
and reachable from both, but a live, in-flight run is not shared between them.

If you want the terminal and the browser to drive the **same** live session,
don't launch a fresh TUI — **attach** to the managed server. It requires Basic
auth with a per-sandbox password the kit generated, passed via
`OPENCODE_SERVER_PASSWORD`:

```bash
acq exec <sandbox> -- sh -lc \
  'OPENCODE_SERVER_PASSWORD="$(cat ~/.local/state/openchamber/opencode-server-password)" \
     opencode attach http://127.0.0.1:4096'
```

Both clients then share one server, one session list, and one live run.

> The managed `opencode serve` requires HTTP Basic auth (unauthenticated
> requests get `401`). The kit generates a per-sandbox password once, stores it
> at `~/.local/state/openchamber/opencode-server-password` (mode `600`), and
> gives it to both `opencode serve` and OpenChamber so they share one
> credential. It's a sandbox-local secret, not host key material.

## Security note

OpenChamber is bound to `0.0.0.0` with
`OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true` so the mapped host port is usable.
This is safe **only because the kit runs inside a sandbox** — an ephemeral
container with a proxied, allow-listed network and no host filesystem access.
The sandbox is the security boundary. The managed `opencode serve` is bound to
loopback (`127.0.0.1`) and is never published to the host directly; the browser
reaches it only through OpenChamber's proxy.

**Assumes a trusted, single-tenant host.** Unlike an on-demand wrapper that
starts the UI only when you ask for it, this kit auto-starts on **every** boot,
so the unauthenticated UI is always live — bound in-container to `0.0.0.0:3000`
and mapped to a host **loopback** (`127.0.0.1`) ephemeral port — the whole time
the sandbox runs. The published port is loopback-only, so it is not
LAN-reachable; but anyone with access to the host's loopback (any local user, or
anything you forward that port to) can drive OpenCode without a credential. Only
run this on a host you trust as single-tenant, and don't forward the mapped port
to a wider interface.

**Installer supply chain.** The first-boot install fetches OpenChamber's
`install.sh` from a **pinned release tag** (`OPENCHAMBER_REF`) and refuses to run
it unless its SHA-256 matches `OPENCHAMBER_INSTALL_SHA256` — it does not pipe
`main` to a shell on each boot. Bump both values together to adopt a newer
release (see the comments in `spec.yaml` and the startup command).

## Validating

```bash
# Backend-agnostic gate (schema + source paths + registry cross-check):
python ../validate-kits.py
./scripts/verify          # end-to-end: create a sandbox and assert behavior
```

## Layout

```
openchamber/
├── spec.yaml                        # the kit (hybrid/v1: caps, files, startup command, backend_extras)
├── files/home/openchamber-start.sh  # install + supervise script (dropped into the agent home)
├── README.md                        # this file
├── TROUBLESHOOTING.md               # failure modes
├── scripts/verify                   # host-side end-to-end check
└── docs/decisions/                  # design records
```
