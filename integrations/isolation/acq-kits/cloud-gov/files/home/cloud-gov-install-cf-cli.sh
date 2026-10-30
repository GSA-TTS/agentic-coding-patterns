#!/usr/bin/env sh
set -eu

# Install the Cloud Foundry CLI from a pinned upstream release tarball. The exact
# version and SHA-256 values are committed in this script so the install is
# reproducible and fails closed on upstream drift.
#
# Runs in the STARTUP phase as the agent user, never `phase: install`. The
# download is HTTPS; on a network that intercepts TLS the CA-trust kit
# (zscaler-ca-certificate) installs its CA in its own startup step, which kit
# order runs before this one. An install-phase fetch runs at create time, before
# that CA is trusted, and fails with curl exit 60. The binary goes in the agent's
# ~/.local/bin, so no root step runs this agent-writable script. The agent can
# replace that file; the SHA-256 check covers the download, not later tampering.

CF_CLI_VERSION="8.19.0"
CF_CLI_SHA256_X86_64="98268ab3134bb3a1c97ffce797b4e6d35590a82e006cd098ad7a29f0a5cae7d8"
CF_CLI_SHA256_ARM64="454c29a44a51c8edc9696678403e2e40808357a397033af5a018e6ca8ee32117"

INSTALL_DIR="$HOME/.local/bin"
PATH="$INSTALL_DIR:$PATH"

log() { printf '%s\n' "cloud-gov: $*" >&2; }
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

if command -v cf >/dev/null 2>&1; then
  log "cf CLI already installed: $(cf version 2>/dev/null || printf 'version unavailable')"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  log "curl is required to fetch the pinned CF CLI release; refusing install"
  exit 1
fi
if ! command -v tar >/dev/null 2>&1; then
  log "tar is required to unpack the pinned CF CLI release; refusing install"
  exit 1
fi
if ! command -v gzip >/dev/null 2>&1; then
  log "gzip is required to unpack the pinned CF CLI release; refusing install"
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  log "sha256sum or shasum is required to verify the pinned CF CLI release; refusing install"
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)
    asset="cf8-cli_${CF_CLI_VERSION}_linux_x86-64.tgz"
    want_sha="$CF_CLI_SHA256_X86_64"
    ;;
  aarch64|arm64)
    asset="cf8-cli_${CF_CLI_VERSION}_linux_arm64.tgz"
    want_sha="$CF_CLI_SHA256_ARM64"
    ;;
  *)
    log "unsupported architecture for pinned CF CLI release: $arch"
    exit 1
    ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
url="https://github.com/cloudfoundry/cli/releases/download/v${CF_CLI_VERSION}/${asset}"
curl_rc=0
curl -fsSL "$url" -o "$work/cf-cli.tgz" || curl_rc=$?
if [ "$curl_rc" -ne 0 ]; then
  log "download of $url failed (curl exit $curl_rc); cf not installed"
  if [ "$curl_rc" -eq 60 ]; then
    log "curl exit 60 means the TLS chain is untrusted: apply the CA-trust kit before this kit"
  fi
  exit 1
fi
got_sha="$(sha256_of "$work/cf-cli.tgz" || true)"
if [ -z "$got_sha" ] || [ "$got_sha" != "$want_sha" ]; then
  log "CF CLI release SHA-256 mismatch (got ${got_sha:-none}, want $want_sha); refusing install"
  exit 1
fi

tar -xzf "$work/cf-cli.tgz" -C "$work"
mkdir -p "$INSTALL_DIR"
if [ -x "$work/cf8" ]; then
  install -m 0755 "$work/cf8" "$INSTALL_DIR/cf8"
elif [ -x "$work/cf" ]; then
  install -m 0755 "$work/cf" "$INSTALL_DIR/cf8"
else
  log "pinned CF CLI archive did not contain cf8 or cf executable"
  exit 1
fi
ln -sf "$INSTALL_DIR/cf8" "$INSTALL_DIR/cf"

if command -v cf >/dev/null 2>&1; then
  log "installed $(cf version 2>/dev/null || printf 'cf CLI')"
else
  log "cf CLI install completed but cf is not on PATH"
  exit 1
fi
