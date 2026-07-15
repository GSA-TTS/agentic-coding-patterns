# Troubleshooting — openchamber kit

Failure modes specific to the OpenChamber kit. They assume you applied the kit
to a sandbox (see [README.md](README.md#usage)).

## The browser page won't load / no host port

**Symptoms:** `sbx ports <sandbox>` shows no mapping for container port 3000, or
the browser can't connect.

**Cause:** `publishedPorts` is an immutable, create-time setting. If the kit was
added to an already-running sandbox with `sbx kit add`, the port mapping is
skipped (sbx warns and continues).

**Fix:** recreate the sandbox with the kit applied at create time:

```bash
sbx rm <sandbox>
acq run opencode /path/to/project      # with ACQ_EXTRA_KITS set (see README)
# or: sbx run opencode --kit "git+…&dir=integrations/isolation/sbx-kits/openchamber" /path/to/project
```

## OpenChamber didn't start

**Symptoms:** the host port is mapped but nothing answers on it.

**Cause:** the startup step is still installing OpenChamber (first boot does a
one-time npm install), the install failed, or the managed OpenCode server didn't
come up (e.g. no model provider configured, so `opencode serve` exits).

**Fix:** check the logs inside the sandbox:

```bash
sbx exec <sandbox> -- sh -c 'cat /tmp/openchamber-install.log'   # first-boot install
sbx exec <sandbox> -- sh -c 'cat /tmp/openchamber.log'
sbx exec <sandbox> -- sh -c 'cat /tmp/opencode-serve.log'
sbx exec <sandbox> -- sh -c 'openchamber status'
```

If `opencode serve` is failing, confirm a provider is configured — pair this kit
with the `usai-provider` kit (the default GSA setup does). Then re-run the
startup steps manually (the startup script is inlined in the kit; the commands
below reproduce it):

```bash
sbx exec <sandbox> -- sh -lc '
  PW="$(cat ~/.local/state/openchamber/opencode-server-password)"
  OPENCODE_SERVER_PASSWORD="$PW" nohup opencode serve --hostname 127.0.0.1 --port 4096 >/tmp/opencode-serve.log 2>&1 &
  OPENCODE_SKIP_START=true OPENCODE_PORT=4096 OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
    OPENCODE_SERVER_PASSWORD="$PW" openchamber --lan --port 3000 >/tmp/openchamber.log 2>&1 &
'
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
sbx exec <sandbox> -- sh -c 'echo "${HTTPS_PROXY:-unset}"; echo "PROXY_CA len=${#PROXY_CA_CERT_B64}"'
# then restart the sandbox so the startup step re-runs the install:
sbx stop <sandbox> && sbx run --name <sandbox>
```

If the prebuilt still can't be fetched (blocked release-asset hosts), ensure
`github.com`, `objects.githubusercontent.com`, and
`release-assets.githubusercontent.com` are permitted — under org governance,
kit `caps.network.allow` is superseded by org policy (`sbx policy log <sandbox>`
shows what was blocked).

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

## The terminal TUI and the browser show different sessions

**Not a bug.** This is expected — see
[Session sharing](README.md#session-sharing-important). To drive the same server
from a terminal, attach with the per-sandbox password:

```bash
sbx exec <sandbox> -- sh -lc \
  'OPENCODE_SERVER_PASSWORD="$(cat ~/.local/state/openchamber/opencode-server-password)" \
     opencode attach http://127.0.0.1:4096'
```

## `opencode attach` returns 401 / can't connect to the managed server

**Cause:** `opencode serve` requires Basic auth; attaching without the
per-sandbox password is rejected.

**Fix:** pass `OPENCODE_SERVER_PASSWORD` from the file the kit wrote (see the
command above). Confirm the file exists:

```bash
sbx exec <sandbox> -- sh -c 'test -s ~/.local/state/openchamber/opencode-server-password && echo present'
```

## Do multiple sandboxes fight over port 3000?

**No.** `publishedPorts` declares the *container* port. sbx allocates a distinct
**ephemeral host port on `127.0.0.1` per sandbox**, so several sandboxes running
this kit each get their own host port — they don't collide. `sbx ports
<sandbox>` shows which host port maps to container 3000 for that sandbox.

If you'd rather pin each to a known host port, publish them explicitly:

```bash
sbx ports <sandbox-a> --publish 3000:3000    # host 3000 → container 3000
sbx ports <sandbox-b> --publish 3001:3000    # host 3001 → container 3000
```

Inside every sandbox OpenChamber always listens on container port 3000; that's
private to each sandbox's network namespace, so there's no in-container conflict
either.
