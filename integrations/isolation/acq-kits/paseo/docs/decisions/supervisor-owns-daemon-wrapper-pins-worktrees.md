---
title: Startup owns the daemon; attach reconciles the worktree root
description: Initialize the primary root early and restart only when attach changes it
status: canonical
tier: 2
last_updated: "2026-10-23"
---

# Decision: the startup script owns the daemon; the wrapper pins worktrees and bounces it

**Status:** accepted

## Context

Two requirements pull in different directions:

1. **The daemon/UI should come up on its own** (like `openchamber`), so a single
   `acq create`/`acq run` brings up the web UI with no extra command. That argues
   for the **startup script** owning and supervising the daemon (a `startup`
   command fires on every start, even a detached `acq create`, under the tini
   keepalive).
2. **Worktrees must be pinned to the selected project directory.** ACQ exports
   the primary guest mount as `ACQ_WORKSPACE`; the entrypoint's cwd can differ
   when the operator overrides the attach directory. The daemon itself has no
   "primary project" concept.
   And `worktrees.root` is read only at daemon boot (no HUP; see
   `worktrees-root-global-only.md`).

Startup can initialize the primary root from that explicit guest marker. It
cannot overwrite existing settings on resume: the daemon may already be using a
different project root. The wrapper's physical cwd remains authoritative for
each attach.

## Decision

**Split the responsibility, and reconcile with a daemon bounce:**

- **The startup script (`paseo-start.sh`) owns the daemon lifecycle.** It installs
  the Paseo CLI on first boot, persists the required daemon settings in
  `config.json`, and supervises `paseo daemon run` in a respawn loop marked
  `supervisor:paseo-daemon`. The daemon comes up immediately with whatever
  `config.json` currently says. Before npm work, startup optionally seeds an
  absent config from the physical `ACQ_WORKSPACE` directory, using the helper's
  `--initialize-only` mode and the same config lock. The initialization step
  preserves any existing config entry
  (including an empty/invalid file, directory, or dangling symlink).
  Missing/invalid workspace or ambiguous home disables this optional
  step. No lock is held across npm installation and no nested lock is acquired.
- **The entrypoint pins the worktree root.** On `acq run` the thin wrapper
  (`~/.local/bin/opencode`) execs the generic shim (`~/paseo-agent-shim`), which
  runs in the primary-workspace cwd, computes `<PWD>/.paseo-worktrees`, and writes
  it to `config.json`. **If the value changed**, it restarts the daemon worker so
  the new root takes effect. (The pin/restart lives in the shim; see
  `paseo-mixin-generic-wrapper.md` for the wrapper/shim split.)

### The bounce mechanism (why it's safe)

The process tree is:

```
sh -c  (marker: supervisor:paseo-daemon)     ← the startup script's respawn loop
 └─ paseo daemon run                         ← node CLI
     └─ node supervisor-entrypoint.js        ← "Paseo Supervisor"; holds $PASEO_HOME/paseo.pid
         └─ node daemon-worker.js            ← the listener on :6767 (SIGTERM = graceful)
```

The wrapper first uses `paseo daemon restart`, which asks Paseo's own supervisor
to restart the worker and re-read `config.json`. If that command cannot run, the
fallback kills PIDs whose argv matches `paseo daemon run` **but do NOT carry the
`supervisor:paseo-daemon` marker** — i.e. the Paseo-owned tree, never our shell
respawn loop. `kill` (SIGTERM) lets `daemon-worker` shut down gracefully and free
`:6767`. The fallback clears `paseo.pid` only after it actually kills a daemon
process, so it does not delete a live worker's lock during ordinary respawn.

The normal `paseo daemon restart` path keeps the outer supervisor and PID lock
intact; the marker-scoped kill is only a recovery fallback. Both startup config
writes and wrapper worktree-root writes use the same coarse config lock before
modifying `$PASEO_HOME/config.json`.

## Alternatives considered

- **Wrapper starts+supervises the daemon (no startup script).** Rejected: then a
  detached `acq create` with nobody running the wrapper would have no daemon — the
  UI would not come up on its own.
- **Startup script waits for the wrapper to publish the project path, then starts
  the daemon.** Rejected as more fragile: it couples daemon startup to an
  interactive action that may never happen (detached create), so the UI could
  hang "coming up" forever. Starting immediately + bouncing on change keeps the
  UI available in every path and only pays a restart when a project is actually
  opened via `acq run`.

## Consequences

- When early initialization wins, normal attach sees `unchanged` and avoids a
  premature restart while npm is still installing. If attach wins, its existing
  change/restart behavior remains. There is no launch-ownership claim or guarantee
  that every cold restart attempt disappears.
- Both paths retain the same readiness allowance: up to 30 health probes with
  one-second sleeps after failures, followed by the initial UI probe and up to
  60 UI retries with one-second sleeps after failures. An already-healthy daemon
  passes the health stage on its first probe. These are bounded attempt counts,
  not a strict wall-clock deadline; command runtimes add time. Avoiding a restart
  must not remove the initial health allowance. UI success still requires the
  existing complete-bundle checks. A detached shim intentionally exits zero even
  when readiness is exhausted; `ui_wait_end rc=1` reports that failure separately.
- The marker names the primary guest mount, including a disposable clone's guest
  path. Secondary mounts are ignored. An overridden attach cwd can still require
  a different root and restart. Startup never resets a warm configuration to the
  primary root.

- The UI is available after `acq create`/`acq run` with no manual step.
- Opening a project via `acq run` pins its worktree root and triggers exactly one
  daemon bounce (idempotent; no bounce if unchanged).
- Two independent "supervisors" exist conceptually — our shell respawn loop and
  Paseo's own `supervisor-entrypoint.js` — but they nest cleanly (ours respawns
  the whole `paseo daemon run` tree; Paseo's manages the worker within one run).
  The fallback kill is marker-scoped so our loop is never the target.

## Links

- `worktrees-root-global-only.md` — why the root needs a restart to change.
- `paseo-single-port-daemon.md` — the single-process/one-port model.
- `../../../paseo/files/home/paseo-start.sh`,
  `../../../paseo/files/home/.local/bin/opencode`.
