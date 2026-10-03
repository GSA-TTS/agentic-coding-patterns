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

## The published port reaches a DIFFERENT daemon than `acq exec` (stale host forwarder)

**Symptom.** Everything looks healthy in isolation, yet the browser behaves as if
it is talking to a different machine — agents and workspaces you created via the
CLI are absent from the UI (or vice versa), and **provider calls from browser
sessions fail with a rejected credential**, e.g.:

```text
{"detail":"Authentication failed"}
```

Note that `Authentication failed` is **not** `Not authenticated`: a non-empty
credential *was* sent and rejected. That distinction is the tell — the header was
populated, but with an unsubstituted value.

**Why a wrong-daemon route breaks auth specifically.** Under acq/msb, injected
secrets can be **placeholders** that the sandbox's TLS-interception layer
substitutes on the wire. A request that reaches a daemon *outside* that path
still carries the placeholder, so the provider receives a well-formed but invalid
credential. The auth error is therefore a *symptom of misrouting*, not a bad key —
chasing the key wastes the most time on this failure.

**Diagnosis — compare the two identities.** A Paseo daemon has a stable id in
`~/.paseo/server-id`. Ask the host-published port what it is, then ask the guest
directly. They must match:

```bash
scripts/paseo-verify-identity <sandbox>
```

That check fails loudly on a mismatch and prints the remediation. To do it by
hand, the guest side is:

```bash
acq exec <sandbox> -- sh -lc 'cat ~/.paseo/server-id; cat ~/.paseo/paseo.pid'
```

and the host side is a `hello` frame over the published port's `/ws`, reading
`serverId` from the `server_info` reply.

**Cause — a host forwarder that outlived the sandbox it was created for.** The
create-time `-p HOST:GUEST` publish runs a host-side `msb` process. That process
can **survive `acq stop` *and* `acq rm`** and keep holding the host port. The
replacement sandbox's forwarder then cannot bind, while `acq ports` still reports
the mapping as configured — so every restart appears to succeed and changes
nothing. Two independent tells:

- **Age.** The listener is *older than the sandbox it serves*. Compare its
  `ELAPSED` against guest uptime:

  ```bash
  ps -ww -o pid,ppid,lstart,etime,command -p <listener-pid>
  acq exec <sandbox> -- sh -c 'cut -d. -f1 /proc/uptime'
  ```

- **Build.** The listener's binary path may belong to a **different `msb`
  installation** than the one `acq` drives (this tap ships a pinned
  `microsandbox-acq` plus keg-only versioned formulas, and upstream's
  `microsandbox` owns the same `bin/msb`). A forwarder from another build is
  invisible to the active one, which is exactly why the lifecycle commands cannot
  release it:

  ```bash
  lsof -nP -iTCP:<host-port> -sTCP:LISTEN     # note the PID
  ps -ww -o command= -p <listener-pid>        # -ww: do not truncate the path
  command -v msb                              # compare installation prefixes
  ```

  Do not rely on a truncated `ps` line — the version segment is often exactly
  what gets cut off.

> A `PPID` of `1` is **normal** here: launchd adopts the forwarder. It is not by
> itself evidence of a leak. Age and build are the discriminating signals.

**How you get one.** Switching the host's `msb` version is the known trigger:
replacing the active binary does not stop forwarders from the outgoing build, and
because upstream's `microsandbox` and the pinned `microsandbox-acq` both own
`bin/msb`, a swap leaves a forwarder no surviving binary will reap. If you have
upgraded, downgraded, or pinned `msb` while a sandbox had a published port, this
is the failure to check for first.

**Fix.** Kill the stale forwarder by PID, confirm the port is genuinely free,
then restart so the sandbox can bind its own:

```bash
kill <listener-pid>
lsof -nP -iTCP:<host-port> -sTCP:LISTEN     # must print NOTHING before continuing
# only if it survived SIGTERM:
kill -9 <listener-pid>

acq stop <sandbox> && acq start <sandbox>
scripts/paseo-verify-identity <sandbox>
```

