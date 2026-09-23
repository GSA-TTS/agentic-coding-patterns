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
OD_PORT="${OD_PORT:-7456}"
OD_BIND_HOST="${OD_BIND_HOST:-0.0.0.0}"
OD_DATA_DIR="${OD_DATA_DIR:-$APP_HOME/data}"
DAEMON_LOG="$STATE_HOME/opendesign-daemon.log"
SEED_LOG="$STATE_HOME/opendesign-seed.log"
INSTALL_SCRIPT="$HOME/opendesign-install.sh"
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
export OD_BIND_HOST OD_PORT OD_DATA_DIR
export OD_WEB_PORT="${OD_WEB_PORT:-$OD_PORT}"
export OD_DISABLE_API_AUTH="${OD_DISABLE_API_AUTH:-1}"
export OD_SANDBOX_MODE="${OD_SANDBOX_MODE:-1}"

# Make OpenDesign-spawned agent processes see the same configured OpenCode binary
# and model-provider environment the sandbox already has. No model key is copied
# into OpenDesign state; usai-provider + acq injection remain the credential path.
if command -v opencode >/dev/null 2>&1; then
  export OPENCODE_BIN="$(command -v opencode)"
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
