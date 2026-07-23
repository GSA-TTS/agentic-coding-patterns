# openchamber (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that runs [OpenChamber](https://github.com/openchamber/openchamber) — a
browser UI for OpenCode — inside the sandbox, and ships an `opencode` wrapper so
the browser and an optional terminal TUI share one live OpenCode session.

This kit is **opt-in**. It is *not* one of the default GSA kits; you add it
explicitly (see [Usage](#usage)).

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend. It replaces the
> former `sbx-kits/openchamber/` sbx-only spec. See
> [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## What it does

- **Network egress** — allow-lists the npm registry (`registry.npmjs.org` —
  metadata and tarballs both come from this host), the install-script host
  (`raw.githubusercontent.com`), and the
  GitHub release-asset hosts (`github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`) that the prebuilt `better-sqlite3`
  native binary is downloaded from (`caps.network`). Default-deny otherwise.
- **An `opencode` wrapper that owns the shared server** — the kit drops
  [`files/home/.local/bin/opencode`](files/home/.local/bin/opencode) at
  `~/.local/bin/opencode`, which is **first on the base-image PATH** (ahead of
  the npm-global bin where the real `opencode` lives). The sandbox entrypoint
  runs the bare command `opencode`, so it runs this wrapper. The wrapper:
  - with **no arguments** — idempotently starts a shared
    `opencode serve --hostname 0.0.0.0 --port 4096` (a no-op if it's already up),
    prints host-connect instructions, then offers to attach a TUI right there. If
    you attach, the TUI runs as a **child** — quitting it returns to the wrapper,
    which keeps the server running. In every case (attach-then-quit, decline, or
    no terminal) the wrapper keeps the shared server in the **foreground** —
    because the wrapper *is* the sandbox entrypoint, it must not return, or PID 1
    would exit and the sandbox would stop; and
  - with **any arguments** — passes straight through to the real `opencode`
    (`opencode run …`, `opencode auth login`, etc.).
- **Install + supervise OpenChamber (one script)** — a `startup`-phase command
  runs [`files/home/openchamber-start.sh`](files/home/openchamber-start.sh) in
  the background on every sandbox start. That script:
  1. installs the OpenChamber CLI on first boot (only if missing) from a
     **pinned release tag whose `install.sh` is SHA-256-verified before it
     runs** (`OPENCHAMBER_REF` / `OPENCHAMBER_INSTALL_SHA256`, exported by the
     startup command — not `main`), routing the install through the sandbox
     proxy and trusting the sandbox proxy CA so the prebuilt native binary
     downloads instead of trying to compile; and
  2. supervises OpenChamber bound to `0.0.0.0:3000` in skip-start mode
     (`OPENCODE_SKIP_START=true` + `OPENCODE_PORT=4096`), so it attaches to the
     shared server the wrapper brings up rather than starting its own.
  The install step no-ops when already done. OpenChamber runs under a tiny
  respawn loop — if it exits (e.g. after an interactive self-update, which needs
  a restart to apply, or a crash) it is restarted after a few seconds
  (`OPENCHAMBER_RESTART_DELAY`, default `5`). No systemd. **The startup script no
  longer starts `opencode serve` — the wrapper owns that, on demand.**
- **Published ports** — the sbx backend publishes container ports `3000`
  (OpenChamber) and `4096` (the shared server), each mapped to an ephemeral host
  loopback port at sandbox start (`backend_extras.sbx.publishedPorts`).

> **Why install at startup, not at create?** OpenChamber's `better-sqlite3`
> dependency is a native module; on the toolchain-free opencode base image, a
> create-time install failure would crash sandbox create. Running it at startup
> keeps a failure to "UI unavailable" instead of a dead sandbox. The first boot
> therefore does a one-time npm install (a few extra seconds); later starts skip
> it.
>
> **OpenChamber shows no server until you run `opencode`.** The shared server is
> started on demand by the wrapper, not by the startup script. Run `opencode`
> (no args) once — in the sandbox or via `acq exec <sandbox> -- opencode` — to
> bring it up; then reload OpenChamber.

## Backend parity

| Backend | Support | Notes |
|---------|---------|-------|
| **sbx** | Supported (ports need one manual step) | The startup script runs as a background hook. Port publishing is **not** carried by acq's neutral→sbx translation, so publish the two container ports once after create: `acq ports <sandbox> --publish 3000:3000` and `--publish 4096:4096`. `backend_extras.sbx.publishedPorts` documents the intended mapping and is honored by a direct sbx-v2 apply. |
| **msb** | Not yet | Deferred: the neutral spec models neither port publishing nor a background-command flag, and no equivalent `backend_extras.msb` is wired. The install+supervise script and the `opencode` wrapper are backend-agnostic; only the port/background plumbing is missing. |
| **ppp** (later) | Not yet | Same gap as msb. |

The one backend-specific dependency is **exposing the in-container ports to the
host** and **running the startup command in the background**. The background hook
is carried through acq's translation; **port publishing** was added to acq's
translator upstream ([quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221)),
but until that fix reaches the pinned patterns kit ref it is a manual
`acq ports … --publish` step. Both live in `backend_extras.sbx` because
`hybrid/v1` does not (yet) model published ports or a background flag. Extending
`openchamber` to `msb`/`ppp` — and adopting the upstream `publishedPorts`
translation (dropping the manual step) — is tracked as a follow-up on
[#233](https://github.com/GSA-TTS/agentic-coding-patterns/issues/233);
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

Because `acq run opencode` runs the bare command `opencode`, the kit's wrapper
takes over: it starts the shared server and offers you a TUI in that terminal.

> **Publish the ports after create.** `acq`'s neutral→sbx translation does **not**
> carry `backend_extras.sbx.publishedPorts`, so creating with this kit does not by
> itself map the container ports to the host. Publish them once, per sandbox:
>
> ```bash
> acq ports <sandbox> --publish 3000:3000    # OpenChamber web UI
> acq ports <sandbox> --publish 4096:4096    # shared opencode server
> ```
>
> (`publishedPorts` in `spec.yaml` documents the intended mapping and is honored
> by a direct sbx-v2 apply, but not by the current acq translator — see
> [backend parity](#backend-parity).)
>
> **On HTTPS-inspected networks (e.g. Zscaler).** OpenChamber's first-boot
> install downloads a prebuilt native binary; behind an inspecting proxy that
> download only validates if the inspection CA is in the sandbox's system trust
> store. Pair this kit with the `zscaler-ca-certificate` kit (part of the default
> GSA setup) so the CA is present. On a non-inspected network the sandbox proxy
> CA alone suffices and no extra kit is needed.

## Reaching it from the host

The kit publishes **container** ports `3000` (OpenChamber) and `4096` (the
shared server), each mapped to an **ephemeral host port on `127.0.0.1`,
allocated per sandbox** — so running this kit in several sandboxes at once is
fine: each gets its own distinct host ports and they don't collide. Find the
assigned ports:

```bash
acq ports <sandbox>        # (sbx ports <sandbox>) — host ports for 3000 and 4096
# OpenChamber:  open http://127.0.0.1:<host-port-for-3000> in a browser
# host TUI:     opencode attach http://127.0.0.1:<host-port-for-4096>
```

Want a **stable** host port (e.g. always `3000`), or want to pin each sandbox to
a different port of your choosing? Publish it explicitly on top of the kit's
declaration:

```bash
sbx ports <sandbox> --publish 3000:3000        # first sandbox → host 3000
sbx ports <other-sandbox> --publish 3001:3000  # second sandbox → host 3001
```

## Session sharing

The `opencode` wrapper's shared server on `:4096` backs **both** the OpenChamber
browser and any attached TUI, so they share **one live, in-flight session** by
default — no extra steps.

If you want to attach a terminal from the host to that same session, don't
launch a fresh TUI — **attach** to the shared server:

```bash
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

(Or just re-run `opencode` inside the sandbox; with no args it reuses the
already-running server and offers to attach.)

## Security note

The shared `opencode serve` and OpenChamber are both bound to `0.0.0.0` and run
**unsecured** (no `OPENCODE_SERVER_PASSWORD`; OpenChamber uses
`OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true`) so the mapped host ports are
usable. This is safe **only because the kit runs inside a sandbox** — an
ephemeral container with a proxied, allow-listed network and no host filesystem
access. The sandbox is the security boundary.

**Assumes a trusted, single-tenant host.** Unlike the previous design, the
shared server is now published to the host (container port `4096` → a host
**loopback** ephemeral port), and it is unauthenticated. The published ports are
loopback-only, so they are not LAN-reachable; but anyone with access to the
host's loopback (any local user, or anything you forward those ports to) can
drive OpenCode without a credential. Only run this on a host you trust as
single-tenant, and don't forward the mapped ports to a wider interface. The
server is started on demand by the wrapper, so it is only live once you've run
`opencode` — not for the whole sandbox lifetime unless you start it.

**Installer supply chain.** The first-boot install fetches OpenChamber's
`install.sh` from a **pinned release tag** (`OPENCHAMBER_REF`) and refuses to run
it unless its SHA-256 matches `OPENCHAMBER_INSTALL_SHA256` — it does not pipe
`main` to a shell on each boot. Bump both values together to adopt a newer
release (see the comments in `spec.yaml` and the startup command).

## Validating

```bash
# 1. Offline gate (always runs): schema + files[].source paths + registry.
#    Needs python3 with jsonschema + pyyaml.
python ../validate-kits.py

# 2. Live end-to-end via acq (preferred). acq translates this neutral kit to an
#    sbx-v2 kit and applies it; the verify script then publishes ports 3000/4096
#    (acq's translator does not carry backend_extras.publishedPorts), runs the
#    wrapper to bring up the shared server, and asserts the wrapper, server,
#    OpenChamber, ports, and supervisor. Set a USAi key first for the :4096 check:
#      acq secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
RUN_ACQ=1 ./scripts/verify
RUN_ACQ=1 KEEP=1 ./scripts/verify     # keep the sandbox to poke at it

# ./scripts/verify with no RUN_* flag runs only the offline gate.
```

> **Why not raw `sbx`?** `sbx` parses the sbx-v2 schema, not the neutral
> `hybrid/v1` spec, so `sbx create --kit <this-kit>` fails with
> `field files not found` / `cannot unmarshal !!seq into CommandsPolicy` /
> `field backend_extras not found`. `acq` does the translation. The verify
> script's `RUN_SBX=1` path therefore requires a *pre-translated* sbx-v2 kit dir
> in `SBX_KIT_DIR` and otherwise SKIPs with guidance — use `RUN_ACQ=1`.

## Layout

```
openchamber/
├── spec.yaml                          # the kit (hybrid/v1: caps, files, startup command, backend_extras)
├── files/home/
│   ├── .local/bin/opencode            # opencode wrapper (owns shared server, offers TUI, passthrough)
│   └── openchamber-start.sh           # install + supervise OpenChamber (dropped into the agent home)
├── README.md                          # this file
├── TROUBLESHOOTING.md                 # failure modes
├── scripts/verify                     # host-side end-to-end check
└── docs/decisions/                    # design records
```
