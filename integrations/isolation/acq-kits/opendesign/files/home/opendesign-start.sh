#!/bin/sh
# opendesign-start.sh — install/update OpenDesign, seed default local-agent
# preferences, and supervise the headless daemon/UI.
#
# Runs as the agent user in the background on every sandbox start. It is
# idempotent and fail-soft: install/build errors are logged, but this script never
# fails the sandbox over an optional browser UI.

set -eu

APP_HOME="${OPENDESIGN_HOME:-$HOME/.local/share/opendesign}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/opendesign"
SOURCE_DIR="$APP_HOME/source"
NODE_VERSION="${OPENDESIGN_NODE_VERSION:-24.21.0}"
PNPM_VERSION="${OPENDESIGN_PNPM_VERSION:-10.33.2}"
OPENDESIGN_PUBLISHED_PORT="${OPENDESIGN_PUBLISHED_PORT:-7456}"
# Run the daemon on a different loopback-only port from the published relay. If
# both use the same port, ACQ can still reach the daemon directly and bypass the
# relay, which makes peer-loopback-gated routes return 403.
OD_PORT="${OPENDESIGN_DAEMON_PORT:-17456}"
# Loopback-only on purpose. OpenDesign gates several routes on the request PEER
# being a loopback address, so the daemon must never see a guest-network peer.
# Reachability for acq/msb port publishing is provided by opendesign-relay.mjs,
# which binds the guest network address and forwards to this loopback listener.
# See docs/decisions/disable-api-auth-loopback-boundary.md.
# Do not inherit OD_BIND_HOST from the backend: acq/msb may set it to 0.0.0.0
# for ordinary services, but that makes OpenDesign's peer-loopback-gated routes
# return 403. Use the kit-specific override only when deliberately testing.
OD_BIND_HOST="${OPENDESIGN_DAEMON_BIND_HOST:-127.0.0.1}"
OD_DATA_DIR="${OD_DATA_DIR:-$APP_HOME/data}"
DAEMON_LOG="$STATE_HOME/opendesign-daemon.log"
RELAY_LOG="$STATE_HOME/opendesign-relay.log"
SEED_LOG="$STATE_HOME/opendesign-seed.log"
INSTALL_SCRIPT="$HOME/opendesign-install.sh"
RELAY_SCRIPT="$HOME/opendesign-relay.mjs"
RESTART_DELAY="${OPENDESIGN_RESTART_DELAY:-5}"

mkdir -p "$APP_HOME" "$STATE_HOME" "$OD_DATA_DIR"

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$DAEMON_LOG"
}

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) node_arch="x64" ;;
  aarch64|arm64) node_arch="arm64" ;;
  *) node_arch="" ;;
esac

if [ -n "$node_arch" ]; then
  NODE_DIR="$APP_HOME/tools/node-v${NODE_VERSION}-linux-${node_arch}"
  if [ -x "$NODE_DIR/bin/node" ]; then
    PATH="$NODE_DIR/bin:$PATH"
  fi
fi
export PATH="$APP_HOME/pnpm-home:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
export COREPACK_HOME="$APP_HOME/corepack"
export PNPM_HOME="$APP_HOME/pnpm-home"
export OD_BIND_HOST OD_PORT OD_DATA_DIR OPENDESIGN_PUBLISHED_PORT
export OD_WEB_PORT="${OD_WEB_PORT:-$OPENDESIGN_PUBLISHED_PORT}"
export OD_DISABLE_API_AUTH="${OD_DISABLE_API_AUTH:-1}"
export OD_SANDBOX_MODE="${OD_SANDBOX_MODE:-1}"

# Make OpenDesign-spawned agent processes see the same configured OpenCode binary
# and model-provider environment the sandbox already has. No model key is copied
# into OpenDesign state; usai-provider + acq injection remain the credential path.
if command -v opencode >/dev/null 2>&1; then
  export OPENCODE_BIN="$(command -v opencode)"
fi

