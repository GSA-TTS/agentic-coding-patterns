# Troubleshooting — opendesign acq kit

Symptoms, causes, and fixes for the OpenDesign headless browser kit. Most
diagnosis is done with `acq exec <sandbox> -- sh -c '…'`.

---

## Browser UI never loads / connection refused

Check the port mapping and daemon health:

```bash
acq ports <sandbox>
acq exec <sandbox> -- sh -c 'curl -fsS http://127.0.0.1:7456/api/daemon/status && echo OK'
```

- `/api/daemon/status` returns 200 and the port is mapped: open
  `http://localhost:<host-port-for-7456>`.
- `/api/daemon/status` fails: first boot may still be installing/building OpenDesign.
  Watch the logs:

  ```bash
  acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-install.log'
  acq exec <sandbox> -- sh -c 'tail -n 80 ~/.local/state/opendesign/opendesign-daemon.log'
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
acq exec <sandbox> -- sh -c 'PATH="$HOME/.local/share/opendesign/tools/node-v24.21.0-linux-arm64/bin:$PATH" node -p "process.version + " " + process.versions.modules"'
```

## Host curl returns "Empty reply from server" while guest curl works

The daemon likely bound guest loopback only. This kit sets `OD_BIND_HOST=0.0.0.0`
and starts with `--host 0.0.0.0` because msb/acq create-time publishing dials the
sandbox guest network IP, not guest `127.0.0.1`.

Confirm the bind:

```bash
acq exec <sandbox> -- sh -c 'grep -i ":1D20" /proc/net/tcp'
# 1D20 hex = 7456. 00000000:1D20 is 0.0.0.0:7456.
```

If it is loopback-only, rebuild the sandbox with the current kit or use a
post-hoc publish path that tunnels from inside the guest.

## OpenDesign shows no usable OpenCode agent

This kit expects an existing OpenCode installation in the sandbox. It does not
install OpenCode.

Check:

```bash
acq exec <sandbox> -- sh -c 'command -v opencode || command -v opencode-cli || true'
acq exec <sandbox> -- sh -c 'cat ~/.local/share/opendesign/data/app-config.json 2>/dev/null'
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
