#!/bin/sh
# Fetch and install the pinned FirstMate Paseo plugin.
#
# This is intentionally startup-time and fail-soft: FirstMate is an optional
# UI extension, so a network or dependency failure must not kill the sandbox or
# the base Paseo daemon. The source is staged before replacing the live copy.

set -u

HOME="${HOME:-/home/agent}"
export HOME
PASEO_HOME="${PASEO_HOME:-$HOME/.paseo}"
REF="${FIRSTMATE_REF:-5e745c7202a4ef1dff859c31be1a365871b8b9c6}"
SOURCE_DIR="${FIRSTMATE_HOME:-$HOME/.paseo-firstmate}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/paseo-firstmate"
LOG="$STATE_DIR/install.log"
OWNER_REPO="ABorakati/paseo-firstmate"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

log() {
  printf '%s\n' "paseo-firstmate: $*" | tee -a "$LOG" >&2
}

cleanup() {
  [ -n "${STAGE:-}" ] && rm -rf "$STAGE" 2>/dev/null || true
  [ -n "${ARCHIVE:-}" ] && rm -f "$ARCHIVE" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

if ! command -v curl >/dev/null 2>&1; then
  log "curl is unavailable; FirstMate will retry on the next sandbox start"
  exit 0
fi
if ! command -v tar >/dev/null 2>&1; then
  log "tar is unavailable; FirstMate will retry on the next sandbox start"
  exit 0
fi
if ! command -v paseo >/dev/null 2>&1; then
  log "Paseo CLI is unavailable; the base paseo kit may still be starting"
  exit 0
fi

# Do not expose a mutable branch. The codeload URL is addressed by the full
# commit SHA and the staged tree is only promoted after successful extraction.
ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/paseo-firstmate.XXXXXX.tgz" 2>/dev/null || true)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/paseo-firstmate-stage.XXXXXX" 2>/dev/null || true)"
if [ -z "$ARCHIVE" ] || [ -z "$STAGE" ]; then
  log "cannot create a staging area; FirstMate is unavailable"
  exit 0
fi

URL="https://api.github.com/repos/$OWNER_REPO/tarball/$REF"
if ! curl -fsSL --connect-timeout 15 --max-time 120 \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -o "$ARCHIVE" "$URL" >>"$LOG" 2>&1; then
  log "could not fetch $OWNER_REPO@$REF; FirstMate will retry on the next start"
  exit 0
fi

if ! tar xzf "$ARCHIVE" -C "$STAGE" --strip-components=1 --no-same-owner --no-same-permissions 2>>"$LOG"; then
  log "could not extract the pinned source; FirstMate will retry on the next start"
  exit 0
fi

if [ ! -f "$STAGE/paseo-plugin.json" ] || [ ! -f "$STAGE/package-lock.json" ]; then
  log "pinned source is missing paseo-plugin.json or package-lock.json; refusing install"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  log "npm is unavailable; FirstMate will retry on the next sandbox start"
  exit 0
fi

mkdir -p "$STAGE/node_modules" 2>/dev/null || true
if ! (cd "$STAGE" && npm ci --ignore-scripts --no-audit --no-fund \
  --fetch-timeout=30000 --fetch-retries=1) >>"$LOG" 2>&1; then
  log "npm ci failed; refusing to register an incomplete plugin"
  exit 0
fi

mkdir -p "$(dirname "$SOURCE_DIR")" 2>/dev/null || exit 0
rm -rf "$SOURCE_DIR" 2>/dev/null || true
if ! mv "$STAGE" "$SOURCE_DIR" 2>>"$LOG"; then
  log "could not activate the staged plugin source"
  exit 0
fi
STAGE=""

if ! paseo plugin install "$SOURCE_DIR" --id paseo-firstmate >>"$LOG" 2>&1; then
  log "Paseo rejected the FirstMate plugin; see $LOG"
  exit 0
fi
if ! paseo plugin reload paseo-firstmate >>"$LOG" 2>&1; then
  log "Paseo could not reload FirstMate; see $LOG"
  exit 0
fi

log "installed and reloaded FirstMate from $OWNER_REPO@$REF"
exit 0
