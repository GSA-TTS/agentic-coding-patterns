#!/bin/sh
# opendesign-install.sh — install/update a pinned OpenDesign source checkout and
# kit-managed Node 24 runtime under the kit's persistent volume.
#
# This script is called from opendesign-start.sh on every sandbox start. It is
# idempotent and fail-soft: any install/build failure is logged and returns 0 so
# an optional browser UI cannot break sandbox creation or startup.

set -eu

APP_HOME="${OPENDESIGN_HOME:-$HOME/.local/share/opendesign}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/opendesign"
INSTALL_LOG="$STATE_HOME/opendesign-install.log"
SOURCE_DIR="$APP_HOME/source"
TOOLS_DIR="$APP_HOME/tools"
BUILD_MARKER="$APP_HOME/.built"

OPENDESIGN_REPO="${OPENDESIGN_REPO:-https://github.com/nexu-io/open-design.git}"
OPENDESIGN_REF="${OPENDESIGN_REF:-open-design-v0.24.0}"
OPENDESIGN_COMMIT="${OPENDESIGN_COMMIT:-0d3a14c1df6dc5017f3cc3ef05b24558250c220b}"
OPENDESIGN_NODE_VERSION="${OPENDESIGN_NODE_VERSION:-24.21.0}"
OPENDESIGN_PNPM_VERSION="${OPENDESIGN_PNPM_VERSION:-10.33.2}"

mkdir -p "$APP_HOME" "$STATE_HOME" "$TOOLS_DIR"

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$INSTALL_LOG"
}

fail_soft() {
  log "ERROR: $*"
  printf '%s\n' "opendesign install failed; see $INSTALL_LOG" >&2
  exit 0
}

run_logged() {
  log "+ $*"
  "$@" >>"$INSTALL_LOG" 2>&1 || fail_soft "command failed: $*"
}

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)
    node_arch="x64"
    node_sha="6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff"
    ;;
  aarch64|arm64)
    node_arch="arm64"
    node_sha="724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5"
    ;;
  *)
    fail_soft "unsupported architecture for kit-managed Node: $arch"
    ;;
esac

node_dir="$TOOLS_DIR/node-v${OPENDESIGN_NODE_VERSION}-linux-${node_arch}"
node_tar="node-v${OPENDESIGN_NODE_VERSION}-linux-${node_arch}.tar.gz"
node_url="https://nodejs.org/dist/v${OPENDESIGN_NODE_VERSION}/${node_tar}"

if [ ! -x "$node_dir/bin/node" ]; then
  tmp="$TOOLS_DIR/${node_tar}.tmp"
  log "installing Node ${OPENDESIGN_NODE_VERSION} (${node_arch})"
  if command -v curl >/dev/null 2>&1; then
    run_logged curl -fsSL "$node_url" -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    run_logged wget -O "$tmp" "$node_url"
  else
    fail_soft "neither curl nor wget is available to download Node"
  fi
  actual_sha="$(sha256sum "$tmp" | awk '{print $1}')"
  if [ "$actual_sha" != "$node_sha" ]; then
    rm -f "$tmp"
    fail_soft "Node archive SHA-256 mismatch for $node_tar"
  fi
  rm -rf "$node_dir"
  run_logged tar -xzf "$tmp" -C "$TOOLS_DIR"
  rm -f "$tmp"
fi

export PATH="$node_dir/bin:$PATH"
export COREPACK_HOME="$APP_HOME/corepack"
export PNPM_HOME="$APP_HOME/pnpm-home"
export npm_config_store_dir="$APP_HOME/pnpm-store"
mkdir -p "$COREPACK_HOME" "$PNPM_HOME" "$npm_config_store_dir"
export PATH="$PNPM_HOME:$PATH"

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
[ "$node_major" = "24" ] || fail_soft "Node 24 unavailable after kit-managed install"

# Route Node/npm/pnpm through the sandbox proxy and CA bundle when present. The
# zscaler-ca-certificate kit populates the system trust store; PROXY_CA_CERT_B64
# carries the sandbox proxy CA when the backend provides it.
[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && export npm_config_https_proxy="${HTTPS_PROXY:-$https_proxy}"
[ -n "${HTTP_PROXY:-${http_proxy:-}}" ] && export npm_config_proxy="${HTTP_PROXY:-$http_proxy}"
ca_bundle="$STATE_HOME/ca-bundle.pem"
: >"$ca_bundle"
if [ -n "${PROXY_CA_CERT_B64:-}" ]; then
  proxy_ca_tmp="$STATE_HOME/proxy-ca.pem.tmp"
  if printf %s "$PROXY_CA_CERT_B64" | base64 -d >"$proxy_ca_tmp" 2>/dev/null; then
    cat "$proxy_ca_tmp" >>"$ca_bundle"
  else
    log "WARNING: ignoring invalid PROXY_CA_CERT_B64; could not decode proxy CA"
  fi
  rm -f "$proxy_ca_tmp"
fi
[ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >>"$ca_bundle"
[ -s "$ca_bundle" ] && export NODE_EXTRA_CA_CERTS="$ca_bundle"

if ! command -v git >/dev/null 2>&1; then
  fail_soft "git is required to fetch OpenDesign source"
fi

if [ ! -d "$SOURCE_DIR/.git" ]; then
  rm -rf "$SOURCE_DIR"
  log "cloning OpenDesign $OPENDESIGN_REF"
  run_logged git clone --filter=blob:none --no-tags "$OPENDESIGN_REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
run_logged git fetch --depth=1 origin "$OPENDESIGN_REF"
run_logged git checkout --detach FETCH_HEAD
actual_commit="$(git rev-parse HEAD 2>/dev/null || true)"
[ "$actual_commit" = "$OPENDESIGN_COMMIT" ] || fail_soft "OpenDesign commit mismatch: got $actual_commit expected $OPENDESIGN_COMMIT"

marker_value="${OPENDESIGN_COMMIT}:${OPENDESIGN_NODE_VERSION}:${OPENDESIGN_PNPM_VERSION}"
if [ -f "$BUILD_MARKER" ] && [ "$(cat "$BUILD_MARKER" 2>/dev/null || true)" = "$marker_value" ] && [ -f "$SOURCE_DIR/apps/daemon/dist/cli.js" ] && [ -d "$SOURCE_DIR/apps/web/out" ]; then
  log "OpenDesign already built for $marker_value"
  exit 0
fi

run_logged corepack enable --install-directory "$PNPM_HOME"
run_logged corepack prepare "pnpm@${OPENDESIGN_PNPM_VERSION}" --activate
run_logged pnpm --version
export CI="${CI:-true}"
export NEXT_TELEMETRY_DISABLED="1"
export NODE_ENV="${NODE_ENV:-production}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"
run_logged pnpm install --frozen-lockfile
# OpenDesign's workspace packages must be built before the daemon can typecheck.
# The upstream bootstrap script does a dependency-aware build of those packages.
run_logged pnpm bootstrap
run_logged pnpm --filter @open-design/web build
printf '%s\n' "$marker_value" >"$BUILD_MARKER"
log "OpenDesign build complete: $marker_value"