If the listener's `PPID` is **not** 1, do not `kill -9` blindly — it may have
siblings under a supervisor. Investigate the parent first.

> **`paseo daemon restart` will not fix this.** Elsewhere in this guide that is
> the right way to bounce the daemon, but here the stale component is the
> **host-side forwarder**, not the guest daemon. Restarting the daemon alone was
> observed to change nothing: the daemon PID changed while the host listener kept
> the port and kept serving the old backend. The sequence above is required —
> kill the forwarder, then restart the **sandbox** so it can bind a new one.

Success is the two ids **agreeing with each other**, never matching a remembered
value: the id changes whenever the VM is recreated.

**Then clear stale browser state.** The daemon registry lives in the browser and
pins a `serverId`. Once that id no longer exists anywhere it does not self-heal:
use DevTools ▸ **Application** ▸ **Storage** ▸ **Clear site data**, or delete the
`@paseo:daemon-registry` and `@paseo:replica-cache` keys. As noted below, "Empty
Cache and Hard Reload" does **not** clear Local Storage.

**Confirming the fix took.** The daemon logs the provenance of each WebSocket
client. Host-originated clients appear as `"peer":"external"`; in-guest CLI
clients as `"peer":"loopback"`. If the count of `external` clients is zero after
you have opened the UI, host traffic is still landing somewhere else:

```bash
acq exec <sandbox> -- sh -c 'grep -c "\"peer\":\"external\"" ~/.paseo/daemon.log'
```

> This reads the daemon's **own** log (`~/.paseo/daemon.log`), not the supervisor's
> captured stdout (`~/.local/state/paseo/paseo-daemon.log`) that the other sections
> here tail. They carry the same stream, but the former does not depend on this
> kit's redirect, so it is the safer one to assert on.

## Host curl returns "Empty reply from server" (guest curl works)

> **First rule out a just-restarted daemon.** For a few seconds after a restart
> the daemon accepts the TCP connection but answers nothing, producing exactly
> this `rc=52`. Retry for ~30s before treating it as a fault;
> `scripts/paseo-verify-identity` and `scripts/verify` both build in that grace.
> The cause below applies only when it persists.

**Symptom.** `acq ports <sandbox>` shows container `6767` mapped to a host port,
and the daemon answers from *inside* the sandbox:

```bash
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:6767/api/health && echo OK'   # -> OK
```

…but the same request from the **host** fails:

```bash
curl http://127.0.0.1:<host-port-for-6767>/
# curl: (52) Empty reply from server
```

Chrome shows `net::ERR_EMPTY_RESPONSE`. The TCP connect to the host listener
*succeeds* — this is not a connection reset / ingress-deny.

**Cause — the daemon is bound to guest loopback only.** On the **msb** backend,
create-time port publish (`-p HOST:GUEST`) binds a host loopback listener but the
publisher connects to the sandbox's **guest network IP**, not guest `127.0.0.1`.
A daemon bound only to `127.0.0.1:6767` is therefore healthy from inside the
sandbox yet unreachable through the create-time published port. Confirm the bind:

```bash
acq exec <sandbox> -- sh -c 'awk "\$2 ~ /:1A6F\$/ && \$4==\"0A\" {print \$2}" /proc/net/tcp'
# 00000000:1A6F = 0.0.0.0:6767 (good); 0100007F:1A6F = 127.0.0.1:6767 (the bug)
```

**Fix.** This kit sets `PASEO_LISTEN=0.0.0.0:6767` in `spec.yaml` so the guest
daemon binds all interfaces and the create-time publish can reach it. If you are
running an older sandbox that predates this (or a manual `PASEO_LISTEN` override to
loopback), either rebuild with the current kit or use acq's post-hoc publish path,
which tunnels from *inside* the guest and can reach guest loopback:

```bash
acq --backend msb ports <sandbox> --publish 16767:6767
curl http://127.0.0.1:16767/
```

