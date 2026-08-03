# Troubleshooting — openchamber kit

Failure modes specific to the OpenChamber kit. They assume you applied the kit
to a sandbox (see [README.md](README.md#usage)).

## "The running turn was stopped before OpenCode could send the next message" / the sandbox auto-stops ~30s after create

**Symptoms:** you `acq create` (detached) with this kit — or only ever `acq exec`
into the sandbox — the browser UI on the mapped port loads, but any prompt fails
with *"The running turn was stopped before OpenCode could send the next
message."* Checking `acq ls` / `sbx inspect` shows the sandbox went `stopped` on
its own about 30–40 seconds after create, with `Sessions: 0`.

**Cause:** sbx (verified v0.35.0) **auto-stops a sandbox ~30 seconds after its
last session disconnects** — for any agent, with or without a kit. A detached
`acq create` is session-less after it returns: `acq create` opens a short-lived
session and disconnects it, which alone arms a 30s grace timer (`session
disconnected, deferring auto-stop delay:30000000000` → `auto-stop grace period
expired` → `auto-stopped runtime after last session disconnected` in the daemon
log) — this happens **even with no kit and no `acq exec`**. Any lone `acq exec`
is likewise a transient session that re-arms it. The `tini` PID-1 keepalive does
**not** prevent this (sbx measures idleness by session connections, not by
whether PID 1 is alive), and there is no sbx setting or flag to disable/extend
the grace (checked in `sbx settings`, `sbx create --help`, `sbx run --help`).
This is universal — confirmed by `scripts/investigate-shell-autostop`, where
shell/opencode × kit/no-kit × exec/no-exec all stopped at ~36s.

**Fix: use `acq run`, which holds a session and keeps the sandbox alive.**

```bash
acq run --name <sandbox>            # or: acq run opencode /path/to/project
```

Keep that terminal open while you use OpenChamber from the browser; the attached
session is what prevents the auto-stop. (The shared server + UI are already up,
started by the startup script — `acq run` just keeps the sandbox running.) You
can confirm the mechanism on your host with
[`scripts/detach-probe`](scripts/detach-probe) (it watches longer than the 30s
grace, so it observes the stop). Inspect the auto-stop markers directly in the
sbx daemon log:

```bash
# macOS (the sandboxd log is a few levels deep under the state dir):
grep -E 'auto-stop|session (dis)?connected' \
  "$HOME/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/daemon.log" \
  | grep <sandbox>
```

## I don't want `acq run` in the foreground / suspend + `bg` kills the sandbox

**Symptoms:** you `acq run opencode <path>`, decline (or quit) the TUI, and are
left with the wrapper holding your terminal in the foreground. If you suspend it
(`Ctrl-Z`) and `bg` it, the sandbox dies — you can't get your terminal back and
keep the sandbox alive that way.

**Cause:** `acq run` **attaches your terminal to the sandbox entrypoint** (PID
1), which on this path is the kit's `opencode` wrapper. The wrapper holds the
foreground on purpose so PID 1 stays alive. Job-control `bg` is not a session
detach — suspending and backgrounding the attached client tears down the
interactive `run` session, so the entrypoint's controlling channel goes away and
the sandbox stops. `acq run` is the *interactive* path; it is not meant to be
backgrounded.

**There is unfortunately no fully terminal-free option on sbx.** A detached
`acq create` does **not** keep the sandbox alive — sbx auto-stops a session-less
agent sandbox ~30s after its last session disconnects (see the entry above), and
there is no sbx knob to disable that. `acq run` (holding a session) is the
supported way to keep OpenChamber reachable. If you don't want to tie up an
interactive shell, run `acq run` in a dedicated terminal/tab (e.g. a `tmux`/screen
window) and leave it attached — that keeps the session alive without occupying
your working terminal. You can still attach a TUI to the shared session from
elsewhere any time:

```bash
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

> **`acq create` shows no connect banner.** The wrapper's "Connect from your
> HOST" banner only prints when the wrapper *runs* (the `acq run` path). After a
> detached `acq create` the wrapper does not run, so use `acq ports <sandbox>`
> to discover the mapped host ports.

## The sandbox stops on its own right after `acq run`

**Symptoms:** you `acq run opencode <path>` with this kit and decline the TUI
prompt (or run non-interactively); the sandbox briefly shows `running` in
`acq ls` and then flips to `stopped` on its own, seconds later — with nothing
else started. Starting a *second* sandbox is not the cause; the first had
already stopped.

**Cause:** the kit's `opencode` **wrapper** is the sandbox entrypoint on the
`acq run` path (it shadows the real binary via PATH). A Docker sandbox is
"running" only while its entrypoint / PID 1 is alive. An earlier version of the
wrapper backgrounded `opencode serve` with `nohup … &` and then **returned** on
the no-TUI path — so PID 1 exited and the sandbox stopped. Fixed by having the
wrapper **hold PID 1 in the foreground** (it blocks forever in `hold_pid1`) so
PID 1 stays alive. (This only affects `acq run`; a detached `acq create` uses a
tini keepalive as PID 1 and is unaffected — prefer `acq create` if you don't want
a foreground terminal, see the first entry above.)

**Fix / confirm you have the fix:** the wrapper's no-arg path should block (hold
PID 1) rather than return. Check the wrapper's tail:

```bash
grep -n 'hold_pid1' ~/.local/bin/opencode   # inside the sandbox
```

If your copy still ends the no-arg path with `exit 0` after a `nohup … &`, update
the kit to the current version and recreate the sandbox. As a stopgap you can
re-attach a stopped sandbox any time with `acq run <name>` (state persists until
`acq rm`).

## The sandbox stops when I quit the attached TUI

**Symptoms:** you `acq run opencode <path>`, accept the "Connect a TUI now?"
prompt, work in the TUI, then quit it — and the sandbox flips to `stopped` (and
the OpenChamber browser UI goes dark).

**Cause:** an earlier version of the wrapper `exec`ed `opencode attach`, so the
TUI *became* the entrypoint / PID 1; quitting it ended PID 1 and stopped the
sandbox. Fixed: the wrapper now runs the TUI as a **child** and, when you quit,
falls through to holding PID 1 in the foreground — so the sandbox and the
browser UI survive a TUI exit. (The shared server is separate — it's supervised
by the startup script — so it is unaffected by the TUI either way.)

**Fix / confirm you have the fix:** the attach line must not use `exec`, and the
wrapper must end in a `hold_pid1` call:

```bash
grep -n 'attach\|hold_pid1' ~/.local/bin/opencode   # inside the sandbox
```

The `opencode attach …` line should have no `exec` prefix (it ends with
`|| true`), and the file should end with a `hold_pid1` invocation. If your copy
still `exec`s the attach, update the kit and recreate the sandbox.

## The browser page won't load / no host port

**Symptoms:** `acq ports <sandbox>` shows no mapping for
container port 3000 (or 4096), or the browser can't connect.

**Cause:** on a **current `acq`** the ports are published automatically at create
time (acq reads the kit's neutral top-level `publishedPorts`). If you see no
mapping, you are most likely on an **older `acq`** that lacks automatic port
publishing, so it did not publish the ports.

**Fix:** publish the two container ports (once per sandbox):

```bash
acq ports <sandbox> --publish 3000:3000    # OpenChamber web UI
acq ports <sandbox> --publish 4096:4096    # shared opencode server
acq ports <sandbox>                        # confirm the mappings
```

Upgrading `acq` to a build with automatic `publishedPorts` publishing removes the manual step.

## OpenChamber loads but shows no server

**Symptoms:** the OpenChamber page opens, but there is no live OpenCode server /
no sessions.

**Cause:** the shared `opencode serve` on `:4096` is started and supervised by
the kit's startup script on every sandbox start, so this should resolve on its
own within a few seconds. If it persists, either the first-boot install is still
running, or the shared server is failing to start (most often: no model provider
configured).

**Fix:** confirm the shared server is up (the startup supervisor should have
started it — no manual command needed):

```bash
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:4096/global/health >/dev/null && echo up'
```

If it's not up, check the serve log and that a provider is configured (pair this
kit with the `usai-provider` kit — the default GSA setup does):

```bash
acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/openchamber/opencode-serve.log'
acq exec <sandbox> -- sh -c 'pgrep -af "supervisor:opencode-serve"'   # the server's supervisor
```

## OpenChamber didn't start

**Symptoms:** the host port is mapped but nothing answers on the OpenChamber
port.

**Cause:** the startup step is still installing OpenChamber (first boot does a
one-time npm install), or the install failed.

**Fix:** check the logs inside the sandbox:

```bash
acq exec <sandbox> -- sh -c 'cat /tmp/openchamber-install.log'   # first-boot install
acq exec <sandbox> -- sh -c 'cat /tmp/openchamber.log'
acq exec <sandbox> -- sh -c 'cat ~/.local/state/openchamber/opencode-serve.log'  # shared server (startup supervisor)
acq exec <sandbox> -- sh -c 'openchamber status'
```

If the shared server is failing (see
`~/.local/state/openchamber/opencode-serve.log`), confirm a provider is
configured — pair this kit with the `usai-provider` kit (the default GSA setup
does). Both the shared server and OpenChamber run under respawn loops
(`supervisor:opencode-serve`, `supervisor:openchamber`), so a transient failure
self-heals within a few seconds. To reproduce a single run by hand (mirrors what
`files/home/openchamber-start.sh` does):

```bash
acq exec <sandbox> -- sh -lc '
  nohup opencode serve --hostname 0.0.0.0 --port 4096 >~/.local/state/openchamber/opencode-serve.log 2>&1 &
  OPENCODE_SKIP_START=true OPENCODE_PORT=4096 OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
    openchamber --lan --port 3000 >/tmp/openchamber.log 2>&1 &
'
```

## OpenChamber keeps restarting (crash loop)

**Symptoms:** `/tmp/openchamber.log` shows
`[supervisor] openchamber exited; restarting in 5s` over and over.

**Cause:** the respawn loop is doing its job — OpenChamber keeps exiting
immediately (bad config, a failed self-update), so it is restarted every few
seconds. The restart mechanism is fine; the *service* is the problem.

**Fix:** read the lines *above* each `[supervisor]` restart marker for the real
error, and fix that. To slow the loop down while you investigate, raise the delay
by recreating the sandbox with `OPENCHAMBER_RESTART_DELAY` set higher (default
`5` seconds). The loop intentionally never gives up, so once the underlying cause
is fixed OpenChamber comes back on the next cycle without a sandbox restart.

To confirm exactly one supervisor is running:

```bash
acq exec <sandbox> -- sh -c 'pgrep -af "supervisor:openchamber"'
```

The shared `opencode serve` has its own respawn loop with the same behavior; if
it crash-loops, `~/.local/state/openchamber/opencode-serve.log` shows
`[supervisor] opencode serve exited; restarting in 5s`. Confirm its supervisor
with `pgrep -af "supervisor:opencode-serve"`.

## OpenChamber failed to install (native build error)

**Symptoms:** `/tmp/openchamber-install.log` shows
`prebuild-install warn install unable to get local issuer certificate` followed
by `node-gyp rebuild` and `cc: No such file or directory` / `make: *** Error`.

**Cause:** OpenChamber's `better-sqlite3` dependency downloads a prebuilt native
binary, falling back to compiling from source only if that download fails — and
the base image has no C toolchain. The download fails when Node can't verify the
sandbox proxy's TLS chain, i.e. `PROXY_CA_CERT_B64` wasn't available or wasn't
trusted. The kit exports `NODE_EXTRA_CA_CERTS` from `PROXY_CA_CERT_B64` and
routes npm/prebuild-install through the sandbox proxy to make the prebuilt
download succeed; this error means one of those wasn't in effect.

**Fix:** confirm the proxy env and CA are present, then re-trigger the startup:

```bash
acq exec <sandbox> -- sh -c 'echo "${HTTPS_PROXY:-unset}"; echo "PROXY_CA len=${#PROXY_CA_CERT_B64}"'
# then restart the sandbox so the startup step re-runs the install:
acq stop <sandbox> && acq run <sandbox>
```

If the prebuilt still can't be fetched (blocked release-asset hosts), ensure
`github.com`, `objects.githubusercontent.com`, and
`release-assets.githubusercontent.com` are permitted — under org governance,
kit `caps.network.allow` is superseded by org policy (`acq policy log <sandbox>`
shows what was blocked on the sbx backend).

## Node.js too old

**Symptoms:** the install log aborts with `Node.js 22+ is required`.

**Cause:** OpenChamber needs Node 22+. The opencode base template ships a recent
Node, but a customized base image may not.

**Fix:** use the opencode base template (the default), or add a Node 22 install
step ahead of this kit.

## Installer SHA-256 mismatch (install refused)

**Symptoms:** `/tmp/openchamber-install.log` shows
`install.sh SHA-256 mismatch (got <hash>, want <hash>) at <ref>; refusing to run
it`, and `openchamber` never installs.

**Cause:** the kit fetches OpenChamber's `install.sh` from the pinned tag
(`OPENCHAMBER_REF`) and runs it only if its SHA-256 equals
`OPENCHAMBER_INSTALL_SHA256`. A mismatch means the fetched bytes are not the
pinned ones — either the pin is stale (the two values weren't bumped together),
the fetch was corrupted/tampered on the inspected path, or the tag content moved.
The kit fails **closed**: it skips the install rather than run unverified code.

**Fix:** re-pin the hash for the tag you intend to use, then restart the sandbox:

```bash
# recompute the expected hash for the pinned ref
curl -fsSL "https://raw.githubusercontent.com/openchamber/openchamber/<ref>/scripts/install.sh" | sha256sum
# set OPENCHAMBER_REF + OPENCHAMBER_INSTALL_SHA256 in spec.yaml to matching values,
# recreate the sandbox so the startup step re-runs.
```

If the hash you compute keeps changing for a fixed tag, treat that as suspicious
(a tag should be immutable) and do not bump the pin to match it.

## `opencode` doesn't run the wrapper (real opencode runs instead)

**Symptoms:** running `opencode` with no args launches the plain TUI instead of
the wrapper's "connect instructions / offer a TUI" flow.

**Cause:** the wrapper shadows the real `opencode` by being **first on PATH** at
`~/.local/bin/opencode`. If `~/.local/bin` isn't first on PATH, or the file
wasn't dropped, the real binary wins.

**Fix:** confirm the wrapper is present, executable, and first on PATH:

```bash
acq exec <sandbox> -- sh -c 'command -v opencode; ls -l ~/.local/bin/opencode; echo "$PATH"'
```

`command -v opencode` should print `/home/agent/.local/bin/opencode`. If it
prints the npm-global path instead, the kit's `files[]` drop didn't land — check
that the kit was applied and recreate the sandbox.

## A host TUI can't attach to the shared server

**Cause:** the shared server is supervised by the startup script and should be
listening on `:4096` shortly after any sandbox start. If nothing answers, it is
still installing (first boot) or failing to start (usually: no model provider).

**Fix:** confirm it's listening, then attach — no manual start needed:

```bash
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:4096/global/health >/dev/null && echo up'
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

The server is unsecured (no password), so no `OPENCODE_SERVER_PASSWORD` is
needed. If it isn't up, see "OpenChamber loads but shows no server" above (check
`~/.local/state/openchamber/opencode-serve.log` and that a provider is
configured).

## Do multiple sandboxes fight over ports 3000 / 4096?

**No.** The kit declares the *container* ports; the sbx backend allocates
distinct **ephemeral host ports on `127.0.0.1` per sandbox**, so several
sandboxes running this kit each get their own host ports — they don't collide.
`acq ports <sandbox>` shows which host ports map to
container 3000 and 4096 for that sandbox.

If you'd rather pin each to a known host port, publish them explicitly:

```bash
acq ports <sandbox-a> --publish 3000:3000    # host 3000 → container 3000
acq ports <sandbox-b> --publish 3001:3000    # host 3001 → container 3000
```

Inside every sandbox OpenChamber always listens on container port 3000 and the
shared server on 4096; those are private to each sandbox's network namespace, so
there's no in-container conflict either.
