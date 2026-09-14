# TROUBLESHOOTING — agor-daemon-egress

## The executor can't reach the daemon / session never streams results

Symptoms: the Agor session starts but produces no output; executor logs show a
WebSocket/connection error to the daemon.

1. **Confirm the kit was applied.** The `orchestrators/agor` wrapper must pass
   `AGOR_EGRESS_KIT` and include `--kit "$AGOR_EGRESS_KIT"` on `acq create`. Run
   the wrapper with `AGOR_SANDBOX_DRY_RUN=1` and check the printed `acq create`
   line includes `--kit`.
2. **Confirm the daemonUrl host alias matches the backend.** Inside the sandbox,
   `localhost`/`127.0.0.1` is the *guest's own loopback* — it never reaches the
   host daemon. The wrapper rewrites a loopback `daemonUrl` to `AGOR_DAEMON_HOST`
   (default `host.microsandbox.internal` for msb; `host.docker.internal` for sbx).
   If the daemon advertises a non-loopback URL, set `AGOR_DAEMON_HOST` to match.
3. **Confirm the host alias + port are allow-listed.** The kit allow-lists
   `host.docker.internal:3030` (sbx) and `host.microsandbox.internal:3030` (msb).
   If your daemon uses a different port, edit `spec.yaml`'s `caps.network.allow`.
4. **Backends are deny-by-default.** If you removed or mistyped the allow entry,
   egress to the daemon is blocked. Re-check `spec.yaml`.
5. **Routing vs. allow-listing.** This kit only *allow-lists* the destination.
   Whether the runtime can actually **route** to the host-gateway alias is a
   backend property, not something the kit controls. Verify from inside the
   sandbox:
   `acq exec <sandbox> -- sh -c 'getent hosts host.microsandbox.internal'`
   (msb) or `… host.docker.internal` (sbx).

## `agor-executor` is not found inside the sandbox

Symptoms: the wrapper's `acq exec … -- agor-executor --stdin` fails with
`command not found`.

1. **The install phase needs node/npm.** The kit's `install` command runs
   `npm install -g agor-live`. If the base image lacks node/npm, the script warns
   and skips (non-fatal), leaving no `agor-executor`. Use a base image that ships
   node/npm (the default `shell-docker` image does), or bake the executor in.
2. **npm install failed (offline / blocked egress).** The install needs
   `registry.npmjs.org` (allow-listed by this kit). If the sandbox could not reach
   npm, `agor-executor` is absent. Re-create the sandbox once npm egress works.
3. **Shim path.** The kit writes the shim at `/usr/local/bin/agor-executor`,
   execing `node "$(npm root -g)/agor-live/dist/executor/cli.js"`. Confirm both
   exist: `acq exec <sandbox> -- sh -c 'command -v agor-executor; ls -l $(npm root -g)/agor-live/dist/executor/cli.js'`.

## On msb, egress seems broader than the port I set

Expected. `acq`'s msb adapter emits `--net-rule allow@host.microsandbox.internal`
and **strips the `:port`** — msb keys on the domain only, so egress is host-wide
for that host. sbx keeps the port. The msb port-stripping is benign for this
single-host egress. A live msb run is tracked at
[#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257).

## `validate-kits.py` fails for this kit

- **Missing registry entry** — add `agor-daemon-egress` to
  [`../kits.yaml`](../kits.yaml).
- **Missing README** — this file's sibling `README.md` must exist (parity note).
- **Schema error** — the kit uses `caps.network.allow` + `files` + `commands` +
  `backend_shortcuts`. Keep `files[].path`/`commands[].phase` within the
  `hybrid/v1` schema (safe path charset, `install`/`initFiles`/`startup` phases,
  numeric `user` uid).
