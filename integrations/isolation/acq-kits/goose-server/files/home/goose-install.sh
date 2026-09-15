#!/bin/sh
# goose-install.sh — install the pinned goose CLI binary into the sandbox.
#
# Runs at CREATE time as ROOT (install phase). Detects the guest architecture,
# fetches the matching pinned goose release tarball from GitHub Releases, verifies
# its sha256, extracts the single `goose` binary, and installs it on PATH.
# Non-fatal: any failure warns to stderr and exits 0 so sandbox provisioning still
# succeeds (the kit degrades — `goose` is simply absent and the startup step warns,
# so the sandbox is never dead just because the optional server could not install).
#
# WHY create-time (install phase), unlike the openchamber/paseo kits which install
# at startup: those install npm packages whose native deps can fail behind the
# proxy, so they defer to startup to keep a transient failure OFF the create path.
# goose ships as a SINGLE prebuilt static binary from GitHub Releases (no npm, no
# native build, no toolchain), so the create-time install is a plain, deterministic
# curl+verify+extract with no compile step — and it is still fully non-fatal here,
# so a transient download failure degrades to "server absent", never a dead
# sandbox. Installing at create time means the binary is present before the first
# startup supervises `goose serve`.
#
# ARCHITECTURE (same lesson as the mcp-gateway kit): microsandbox microVMs are
# aarch64 on Apple Silicon hosts and x86-64 on amd64 hosts. Installing a fixed
# amd64 binary on an aarch64 guest fails at runtime with "Exec format error", so
# we SELECT the asset by `uname -m`. goose's own download_cli.sh names the Linux
# assets `goose-<arch>-unknown-linux-<gnu|musl>.tar.<ext>` where <arch> is the
# rust triple arch (x86_64 or aarch64). We follow the same naming.
#
# ARCHIVE FORMAT — GZIP, NOT BZIP2 (learned from a live msb test): goose publishes
# BOTH `.tar.bz2` and `.tar.gz` for every asset. We use the `.tar.gz`, because the
# minimal `shell-docker` sandbox-template (docker.io/docker/sandbox-templates:
# shell-docker) has NO `bzip2` binary — and GNU tar's bzip2 filter (`-j`) shells
# out to the external `bzip2`, so `tar xjf` fails there with the binary absent (the
# create-time download + sha256 verify SUCCEED, then extraction fails, leaving
# goose uninstalled). gzip (`tar xzf`) needs only zlib, which is universally
# present. So we fetch the `.gz` asset and extract with `tar xzf`.
#
# LIBC VARIANT: goose ships `-gnu` (glibc) and `-musl` builds. The acq base images
# (Docker sandbox-templates + the msb opencode image) are Debian/glibc, so we
# install the `-gnu` build by default. GOOSE_LINUX_VARIANT=musl overrides it for a
# musl base.
#
# INTEGRITY: GitHub RELEASE assets are byte-stable (unlike source tarballs, which
# the server recompresses), so we pin each ARCHIVE sha256 directly and verify
# before extracting. The `.tar.gz` sha256 DIFFERS from the `.tar.bz2` sha256 — pin
# the GZIP one. Pins arrive via the environment (with in-script fallbacks kept in
# sync with the kit spec):
#   GOOSE_VERSION              — release tag, e.g. v1.10.0 (NOT the moving "stable")
#   GOOSE_SHA256_LINUX_X86_64  — sha256 of goose-x86_64-unknown-linux-<variant>.tar.gz
#   GOOSE_SHA256_LINUX_AARCH64 — sha256 of goose-aarch64-unknown-linux-<variant>.tar.gz
# To bump: change the version + BOTH hashes in the spec's install command AND the
# fallbacks below, and re-verify against the release assets (the GZIP digests).
#
# WHY WE DO NOT PIPE goose's download_cli.sh: that script defaults to the MOVING
# `stable` tag (not a pinned version), runs `goose configure` interactively, and
# offers to edit shell rc files — none of which suits a reproducible, sha-pinned,
# non-interactive create-time install. We fetch the same release asset directly.

set -u

# NON-INTERACTIVE: no terminal at create time.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false

ver="${GOOSE_VERSION:-}"
sha_x86_64="${GOOSE_SHA256_LINUX_X86_64:-}"
sha_aarch64="${GOOSE_SHA256_LINUX_AARCH64:-}"
variant="${GOOSE_LINUX_VARIANT:-gnu}"

warn() { echo "goose-server(install): $*" >&2; }

# A pinned version + hashes are REQUIRED. Without them we cannot install a
# verified binary; degrade to "server absent" (non-fatal) rather than fetch an
# unpinned/unverified artifact.
if [ -z "$ver" ]; then
  warn "GOOSE_VERSION not set; refusing to install an unpinned goose. (non-fatal)"
  exit 0
fi

case "$variant" in
  gnu|musl) ;;
  *) warn "unknown GOOSE_LINUX_VARIANT '$variant' (want gnu|musl); defaulting to gnu."; variant="gnu" ;;
esac

# Map the guest architecture to goose's rust-triple arch + pick its hash.
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_m" in
  x86_64|amd64)   rarch="x86_64";  sha="$sha_x86_64" ;;
  aarch64|arm64)  rarch="aarch64"; sha="$sha_aarch64" ;;
  *)
    warn "unsupported guest architecture '$uname_m' (need x86_64/amd64 or aarch64/arm64)."
    warn "  goose not installed (non-fatal)."
    exit 0
    ;;
esac

if [ -z "$sha" ]; then
  warn "no pinned sha256 for arch '$rarch' (variant $variant); refusing to install unverified. (non-fatal)"
  exit 0
fi

