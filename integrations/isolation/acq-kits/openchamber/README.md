# openchamber (acq mixin kit, `hybrid/v1`)

Runs [OpenChamber](https://github.com/openchamber/openchamber) — a browser UI
for OpenCode — inside an `acq` sandbox. One shared OpenCode server backs both the
browser UI and an optional terminal TUI, so they share a single live session.

This kit is **opt-in** (not one of the default GSA kits); you add it explicitly
as shown below.

## Quick start

1. **Set the kit reference** (a full 40-char commit SHA of this repo — branches
   and tags are rejected):

   ```bash
   export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/openchamber"
   ```

2. **Start the sandbox with `acq run`** (not `acq create` — see
   [Keep it running](#keep-it-running)):

   ```bash
   acq run opencode /path/to/your/project
   ```

   Leave this terminal open. It prints connect instructions and offers a TUI in
   the terminal; the browser UI works whether or not you take the TUI. Closing
   this terminal stops the sandbox.

3. **Open the browser UI.** Find the mapped host port and open it:

   ```bash
   acq ports <sandbox>     # look up the host port mapped to container 3000
   ```

   Open `http://127.0.0.1:<host-port-for-3000>`. On first boot, wait a few
   seconds for the one-time OpenChamber install, then reload.

That's the whole flow. The shared server and OpenChamber start automatically; you
never run a separate command to bring them up.

## Keep it running

**Use `acq run`, and keep its terminal open.** sbx auto-stops a sandbox ~30
seconds after its last session disconnects, and there is no setting to disable or
extend that. `acq run` holds a session for as long as its terminal is attached,
which is what keeps the sandbox — and the browser UI — alive.

A detached `acq create` **does not** keep the sandbox running: with nothing
attached it is auto-stopped ~30s later, and the browser then fails with *"The
running turn was stopped before OpenCode could send the next message."* You may
still use `acq create` to pre-create a sandbox, but you must then `acq run
--name <sandbox>` to actually use it.

If you don't want to tie up your working terminal, run `acq run` in a separate
terminal tab or a `tmux`/`screen` window and leave it attached.

> Why the sandbox behaves this way (and why the kit is structured around it) is
> recorded in
> [`docs/decisions/startup-owns-shared-server.md`](docs/decisions/startup-owns-shared-server.md).

## Reaching it from the host

The kit exposes **container** port `3000` (OpenChamber UI) and `4096` (the shared
OpenCode server). A current `acq` publishes both to an **ephemeral `127.0.0.1`
host port per sandbox** at create time, so several sandboxes running this kit at
once don't collide. Look up the mapping:

```bash
acq ports <sandbox>
# OpenChamber:  open http://127.0.0.1:<host-port-for-3000> in a browser
# host TUI:     opencode attach http://127.0.0.1:<host-port-for-4096>
```

Want a **fixed** host port instead of the ephemeral one? Publish it explicitly:

```bash
acq ports <sandbox> --publish 3000:3000        # this sandbox → host 3000
acq ports <other-sandbox> --publish 3001:3000  # another → host 3001
```

> On an older `acq` that predates automatic publishing
> ([quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221)),
> the ports are not mapped at create; publish them once per sandbox with the
> `acq ports … --publish` commands above.

## Sharing a session with a terminal

The shared server on `:4096` backs both the browser and any attached TUI, so they
share one live session automatically. To attach a terminal to that same session
from the host:

```bash
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

## HTTPS-inspected networks (e.g. Zscaler)

OpenChamber's first-boot install downloads a prebuilt native binary; behind an
inspecting proxy that download only succeeds if the inspection CA is in the
sandbox's trust store. Pair this kit with the `zscaler-ca-certificate` kit (part
of the default GSA setup). On a non-inspected network no extra kit is needed.

## Security

The shared OpenCode server and OpenChamber run **unsecured** (no server password;
OpenChamber runs with `OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true`) and are bound
to `0.0.0.0` inside the sandbox. This is safe **only because the sandbox is the
security boundary** — an ephemeral container with a proxied, allow-listed network
and no host filesystem access.

**Run this only on a trusted, single-tenant host.** The server is published to a
host **loopback** port and is live for the sandbox's whole lifetime. Loopback
ports are not LAN-reachable, but anyone with access to the host's loopback (any
local user, or anything you forward those ports to) can drive OpenCode without a
credential. Don't forward the mapped ports to a wider interface.

> The loopback-only guarantee depends on `acq` publishing the `0.0.0.0:4096`
> container bind to a loopback-scoped host port (automatic on a current `acq`; on
> an older `acq` you must publish it yourself). Until published loopback-scoped,
> treat the unauthenticated bind as reachable to whatever can route to the
> container.
>
> The installer is pinned and integrity-checked: the first-boot install fetches
> OpenChamber's `install.sh` from a pinned release tag and runs it only if its
> SHA-256 matches the pinned value (`OPENCHAMBER_REF` /
> `OPENCHAMBER_INSTALL_SHA256` in `spec.yaml`).

## Backend support

| Backend | Status |
|---------|--------|
| **sbx** | Supported. |
| **msb**, **ppp** | Not yet — the neutral `hybrid/v1` spec does not model published ports or a background-command flag; both live in `backend_extras.sbx` today. Tracked on [#233](https://github.com/GSA-TTS/agentic-coding-patterns/issues/233). |

## Validating

```bash
# Offline gate (schema + file paths + registry). Needs python3 + jsonschema + pyyaml.
python ../validate-kits.py

# Live end-to-end via acq (translates + applies the kit, publishes ports, and
# asserts the wrapper, shared server, OpenChamber, ports, and supervisors).
# Set a USAi key first for the :4096 check:
#   acq secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
RUN_ACQ=1 ./scripts/verify

# Host-side lifecycle probes (see each script's header):
./scripts/detach-probe               # observes sbx's session-based auto-stop
./scripts/investigate-shell-autostop # A–D auto-stop matrix
```

`sbx` cannot parse the neutral `hybrid/v1` spec directly; `acq` translates it, so
use `RUN_ACQ=1` (the verify script's `RUN_SBX=1` path needs a pre-translated kit
dir and otherwise SKIPs with guidance).

## Layout

```text
openchamber/
├── spec.yaml                  # the kit (caps, files, startup command, backend_extras)
├── files/home/
│   ├── .local/bin/opencode    # opencode wrapper (TUI attach + PID-1 hold on acq run)
│   └── openchamber-start.sh   # installs + supervises the shared server + OpenChamber
├── README.md                  # this file
├── TROUBLESHOOTING.md          # failure modes and fixes
├── scripts/                   # verify + host-side lifecycle probes
└── docs/decisions/            # design records (ADRs)
```

## Design records

Rationale and the decisions behind this kit's structure live in
[`docs/decisions/`](docs/decisions/) — notably why the startup script owns the
shared server, why the install runs at startup, why it's a mixin rather than a
sandbox kit, and how the installer is pinned and verified.
