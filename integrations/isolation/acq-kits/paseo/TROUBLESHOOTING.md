# Troubleshooting — paseo acq kit

Symptoms, causes, and fixes for the Paseo self-hosted web UI kit. Most diagnosis
is done with `acq exec <sandbox> -- sh -c '…'`. Because a bare `acq exec` runs a
non-login shell whose PATH lacks the npm-global bin and `~/.local/bin`, prepend
them when probing for the `paseo`/`opencode` binaries:

```bash
acq exec <sandbox> -- sh -c 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$(npm prefix -g 2>/dev/null)/bin:$PATH"; command -v paseo'
```

---

## The browser UI never loads / connection refused

**Check the port mapping and the daemon.**

```bash
acq ports <sandbox>                       # is container 6767 mapped to a host port?
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:6767/api/health && echo OK'
```

- `/api/health` returns 200 and the port is mapped → open
  `http://127.0.0.1:<host-port-for-6767>`.
- `/api/health` fails → the daemon isn't up yet. On **first boot** it installs the
  Paseo CLI first (a few seconds). Watch the logs:

  ```bash
  acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/paseo/paseo-daemon.log'
  acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/paseo/paseo-install.log'
  ```

## "The sandbox stopped" shortly after `acq create`

A session-less sandbox is **auto-stopped shortly after** the last session
disconnects. A detached `acq create` with nothing attached is stopped, taking the
daemon/UI down.

**Fix:** use `acq run` and keep its terminal open (the wrapper holds PID 1 for as
long as the terminal is attached). Use a separate tab or `tmux`/`screen` if you
don't want to tie up your working terminal. See the README "Keep it running".

## The Paseo CLI didn't install (UI unavailable, sandbox healthy)

The install runs at startup with `|| true`, so a failure degrades to "UI
unavailable" and never kills the sandbox.

```bash
acq exec <sandbox> -- sh -c 'tail -n 60 ~/.local/state/paseo/paseo-install.log'
```

Common causes:

- **Egress blocked.** The kit only allow-lists `registry.npmjs.org`. If npm can't
  reach it, check the proxy env is present:

  ```bash
  acq exec <sandbox> -- sh -c 'echo "${HTTPS_PROXY:-unset}"; echo "PROXY_CA len=${#PROXY_CA_CERT_B64}"'
  ```

- **TLS on an inspected network (e.g. Zscaler).** npm/Node must trust the
  inspection CA. Pair with the `zscaler-ca-certificate` kit; the startup script
  folds `PROXY_CA_CERT_B64` + the system trust store into `NODE_EXTRA_CA_CERTS`.

- **npm global prefix permissions.** On the default sandbox template the global
  prefix is root-owned, so the script installs via `sudo -n`. If sudo is
  unavailable (a plain-OCI base), it falls back to a per-user prefix at
  `~/.npm-global`. Verify which took effect:

  ```bash
  acq exec <sandbox> -- sh -c 'ls -la ~/.npm-global/bin 2>/dev/null; ls -la "$(npm prefix -g 2>/dev/null)/bin" 2>/dev/null | grep -i paseo'
  ```

## Worktrees aren't landing under my project

Paseo keeps worktrees under a single global `worktrees.root`
(`<root>/<projectHash>/<slug>`) — see
[`docs/decisions/worktrees-root-global-only.md`](docs/decisions/worktrees-root-global-only.md).
The kit pins that root to `<primary-project>/.paseo-worktrees` **when you run the
`opencode` wrapper on the `acq run` path** (whose cwd is the primary workspace).

Check what's configured and whether the daemon has it:

```bash
acq exec <sandbox> -- sh -c 'cat "${PASEO_HOME:-$HOME/.paseo}/config.json"'
```

- `worktrees.root` still absent or `$PASEO_HOME/worktrees` → you haven't run the
  wrapper yet on `acq run` (a detached `acq create` alone won't pin it). Run
  `acq run opencode <project>` once.
- `worktrees.root` points at `<project>/.paseo-worktrees` but new worktrees still
  land elsewhere → the daemon may not have restarted to pick it up. The wrapper
  bounces the daemon only when the value **changes**; force a bounce by killing
  the daemon child (the supervisor respawns it):

  ```bash
  acq exec <sandbox> -- sh -c '
    for pid in $(pgrep -u "$(id -u)" -f "paseo daemon start"); do
      tr "\0" " " </proc/"$pid"/cmdline | grep -q "supervisor:paseo-daemon" && continue
      kill "$pid"
    done'
  ```

- **The root must be absolute.** A relative `worktrees.root` resolves against
  `PASEO_HOME`, not your project; the kit's helper refuses a non-absolute value,
  so a hand-edited relative root is the likely culprit.

## I set my own `worktrees.root` and the wrapper overwrote it

By design, the wrapper always targets `<primary-project>/.paseo-worktrees` and
rewrites `config.json` when the value differs. If you need a custom fixed root,
don't rely on the wrapper's pin — the current kit does not expose an override env
var.

## The daemon keeps restarting in the logs

`[supervisor] ... restarting` lines are normal after:

- a worktree-root change (the wrapper bounces the daemon on purpose), or
- a Paseo self-update.

A **continuous** restart loop (every few seconds, no external trigger) is not
normal — capture the tail and check for a crash:

```bash
acq exec <sandbox> -- sh -c 'tail -n 60 ~/.local/state/paseo/paseo-daemon.log'
```

A likely cause is a **stale PID lock** if a previous daemon died uncleanly; Paseo
reclaims a dead-owner or >5-min-old lock automatically, but if you see
"Another Paseo daemon is already running" repeatedly, inspect/remove the lock:

```bash
acq exec <sandbox> -- sh -c 'cat "${PASEO_HOME:-$HOME/.paseo}/paseo.pid"'
# only if its PID is truly dead:
acq exec <sandbox> -- sh -c 'rm -f "${PASEO_HOME:-$HOME/.paseo}/paseo.pid"'
```

## `opencode <args>` behaves oddly

The kit's `opencode` at `~/.local/bin/opencode` is a **thin wrapper** that shadows
the real binary. With arguments it `exec`s the real opencode unchanged; with no
arguments it `exec`s the generic kit shim (`~/paseo-agent-shim`), which pins
worktrees + holds PID 1. Confirm the shadow and that the real binary resolves:

```bash
acq exec <sandbox> -- sh -c 'command -v opencode'          # should be ~/.local/bin/opencode
acq exec <sandbox> -- sh -c 'ls -la ~/.local/bin/opencode ~/paseo-agent-shim' # both present + executable?
```

If `command -v opencode` is empty, the base image PATH or CMD changed (the
shadow depends on `~/.local/bin` being first on PATH and `CMD` being the bare
`opencode`); the wrapper won't be the entrypoint. Re-check the base image.

## No shared session between a terminal and the browser

This is expected — Paseo launches its own agent CLIs as child processes and is not
an attachable OpenCode server, so there is no shared live session and no attach
command. See
[`docs/decisions/paseo-single-port-daemon.md`](docs/decisions/paseo-single-port-daemon.md).
Drive agents from the browser UI.

## Auth / "cannot connect" from another Paseo client

The daemon runs **unsecured** (no `PASEO_PASSWORD`) by design (the sandbox is the
security boundary; the port is host loopback only). If you point a Paseo client
that expects a password at it, leave the password blank. Do **not** expose the
mapped port beyond host loopback.
