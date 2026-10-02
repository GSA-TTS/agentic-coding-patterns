# Troubleshooting — opendesign acq kit

Symptoms, causes, and fixes for the OpenDesign headless browser kit. Most
diagnosis is done with `acq exec <sandbox> -- sh -c '…'`.

OpenDesign state and logs can contain prompts, run metadata, generated file
paths, and local provider/media settings. Do not paste full logs, diagnostics, or
`OD_DATA_DIR` files into public issues or PR comments; redact first or share a
reviewed diagnostics bundle through the approved channel.

---

## Browser UI never loads / connection refused

Check the port mapping and daemon health:

```bash
acq ports <sandbox>
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:17456/api/daemon/status && echo OK'
```

- `/api/daemon/status` returns 200 and the port is mapped: open
  `http://localhost:<host-port-for-7456>`. If the browser still cannot connect,
  the in-guest daemon is healthy but the publish relay is not — see "Host curl
  returns Empty reply from server" below.
- `/api/daemon/status` fails: first boot may still be installing/building OpenDesign.
  Watch the logs:

  ```bash
  acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-install.log'
  acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-daemon.log'
  acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/opendesign/opendesign-relay.log'
  ```

## First boot takes a long time

OpenDesign is built from source in the sandbox. First boot downloads a pinned
Node 24 tarball, fetches the OpenDesign source tag, installs pnpm dependencies,
and builds both the daemon and web app.

Later starts skip the build when the persisted marker matches the pinned
OpenDesign commit, Node version, and pnpm version.

## No install log and no daemon process

If `/home/agent/.local/share/opendesign` exists but both logs are missing and no
`node`/`pnpm`/`git` process is running, check persistent volume ownership:

```bash
acq exec <sandbox> -- sh -c 'stat -c "%U:%G %a %n" /home/agent/.local/share/opendesign /home/agent/.local/state/opendesign'
```

The OpenDesign volume must be writable by `agent`. This kit includes a root
startup step that runs before the agent-owned supervisor:

```bash
chown 1000:1000 /home/agent/.local/share/opendesign /home/agent/.local/state/opendesign
```

If the volume remains `root:root 755`, the backend did not run the ownership-init
startup command or the sandbox was created with an older kit version. Recreate
the sandbox with the current kit.

## Node 24 install fails

The install script supports Linux `x86_64`/`amd64` and `aarch64`/`arm64` only.
It downloads Node from `nodejs.org` and verifies SHA-256.

Check:

```bash
acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-install.log'
```

Common causes:

- `nodejs.org:443` is blocked by egress policy.
- The sandbox architecture is not x64 or arm64.
- TLS inspection is active but the CA bundle was not installed; pair with
  `zscaler-ca-certificate`.

## pnpm install or build fails

OpenDesign uses Node `~24` and pnpm `10.33.2`. The kit installs pnpm through
Corepack under the persistent kit volume.

Check:

```bash
acq exec <sandbox> -- sh -c 'tail -n 120 ~/.local/state/opendesign/opendesign-install.log'
```

Common causes:

- `registry.npmjs.org:443` blocked.
- GitHub release asset hosts blocked for native prebuild downloads.
- Inspecting proxy CA missing.
- Upstream OpenDesign dependency/build regression at the pinned tag.
- Not enough memory for the Next.js production build. With the earlier 1536 MiB
  heap cap, `pnpm --filter @open-design/web build` compiled successfully and then
  failed during `Running TypeScript ...` with `JavaScript heap out of memory`.
  This kit now defaults `NODE_OPTIONS` to `--max-old-space-size=3072`; if that is
  still too small for the active sandbox, increase `NODE_OPTIONS`, use a larger
  sandbox, or use a prebuilt OpenDesign artifact if one becomes available.

The script is fail-soft by design: the sandbox should still start even when the
optional OpenDesign UI is unavailable.

## Daemon restarts with NODE_MODULE_VERSION mismatch

If the build completes but the daemon restarts with an error like:

```text
better_sqlite3.node was compiled against a different Node.js version
NODE_MODULE_VERSION 137 ... This version of Node.js requires NODE_MODULE_VERSION 127
Node.js v22.x
```

then the daemon is being launched with the sandbox's system Node instead of the
kit-managed Node 24 runtime used to build native modules. The startup script
refreshes `PATH` after install so `node` resolves to:

```text
/home/agent/.local/share/opendesign/tools/node-v24.21.0-linux-<arch>/bin/node
```

Recreate the sandbox with the current kit. If it still happens, check the daemon
log and effective Node path:

