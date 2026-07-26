# openchamber (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that runs [OpenChamber](https://github.com/openchamber/openchamber) — a
browser UI for OpenCode — inside the sandbox, and ships an `opencode` wrapper so
the browser and an optional terminal TUI share one live OpenCode session. The
shared server and the UI are started by the kit's startup script on every
sandbox start.

> [!IMPORTANT]
> **Use `acq run`, not a detached `acq create` alone.** On sbx (verified on
> v0.35.0), an agent sandbox with **no attached session** is auto-stopped ~30s
> after its last session disconnects — so a detached `acq create` (or any
> sandbox you only `acq exec` into) stops itself about half a minute later,
> taking the shared server on `:4096` with it. The browser then fails with
> *"The running turn was stopped before OpenCode could send the next message."*
> The tini keepalive does **not** prevent this: sbx measures idleness by
> **session connections**, not by whether PID 1 is alive, and there is no sbx
> setting or flag to disable or extend the grace. Keep a session attached with
> `acq run` (see [Usage](#usage) and [`docs/decisions/startup-owns-shared-server.md`](docs/decisions/startup-owns-shared-server.md)).

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
- **An `opencode` wrapper for the interactive path** — the kit drops
  [`files/home/.local/bin/opencode`](files/home/.local/bin/opencode) at
  `~/.local/bin/opencode`, which is **first on the base-image PATH** (ahead of
  the npm-global bin where the real `opencode` lives). On the interactive
  `acq run` path the sandbox entrypoint runs the bare command `opencode`, so it
  runs this wrapper. The wrapper:
  - with **no arguments** — prints host-connect instructions, then (only on an
    interactive terminal) offers to attach a TUI right there. If you attach, the
    TUI runs as a **child** — quitting it returns to the wrapper. After that
    (declined or TUI quit) the wrapper's behavior depends on whether it is
    **PID 1**:
    - **PID 1** (the `acq run` path — the wrapper *is* the sandbox entrypoint):
      it **holds the terminal open**, because returning would exit PID 1 and stop
      the sandbox. It prints a note saying to keep the terminal open, and — if
      you ran `acq run` without meaning to hold a terminal — how to quit and use
      `acq create` instead.
    - **not PID 1** (run from a shell inside the sandbox, or via `acq exec`,
      while a detached `acq create` keeps the sandbox alive): it **exits
      cleanly** and returns your terminal; the startup script keeps the server +
      UI running.
    It does **not** start the server on either branch (the startup script does);
    and
  - with **any arguments** — passes straight through to the real `opencode`
    (`opencode run …`, `opencode auth login`, etc.).

  On a detached `acq create`, PID 1 is a `tini` keepalive shim and the wrapper
  does not run at all. The startup script still brings the server + UI up — but
  note the auto-stop caveat above: a session-less sandbox is stopped ~30s after
  its last session disconnects, so this path alone does not keep OpenChamber
  reachable. Use `acq run` to hold a session.
- **Install + supervise the shared server AND OpenChamber (one script)** — a
  `startup`-phase command runs
  [`files/home/openchamber-start.sh`](files/home/openchamber-start.sh) in the
  background on every sandbox start (including a detached `acq create` with
  nobody attached, held open by the tini keepalive — though such a session-less
  sandbox is auto-stopped ~30s later; see the note at the top). That script:
  1. installs the OpenChamber CLI on first boot (only if missing) from a
     **pinned release tag whose `install.sh` is SHA-256-verified before it
     runs** (`OPENCHAMBER_REF` / `OPENCHAMBER_INSTALL_SHA256`, exported by the
     startup command — not `main`), routing the install through the sandbox
     proxy and trusting the sandbox proxy CA so the prebuilt native binary
     downloads instead of trying to compile; and
  2. supervises a single shared `opencode serve` on `0.0.0.0:4096`
     (`supervisor:opencode-serve`) **and** OpenChamber bound to `0.0.0.0:3000`
     in skip-start mode (`OPENCODE_SKIP_START=true` + `OPENCODE_PORT=4096`,
     `supervisor:openchamber`), so OpenChamber attaches to the shared server.
  The install step no-ops when already done. Each service runs under a tiny
  respawn loop — if it exits (e.g. after an interactive self-update, which needs
  a restart to apply, or a crash) it is restarted after a few seconds
  (`OPENCHAMBER_RESTART_DELAY`, default `5`). No systemd. **Because the startup
  script owns the server, it comes up on its own on every sandbox start — but the
  sandbox must keep an attached session (`acq run`) to stay running; see the
  auto-stop note at the top.**
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
> **The shared server and OpenChamber start on their own.** Both are supervised
> by the startup script, which fires on every sandbox start — including a
> detached `acq create` with nobody attached. You do not need to run `opencode`
> to bring the server up. Reload OpenChamber once the first-boot install
> finishes (a few seconds). **But** a session-less sandbox is auto-stopped ~30s
> after its last session disconnects (see the note at the top), so keep a
> session attached with `acq run` to keep it reachable.

## Backend parity

| Backend | Support | Notes |
|---------|---------|-------|
| **sbx** | Supported | The startup script runs as a background hook, and acq's neutral→sbx translation carries `backend_extras.sbx.publishedPorts` ([quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221), merged), so the two container ports are published to the host at create time — no manual step. |
| **msb** | Not yet | Deferred: the neutral spec models neither port publishing nor a background-command flag, and no equivalent `backend_extras.msb` is wired. The install+supervise script and the `opencode` wrapper are backend-agnostic; only the port/background plumbing is missing. |
| **ppp** (later) | Not yet | Same gap as msb. |

The one backend-specific dependency is **exposing the in-container ports to the
host** and **running the startup command in the background**. The background hook
is carried through acq's translation; **port publishing** is now carried too, as
of acq's translator fix ([quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221),
merged) — so a current `acq` publishes ports 3000/4096 at create time with no
manual step. (If you run an older `acq` that predates that fix, publish them once
per sandbox with `acq ports <sandbox> --publish 3000:3000` / `--publish
4096:4096`.) Both live in `backend_extras.sbx` because `hybrid/v1` does not (yet)
model published ports or a background flag. Extending `openchamber` to
`msb`/`ppp` is tracked as a follow-up on
[#233](https://github.com/GSA-TTS/agentic-coding-patterns/issues/233);
it needs either a neutral port-publish + background vocabulary in `acq` or an
`msb`-native equivalent extra.

## Usage

The kit is applied by remote reference. Apply it as an **extra kit** on top of
the default GSA kits.

### Recommended: `acq run` (holds a session, stays running)

`acq run` attaches a session to the sandbox, which is what keeps it alive — sbx
auto-stops a session-less agent sandbox ~30s after its last session disconnects
(see the note at the top of this README), so this is the path that actually
keeps OpenChamber reachable:

```bash
export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/openchamber"
acq run opencode /path/to/your/project
```

Because `acq run opencode` runs the bare command `opencode`, the kit's wrapper
takes over: it prints host-connect instructions and offers you a TUI in that
terminal (the server is already up, started by the startup script). On this path
the wrapper is the sandbox's PID 1, so after you decline or quit the TUI it
**keeps the terminal open** — keep it open while you use OpenChamber/OpenCode
from your browser; closing it disconnects the session and the sandbox
auto-stops. Find the mapped host ports with `acq ports <sandbox>` and open
`http://127.0.0.1:<host-port-for-3000>`. Wait a few seconds on first boot for the
one-time OpenChamber install.

### `acq create` (detached — NOT sufficient on its own)

> [!WARNING]
> A detached `acq create` alone does **not** keep the sandbox running on sbx: with
> no attached session it is auto-stopped ~30s after the kit-apply step's
> transient session disconnects, and the browser then fails with *"The running
> turn was stopped before OpenCode could send the next message."* The tini
> keepalive does not prevent this (sbx keys auto-stop off session connections,
> not PID 1), and there is no sbx setting/flag to disable or extend the grace.
> Use `acq run` above, which holds a session. `acq create` is still useful to
> pre-create/apply the kit, but you must then attach with `acq run` to use it.

```bash
export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/openchamber"
acq create --name <sandbox> opencode /path/to/your/project
acq run --name <sandbox>   # attach a session so it stays running
```

> **`acq create` prints no connect banner.** The wrapper's "Connect from your
> HOST" instructions only print when the wrapper *runs* (the `acq run` path
> above). After a detached `acq create` the wrapper does not run, so use
> `acq ports <sandbox>` to discover the mapped host ports (see
> [Reaching it from the host](#reaching-it-from-the-host)).

`GSA-TTS/` is already in the default kit-source allowlist, so no
`ACQ_EXTRA_KIT_SOURCES` change is needed. `<sha>` must be a full 40-character
commit SHA of this repo (branches and tags are rejected for git kit refs).

> **Ports are published at create time.** A current `acq` carries the kit's
> `backend_extras.sbx.publishedPorts` through translation
> ([quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221),
> merged), so both container ports are mapped to the host **loopback** on create.
> If you're on an older `acq` that predates that fix, map them once per sandbox:
>
> ```bash
> acq ports <sandbox> --publish 3000:3000    # OpenChamber web UI
> acq ports <sandbox> --publish 4096:4096    # shared opencode server
> ```
>
> (`publishedPorts` in `spec.yaml` is the source of that mapping — see
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
acq ports <sandbox>        # host ports for 3000 and 4096
# OpenChamber:  open http://127.0.0.1:<host-port-for-3000> in a browser
# host TUI:     opencode attach http://127.0.0.1:<host-port-for-4096>
```

Want a **stable** host port (e.g. always `3000`), or want to pin each sandbox to
a different port of your choosing? Publish it explicitly on top of the kit's
declaration:

```bash
acq ports <sandbox> --publish 3000:3000        # first sandbox → host 3000
acq ports <other-sandbox> --publish 3001:3000  # second sandbox → host 3001
```

## Session sharing

The startup script's shared server on `:4096` backs **both** the OpenChamber
browser and any attached TUI, so they share **one live, in-flight session** by
default — no extra steps.

If you want to attach a terminal from the host to that same session, don't
launch a fresh TUI — **attach** to the shared server:

```bash
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

(Or run `opencode` inside the sandbox; with no args it reuses the
already-running server and offers to attach.)

## Security note

The shared `opencode serve` and OpenChamber are both bound to `0.0.0.0` and run
**unsecured** (no `OPENCODE_SERVER_PASSWORD`; OpenChamber uses
`OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true`) so the mapped host ports are
usable. This is safe **only because the kit runs inside a sandbox** — an
ephemeral container with a proxied, allow-listed network and no host filesystem
access. The sandbox is the security boundary.

**Assumes a trusted, single-tenant host.** The shared server is published to the
host (container port `4096` → a host **loopback** ephemeral port), it is
unauthenticated, and — because the startup script supervises it — it is
**live for the whole lifetime of the sandbox**, from first boot, even if you
never open the UI or attach a TUI. (This is a change from the previous
on-demand design, where the server only started when you ran `opencode`.) The
published ports are loopback-only, so they are not LAN-reachable; but anyone with
access to the host's loopback (any local user, or anything you forward those
ports to) can drive OpenCode without a credential. Only run this on a host you
trust as single-tenant, and don't forward the mapped ports to a wider interface.

**The loopback-only guarantee depends on the acq port-publish translation.** The
"host **loopback** only" claim holds only because the backend publishes the
`0.0.0.0:4096` container bind to a loopback-scoped host port. That mapping is
carried by acq's `backend_extras.sbx.publishedPorts` translation, added in
[quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221)
(merged). On an **older `acq`** that predates that fix, the ports are **not**
auto-published — you must publish them yourself (`acq ports <sandbox> --publish
4096:4096`), and acq maps published ports to `127.0.0.1` per sandbox. Until the
ports are published loopback-scoped, treat the unauthenticated `0.0.0.0` bind as
reachable to whatever can route to the container, and don't expose it.

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
#    sbx-v2 kit and applies it, carrying backend_extras.sbx.publishedPorts
#    (quickstart#221) so ports 3000/4096 publish at create time; the verify
#    script confirms that and asserts the wrapper, the startup-supervised shared
#    server, OpenChamber, ports, and both respawn supervisors. Set a USAi key
#    first for the :4096 check:
#      acq secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
RUN_ACQ=1 ./scripts/verify
RUN_ACQ=1 KEEP=1 ./scripts/verify     # keep the sandbox to poke at it

# ./scripts/verify with no RUN_* flag runs only the offline gate.

# Probe sbx's session-based auto-stop on your host (no attach): a detached
# create + one exec is auto-stopped ~30s after the session disconnects. The
# probe watches longer than the grace so it observes the stop (HOLD_SECONDS=90).
./scripts/detach-probe
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
│   ├── .local/bin/opencode            # opencode wrapper (offers TUI, holds PID 1 on acq run, passthrough)
│   └── openchamber-start.sh           # install + supervise the shared server + OpenChamber
├── README.md                          # this file
├── TROUBLESHOOTING.md                 # failure modes
├── scripts/verify                     # host-side end-to-end check
├── scripts/detach-probe               # host-side probe: terminal-free premise
└── docs/decisions/                    # design records
```
