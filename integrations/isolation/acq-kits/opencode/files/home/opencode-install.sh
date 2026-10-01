#!/bin/sh
# opencode-install.sh — install the pinned OpenCode CLI binary into the sandbox.
#
# Runs at CREATE time as ROOT (install phase). Detects the guest architecture,
# fetches the matching pinned OpenCode release tarball from GitHub Releases,
# verifies its sha256, extracts the single `opencode` binary, and installs it
# on PATH for every user. FAIL-CLOSED on integrity, FAIL-SOFT on availability:
# any download/network/extraction failure degrades to "opencode absent, agent
# unavailable this boot" (never a dead sandbox, matching the kit-library
# convention — see openchamber-start.sh and pi-coding-agent-install.sh), but a
# SHA-256 MISMATCH refuses to install the mismatched bytes and does NOT fall
# back to any other install path. There is no unpinned fallback for this kit
# to fall back to — see docs/decisions/fail-closed-on-integrity.md for why that
# matters here specifically, unlike the optional-capability kits in this
# family.
#
# WHY create-time (install phase), unlike pi-coding-agent/openchamber (which
# install at startup): those install native npm packages whose postinstall can
# fail behind the proxy, so they defer to startup to keep a transient failure
# OFF the create path. OpenCode ships as a SINGLE prebuilt static-ish binary
# tarball from GitHub Releases (no npm, no native build, no toolchain), so the
# create-time install is a plain, deterministic curl+verify+extract with no
# compile step. This kit also replaces quickstart's own `acq`-side unpinned
# install path (`ACQ_MSB_OPENCODE_PKG=opencode-ai`, resolves to latest via
# `npm install -g`) — see GSA-TTS/agentic-coding-quickstart's
# docs/KNOWN_FAILURE_MODES.md for a real, independent reason to prefer this
# path even ignoring the pin: opencode-ai's own npm postinstall step
# intermittently fails fetching its real binary, which this install method has
# no equivalent of (there is no postinstall step; the tarball already contains
# the real binary).
#
# ARCHITECTURE: microVM/container guests are aarch64 on Apple Silicon hosts and
# x86-64 on amd64 hosts (same lesson as the goose-server and mcp-gateway kits).
# Installing a fixed x64 binary on an aarch64 guest fails at runtime with "Exec
# format error", so we SELECT the asset by `uname -m`. OpenCode's own release
# assets are named `opencode-linux-<arch>.tar.gz` where <arch> is x64 or arm64
# (NOT the rust-triple naming goose-server uses).
#
# INTEGRITY: GitHub RELEASE assets are byte-stable (unlike source tarballs,
# which the server recompresses), so we pin each ARCHIVE's sha256 directly and
# verify before extracting. Pins arrive via the environment ONLY — this script
# has NO literal fallback values (unlike pi-coding-agent-install.sh's
# ${PI_CODING_AGENT_VERSION:-0.84.3} pattern): the kit's spec.yaml install
# command is the single source of truth for these three values, and an unset
# value fails soft to "agent absent" below rather than installing anything
# unpinned. A literal fallback here would be a second copy of the pin that
# could silently drift from spec.yaml's — deliberately not duplicated.
#   OPENCODE_VERSION             — release tag, e.g. v1.18.34 (NOT "latest")
#   OPENCODE_SHA256_LINUX_X64     — sha256 of opencode-linux-x64.tar.gz
#   OPENCODE_SHA256_LINUX_ARM64   — sha256 of opencode-linux-arm64.tar.gz
# To bump: change the version + BOTH hashes in spec.yaml's install command,
# re-verify against the real release assets (download + `shasum -a 256`, not
# copied from any third party).
#
# WHY WE DO NOT USE THE opencode.ai/install SCRIPT: that script resolves
# "latest" by default (an explicit --version flag is required to pin at all),
# downloads via a redirect chain this script instead resolves and allow-lists
# explicitly, and is designed for interactive/CI use, not a non-interactive,
# SHA-pinned create-time install. We fetch the same underlying GitHub Release
# asset directly, with our own pin and verification — mirroring the structure
# of this repo's other release-asset-pin kits (goose-server, when merged) and
# openchamber's SHA-pinned installer fetch.
#
# NOTE ON v2: as of this kit's authoring, OpenCode has git tags v2.0.0 through
# v2.0.21 on its upstream repo, but NONE of them are published GitHub Releases,
# npm versions, or Homebrew-formula versions — the real, currently-installable
# release across every channel is still the 1.18.x series this kit pins. See
# docs/decisions/opencode-v2-not-yet-released.md. When v2 does actually ship,
# treat it as a deliberate, reviewed migration (the upstream diff between
# 1.18.x and the v2 tags is on the order of several thousand commits), not a
# routine pin bump.

