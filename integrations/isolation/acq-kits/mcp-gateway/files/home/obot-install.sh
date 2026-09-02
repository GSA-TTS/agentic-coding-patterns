#!/bin/sh
# obot-install.sh — install the pinned obot CLI binary into the sandbox.
#
# Runs at CREATE time as ROOT (install phase). Fetches the pinned obot release
# tarball from GitHub Releases, verifies its sha256, extracts the single `obot`
# binary, and installs it on PATH. Non-fatal: any failure warns to stderr and
# exits 0 so sandbox provisioning still succeeds (the kit degrades — `obot` is
# simply absent and the startup/skill steps will warn).
#
# WHY A RELEASE BINARY (not brew, not `go install`): the Homebrew formula
# (obot-platform/homebrew-tap) is a GoReleaser wrapper around a static binary
# tarball on GitHub Releases — `bin.install "obot"`. So we fetch that same asset
# directly; no brew, no Go toolchain, no build. The gateway host and the sandbox
# base are linux/amd64, so we pin the linux_amd64 asset.
#
# INTEGRITY: GitHub RELEASE assets are byte-stable (unlike source tarballs, which
# the server recompresses), so we pin the ARCHIVE sha256 directly — simpler than
# a content-manifest digest. Pins arrive via the environment (with in-script
# fallbacks kept in sync with the kit spec):
#   OBOT_VERSION              — release tag, e.g. v0.25.4
#   OBOT_SHA256_LINUX_AMD64   — sha256 of obot_<ver>_linux_amd64.tar.gz
# To bump: change both in the spec's install command AND the fallbacks below.

set -u

# NON-INTERACTIVE: no terminal at create time. curl is non-interactive; keep the
# git guards as defense-in-depth in case a future edit shells out to git.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false

ver="${OBOT_VERSION:-v0.25.4}"
sha="${OBOT_SHA256_LINUX_AMD64:-6553abb14df6cea031a994724e597d878ad6cd9a228ee761424c96243c608f74}"
asset="obot_${ver}_linux_amd64.tar.gz"
url="https://github.com/obot-platform/obot/releases/download/${ver}/${asset}"
# Install into a system PATH dir (root at create time). /usr/local/bin is on PATH
# for the agent user in the base image.
dest_dir="/usr/local/bin"

warn() { echo "mcp-gateway(install): $*" >&2; }

# Idempotency: if the pinned obot is already installed, do nothing.
if command -v obot >/dev/null 2>&1; then
  if obot version 2>/dev/null | grep -q "$ver"; then
    echo "mcp-gateway(install): obot $ver already installed; skipping."
    exit 0
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found in base image; cannot download obot. Skipping (non-fatal)."
  exit 0
fi

# sha256 helper: prefer sha256sum, fall back to shasum -a 256.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  fi
}

tgz="$(mktemp "${TMPDIR:-/tmp}/obot.XXXXXX.tgz" 2>/dev/null)" || tgz="/tmp/obot.$$.tgz"
cerr="$(mktemp "${TMPDIR:-/tmp}/obot-err.XXXXXX" 2>/dev/null)" || cerr="/tmp/obot-err.$$"
stage="$(mktemp -d "${TMPDIR:-/tmp}/obot-stage.XXXXXX" 2>/dev/null)" || stage="/tmp/obot-stage.$$"

cleanup() { rm -rf "$tgz" "$cerr" "$stage" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# -f fail on HTTP error; -sSL quiet-but-show-errors + follow the releases ->
# objects.githubusercontent.com redirect. Bounded timeouts so a black-holing
# network cannot hang provisioning. Public asset — no auth header.
curl -fsSL --connect-timeout 15 --max-time 180 -o "$tgz" "$url" 2>"$cerr"
if [ $? -ne 0 ]; then
  warn "download of $url failed (offline or bad pin?). obot not installed (non-fatal)."
  [ -s "$cerr" ] && warn "curl: $(tr '\n' ' ' < "$cerr")"
  exit 0
fi

# Verify the archive sha256 BEFORE extracting.
got="$(sha256_of "$tgz")"
if [ -z "$got" ]; then
  warn "no sha256 tool available; cannot verify obot archive. Refusing to install (non-fatal)."
  exit 0
fi
if [ "$got" != "$sha" ]; then
  warn "obot archive sha256 mismatch:"
  warn "  expected $sha"
  warn "  got      $got"
  warn "Refusing to install a mismatched binary. (non-fatal)"
  exit 0
fi

# Extract into staging, then install just the `obot` binary. --no-same-owner /
# --no-same-permissions avoid honoring owner/mode bits from the archive.
if ! tar xzf "$tgz" -C "$stage" --no-same-owner --no-same-permissions 2>/dev/null; then
  warn "failed to extract obot archive. (non-fatal)"
  exit 0
fi

# The asset installs a single top-level `obot` binary (per the GoReleaser
# formula). Find it defensively (top level, then anywhere in staging).
obot_bin=""
if [ -f "$stage/obot" ]; then
  obot_bin="$stage/obot"
else
  obot_bin="$(find "$stage" -type f -name obot 2>/dev/null | head -n1)"
fi
if [ -z "$obot_bin" ] || [ ! -f "$obot_bin" ]; then
  warn "obot binary not found in extracted archive. (non-fatal)"
  exit 0
fi

mkdir -p "$dest_dir" 2>/dev/null || true
if install -m 0755 "$obot_bin" "$dest_dir/obot" 2>/dev/null \
   || { cp "$obot_bin" "$dest_dir/obot" && chmod 0755 "$dest_dir/obot"; }; then
  echo "mcp-gateway(install): installed obot $ver to $dest_dir/obot"
else
  warn "failed to install obot to $dest_dir. (non-fatal)"
  exit 0
fi

exit 0
