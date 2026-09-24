# Decision: the startup script owns the daemon; the wrapper pins worktrees and bounces it

**Status:** accepted

## Context

Two requirements pull in different directions:

1. **The daemon/UI should come up on its own** (like `openchamber`), so a single
   `acq create`/`acq run` brings up the web UI with no extra command. That argues
   for the **startup script** owning and supervising the daemon (a `startup`
   command fires on every start, even a detached `acq create`, under the tini
   keepalive).
2. **Worktrees must be pinned to the first project directory** — an absolute path
   only the *entrypoint* knows, because the entrypoint's cwd IS the primary
   workspace on `acq run`. The daemon itself has no "primary project" concept.
   And `worktrees.root` is read only at daemon boot (no HUP; see
   `worktrees-root-global-only.md`).

If the startup script alone started the daemon, it would come up with the default
`$PASEO_HOME/worktrees` root, because at startup time the primary-project cwd is
not reliably known to it — the dependable signal is the wrapper's own `$PWD` (the
entrypoint runs in the primary workspace on `acq run`).

## Decision

**Split the responsibility, and reconcile with a daemon bounce:**

- **The startup script (`paseo-start.sh`) owns the daemon lifecycle.** It installs
  the Paseo CLI on first boot, persists the required daemon settings in
  `config.json`, and supervises `paseo daemon run` in a respawn loop marked
  `supervisor:paseo-daemon`. The daemon comes up immediately with whatever
  `config.json` currently says (default root on first boot).
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
`:6767`. The fallback also clears `paseo.pid` before the shell loop respawns
`paseo daemon run`, avoiding stale-lock races.

The normal `paseo daemon restart` path keeps the outer supervisor and PID lock
intact; the marker-scoped kill is only a recovery fallback.

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