```bash
acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-daemon.log'
acq exec <sandbox> -- sh -c '
  case "$(uname -m)" in x86_64|amd64) a=x64 ;; aarch64|arm64) a=arm64 ;; *) a=unknown ;; esac
  PATH="$HOME/.local/share/opendesign/tools/node-v24.21.0-linux-$a/bin:$PATH"
  node -p '\''process.version + " " + process.versions.modules'\''
'
```

## Host curl returns "Empty reply from server" / connection refused while guest curl works

The publish relay is probably not running. The daemon binds guest `127.0.0.1`
only on internal port `17456` (on purpose — see the 403 entry below), and
`~/opendesign-relay.mjs` is what listens on published guest port `7456` that
msb/acq publishing actually dials.

```bash
acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/opendesign/opendesign-relay.log'
acq exec <sandbox> -- sh -c 'pgrep -af "supervisor:opendesign-relay" || echo "relay supervisor not running"'
```

Confirm both listeners. `1D20` hex = 7456 and `4430` hex = 17456:

```bash
acq exec <sandbox> -- sh -c 'grep -Ei ":(1D20|4430)" /proc/net/tcp'
# 0100007F:4430 state 0A  -> daemon on 127.0.0.1:17456   (expected)
# <guest-ip-hex>:1D20 0A  -> relay on published guest port 7456 (expected)
# 00000000:* state 0A     -> wrong; see the 403 entry below
```

If the relay log shows `no default-route interface yet`, the guest network came
up late; the relay rescans every 10s and should recover on its own. If it shows
`bind failed`, read the reported error code. If `~/opendesign-relay.mjs` is
missing entirely, the sandbox was created with an older kit version — recreate
it.

## Export diagnostics (or another UI action) returns 403 Forbidden

OpenDesign gates a subset of its API on the request **peer** address being
loopback (`requireLocalDaemonRequest`, upstream
`apps/daemon/src/http/local-daemon-request.ts`). If the daemon is bound to
`0.0.0.0`, or if the published path bypasses the relay, requests published from
the host arrive with a guest-network peer address and these routes 403 while the
rest of the UI works normally:

```text
GET  /api/diagnostics/export                 <- Settings -> About -> Export diagnostics
POST /api/strategies/od-next/rollout         <- OD Next strategy switch (fails silently)
POST /api/diagnostics/chat-scroll-forensics
```

The current kit avoids this by binding the daemon to `127.0.0.1:17456` and
publishing it through the relay on guest port `7456`. If you see a 403 anyway,
check which address holds both ports:

```bash
acq exec <sandbox> -- sh -c 'grep -Ei ":(1D20|4430)" /proc/net/tcp'
# want 0100007F:4430 (127.0.0.1:17456) for the daemon
# want <guest-ip-hex>:1D20 for the relay on published guest port 7456
# 00000000:* is wrong; a wildcard listener can bypass the relay path
```

A daemon on `0.0.0.0` means the sandbox was created with an earlier kit version
or `OPENDESIGN_DAEMON_BIND_HOST` was deliberately set for testing. The startup
script intentionally ignores backend-provided `OD_BIND_HOST` values for the
daemon, because `0.0.0.0` breaks peer-loopback-gated routes.

Confirm the fix from the host with the exact request the UI button makes:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Origin: http://localhost:<host-port>" \
  http://localhost:<host-port>/api/diagnostics/export
