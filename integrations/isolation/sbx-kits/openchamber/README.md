# openchamber (sbx mixin kit)

An [sbx](https://docs.docker.com/ai/sandboxes/) **mixin kit** that runs
[OpenChamber](https://github.com/openchamber/openchamber) — a browser UI for
OpenCode — inside the sandbox, alongside the terminal TUI.

This kit is **opt-in**. It is *not* one of the default GSA kits applied by
`acq`/`qsbx`; you add it explicitly (see [Usage](#usage)).

## What it does

- **Network egress** — allow-lists the npm registry (`registry.npmjs.org`,
  `*.npmjs.org`), the install-script host (`raw.githubusercontent.com`), and the
  GitHub release-asset hosts (`github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`) that the prebuilt `better-sqlite3`
  native binary is downloaded from (`caps.network`). Default-deny otherwise.
- **Install + startup (one step)** — on every sandbox start (`commands.startup`,
  background), a single idempotent script:
  1. installs the OpenChamber CLI on first boot (only if missing), routing the
     install through the sandbox proxy and trusting the sandbox proxy CA so the
     prebuilt native binary downloads instead of trying to compile;
  2. starts a headless `opencode serve` on `127.0.0.1:4096` (the OpenCode server
     the browser drives); and
  3. starts OpenChamber bound to `0.0.0.0`, pointed at that managed server via
     `OPENCODE_SKIP_START=true` + `OPENCODE_PORT=4096`.
  Each step no-ops when already done.
- **Port** — declares container port `3000` (`publishedPorts`); sbx maps it to
  an ephemeral host port at sandbox start.

> **Why install at startup, not at create?** OpenChamber's `better-sqlite3`
> dependency is a native module; on the toolchain-free opencode base image, a
> create-time install failure would crash `sbx create`. Running it at startup
> keeps a failure to "UI unavailable" instead of a dead sandbox. The first boot
> therefore does a one-time npm install (a few extra seconds); later starts skip
> it.

## Usage

The kit is applied by remote reference, pinned to a commit SHA. Apply it as an
**extra kit** on top of the default GSA kits:

```bash
# acq (recommended, 1.1.0+):
export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/sbx-kits/openchamber"
acq run opencode /path/to/your/project

# qsbx (legacy):
export QSBX_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/sbx-kits/openchamber"
./qsbx run opencode /path/to/your/project
```

`GSA-TTS/` is already in the default kit-source allowlist, so no
`ACQ_EXTRA_KIT_SOURCES` change is needed. `<sha>` must be a full 40-character
commit SHA of this repo (sbx rejects branches and tags for git kit refs).

Apply it directly with plain sbx instead:

```bash
sbx run opencode --kit "git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/sbx-kits/openchamber" /path/to/project
```

> **Apply at create time.** `publishedPorts` is fixed when the container is
> created. `sbx kit add` on a *running* sandbox skips the port mapping, so add
> this kit with `--kit` at create time (recreate the sandbox if it already
> exists).
>
> **On HTTPS-inspected networks (e.g. Zscaler).** OpenChamber's first-boot
> install downloads a prebuilt native binary; behind an inspecting proxy that
> download only validates if the inspection CA is in the sandbox's system trust
> store. Pair this kit with the `zscaler-ca-certificate` kit (part of the default
> GSA setup) so the CA is present. On a non-inspected network the sandbox proxy
> CA alone suffices and no extra kit is needed.

## Reaching it from the host

The kit declares **container** port `3000`. sbx maps it to an **ephemeral host
port on `127.0.0.1`, allocated per sandbox** — so running this kit in several
sandboxes at once is fine: each gets its own distinct host port and they don't
collide. Find the assigned port and open it:

```bash
sbx ports <sandbox>        # or: acq ports <sandbox> — lists the host port for container 3000
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

The terminal TUI you get from `sbx run <sandbox>` / `acq run opencode` starts
its **own** in-process OpenCode server. It does **not** share live session state
with the OpenChamber browser, which uses the managed server on `:4096`. Session
*history* is on disk and reachable from both, but a live, in-flight run is not
shared between them.

If you want the terminal and the browser to drive the **same** live session,
don't launch a fresh TUI — **attach** to the managed server. It requires Basic
auth with a per-sandbox password the kit generated, passed via
`OPENCODE_SERVER_PASSWORD`:

```bash
sbx exec <sandbox> -- sh -lc \
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
This is safe **only because the kit runs inside an sbx sandbox** — an ephemeral
container with a proxied, allow-listed network and no host filesystem access.
The sandbox is the security boundary. The managed `opencode serve` is bound to
loopback (`127.0.0.1`) and is never published to the host directly; the browser
reaches it only through OpenChamber's proxy.

## Validating

```bash
sbx kit validate .        # static spec check
./scripts/verify          # end-to-end: create a sandbox and assert behavior
```

## Layout

```
openchamber/
├── spec.yaml            # the kit (install + inline startup script)
├── README.md            # this file
├── TROUBLESHOOTING.md   # failure modes
├── scripts/verify       # host-side end-to-end check
└── docs/decisions/      # design records
```
