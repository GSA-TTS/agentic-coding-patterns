---
title: Paseo acq mixin kit
description: Self-hosted Paseo daemon and browser UI in an acq sandbox
status: draft
tier: 2
last_updated: "2026-10-22"
---

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

2. **Start the sandbox with `acq run`** for a held PID-1 session, or use
   detached `acq create` if your backend provides a keepalive (see
   [Keep it running](#keep-it-running)):

   ```bash
   acq run opencode /path/to/your/project
   ```

    On a PID-1 entrypoint, leave this terminal open: the shim pins Paseo's
    worktree root, prints connect instructions, and holds that session open.

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

## Opt-in startup timing

### Guest CLI availability

After finding an executable CLI, startup publishes a symlink at
`$HOME/.local/bin/paseo`, preferring the kit's per-user npm installation over
the default npm prefix. This directory is already on the supported image PATH
for the OpenCode wrapper. The link preserves arguments, exit status, and package
realpath resolution without adding a wrapper process. Publication runs on every
startup, including resumes that skip installation.

The kit records its link target in the Paseo state directory as
`paseo-cli-link-target`. It repairs a changed target only when the existing
symlink still matches that receipt. Foreign files, directories, or links are
preserved with a notice. Publication failures produce a warning and do not stop
daemon startup. No shell profiles or PATH values are replaced. Shells that
deliberately omit `~/.local/bin` still need the absolute executable path.

On a fresh install the public command appears only after an executable exists.
An early attach can still encounter a missing CLI. After publication, including
warm resumes, the shim's restart request can actually execute instead of failing
command lookup. Compare that lifecycle separately from artifact-lookup timings.

### Timing records

To separate restart, supervisor backoff, API polling, and UI asset-check costs,
apply the local kit together with its **environment-only diagnostic overlay**
at `diagnostics/timing`. Replace any configured remote Paseo extra-kit reference
with the local kit; do not apply both copies. Add the overlay as a second extra
kit. It declares `environment: {PASEO_KIT_TIMING: "1"}` so both startup commands
and the attach shim inherit the flag. Merely exporting the flag on the host does
not inject it into the guest. The normal kit does not enable timing.

Each record has exactly this format:

```text
PASEO_KIT_TIMING v1 event=shim_begin uptime_s=123.45 rc=0
```

`uptime_s` is Linux guest `/proc/uptime` (including suspend), read using shell
builtins. Compare records within the same guest boot; do not subtract host wall
clock timestamps. `rc` is a numeric status, not output from a command. Begin
markers and branch markers use zero. End markers report a command or predicate
status where checked; `ui_find_end` only marks completion of the existing search
pipeline, not proof that an artifact was found. `restart_end` can also report a
failed CLI lookup. `shim_end` marks completion before the PID-1 hold or exit.

Records go to stderr and append to the dedicated guest file
`$HOME/.local/state/paseo/paseo-timing.log` (normally
`/home/agent/.local/state/paseo/paseo-timing.log`). Supervisor stderr is redirected
to its existing daemon log; use the **dedicated timing file** to collect those
records without retaining daemon output. The file contains fixed labels and
numbers only. Collection must still validate complete lines against the format
and event allowlist below, and persist only accepted records. Use a fresh
diagnostic sandbox to avoid mixing boots or runs in this append-only file.

Event allowlist:

```text
startup_begin startup_path_done version_begin version_end install_begin install_end
config_begin config_end supervisor_spawn supervisor_existing
daemon_launch daemon_exit backoff_begin backoff_end
shim_begin root_begin root_changed root_unchanged root_error root_end
restart_begin restart_end fallback_begin fallback_kill_sent fallback_end
health_wait_begin health_probe_begin health_probe_end health_wait_end
ui_wait_begin ui_probe_begin ui_health_begin ui_health_end
ui_index_begin ui_index_end ui_find_begin ui_find_end
ui_bundle_begin ui_bundle_end ui_size_begin ui_size_end ui_probe_end ui_wait_end shim_end
```

Timing does not alter restart delays, retry counts, curl options, or readiness
predicates. A readiness marker reports the existing predicate's result; it does
not independently prove the new daemon generation loaded the worktree setting,
or that host forwarding and the browser work. Markers add small diagnostic I/O
costs, so compare opt-in measurements with that limitation in mind.

The UI artifact lookup first checks the executable at
`$HOME/.npm-global/bin/paseo`, then falls back to the inherited PATH. Startup's
per-user PATH addition is process-local and does not reach the attach shim; this
explicit lookup works without changing PATH or restart-command behavior. It
resolves the executable to its npm package. For the `@getpaseo/cli/bin/paseo`
layout, it checks the exact hashed `.br`
file in the nested `@getpaseo/server/dist/server/web-ui` dependency, or the
same-prefix sibling server package when no nested server directory exists. This
avoids walking unrelated filesystems on the recognized layout. Unknown layouts,
missing artifacts, and unreadable artifacts retain the original filesystem-wide
search. A nested server with a missing artifact does not select a hoisted copy
as a fast-path substitute. The Brotli fetch and exact on-disk byte comparison
remain unchanged. `ui_find_begin` / `ui_find_end` time the entire lookup, including
the compatibility search when needed. No artifact location or size is cached.

Local tests use stub commands, never real services:

```bash
node --test integrations/isolation/acq-kits/paseo/tests/paseo-timing.test.mjs
```

## Keep it running

On a backend that runs the wrapper as **PID 1**, `acq run` holds its terminal
open so the sandbox and Paseo web UI stay up. A detached `acq create` can instead
use its own keepalive process and run the startup-supervised daemon without an
attached terminal; check `acq ls` and `acq ports <sandbox>` before assuming it
stopped. The wrapper's PID-1 hold is not a prerequisite for a detached sandbox.

If you don't want to tie up your working terminal, run `acq run` in a separate
terminal tab or a `tmux`/`screen` window and leave it attached.

## Reaching it from the host

The kit exposes **container** port `6767` (the Paseo daemon API + WebSocket +
bundled web UI), declared via the neutral `publishedPorts` field in `spec.yaml`.
`acq` publishes it to a host-loopback port at create time. Allocation is
backend-dependent: one MSB build maps guest 6767 to host 6767, so a second
listener can collide; other backends may allocate an ephemeral port. Look up
the actual mapping rather than assuming multiple sandboxes never collide:

```bash
acq ports <sandbox>
# Paseo web UI:  open http://localhost:<host-port-for-6767> in a browser
```

Prefer the `localhost` hostname over `127.0.0.1` — the web UI keys its
self-advertised local daemon on `localhost:<port>`, so a `127.0.0.1` address bar
can leave it showing "no hosts" with a `ws://…/ws` reconnect loop (see
TROUBLESHOOTING.md).

Need a **different** host port? Publish it explicitly if the backend supports
remapping; this is a separate transport from the create-time mapping that the
verifier checks:

```bash
acq ports <sandbox> --publish 6767:6767          # this sandbox → host 6767
acq ports <other-sandbox> --publish 6868:6767    # another → host 6868
```

## Projects are pre-populated from your mounts

Every **read-write** host directory you mount into the sandbox is inspected at
startup, so the web UI already lists your repos when you connect — no manual
**Add project** per directory. This runs on every start (idempotent) and covers
all mounts, not just the primary one the `acq run` entrypoint opens.

- **Read-only mounts are skipped.**
- A mount that is itself a Git repo is registered as that project.
- A plain parent-directory mount with direct child Git repos registers those
  child repos instead of the parent. This scan is intentionally shallow (direct
  children only), follows direct-child symlinks that resolve to directories, and
  `.git` may be either a directory or a file.
- A mount with no direct child Git repos falls back to registering the mount
  itself, preserving support for non-git working directories.
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

Startup can seed an absent config with a root beneath the **primary guest
workspace**, using `ACQ_WORKSPACE` before installation. Initialization preserves
every existing config entry. The `opencode` wrapper's shim then reconciles
`worktrees.root` with `<physical-attach-directory>/.paseo-worktrees` only when
the wrapper is the PID-1 entrypoint, and restarts the daemon worker only if the
value changes. A bare `opencode` typed in a shell does not repin it. See
[the lifecycle decision](docs/decisions/supervisor-owns-daemon-wrapper-pins-worktrees.md).

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
> `opencode` is redirected to the kit shim only at PID 1 (pin worktree root,
> hold the sandbox open). Outside PID 1 it opens the real OpenCode TUI. This
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
# hold's source structure (live PID-1 hold requires a separate interactive
# sandbox run), daemon self-heal, and the startup worktree-root value).
RUN_ACQ=1 ./scripts/verify

# The default detached verifier exits 3 when checks are skipped or unverified;
# exit 0 means all applicable measured checks passed. A live run still cannot
# demonstrate the PID-1 hold or real TUI routing without a separate interactive
# sandbox observation. Exit 1 means a measured check failed.

# Keep the sandbox afterward to inspect it:
KEEP=1 RUN_ACQ=1 ./scripts/verify

# Identity gate (read-only): assert the host-published port and `acq exec` reach
# the SAME daemon. Run this when the UI looks healthy but behaves like a
# different machine — missing agents/workspaces, or provider calls failing with
# "Authentication failed".
./scripts/paseo-verify-identity <sandbox>
```

Validate and drive the kit through `acq`, which translates the neutral
`hybrid/v1` spec for the active backend and applies it.

## Layout

```text
paseo/
├── spec.yaml                       # the kit (caps, files, startup command, publishedPorts, env)
├── files/home/
│   ├── .local/bin/opencode         # thin wrapper: real TUI outside PID 1, kit shim at PID 1
│   ├── paseo-agent-shim            # generic kit logic: pins worktree root, prints connect info, holds PID 1 on acq run
│   ├── paseo-start.sh              # installs + supervises the Paseo daemon + web UI; runs the mount registrar
│   ├── paseo-set-worktrees-root.mjs # idempotent worktrees.root merge into config.json
│   └── paseo-register-mounts.mjs   # registers each read-write host mount as a Paseo project (fail-open, idempotent)
├── README.md                       # this file
├── TROUBLESHOOTING.md              # failure modes and fixes
├── scripts/verify                  # host-side live check
├── scripts/paseo-verify-identity   # host-side identity gate: published port vs `acq exec`
└── docs/decisions/                 # design records (ADRs)
```

## Design records

Rationale and the decisions behind this kit's structure live in
[`docs/decisions/`](docs/decisions/) — notably why one daemon serves everything
on a single port, why worktrees can only be pinned to the first project dir (and
why that needs a daemon restart), why the startup script owns the daemon while
the entrypoint pins worktrees, why the install runs at startup, why the
entrypoint is split into a thin agent-named wrapper over a generic kit shim, and
why readiness is gated on daemon *identity* and not just reachability.