# 200 = working. 403 = the daemon saw a non-loopback peer.
```

The daemon also journals its own API failures, which is the fastest way to
confirm the cause — the peer-gated routes appear there and nothing else does:

```bash
acq exec <sandbox> -- sh -c 'node -e "const fs=require(\"fs\"); const p=process.env.OD_DATA_DIR+\"/diagnostics/environment-evidence.json\"; const j=JSON.parse(fs.readFileSync(p,\"utf8\")); console.log(JSON.stringify({recentApiFailures:j.recentApiFailures||j.apiFailures||null}, null, 2))"'
# The full file may contain environment and diagnostic details; redact before sharing.
```

As a fallback that bypasses HTTP entirely, the CLI writes the same bundle:

```bash
acq exec <sandbox> -- sh -c 'cd ~/.local/share/opendesign/source && node apps/daemon/dist/cli.js diagnostics export /tmp/od-diag.zip --json'
```

## Every run fails with "Cannot connect to API" after a long delay

Symptom: a prompt runs for ~2-3 minutes and the UI shows "This task failed to
run. Please retry."

Cause: OpenCode never read the `usai-provider` config, so it has no `usai`
provider and fell back to its own hosted gateway (`opencode.ai/zen`), which this
kit's egress policy does not allow. It then exhausts its retry budget.

OpenDesign launches agent children with `OD_SANDBOX_MODE=1`, which rewrites
`HOME` and `XDG_CONFIG_HOME` to a private agent home under `OD_DATA_DIR`.
OpenCode resolves its global config from those variables, finds the empty stub it
auto-created at `$OD_DATA_DIR/sandbox/config/opencode/opencode.jsonc`, and never
looks at `~/.config/opencode/opencode.jsonc`.

Confirm from the child's own log — the provider and model names are the tell:

```bash
acq exec <sandbox> -- sh -c 'grep -E "loading path|providerID|stream error" ~/.local/share/opendesign/data/sandbox/config/data/opencode/log/opencode.log | tail -n 20'
# BAD:  providerID=opencode modelID=big-pickle   ... url: https://opencode.ai/zen/...
# GOOD: providerID=usai     modelID=claude-opus-5
```

And check the failed run's own record:

```bash
acq exec <sandbox> -- sh -c 'grep -h -E "status|failureDetail" ~/.local/share/opendesign/data/runs/*/state.json 2>/dev/null | tail -n 40'
```

The current kit fixes this by exporting `OPENCODE_CONFIG`. Verify it reached the
daemon, and that OpenCode resolves `usai/*` models under the same rewritten
environment OpenDesign uses:

```bash
acq exec <sandbox> -- sh -c 'tr "\0" "\n" < /proc/$(pgrep -f "apps/daemon/dist/cli.js" | head -n1)/environ | grep OPENCODE_CONFIG'

acq exec <sandbox> -- sh -c '
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc" \
  HOME="$OD_DATA_DIR/sandbox/agent-home" \
  XDG_CONFIG_HOME="$OD_DATA_DIR/sandbox/config" \
  XDG_DATA_HOME="$OD_DATA_DIR/sandbox/config/data" \
  XDG_CACHE_HOME="$OD_DATA_DIR/sandbox/cache" \
  opencode models | grep "^usai/" | head'
```

If `OPENCODE_CONFIG` is absent, the sandbox predates this fix — recreate it. If
it is present but no `usai/*` models resolve, `usai-provider` is not paired or
`USAI_API_KEY` is not injected; see the USAi section below.

Note there is no workaround through the OpenDesign UI: Settings → Local CLI only
accepts `OPENCODE_BIN` for the opencode agent (upstream `app-config.ts`
allowlist), not a config path or an API key.

## OpenDesign shows no usable OpenCode agent

This kit expects an existing OpenCode installation in the sandbox. It does not
install OpenCode.

Check:

```bash
acq exec <sandbox> -- sh -c 'command -v opencode || command -v opencode-cli || true'
acq exec <sandbox> -- sh -c 'node -e "const fs=require(\"fs\"); const p=process.env.OD_DATA_DIR+\"/app-config.json\"; const c=JSON.parse(fs.readFileSync(p,\"utf8\")); console.log(JSON.stringify({agentId:c.agentId,onboardingCompleted:c.onboardingCompleted,telemetry:c.telemetry}, null, 2))" 2>/dev/null || true'
```

The startup script seeds `agentId: "opencode"` only when no user choice exists.
If OpenCode is missing, create the sandbox with an OpenCode base agent, for
example `acq run opencode /path/to/project`.

## USAi/OpenCode provider does not work

This kit does not configure model-provider credentials. Pair it with the default
`usai-provider` kit and inject the USAi key through `acq`:

```bash
acq secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
```

Then check inside the sandbox:

```bash
acq exec <sandbox> -- sh -c 'test -n "$USAI_API_KEY" && echo USAI_API_KEY-present'
acq exec <sandbox> -- sh -c 'grep -n "api.gsa.usai.gov" ~/.config/opencode/opencode.jsonc 2>/dev/null || true'
```

If the config exists and the key is present but OpenDesign runs still fail, see
"Every run fails with Cannot connect to API" above — the config exists but
OpenDesign's sandbox mode may be pointing OpenCode somewhere else.

Do not copy `USAI_API_KEY` into OpenDesign `media-config.json`; OpenDesign should
launch OpenCode, and OpenCode should read USAi through its own config/env path.

## OpenDesign media provider keys are missing

OpenDesign media providers are separate from the core OpenCode/USAi chat path.
For v1, this kit does not seed media provider keys. Configure extra media
providers through OpenDesign settings only if you need them.

OpenDesign stores those settings under `OD_DATA_DIR`, which this kit maps to:

```text
/home/agent/.local/share/opendesign/data
```

Treat that directory as sensitive local state.

## State does not persist

This kit declares a persistent volume at:

```text
/home/agent/.local/share/opendesign
```

If projects/settings disappear after restart, verify the backend applied the
volume declaration:

```bash
acq exec <sandbox> -- sh -c 'mount | grep /home/agent/.local/share/opendesign || true'
acq exec <sandbox> -- sh -c 'ls -la /home/agent/.local/share/opendesign'
```

If the path is not mounted, the active `acq` version/backend may not support the
neutral `volumes` field yet.
