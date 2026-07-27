# Decision: the startup script owns the shared server (terminal-free UX)

**Status:** accepted, with a **material correction** — see
[Correction (2026-07): sbx session-based auto-stop invalidates the terminal-free
premise](#correction-2026-07-sbx-session-based-auto-stop-invalidates-the-terminal-free-premise)
below. The decision to move server supervision into the startup script **stands**
(it is correct and required for the `acq run` path). What does **not** hold is the
"one-command, terminal-free `acq create` with nobody attached" UX this record
claimed as its payoff: on sbx v0.35.0 a session-less agent sandbox is auto-stopped
~30s after its last session disconnects, so a detached `acq create` alone does not
stay running. Use `acq run`. (Also supersedes the server-ownership decision in
[`wrapper-entrypoint-owns-server.md`](wrapper-entrypoint-owns-server.md); that
record's PID-1 reasoning for the interactive `acq run` path still applies.)

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

## Correction (2026-07): sbx session-based auto-stop invalidates the terminal-free premise

The two "pivotal facts" this record relied on — established by an early
`scripts/detach-probe` run — were **incompletely observed**, and the headline UX
claim ("a single `acq create` with nobody attached yields a working, persistent
OpenChamber") is **false on sbx v0.35.0**.

**What is actually true (verified on sbx v0.35.0, macOS, via the daemon log):**

- sbx **auto-stops a sandbox ~30 seconds after its *last session*
  disconnects** — for **any** agent (`opencode`, `shell`, …), **with or without a
  kit**. The daemon log shows, in order:
  `session disconnected, deferring auto-stop  delay:30000000000` (30s in ns),
  then `auto-stop grace period expired, stopping runtime`, then
  `auto-stopped runtime after last session disconnected`.
- **`acq create` itself is session-less after it returns**, and that alone arms
  the timer. `acq create` opens a short-lived session and disconnects it (the log
  shows `session connected` immediately followed by `session disconnected,
  deferring auto-stop`), so a detached create — **even with no kit and no
  subsequent `acq exec`** — is auto-stopped ~30s later. Any transient `acq
  exec`/attach is likewise a session that connects then disconnects; the kit-apply
  step is one such exec, but it is **not** special — create alone is sufficient.
- **This is universal, not agent- or kit-specific.** A controlled matrix
  (`scripts/investigate-shell-autostop`, watched 120s via `acq ls`) had *all four*
  cases stop at ~36s with the identical 30s-grace signature: `shell`/no-kit/no-exec,
  `shell`/no-kit/+exec, `shell`/+kit, and `opencode`/+exec. An earlier one-off
  observation that a `shell`+kit sandbox "stayed up" did **not** reproduce and is
  discarded (it was made via raw `sbx create` without a clean `acq ls` watch —
  most likely a session was still held or a still-booting state was misread).
- This is **independent of PID 1.** PID 1 is the `tini … sleep infinity`
  keepalive in all cases (bare and kit); sbx measures idleness by **session
  connections**, not PID-1 liveness, so tini does **not** prevent the stop.
- There is **no sbx knob** to disable or extend the grace: neither `sbx settings`
  nor `sbx create --help` / `sbx run --help` exposes an auto-stop/idle/keep-alive
  setting or flag (checked on v0.35.0).

**Why the probe missed it.** The original `detach-probe` watched for only 15s —
*shorter than the 30s grace* — so it saw `running`, saw the startup hook fire, and
reported "PREMISE HOLDS." The probe now defaults `HOLD_SECONDS=90` (> grace) and
its messaging names the auto-stop mechanism, so it observes the stop instead of
missing it.

**What still stands / what changes:**

- **Server supervision in the startup script: KEEP.** Running both supervisors on
  every start is correct and is exactly what makes the server available the moment
  a session is attached. Nothing here reverts that.
- **The wrapper's PID-1 discriminator (hold on `acq run`, exit otherwise): KEEP.**
  It is still correct for the `acq run` path (verify steps 9–10). It is *not* the
  cause of the auto-stop — the wrapper does not even run on the detached path.
- **The terminal-free "`acq create` with nobody attached" UX: DROP.** It is not
  achievable on sbx v0.35.0. The supported path is **`acq run`**, which holds a
  session and keeps the sandbox (and `:4096`) alive. README and TROUBLESHOOTING
  are updated accordingly.

The user-visible symptom of relying on the dropped premise is the browser error
*"The running turn was stopped before OpenCode could send the next message"* — the
sandbox behind `:4096` was auto-stopped out from under the UI.

## Links

- `scripts/detach-probe` — host-side probe of the detach/auto-stop behavior.
  **Note:** its early 15s window under-observed the 30s auto-stop and produced the
  incorrect "premise holds" reading corrected above; it now watches 90s and names
  the auto-stop mechanism.
- `scripts/investigate-shell-autostop` — the controlled A–D matrix (shell/opencode
  × kit/no-kit × exec/no-exec) that established the auto-stop is universal: all
  four cases stopped at ~36s, including `shell`/no-kit/no-exec (proving `acq create`
  alone arms the timer). Kept as a lifecycle-regression probe.
- sbx daemon log (macOS): the sandboxd log is a few levels deep at
  `~/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/daemon.log`
  — where the `session (dis)connected` / `deferring auto-stop` /
  `auto-stop grace period expired` / `auto-stopped runtime after last session
  disconnected` markers appear.
