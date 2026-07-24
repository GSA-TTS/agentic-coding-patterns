# Decision: the startup script owns the shared server (terminal-free UX)

**Status:** accepted (supersedes the server-ownership decision in
[`wrapper-entrypoint-owns-server.md`](wrapper-entrypoint-owns-server.md); that
record's PID-1 reasoning for the interactive `acq run` path still applies)

## Context

[`wrapper-entrypoint-owns-server.md`](wrapper-entrypoint-owns-server.md) put the
shared `opencode serve` under the `opencode` **wrapper**, started **on demand**
when the wrapper ran with no arguments. Because the wrapper is the sandbox
entrypoint on the interactive `acq run` path, that made "bring the server up" and
"hold the sandbox entrypoint open" the same act — which forced a clumsy workflow
for anyone who did **not** want a foreground terminal:

- `acq run opencode <path>` attaches your terminal to the entrypoint (the
  wrapper), which then holds the foreground forever. Suspending it and `bg`-ing
  it tears down the interactive `run` session and the sandbox stops.
- To use OpenChamber *without* tying up a terminal, you had to `acq create` (or
  `acq run`) and then separately `acq exec <sandbox> -- sh -c 'nohup opencode &'`
  to bring the server up — two commands and an easy-to-forget second step. Until
  that ran, OpenChamber loaded but showed no live server.

New empirical evidence (see `scripts/detach-probe`, run on a real host) changes
what's possible:

- On the **detached `acq create`** path, **PID 1 is a `tini -- … sleep infinity`
  keepalive shim**, *not* this kit's wrapper. The sandbox stays `running` on its
  own with nobody attached; the wrapper is only the entrypoint on the
  interactive `acq run` path.
- The kit's **`startup` command fires on `acq create`** even with nobody
  attached (the probe confirmed the install log is written and the OpenChamber
  supervisor is running after a bare detached create). Startup commands run in
  the background under the tini keepalive, independent of any session.

So a background service started by the `startup` script lives for the sandbox's
lifetime regardless of whether anyone ever runs the wrapper — which means the
server no longer needs to be tied to the entrypoint.

## Decision

**Move supervision of the shared `opencode serve` into the startup script
(`openchamber-start.sh`), and reduce the wrapper to a TUI-attach + PID-1 hold.**

- `openchamber-start.sh` now runs **two** respawn supervisors: one for
  `opencode serve --hostname 0.0.0.0 --port 4096`
  (`supervisor:opencode-serve`) and the existing one for OpenChamber
  (`supervisor:openchamber`, skip-start, attaching to `:4096`). Both come up on
  every sandbox start, including a detached `acq create`.
- The `opencode` **wrapper** no longer starts or owns the server. With arguments
  it passes through to the real `opencode`. With no arguments it prints the
  host-connect instructions, optionally attaches a TUI (as a child, TTY-gated),
  and then branches on whether it is **PID 1**:
  - **PID 1** (it is the sandbox entrypoint — the `acq run` path): it **holds
    PID 1** forever (`hold_pid1`) so that interactive session's sandbox stays
    alive. The printed note tells the user to keep the terminal open, and — for
    someone who ran `acq run` without meaning to hold a terminal — how to quit
    and use `acq create` instead.
  - **not PID 1** (run from a shell inside the sandbox, or `acq exec`, while a
    detached `acq create`'s tini keepalive holds the sandbox): it **exits
    cleanly** and returns the terminal, since the startup script already
    supervises the server + UI and nothing needs holding.

  It does not supervise the server on either branch — the startup loop does, and
  re-heals it if it dies.

### The one-command, terminal-free result

```
acq create --name <sandbox> opencode <path>   # server + OpenChamber come up on their own
acq ports <sandbox>                            # find the mapped host ports
```

No `acq exec` step, no wrapper invocation, no foreground terminal. `acq run`
remains available for an interactive TUI in that terminal.

## Consequences

- **Terminal-free by default.** A detached `acq create` yields a working
  OpenChamber with a live server, held open by the tini keepalive — the original
  request ("use openchamber and otherwise ignore the terminal interaction").
- **`acq create` shows no connect banner.** The wrapper's "Connect from your
  HOST" banner only prints when the wrapper runs (the `acq run` path). On the
  detached `create` path the wrapper does not run, so discover the mapped ports
  with `acq ports <sandbox>`. Documented in the README and TROUBLESHOOTING.
- **The unauthenticated `:4096` is now always-on for the sandbox's lifetime**,
  not on-demand. It was already unsecured and only reachable via a host-loopback
  published port inside the sandbox boundary; the change is that it is live from
  first boot even if the UI is never opened. The README Security note states
  this. The sandbox remains the security boundary.
- **Self-heal moves to the startup supervisor.** If `opencode serve` dies, the
  `supervisor:opencode-serve` loop relaunches it (verified by `scripts/verify`
  step 11) — the wrapper is no longer involved in server liveness.
- **The wrapper's PID-1 hold still matters — but only for `acq run`.** On the
  detached path PID 1 is the tini shim and the wrapper is not PID 1, so it
  **exits cleanly** there and returns the terminal. The wrapper discriminates
  with a `[ "$$" -eq 1 ]` check: hold when it is the entrypoint, exit otherwise.
  The two regression guards (PID-1 discriminator + exits-cleanly-when-not-PID-1;
  TUI runs as a child + PID-1 branch ends in `hold_pid1`) are in `scripts/verify`
  (steps 9–10).
- **Two supervisors instead of one.** `openchamber-start.sh` starts both,
  each idempotent (guarded by `supervisor_running`), so repeated startup runs
  don't spawn duplicates.

## Links

- `scripts/detach-probe` — the host-side probe that established the two pivotal
  facts (detached PID 1 is a tini keepalive; the startup hook fires on
  `acq create`).
- [`wrapper-entrypoint-owns-server.md`](wrapper-entrypoint-owns-server.md) — the
  prior decision whose server-ownership choice this record supersedes; its
  PID-1-on-`acq run` reasoning still holds.
- [`install-at-startup.md`](install-at-startup.md),
  [`pin-and-verify-installer.md`](pin-and-verify-installer.md) — unchanged; still
  apply to the OpenChamber install the startup script performs.
- OpenCode `opencode serve` / `opencode attach` — headless server + TUI attach.