asset="goose-${rarch}-unknown-linux-${variant}.tar.gz"
url="https://github.com/aaif-goose/goose/releases/download/${ver}/${asset}"
# Install into a system PATH dir (root at create time). /usr/local/bin is on PATH
# for the agent user in the base image.
dest_dir="/usr/local/bin"

# Idempotency: if the pinned goose is already installed AND executes, do nothing.
# Require it to actually run (a wrong-arch binary "exists" but fails Exec format).
if command -v goose >/dev/null 2>&1 && goose --version >/dev/null 2>&1; then
  if goose --version 2>/dev/null | grep -q "${ver#v}"; then
    echo "goose-server(install): goose $ver ($rarch/$variant) already installed and runnable; skipping."
    exit 0
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found in base image; cannot download goose. Skipping (non-fatal)."
  exit 0
fi

# The archive is gzip-compressed (`tar xzf`, zlib only — no external bzip2, which
# the minimal shell-docker template lacks). Fail non-fatally with a clear hint on
# any error.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  fi
}

tgz="$(mktemp "${TMPDIR:-/tmp}/goose.XXXXXX.tar.gz" 2>/dev/null)" || tgz="/tmp/goose.$$.tar.gz"
cerr="$(mktemp "${TMPDIR:-/tmp}/goose-err.XXXXXX" 2>/dev/null)" || cerr="/tmp/goose-err.$$"
stage="$(mktemp -d "${TMPDIR:-/tmp}/goose-stage.XXXXXX" 2>/dev/null)" || stage="/tmp/goose-stage.$$"

cleanup() { rm -rf "$tgz" "$cerr" "$stage" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# -f fail on HTTP error; -sSL quiet-but-show-errors + follow the releases ->
# objects.githubusercontent.com redirect. Bounded timeouts so a black-holing
# network cannot hang provisioning. Public asset — no auth header. The sandbox
# proxy CA is already trusted in the guest trust store at create time, so curl's
# default verification works behind the inspecting proxy.
curl -fsSL --connect-timeout 15 --max-time 300 -o "$tgz" "$url" 2>"$cerr"
if [ $? -ne 0 ]; then
  warn "download of $url failed (offline or bad pin?). goose not installed (non-fatal)."
  [ -s "$cerr" ] && warn "curl: $(tr '\n' ' ' < "$cerr")"
  exit 0
fi

# Verify the archive sha256 BEFORE extracting.
got="$(sha256_of "$tgz")"
if [ -z "$got" ]; then
  warn "no sha256 tool available; cannot verify goose archive. Refusing to install (non-fatal)."
  exit 0
fi
if [ "$got" != "$sha" ]; then
  warn "goose archive sha256 mismatch for $rarch/$variant:"
  warn "  expected $sha"
  warn "  got      $got"
  warn "Refusing to install a mismatched binary. (non-fatal)"
  exit 0
fi

# Extract into staging. -z = gzip (zlib only, no external bzip2 binary needed).
# --no-same-owner/--no-same-permissions avoid honoring owner/mode bits from the
# archive.
if ! tar xzf "$tgz" -C "$stage" --no-same-owner --no-same-permissions 2>"$cerr"; then
  warn "failed to extract goose archive. (non-fatal)"
  [ -s "$cerr" ] && warn "tar: $(tr '\n' ' ' < "$cerr")"
  exit 0
fi

# The Linux asset extracts a top-level `goose` binary (and, for local-inference
# builds, sidecar libraries). Install the whole extracted tree's `goose` plus any
# co-located shared objects it needs. Find the binary defensively.
goose_bin=""
if [ -f "$stage/goose" ]; then
  goose_bin="$stage/goose"
else
  goose_bin="$(find "$stage" -type f -name goose 2>/dev/null | head -n1)"
fi
if [ -z "$goose_bin" ] || [ ! -f "$goose_bin" ]; then
  warn "goose binary not found in extracted archive. (non-fatal)"
  exit 0
fi
bindir="$(dirname "$goose_bin")"

mkdir -p "$dest_dir" 2>/dev/null || true

# Install the goose binary.
if install -m 0755 "$goose_bin" "$dest_dir/goose" 2>/dev/null \
   || { cp "$goose_bin" "$dest_dir/goose" && chmod 0755 "$dest_dir/goose"; }; then
  :
else
  warn "failed to install goose to $dest_dir. (non-fatal)"
  exit 0
fi

# Some goose builds ship sidecar shared objects (*.so, temporal worker helpers)
# next to the binary. Copy any co-located non-`goose` regular files into a
# dedicated libdir and point the binary at it via an rpath-style wrapper only if
# they exist — the standard gnu build is a single self-contained binary, so this
# is usually a no-op. We keep it simple: copy siblings into dest_dir (they are
# small helper binaries goose invokes by name off PATH).
for f in "$bindir"/*; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" = "goose" ] && continue
  case "$base" in
    *.so|*.so.*|goose-*|temporal*|*.dylib) : ;;
    *) continue ;;
  esac
  install -m 0755 "$f" "$dest_dir/$base" 2>/dev/null \
    || { cp "$f" "$dest_dir/$base" 2>/dev/null && chmod 0755 "$dest_dir/$base" 2>/dev/null; } \
    || warn "could not install sidecar '$base' (may be unneeded for this build)."
done

# Confirm the installed binary actually EXECUTES on this arch.
if "$dest_dir/goose" --version >/dev/null 2>&1; then
  echo "goose-server(install): installed goose $ver ($rarch/$variant) to $dest_dir/goose"
else
  warn "installed goose to $dest_dir but it does not execute (arch mismatch or missing sidecar?)."
  warn "  guest arch: $uname_m -> $rarch/$variant. (non-fatal)"
  exit 0
fi

exit 0
