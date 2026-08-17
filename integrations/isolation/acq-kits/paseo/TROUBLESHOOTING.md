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

## "No hosts configured" and/or a repeating `ws://…/ws` connect loop

**Symptom.** The UI loads at `http://127.0.0.1:<host-port>`, but shows **no hosts**,
and the browser's Network tab shows repeated `ws://<host>:<port>/ws` requests, each
`101 Switching Protocols`, opening and closing every few seconds (the interval
grows: ~2s → 4s → … → ~30s). The daemon log shows the matching cycle:

```
"msg":"Client connected via hello" … "resumed":true
… seconds later …
"msg":"Client disconnected; waiting for reconnect"  code:1000 reason:"Client closed"
```

**This is not a daemon fault.** `code:1000 "Client closed"` is a clean,
*client*-initiated close — the browser is tearing down and reopening its own
control socket (the growing interval is client-side reconnect backoff). The daemon
accepts every upgrade (`101`); `paseo daemon status` shows `running` and
`/api/health` returns 200 throughout.

**Background — how a local "host" is established (no relay needed).** A Paseo
"host" is a daemon the UI attaches its session to. With the relay disabled (this
kit's default), the daemon self-advertises over the **same origin**: it injects
`window.__PASEO_INITIAL_DAEMON_CONNECTION__` into the served `index.html`
(`server/web-ui.js` `injectConnectionHint`), built from the request's `Host`
header, and the client bootstraps a local host from it. So the daemon already
registers itself; you do **not** need to add a host or enable the relay.

**Fixes, in order of preference.**

1. **Open the UI via `localhost`, not `127.0.0.1`.** The client's built-in local
   daemon key and the injected hint's endpoint both resolve to `localhost:<port>`
   (the client normalizes `127.0.0.1`/`::1`/`0.0.0.0` → `localhost`), so a
   `localhost` address bar gives the cleanest first attach:

   ```bash
   acq ports <sandbox>        # host port for 6767
   # open http://localhost:<host-port-for-6767>   (localhost, not 127.0.0.1)
   ```

2. **Clear stale client-side host state.** The host registry lives in the
   **browser**, not the daemon — a stale entry from an earlier session (a
   different port/label, or a prior relay-based host) can keep the client cycling.
   In DevTools ▸ **Application** ▸ **Local Storage** for the origin, delete the
   `@paseo:daemon-registry` (and `@paseo:replica-cache`) keys, then hard-reload.
   An Incognito window is a quick way to prove this — it starts with empty
   storage, so if the loop disappears there, it was stale client state.

3. **Confirm the daemon is actually advertising itself** (it should be, by
   default):

   ```bash
   acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:6767/ | grep -o "__PASEO_INITIAL_DAEMON_CONNECTION__[^<]*"'
   # → __PASEO_INITIAL_DAEMON_CONNECTION__={"listen":"…:6767","useTls":false,"label":"…"}
   ```

   If that line is present and health is 200, the server side is correct and the
   remaining variable is the browser (fixes 1–2).

Note the `daemon.get_status` `ws_slow_request` entries in the log (a few hundred ms
at boot, while git subprocesses warm up) are unrelated to this loop — they are
one-time and do not recur on the reconnect cadence.

## Black page that persists on reload (`ERR_CONTENT_DECODING_FAILED`)

**Symptom.** The page is black. DevTools ▸ Console shows the entry bundle failing:

```
GET .../_expo/static/js/web/index-<hash>.js  net::ERR_CONTENT_DECODING_FAILED  200 (OK)
```

and DevTools ▸ Network shows that request with `Content-Encoding: br` and
`Cache-Control: … immutable`, often stuck "pending" then failing.

**Cause — a poisoned browser cache from a first-load race, NOT a server bug.**
The web UI's hashed assets are served `immutable`. If the browser loaded the page
during the **boot window** — after `/api/health` answers but before the daemon was
fully serving the large (~15 MB) JS bundle — Chrome can cache a partial/broken
`br` response. Because the entry is `immutable`, Chrome keeps replaying that broken
body and fails to decode it on every later reload, even after the server is
healthy. The bytes on the server are fine: fetched over the same host port they
are byte-identical to the on-disk artifact and Brotli-decode correctly — so this
is purely a stale client cache.

**Fix (once).** Clear the poisoned entry:

- DevTools ▸ **Network** ▸ check **"Disable cache"**, then hard-reload
  (⌘/Ctrl-Shift-R); or
- open the URL in a **private/Incognito** window once.

The app then renders and normal reloads work.

**Prevention.** The kit's startup now waits for the **bundle to be fully
serveable** (not just `/api/health`) before it prints "safe to open," and warns
you to wait / hard-reload if you open during boot. If you scripted the open,
gate it on the bundle rather than `/api/health` — compare the bytes received to
the daemon's on-disk precompressed artifact (the bundle is served chunked, so
there is no `Content-Length` to compare against):

```bash
acq exec <sandbox> -- sh -c '
  b=$(curl -fsS http://127.0.0.1:6767/ | grep -oE "/_expo/static/js/web/index-[0-9a-f]+\.js" | head -1)
  brf=$(find / -path "*/web-ui$b.br" 2>/dev/null | head -1)
  exp=$(wc -c < "$brf" 2>/dev/null | tr -d " ")
  got=$(curl -fsS -H "Accept-Encoding: br" -o /dev/null -w "%{size_download}" "http://127.0.0.1:6767$b")
  [ -n "$exp" ] && [ "$got" = "$exp" ] && echo READY || echo "NOT READY (got=$got exp=$exp)"'
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

## Endless `relay_error` / `relay_control_disconnected` in the daemon log

**Symptom.** The daemon log fills with, every ~30s:

```
… "msg":"relay_error" … "host":"relay.paseo.sh","port":443 … "code":"ECONNRESET"
… "msg":"relay_control_disconnected" … "url":"wss://relay.paseo.sh/ws?…&role=server&v=2"
```

TCP to `relay.paseo.sh:443` opens but the TLS handshake dies mid-flight
(`unexpected eof while reading`, 0 bytes read).

**Cause — the cloud relay is not on this kit's egress allow-list, and is not
needed.** Paseo defaults its cloud relay ON and dials `wss://relay.paseo.sh` on a
retry loop. This kit only allow-lists `registry.npmjs.org`, so the sandbox proxy
resets the relay's TLS handshake. The relay exists to reach a daemon that has no
inbound path; here the host reaches the web UI directly over the loopback-
published port (see README "Reaching it from the host"), so the relay is pure
noise.

**This does NOT affect the web UI.** The daemon still binds `0.0.0.0:6767` and
serves the API + WebSocket + UI locally; `curl http://127.0.0.1:6767/api/health`
returns 200 throughout. If the **host** browser sees a refused connection, that is
a port-mapping issue (see "The browser UI never loads" above), not the relay.

**Fix.** The kit now sets `PASEO_RELAY_ENABLED=false` in `spec.yaml` (read at
daemon config load, precedence over persisted config, survives restarts/self-
updates), so the relay is off by default. If you are running an older sandbox that
predates this, disable it live and bounce the daemon:

```bash
acq exec <sandbox> -- sh -c '
  node -e "const f=process.env.HOME+\"/.paseo/config.json\";const c=require(f);(c.daemon??={}).relay={enabled:false};require(\"fs\").writeFileSync(f,JSON.stringify(c,null,2)+\"\n\",{mode:0o600})"
  for pid in $(pgrep -u "$(id -u)" -f "paseo daemon start"); do
    tr "\0" " " </proc/"$pid"/cmdline | grep -q "supervisor:paseo-daemon" && continue
    kill "$pid"
  done'
```

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
