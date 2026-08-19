# paseo (acq mixin kit, `hybrid/v1`)

Self-hosts [Paseo](https://github.com/getpaseo/paseo) — a browser/mobile/CLI
front-end that orchestrates coding-agent CLIs (Claude Code, Codex, Copilot,
OpenCode, Pi) — inside an `acq` sandbox. This kit runs **only the self-hosted web
UI** in the sandbox and publishes it to the host; the native desktop/mobile apps
are out of scope.

A single Paseo daemon process serves the daemon API, the WebSocket, and the
bundled browser UI, all on **one container port (6767)**.

This kit is **opt-in** (not one of the default GSA kits); you add it explicitly
as shown below.

## Quick start

1. **Set the kit reference** (a full 40-char commit SHA of this repo — branches
   and tags are rejected):

   ```bash
   export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/paseo"
   ```

2. **Start the sandbox with `acq run`** (not `acq create` — see
   [Keep it running](#keep-it-running)):

   ```bash
   acq run opencode /path/to/your/project
   ```

   Leave this terminal open. It pins Paseo's worktree root under your project,
   prints connect instructions, and holds the session open. Closing this terminal
   stops the sandbox.

3. **Open the browser UI.** Find the mapped host port and open it:

   ```bash
   acq ports <sandbox>     # look up the host port mapped to container 6767
   ```

   Open `http://localhost:<host-port-for-6767>`. On first boot, wait a few
   seconds for the one-time Paseo CLI install, then reload.

   > Prefer the `localhost` hostname over `127.0.0.1`. The daemon self-advertises
   > as a local "host" over the same origin (no relay needed), and the web UI keys
   > that local host on `localhost:<port>`. Opening via `127.0.0.1` can leave the
   > UI showing **no hosts** with a repeating `ws://…/ws` reconnect loop — see
   > TROUBLESHOOTING.md "No hosts configured".

That's the whole flow. The daemon and web UI start automatically; you never run a
separate command to bring them up.

## Keep it running

**Use `acq run`, and keep its terminal open.** A session-less sandbox is
auto-stopped shortly after its last session disconnects. `acq run` holds a session
for as long as its terminal is attached, which is what keeps the sandbox — and the
Paseo web UI — alive.

A detached `acq create` **does not** keep the sandbox running: with nothing
attached it is auto-stopped soon after. You may still use `acq create` to
pre-create a sandbox, but you must then `acq run --name <sandbox>` to actually use
it.

If you don't want to tie up your working terminal, run `acq run` in a separate
terminal tab or a `tmux`/`screen` window and leave it attached.

## Reaching it from the host

The kit exposes **container** port `6767` (the Paseo daemon API + WebSocket +
bundled web UI), declared via the neutral `publishedPorts` field in `spec.yaml`.
`acq` publishes it to an **ephemeral `127.0.0.1` host port per sandbox** at create
time, so several sandboxes running this kit at once don't collide. Look up the
mapping:

```bash
acq ports <sandbox>
# Paseo web UI:  open http://localhost:<host-port-for-6767> in a browser
```

Prefer the `localhost` hostname over `127.0.0.1` — the web UI keys its
self-advertised local daemon on `localhost:<port>`, so a `127.0.0.1` address bar
can leave it showing "no hosts" with a `ws://…/ws` reconnect loop (see
TROUBLESHOOTING.md).

Want a **fixed** host port instead of the ephemeral one? Publish it explicitly:

```bash
acq ports <sandbox> --publish 6767:6767          # this sandbox → host 6767
acq ports <other-sandbox> --publish 6868:6767    # another → host 6868
```

## Projects are pre-populated from your mounts

Every **read-write** host directory you mount into the sandbox is registered with
the Paseo daemon at startup, so the web UI already lists your repos when you
connect — no manual **Add project** per directory. This runs on every start
(idempotent) and covers all mounts, not just the primary one the `acq run`
entrypoint opens.

- **Read-only mounts are skipped.**
- The backend runtime dir (`/.msb`) and system mounts (`/etc`, `/run`, …) are
  excluded.
- Discovery reads `/proc/mounts` and keys only on portable mount properties
  (fstype `virtiofs`, read-write, a real directory, non-system path, non-dot
  basename), so it works on both the `sbx` and `msb` isolation backends without
  relying on backend-specific mount names.
- It is **fail-open**: if the daemon is briefly unreachable, the sandbox is
  unaffected and the UI simply shows fewer projects until the next start. See the
  registrar log at `~/.local/state/paseo/paseo-register.log`.

This is separate from worktree placement below — pre-population only adds
projects; it never edits `config.json` / `worktrees.root`. See
`docs/decisions/prepopulate-projects-from-mounts.md`.

## Worktrees

Paseo keeps agent git worktrees under a **single global root**
(`worktrees.root` in `$PASEO_HOME/config.json`), laid out
`<root>/<projectHash>/<slug>`. Paseo has **no per-project worktree root**, and a
*relative* root is resolved against `PASEO_HOME` (not your project) — so keeping
worktrees inside each project directory is not natively possible.

This kit does the best achievable thing: it pins the one global root to a
subdirectory of the **first mounted project directory**. When you run the
`opencode` wrapper on the `acq run` path (whose working directory is that primary
workspace), the kit shim writes `worktrees.root = <your-project>/.paseo-worktrees`
into `config.json` and **restarts the daemon** so the change takes effect (Paseo
reads `worktrees.root` only at daemon startup — there is no signal to reread it).
Before you run it once, worktrees default to `$PASEO_HOME/worktrees`.

To override the location, pre-set `worktrees.root` to an absolute path in
`config.json`; the shim only rewrites it when the value actually differs from
`<primary-project>/.paseo-worktrees`, so a manual absolute value you set will be
replaced on the next run — set it via the entrypoint's working directory instead,
or remove the shim's pinning if you need a custom fixed root.

## No shared session with a terminal TUI

Unlike a shared-server setup (e.g. the `openchamber` kit), Paseo is **not** an
OpenCode server — it launches its own agent CLIs (OpenCode among them) as child
processes. There is therefore **no shared live session** between a terminal TUI
and Paseo, and no separate "raw server" port to attach a TUI to. Drive agents
through the browser UI. Running `opencode <args…>` in the sandbox still works
(the wrapper passes it through to the real opencode), so opencode remains usable
as one of Paseo's provider CLIs.

> **Enabling this kit shadows `opencode` in-sandbox.** The kit drops a thin
> `opencode` wrapper at `~/.local/bin/opencode` (first on PATH) that shadows the
> real binary for **all** in-sandbox invocations. Calls with arguments pass
> straight through to the real opencode unchanged, so normal flows (including
> Paseo spawning `opencode` as a provider CLI) are unaffected; only a **no-arg**
> `opencode` is redirected to the kit shim (pin worktree root, hold PID 1). This
> applies only inside a sandbox with the kit enabled — it does not touch your host
> opencode.

## HTTPS-inspected networks (e.g. Zscaler)

Paseo's first-boot install is a plain `npm install -g @getpaseo/cli`. Behind an
inspecting proxy, npm/Node need the inspection CA in the sandbox's trust store.
Pair this kit with the `zscaler-ca-certificate` kit (part of the default GSA
setup); the startup script folds both the sandbox proxy CA (`PROXY_CA_CERT_B64`)
and the system trust store into `NODE_EXTRA_CA_CERTS`. On a non-inspected network
no extra kit is needed.

## Security

The Paseo daemon runs **unsecured** (no `PASEO_PASSWORD`) and is bound to
**`0.0.0.0` (all interfaces)** inside the sandbox. This is safe **only because the
sandbox is the security boundary** — an ephemeral container with a proxied,
allow-listed network and no host filesystem access. The in-guest `0.0.0.0` bind is
required for reachability: `acq`'s create-time port publish (msb `-p HOST:GUEST`)
binds a **host loopback** listener but dials the sandbox's **guest network IP**,
not guest `127.0.0.1`, so a loopback-only in-guest bind would answer inside the
sandbox yet return "Empty reply from server" on the published host port. See
[GSA-TTS/agentic-coding-quickstart#333](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/333).

**Run this only on a trusted, single-tenant host.** The daemon is published to a
host **loopback** port and is live for the sandbox's whole lifetime. Loopback
ports are not LAN-reachable, but anyone with access to the host's loopback (any
local user, or anything you forward that port to) can drive Paseo — and the
agents it launches — without a credential. Don't forward the mapped port to a
wider interface.

> The host-side loopback guarantee depends on `acq` publishing the guest
> `6767` daemon port to a loopback-scoped host port, which it does at
> create time from the kit's neutral `publishedPorts`. (The guest daemon itself
> binds `0.0.0.0:6767` so the create-time publish can reach it — see the Fig.
> in quickstart#333 — but the HOST side of the mapping stays loopback-only.)
>
> Paseo's bundled web UI static files are public on the daemon origin; the daemon
> API and WebSocket would be password-protected if `PASEO_PASSWORD` were set. We
> leave it unset by design (see above) — the sandbox boundary is the control.

## Backend support

`acq` selects and abstracts the isolation backend, so this kit is written entirely
in the neutral `hybrid/v1` vocabulary (`caps`, `files`, `commands`,
`publishedPorts`, `environment`) — nothing here is backend-specific. It uses no
`backend_shortcuts` or `backend_extras`, so it runs on whatever backends `acq`
supports. See the [`kits.yaml`](../kits.yaml) registry for the current
backend-parity summary.

## Validating

```bash
# Offline gate (schema + file paths + registry). Needs python3 + jsonschema + pyyaml.
python ../validate-kits.py

# Live end-to-end via acq (translates + applies the kit, publishes the port, and
# asserts the wrapper, the daemon + web UI, the port, the supervisor, the PID-1
# hold, daemon self-heal, and the worktree-root pin).
RUN_ACQ=1 ./scripts/verify

# Keep the sandbox afterward to inspect it:
KEEP=1 RUN_ACQ=1 ./scripts/verify
```

Validate and drive the kit through `acq`, which translates the neutral
`hybrid/v1` spec for the active backend and applies it.

## Layout

```text
paseo/
├── spec.yaml                       # the kit (caps, files, startup command, publishedPorts, env)
├── files/home/
│   ├── .local/bin/opencode         # thin agent-named wrapper: passthrough to real opencode, else exec the shim
│   ├── paseo-agent-shim            # generic kit logic: pins worktree root, prints connect info, holds PID 1 on acq run
│   ├── paseo-start.sh              # installs + supervises the Paseo daemon + web UI; runs the mount registrar
│   ├── paseo-set-worktrees-root.mjs # idempotent worktrees.root merge into config.json
│   └── paseo-register-mounts.mjs   # registers each read-write host mount as a Paseo project (fail-open, idempotent)
├── README.md                       # this file
├── TROUBLESHOOTING.md              # failure modes and fixes
├── scripts/verify                  # host-side live check
└── docs/decisions/                 # design records (ADRs)
```

## Design records

Rationale and the decisions behind this kit's structure live in
[`docs/decisions/`](docs/decisions/) — notably why one daemon serves everything
on a single port, why worktrees can only be pinned to the first project dir (and
why that needs a daemon restart), why the startup script owns the daemon while
the entrypoint pins worktrees, why the install runs at startup, and why the
entrypoint is split into a thin agent-named wrapper over a generic kit shim.