set -u

# NON-INTERACTIVE: no terminal at create time.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false

ver="${OPENCODE_VERSION:-}"
sha_x64="${OPENCODE_SHA256_LINUX_X64:-}"
sha_arm64="${OPENCODE_SHA256_LINUX_ARM64:-}"

warn() { echo "opencode-kit(install): $*" >&2; }

# A pinned version + hashes are REQUIRED. Without them we cannot install a
# verified binary; degrade to "agent absent" (non-fatal — see header) rather
# than fetch an unpinned/unverified artifact. This is the SAME non-fatal exit
# as every other failure path below (missing pin is an availability failure,
# not an integrity failure — there is nothing yet to mismatch).
if [ -z "$ver" ]; then
  warn "OPENCODE_VERSION not set; refusing to install an unpinned opencode. (non-fatal)"
  exit 0
fi

# Defensive format check on the version pin, mirroring pi-coding-agent's own
# guard: refuse anything outside a safe version-string charset before it ever
# reaches a URL or argv, rather than relying solely on the tag existing.
case "$ver" in
  v[0-9]*.[0-9]*.[0-9]*)
    case "$ver" in
      *[!0-9A-Za-z.-]*)
        warn "OPENCODE_VERSION='$ver' contains characters outside [0-9A-Za-z.-]; refusing to install"
        exit 0
        ;;
    esac
    ;;
  *)
    warn "OPENCODE_VERSION='$ver' doesn't look like a version tag (want vX.Y.Z); refusing to install"
    exit 0
    ;;
esac

# Map the guest architecture to OpenCode's own asset-name arch token + pick its
# pinned hash. OpenCode names its Linux assets opencode-linux-x64.tar.gz /
# opencode-linux-arm64.tar.gz (plain x64/arm64, not a rust triple).
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_m" in
  x86_64|amd64)   oc_arch="x64";   sha="$sha_x64" ;;
  aarch64|arm64)  oc_arch="arm64"; sha="$sha_arm64" ;;
  *)
    warn "unsupported guest architecture '$uname_m' (need x86_64/amd64 or aarch64/arm64)."
    warn "  opencode not installed (non-fatal)."
    exit 0
    ;;
esac

if [ -z "$sha" ]; then
  warn "no pinned sha256 for arch '$oc_arch'; refusing to install unverified. (non-fatal)"
  exit 0
fi

asset="opencode-linux-${oc_arch}.tar.gz"
url="https://github.com/anomalyco/opencode/releases/download/${ver}/${asset}"
# Install into a system PATH dir (root at create time). /usr/local/bin is on
# PATH for every user in the base image (same destination as the goose-server
# and openchamber kits' root-installed binaries).
dest_dir="/usr/local/bin"

# Idempotency: if the pinned opencode is already installed AND executes, do
# nothing. Checks the FIXED destination path directly ($dest_dir/opencode),
# NOT whatever `opencode` first resolves to on PATH — a PATH lookup here would
# trust an attacker- or another-kit-controlled binary earlier on PATH as if it
# were this kit's own verified install, silently skipping this run's integrity
# gate entirely. Also rejects a symlink at that path for the same reason the
# post-extraction check below does (SECURITY, not just availability): a
# symlink masquerading at the destination path would have its target's
# `--version` output trusted as this kit's own.
if [ -f "$dest_dir/opencode" ] && [ ! -L "$dest_dir/opencode" ] && [ -x "$dest_dir/opencode" ]; then
  installed_ver="$("$dest_dir/opencode" --version 2>/dev/null || true)"
  if [ -n "$installed_ver" ] && [ "$installed_ver" = "${ver#v}" ]; then
    echo "opencode-kit(install): opencode $ver ($oc_arch) already installed and runnable at $dest_dir/opencode; skipping."
    exit 0
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found in base image; cannot download opencode. Skipping (non-fatal)."
  exit 0
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-install.XXXXXX" 2>/dev/null || echo "/tmp/opencode-install.$$")"
mkdir -p "$work_dir" 2>/dev/null || true
cleanup() { rm -rf "$work_dir" 2>/dev/null || true; }
trap cleanup EXIT

archive="$work_dir/$asset"

