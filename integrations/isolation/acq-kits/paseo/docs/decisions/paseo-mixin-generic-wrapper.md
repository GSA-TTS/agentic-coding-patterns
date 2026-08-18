# Decision: a thin agent-named wrapper over a generic shim (PID-1 hold), not opencode-coupled

**Status:** accepted

## Context

On the acq opencode base image the entrypoint runs the bare command `opencode`,
and `~/.local/bin` is first on PATH — so a file dropped at
`~/.local/bin/opencode` **shadows** the real binary and becomes the entrypoint on
the interactive `acq run` path. The `openchamber` kit exploits this to own a
shared server and hold PID 1 (see its `wrapper-entrypoint-owns-server.md`).

Two forces shape this kit's entrypoint:

1. **Keep the sandbox alive on `acq run`.** A Docker sandbox is "running" only
   while PID 1 is alive. Because the entrypoint IS PID 1 on `acq run`, a no-arg
   path that returns would stop the sandbox (and the Paseo daemon/UI with it).
   This is the same PID-1 discipline openchamber established; we keep it.
2. **Minimize opencode coupling.** This kit should be reusable with other coding
   agents. Paseo is agent-agnostic (it launches Claude Code, Codex, Copilot,
   OpenCode, Pi), and the daemon needs nothing opencode-specific.

## Decision

**Split the entrypoint into a thin, agent-named wrapper over a generic,
agent-neutral shim.**

- **Thin wrapper** (`~/.local/bin/opencode`) — the ONLY agent-specific file:
  - **With arguments:** `exec`s the real opencode unchanged.
  - **With no arguments:** `exec`s the generic shim (`~/paseo-agent-shim`).
- **Generic shim** (`~/paseo-agent-shim`) — knows nothing about any agent. It
  pins Paseo's worktree root to `<PWD>/.paseo-worktrees` (see
  `worktrees-root-global-only.md`), prints host-connect instructions, then
  discriminates on `$$`:
  - **PID 1** (the `acq run` entrypoint): `hold_pid1` — block forever so the
    session's sandbox stays up.
  - **not PID 1** (a shell / `acq exec`, with a detached `acq create` holding the
    sandbox): exit cleanly and return the terminal.
  - Offers **no** TUI attach — there is no shared Paseo session to attach to
    (`paseo-single-port-daemon.md`).

### The wrapper must `exec` the shim (not call it)

The PID-1 hold works because the shim inherits the wrapper's process id: when the
wrapper was the sandbox entrypoint (PID 1), `exec`ing the shim makes the shim
PID 1, so its `$$ -eq 1` branch fires and the hold keeps the sandbox alive.
Running the shim as a child would give it a non-1 pid and the hold would never
trigger. The verify script asserts the wrapper `exec`s the shim, and that the
shim carries the `$$ -eq 1` check + `hold_pid1`.

## Why passthrough cannot be dropped

An earlier draft speculated that if acq exposed the primary-workspace path via a
marker or env var, "even the passthrough could be dropped." That is **not
correct**, for two independent reasons:

1. **Passthrough is not about discovering the workspace.** The shim already
   learns the primary-workspace path from its own **cwd**, which equals the first
   mounted workspace on every acq backend (the agent entrypoint is launched
   there — sbx via the container's configured WorkingDir, msb via an explicit
   `-w`). No marker or env var is needed. (The guest file `/var/lib/acq/workspace`
   is written by **some** backends but not all — it is msb-only today — so it is
   not a portable signal; cwd is.)
2. **Passthrough is what keeps the real agent reachable.** Because the wrapper
   **shadows** `opencode` on PATH, it is the only `opencode` a caller finds. The
   real opencode must stay reachable both for interactive use and, crucially,
   because **Paseo itself spawns `opencode` as a child process** when opencode is
   the selected provider. Dropping passthrough would break Paseo's opencode
   provider inside the sandbox.

The genericity win is therefore the **shim/thin-wrapper split**, not removing
passthrough. Truly eliminating passthrough would require *not shadowing an agent
binary at all* — i.e. an acq mechanism to set a non-`opencode` entrypoint, which
does not exist today.

## Reusing the kit with another agent

Copy the thin wrapper to `~/.local/bin/<other-agent>` and change only the agent
name in its "resolve the real binary" block. The generic shim is reused
unchanged. Only opencode is wired today; adding another agent is a documented,
mechanical step rather than speculative code we don't exercise.

## Consequences

- The kit keeps openchamber's proven PID-1 semantics (so `acq run` keeps the
  sandbox alive), now living in the shim; the verify script's regression guards
  assert both the exec-into-shim seam and the shim's hold.
- No shared terminal↔browser session, by design — surfaced in `agentContext`,
  README, and TROUBLESHOOTING.
- All reusable logic is in one agent-neutral file (`paseo-agent-shim`); the
  agent-specific surface is a ~25-line wrapper.

## Links

- `paseo-single-port-daemon.md` — why there's no attach/shared session.
- `worktrees-root-global-only.md`,
  `supervisor-owns-daemon-wrapper-pins-worktrees.md` — the worktree pin/bounce.
- `../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md` — the
  PATH-shadow + PID-1 precedent this reuses.
- `../../../paseo/files/home/.local/bin/opencode` — the thin wrapper.
- `../../../paseo/files/home/paseo-agent-shim` — the generic shim.