# Name the OpenCode global config explicitly.
#
# OpenDesign runs agent children with OD_SANDBOX_MODE=1, which rewrites HOME and
# XDG_CONFIG_HOME to a private agent home under OD_DATA_DIR (upstream
# apps/daemon/src/sandbox-mode.ts). OpenCode then resolves its global config to
# <OD_DATA_DIR>/sandbox/config/opencode/, where it auto-creates an empty stub —
# so the usai-provider kit's config is never read, no `usai` provider is defined,
# and OpenCode silently falls back to its own hosted gateway (opencode.ai/zen),
# which is not in this kit's egress allowlist. Every run then burns its retry
# budget and fails with "Cannot connect to API".
#
# OPENCODE_CONFIG is OpenCode's documented absolute-path override and survives
# the HOME/XDG rewrite, so the same config the sandbox uses interactively is the
# one OpenDesign-launched runs use. This names a config PATH only; no key
# material is copied. USAI_API_KEY stays in the environment and is resolved by
# that config's own {env:USAI_API_KEY} substitution at run time.
if [ -z "${OPENCODE_CONFIG:-}" ]; then
  for candidate in \
    "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.jsonc" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
  do
    if [ -f "$candidate" ]; then
      export OPENCODE_CONFIG="$candidate"
      log "using OpenCode config $candidate for OpenDesign-launched runs"
      break
    fi
  done
  if [ -z "${OPENCODE_CONFIG:-}" ]; then
    log "no OpenCode global config found; OpenDesign runs will use OpenCode defaults"
  fi
fi

if [ -x "$INSTALL_SCRIPT" ]; then
  sh "$INSTALL_SCRIPT" || true
else
  log "install script missing at $INSTALL_SCRIPT"
fi

# On first start the kit-managed Node directory is created by the installer above,
# so refresh PATH before seeding config or launching the daemon. Otherwise the
# supervisor can fall back to the sandbox's system Node and fail native modules.
if [ -n "$node_arch" ]; then
  NODE_DIR="$APP_HOME/tools/node-v${NODE_VERSION}-linux-${node_arch}"
  if [ -x "$NODE_DIR/bin/node" ]; then
    PATH="$NODE_DIR/bin:$PATH"
    export PATH
  fi
fi

if [ ! -f "$SOURCE_DIR/apps/daemon/dist/cli.js" ]; then
  log "OpenDesign daemon entrypoint missing; install likely failed"
  exit 0
fi

# Seed OpenDesign app preferences before first use. Keep this deliberately small:
# select OpenCode and mark onboarding done, but DO NOT seed a model or any keys.
seed_app_config() {
  mkdir -p "$OD_DATA_DIR"
  node - "$OD_DATA_DIR/app-config.json" >>"$SEED_LOG" 2>&1 <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
} catch (err) {
  if (!err || err.code !== 'ENOENT') config = {};
}
let changed = false;
if (!config.agentId) {
  config.agentId = 'opencode';
  changed = true;
}
if (config.onboardingCompleted !== true) {
  config.onboardingCompleted = true;
  changed = true;
}
if (!config.telemetry || typeof config.telemetry !== 'object' || Array.isArray(config.telemetry)) {
  config.telemetry = { metrics: false, content: false, artifactManifest: false };
  changed = true;
}
if (changed) {
  fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
NODE
}
seed_app_config || true

supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

# Publish the loopback daemon on the guest network address so acq/msb port
# publishing can reach it, WITHOUT letting the daemon see a non-loopback peer.
# Supervised separately from the daemon: the relay is cheap to restart and must
# survive a daemon restart, and a missing relay must not stop the UI from
# working in-guest. See opendesign-relay.mjs for the full rationale.
if [ "$OD_BIND_HOST" = "127.0.0.1" ] || [ "$OD_BIND_HOST" = "localhost" ]; then
  if [ ! -f "$RELAY_SCRIPT" ]; then
    log "relay script missing at $RELAY_SCRIPT; published port will not be reachable from the host"
  elif supervisor_running opendesign-relay; then
    log "OpenDesign relay supervisor already running"
  else
    (
      sh -c '
        while :; do
          echo "[supervisor] starting OpenDesign relay at $(date -u +%FT%TZ)"
          node "$4" "$1" "$2" || true
          echo "[supervisor] OpenDesign relay exited; restarting in ${3}s"
          sleep "$3"
        done
      ' "supervisor:opendesign-relay" "$OPENDESIGN_PUBLISHED_PORT" "$OD_PORT" "$RESTART_DELAY" "$RELAY_SCRIPT"
    ) >>"$RELAY_LOG" 2>&1 &
  fi
fi

if supervisor_running opendesign-daemon; then
  log "OpenDesign daemon supervisor already running"
  exit 0
fi

(
  cd "$SOURCE_DIR"
  sh -c '
    while :; do
      echo "[supervisor] starting OpenDesign at $(date -u +%FT%TZ)"
      node apps/daemon/dist/cli.js --host "$1" --port "$2" --no-open || true
      echo "[supervisor] OpenDesign exited; restarting in ${3}s"
      sleep "$3"
    done
  ' "supervisor:opendesign-daemon" "$OD_BIND_HOST" "$OD_PORT" "$RESTART_DELAY"
) >>"$DAEMON_LOG" 2>&1 &