The host side of the mapping stays loopback-only either way, so the `0.0.0.0`
in-guest bind does not widen host exposure. The important distinction is which
side of the boundary dials the guest port: create-time publishing dials the guest
network IP, while post-hoc publishing tunnels from inside the guest and can reach
guest loopback.

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

1. **Prefer `localhost` — but only if `localhost` resolves to the address family
   the forwarder actually bound.** The client's built-in local daemon key and the
   injected hint's endpoint both resolve to `localhost:<port>` (the client
   normalizes `127.0.0.1`/`::1`/`0.0.0.0` → `localhost`), so a `localhost` address
   bar usually gives the cleanest first attach:

   ```bash
   acq ports <sandbox>        # host port for 6767
   # open http://localhost:<host-port-for-6767>
   ```

   > **`localhost` is a name, and a name can select a different listener.** The
   > host forwarder binds **IPv4** (`127.0.0.1`), but `localhost` commonly resolves
   > to `::1` *first*. That is usually harmless — browsers implement Happy Eyeballs
   > ([RFC 8305](https://www.rfc-editor.org/rfc/rfc8305)), racing both families and
   > reaching the IPv4 listener anyway, and an unbound loopback port answers with an
   > immediate `ECONNREFUSED` rather than stalling.
   >
   > It stops being harmless when **something else is listening on `[::1]:<port>`**.
   > The two binds do not conflict — an IPv4-only forwarder on `*:<port>` and an
   > unrelated IPv6 listener on `[::1]:<port>` coexist happily — so a `localhost`
   > URL can silently reach the *other* process while the IPv4 literal reaches the
   > daemon you meant. That is the same wrong-daemon failure this section exists to
   > catch, arriving by name resolution instead of by a stale forwarder. Check what
   > is actually bound, on both families:
   >
   > ```bash
   > lsof -nP -iTCP:<host-port> -sTCP:LISTEN     # expect ONE row; TYPE = IPv4
   > node -e 'require("dns").lookup("localhost",{all:true,verbatim:true},(e,a)=>console.log(a))'
   > ```
   >
   > If `lsof` shows more than one listener on that port, prefer the `127.0.0.1`
   > literal in the address bar — it pins the family and removes resolution from the
   > path — and make sure any stored daemon-registry entry uses the IPv4 endpoint
   > too. `scripts/paseo-verify-identity` reports this pairing for you.
   >
   > Two narrower cases worth knowing, since the diagnostic commands in this guide
   > use `curl`: a client that does **not** fall back between families (`curl -6`,
   > `ipv6Only` sockets, some older libraries) will get `ECONNREFUSED` against an
   > IPv4-only listener, and a **hang** rather than a refusal means packets are being
   > silently dropped — a host firewall rule, not a name-resolution mismatch.

2. **Clear stale client-side host state.** The host registry lives in the
   **browser**, not the daemon — a stale entry from an earlier session (a
   different port/label, a prior relay-based host, or an incompatible persisted
   cache from a different client version — see "handshake succeeds but the socket
   is torn down" below) can keep the client cycling. In DevTools ▸ **Application**
   ▸ **Local Storage** for the origin, delete the `@paseo:daemon-registry` (and
   `@paseo:replica-cache`) keys, then reload.

   > **"Empty Cache and Hard Reload" is NOT enough here.** That Chrome action
   > clears only the **HTTP cache** (JS/CSS/network responses); it does **not**
   > clear **Local Storage** or **IndexedDB**, which is exactly where Paseo keeps
   > this host state. Use DevTools ▸ **Application** ▸ **Storage** ▸ **Clear site
   > data** (which does clear Local Storage + IndexedDB), or delete the keys above
   > by hand.

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

## Handshake succeeds but the socket is torn down every ~30s (incompatible client cache / version skew)

**Symptom.** A close relative of the "No hosts" loop above, but with a distinct
signature. The `hello` handshake *succeeds* (`"msg":"Client connected via hello"`,
`"resumed":true`), yet the socket is closed by the **client** with
`code:1000 "Client closed"` on a **flat ~30s cadence** (not the growing backoff of
the benign case), and the client never advances past `hello` — the daemon's
`inboundMessageTypesTop` stays `["hello", …]` only, never a session subscribe. The
UI sits on a spinner. Two tells distinguish this from the benign loop:

- The reconnect interval is **fixed ~30s**, not exponentially growing. That is the
  client's **liveness heartbeat** (a `ping` on a ~10s timer with a ~15s timeout;
  **2** consecutive missed `pong`s force a transport dispose + reconnect), not
  reconnect backoff.
- The daemon log shows a client whose `appVersion` **differs from the daemon
  version**, and/or a client that only ever sends `hello`.

**Cause — a client whose persisted cache or protocol is incompatible with the
daemon.** Two forms seen in the wild:

1. **A newer client attached to an older daemon** (e.g. a Paseo **desktop app**
   `0.4.0`, `origin: paseo://app`, talking to this kit's pinned `0.3.1` daemon).
   The `hello` is version-tolerant enough to complete, but the post-hello liveness
   contract differs, the `ping` is never answered, liveness fails, and the client
   tears the socket down and retries forever. **Fix:** stop the mismatched client
   (or match its version — see the version pin below); drive the UI from the
   daemon-served bundle at `http://localhost:<host-port>` so client and daemon are
   the same version.

2. **An incompatible persisted cache in your normal browser window.** Paseo `0.3.1`
   can get stuck on a stale/incompatible client cache in **Local Storage /
   IndexedDB** (`@paseo:daemon-registry`, `@paseo:replica-cache`). This is fixed
   upstream in **0.4.0** ("Fixed crash when persisted cache was incompatible",
   [getpaseo/paseo#3289](https://github.com/getpaseo/paseo/pull/3289)). **Fix:**
   clear the site's storage — DevTools ▸ **Application** ▸ **Storage** ▸ **Clear
   site data** (an "Empty Cache and Hard Reload" is **not** enough — it leaves
   Local Storage/IndexedDB intact), or run a version-matched client. An Incognito
   window (empty storage) proves it: if the loop disappears there but your normal
   window still loops after a hard reload, it is this incompatible-cache case, and
   "Clear site data" resolves it.

**Diagnose which is which** — compare the client `appVersion` in the log against
the daemon version:

```bash
acq exec <sandbox> -- sh -c '
  grep -o "\"appVersion\":\"[^\"]*\"" ~/.local/state/paseo/paseo-daemon.log | sort | uniq -c
  paseo daemon status 2>/dev/null | grep -E "Daemon Version|CLI"'
# A single appVersion equal to the daemon version → not a skew; suspect the cache
# (form 2). A second, different appVersion → a mismatched client is attached (form 1).
```

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

- **npm global prefix permissions.** On the default sandbox template the system
  global prefix is root-owned, so the script installs Paseo into the agent-owned
  per-user prefix at `~/.npm-global` and uses the agent-owned cache at `~/.npm`.
  Verify the per-user install path:

  ```bash
  acq exec <sandbox> -- sh -c 'ls -la ~/.npm-global/bin 2>/dev/null; command -v paseo'
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
  restarts the daemon only when the value **changes**; force a restart with the
  supported CLI command:

  ```bash
  acq exec <sandbox> -- paseo daemon restart --home /home/agent/.paseo
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

**Fix.** The kit sets `PASEO_RELAY_ENABLED=false` in `spec.yaml` and persists
`daemon.relay.enabled=false` in config.json for Paseo 0.9 managed/config tooling,
so the relay is off by default. If you are running an older sandbox that predates
this, disable it live and restart the daemon:

```bash
acq exec <sandbox> -- sh -c '
  paseo daemon config set --home "${PASEO_HOME:-$HOME/.paseo}" daemon.relay.enabled false
  paseo daemon restart --home "${PASEO_HOME:-$HOME/.paseo}"'
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