# Bounded fetch: explicit connect/overall timeouts so a hung registry/CDN
# response cannot stall sandbox creation indefinitely (mirrors the bounded-
# fetch convention documented in ADR 0004's models-orchestrator design).
if ! curl -fsSL --connect-timeout 10 --max-time 120 "$url" -o "$archive" 2>"$work_dir/curl.log"; then
  warn "download failed for $url (non-fatal; opencode will be absent this boot)"
  [ -s "$work_dir/curl.log" ] && sed 's/^/opencode-kit(install):   /' "$work_dir/curl.log" >&2
  exit 0
fi

# --- INTEGRITY GATE: verify BEFORE extracting. FAIL CLOSED on mismatch. -----
got_sha="$( (sha256sum "$archive" 2>/dev/null || shasum -a 256 "$archive" 2>/dev/null) | cut -d' ' -f1)"
if [ -z "$got_sha" ]; then
  warn "could not compute a sha256 for the downloaded archive (no sha256sum/shasum?); refusing to install unverified. (non-fatal)"
  exit 0
fi
if [ "$got_sha" != "$sha" ]; then
  # SECURITY: this is the one failure path that is NOT just "optional feature
  # unavailable" — a mismatched archive is either corruption or tampering, and
  # this kit deliberately has no unpinned fallback install path to degrade to
  # (contrast the quickstart-side readiness gate this kit satisfies, whose
  # OWN fallback — the unpinned `npm install -g opencode-ai` — is exactly what
  # this kit exists to retire). Refuse to extract or install the mismatched
  # bytes. Still exit 0: a bad download must not crash sandbox *creation*
  # (the agent is simply absent this boot, loudly, in the log), but it must
  # never silently proceed past this gate.
  warn "SECURITY: sha256 mismatch for $asset (got $got_sha, want $sha) at $ver;"
  warn "  refusing to install. opencode will be ABSENT this boot — this is a"
  warn "  fail-closed integrity refusal, not a transient-failure degrade."
  exit 0
fi
echo "opencode-kit(install): sha256 verified for $asset ($ver)"

if ! tar -xzf "$archive" -C "$work_dir" opencode 2>"$work_dir/tar.log"; then
  warn "extraction failed (non-fatal; opencode will be absent this boot)"
  [ -s "$work_dir/tar.log" ] && sed 's/^/opencode-kit(install):   /' "$work_dir/tar.log" >&2
  exit 0
fi

if [ ! -f "$work_dir/opencode" ]; then
  warn "extracted archive did not contain an 'opencode' binary; skipping (non-fatal)"
  exit 0
fi

# SECURITY: reject a symlink masquerading as the extracted binary. The SHA-256
# gate above only proves the DOWNLOADED ARCHIVE's bytes match the pin; it says
# nothing about what a member named "opencode" inside that archive actually
# IS. `[ -f ]` follows symlinks and reports true for whatever they resolve to,
# so without this check a pinned-but-compromised (or carelessly-cut) release
# whose "opencode" member is a symlink to an arbitrary root-readable path
# (e.g. a host secret) would have that TARGET's content silently copied by
# `install` into a new, world-readable file at $dest_dir/opencode — a real
# root-privileged disclosure primitive this kit must refuse outright, the same
# way it refuses a hash mismatch.
if [ -L "$work_dir/opencode" ]; then
  warn "SECURITY: extracted 'opencode' member is a symlink, not a regular file;"
  warn "  refusing to install. This is a fail-closed integrity refusal, not a"
  warn "  transient-failure degrade — see docs/decisions/fail-closed-on-integrity.md."
  exit 0
fi
if [ ! -x "$work_dir/opencode" ]; then
  warn "extracted 'opencode' binary is not executable; skipping (non-fatal)"
  exit 0
fi

mkdir -p "$dest_dir" 2>/dev/null || true
if ! install -m 0755 "$work_dir/opencode" "$dest_dir/opencode" 2>"$work_dir/install.log"; then
  warn "failed to install binary to $dest_dir (non-fatal; opencode will be absent this boot)"
  [ -s "$work_dir/install.log" ] && sed 's/^/opencode-kit(install):   /' "$work_dir/install.log" >&2
  exit 0
fi

if command -v opencode >/dev/null 2>&1 && opencode --version >/dev/null 2>&1; then
  echo "opencode-kit(install): opencode $ver ($oc_arch) installed and runnable at $dest_dir/opencode"
else
  warn "opencode installed to $dest_dir but is not runnable (non-fatal; check base image compatibility)"
fi
