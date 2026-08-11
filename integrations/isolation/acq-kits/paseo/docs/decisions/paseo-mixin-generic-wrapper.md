# Decision: an agent-generic `opencode` wrapper (PID-1 hold), not opencode-coupled

**Status:** accepted

## Context

On the acq opencode base image the entrypoint runs the bare command `opencode`,
and `~/.local/bin` is first on PATH — so a file dropped at
`~/.local/bin/opencode` **shadows** the real binary and becomes the entrypoint on
the interactive `acq run` path. The `openchamber` kit exploits this to own a
shared server and hold PID 1 (see its
`wrapper-entrypoint-owns-server.md`).

Two forces shape this kit's wrapper:

1. **Keep the sandbox alive on `acq run`.** A Docker sandbox is "running" only
   while PID 1 is alive. Because the wrapper IS PID 1 on `acq run`, a no-arg path
   that returns would stop the sandbox (and the Paseo daemon/UI with it). This is
   the same PID-1 discipline openchamber established; we keep it verbatim.
2. **Minimize opencode coupling.** The user wants this kit reusable with other
   coding agents in the future. Paseo is agent-agnostic (it launches Claude Code,
   Codex, Copilot, OpenCode, Pi), and the daemon needs nothing opencode-specific.

## Decision

**Ship an `opencode` wrapper whose only opencode-specific behavior is resolving
the real `opencode` for passthrough; everything else is agent-generic.** The
wrapper:

- **With arguments:** `exec`s the real opencode unchanged (so `opencode run …`,
  `opencode auth login`, etc. work, and opencode remains usable as a Paseo
  provider CLI).
- **With no arguments:** pins Paseo's worktree root to `<PWD>/.paseo-worktrees`
  (see `worktrees-root-global-only.md`), prints host-connect instructions, then
  discriminates on `$$`:
  - **PID 1** (the `acq run` entrypoint): `hold_pid1` — block forever so the
    session's sandbox stays up.
  - **not PID 1** (a shell / `acq exec`, with a detached `acq create` holding the
    sandbox): exit cleanly and return the terminal.
- **Does NOT** offer a TUI attach — there is no shared Paseo session to attach to
  (`paseo-single-port-daemon.md`). This is what keeps it generic: no
  `opencode attach`, no shared-server assumptions.

## Why keep the file named `opencode`

The base image's `CMD` is the bare `opencode`, and `~/.local/bin` is first on
PATH, so the entrypoint is only shadowable by a file at that exact path. The kit
therefore names the wrapper `opencode`. To reuse this kit with a different agent,
the wrapper's passthrough target (the "resolve the real binary" block) is the
only opencode-specific part to change — the worktree-pin + PID-1-hold logic is
agent-neutral. If acq later exposes the primary-workspace path via an env var or
marker on both backends, even the passthrough could be dropped and the file could
shadow whatever the base entrypoint runs.

## Consequences

- The kit keeps openchamber's proven PID-1 semantics (so `acq run` keeps the
  sandbox alive), which the verify script's regression guards assert.
- No shared terminal↔browser session, by design — surfaced in `agentContext`,
  README, and TROUBLESHOOTING.
- The wrapper is small and mostly agent-neutral, easing future reuse.

## Links

- `paseo-single-port-daemon.md` — why there's no attach/shared session.
- `worktrees-root-global-only.md`,
  `supervisor-owns-daemon-wrapper-pins-worktrees.md` — the worktree pin/bounce.
- `../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md` — the
  PATH-shadow + PID-1 precedent this reuses.
- `../../../paseo/files/home/.local/bin/opencode`.
