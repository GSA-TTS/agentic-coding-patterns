# Troubleshooting — openchamber kit

Failure modes specific to the OpenChamber kit. They assume you applied the kit
to a sandbox (see [README.md](README.md#usage)).

## The browser page won't load / no host port

**Symptoms:** `acq ports <sandbox>` (`sbx ports <sandbox>`) shows no mapping for
container port 3000 (or 4096), or the browser can't connect.

**Cause:** `acq`'s neutral→sbx kit translation does **not** carry the kit's
`backend_extras.sbx.publishedPorts`, so creating the sandbox with this kit does
not by itself publish the ports.

**Fix:** publish the two container ports (once per sandbox):

```bash
acq ports <sandbox> --publish 3000:3000    # OpenChamber web UI
acq ports <sandbox> --publish 4096:4096    # shared opencode server
acq ports <sandbox>                        # confirm the mappings
```

If you applied a *pre-translated* sbx-v2 kit directly via `sbx --kit`, the
`publishedPorts` are honored at create time and this manual step isn't needed.

## OpenChamber loads but shows no server

**Symptoms:** the OpenChamber page opens, but there is no live OpenCode server /
no sessions.

**Cause:** this is expected until the shared server is started. In this kit the
`opencode` **wrapper** owns the shared `opencode serve` on `:4096` and starts it
**on demand** — the startup script only manages OpenChamber, not the server.

**Fix:** run the wrapper once to bring the server up (no args), then reload
OpenChamber:

```bash
acq exec <sandbox> -- opencode        # starts the shared server on :4096
# or open a shell in the sandbox and run `opencode`
```

Then confirm the server answers:

```bash
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:4096/global/health >/dev/null && echo up'
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
acq exec <sandbox> -- sh -c 'cat /tmp/opencode-serve.log'        # written by the wrapper
acq exec <sandbox> -- sh -c 'openchamber status'
```

If the shared server is failing (see `/tmp/opencode-serve.log`), confirm a
provider is configured — pair this kit with the `usai-provider` kit (the default
GSA setup does). OpenChamber runs under a respawn loop, so a transient OpenChamber
failure self-heals within a few seconds; the shared server is not supervised (the
wrapper starts one instance), so if it exits, re-run `opencode`. To reproduce a
single run by hand (mirrors what the wrapper and `files/home/openchamber-start.sh`
do):

```bash
acq exec <sandbox> -- sh -lc '
  nohup opencode serve --hostname 0.0.0.0 --port 4096 >/tmp/opencode-serve.log 2>&1 &
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
sbx stop <sandbox> && sbx run --name <sandbox>   # (sbx backend; use the equivalent acq restart)
```

If the prebuilt still can't be fetched (blocked release-asset hosts), ensure
`github.com`, `objects.githubusercontent.com`, and
`release-assets.githubusercontent.com` are permitted — under org governance,
kit `caps.network.allow` is superseded by org policy (`sbx policy log <sandbox>`
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
the wrapper's "start shared server / offer a TUI" flow.

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

**Cause:** the shared server is started **on demand** by the wrapper. If nobody
has run `opencode` yet, nothing is listening on `:4096`.

**Fix:** start it, then attach:

```bash
acq exec <sandbox> -- opencode                       # start the shared server
acq exec <sandbox> -- opencode attach http://127.0.0.1:4096
```

The server is unsecured (no password), so no `OPENCODE_SERVER_PASSWORD` is
needed. Confirm it's listening:

```bash
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:4096/global/health >/dev/null && echo up'
```

## Do multiple sandboxes fight over ports 3000 / 4096?

**No.** The kit declares the *container* ports; the sbx backend allocates
distinct **ephemeral host ports on `127.0.0.1` per sandbox**, so several
sandboxes running this kit each get their own host ports — they don't collide.
`acq ports <sandbox>` (`sbx ports <sandbox>`) shows which host ports map to
container 3000 and 4096 for that sandbox.

If you'd rather pin each to a known host port, publish them explicitly:

```bash
sbx ports <sandbox-a> --publish 3000:3000    # host 3000 → container 3000
sbx ports <sandbox-b> --publish 3001:3000    # host 3001 → container 3000
```

Inside every sandbox OpenChamber always listens on container port 3000 and the
shared server on 4096; those are private to each sandbox's network namespace, so
there's no in-container conflict either.
