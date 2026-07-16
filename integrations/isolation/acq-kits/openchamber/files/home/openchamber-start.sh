#!/bin/sh
# openchamber-start.sh — install OpenChamber on first boot, then supervise a
# managed `opencode serve` and OpenChamber so both auto-restart if they exit.
#
# Extracted (per the acq design doc §6, like agentic-coding-playbook's
# playbook-clone.sh) from the former sbx kit's inline startup command into a
# standalone, testable script. Behavior is unchanged.
#
# Runs as the agent user (uid 1000) in the background on every sandbox start and
# is fully idempotent: it installs OpenChamber only if missing, then starts a
# supervisor for `opencode serve` and one for OpenChamber only if one isn't
# already running for that service.
#
# Pins are provided via the environment, with in-script fallback defaults kept
# in sync with the kit spec's documented pin:
#   OPENCHAMBER_REF            — OpenChamber release tag whose install.sh is run
#   OPENCHAMBER_INSTALL_SHA256 — SHA-256 the fetched install.sh must match
#   OPENCHAMBER_PORT           — container port OpenChamber binds (default 3000)
#   OPENCHAMBER_RESTART_DELAY  — seconds to wait before respawning (default 5)

set -eu
OC_PORT=4096
CHAMBER_PORT="${OPENCHAMBER_PORT:-3000}"

# npm global installs land in this prefix's bin, which is NOT on the startup
# shell's PATH by default — the installer even warns about it. Put it on PATH up
# front so a freshly-installed `openchamber` resolves in THIS shell (otherwise
# the post-install `command -v openchamber` guard trips and the server section
# never runs on first boot).
NPM_BIN="$(npm prefix -g 2>/dev/null)/bin"
case ":$PATH:" in *":$NPM_BIN:"*) : ;; *) PATH="$NPM_BIN:$PATH" ;; esac
export PATH

# --- Install OpenChamber if it isn't present yet (first boot). ---------------
if ! command -v openchamber >/dev/null 2>&1; then
  # Route prebuild-install (and npm) through the sandbox proxy.
  [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && export npm_config_https_proxy="${HTTPS_PROXY:-$https_proxy}"
  [ -n "${HTTP_PROXY:-${http_proxy:-}}" ]  && export npm_config_proxy="${HTTP_PROXY:-$http_proxy}"
  # Build a CA bundle for Node-based downloads (the prebuilt native binary).
  # NODE_EXTRA_CA_CERTS *appends* to Node's built-in roots, which lack both the
  # sandbox proxy CA and any HTTPS-inspection CA (e.g. Zscaler). Concatenate BOTH
  # the sandbox proxy CA (PROXY_CA_CERT_B64) and the system trust store
  # (populated with the inspection CA by the zscaler-ca-certificate kit at
  # startup) so the full chain validates — the proxy CA alone is not sufficient
  # behind an inspecting proxy.
  _ca="$HOME/.local/state/openchamber/ca-bundle.pem"
  mkdir -p "$(dirname "$_ca")"
  : > "$_ca"
  [ -n "${PROXY_CA_CERT_B64:-}" ] && printf %s "$PROXY_CA_CERT_B64" | base64 -d >> "$_ca" 2>/dev/null
  [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >> "$_ca"
  [ -s "$_ca" ] && export NODE_EXTRA_CA_CERTS="$_ca"
  # Fetch install.sh from a PINNED TAG (never `main`) and verify its SHA-256
  # before running it — the installer runs with the agent's full sandbox caps,
  # and the fetch path may be MITM-inspected, so a tag alone is not enough. On
  # mismatch, skip install (UI unavailable) rather than pipe unverified bytes to
  # bash.
  _ref="${OPENCHAMBER_REF:-v1.9.10}"
  _want_sha="${OPENCHAMBER_INSTALL_SHA256:-aa268c96ddc6d7d53fc54d2e5c2312e689493ecef6ba4f69730a93d50cf33287}"
  _installer="$HOME/.local/state/openchamber/install.sh"
  if curl -fsSL "https://raw.githubusercontent.com/openchamber/openchamber/$_ref/scripts/install.sh" \
       -o "$_installer" 2>/tmp/openchamber-install.log; then
    _got_sha="$( (sha256sum "$_installer" 2>/dev/null || shasum -a 256 "$_installer" 2>/dev/null) | cut -d' ' -f1)"
    if [ "$_got_sha" = "$_want_sha" ]; then
      bash "$_installer" >>/tmp/openchamber-install.log 2>&1 || true
    else
      echo "openchamber: install.sh SHA-256 mismatch (got $_got_sha, want $_want_sha) at $_ref; refusing to run it" >>/tmp/openchamber-install.log 2>&1
    fi
    rm -f "$_installer"
  fi
fi
command -v openchamber >/dev/null 2>&1 || {
  echo "openchamber install failed; see /tmp/openchamber-install.log" >&2
  exit 0   # never fail the sandbox over an optional UI
}

# --- Managed opencode server + OpenChamber (idempotent). ---------------------
# `opencode serve` REQUIRES HTTP Basic auth: unauthenticated requests get 401.
# OpenChamber (skip-start mode) authenticates with Basic
# opencode:$OPENCODE_SERVER_PASSWORD, so both share one password. Generate a
# per-sandbox secret once and reuse it on every startup so restarts keep matching
# a server started with the same password.
PW_FILE="$HOME/.local/state/openchamber/opencode-server-password"
mkdir -p "$(dirname "$PW_FILE")"
if [ ! -s "$PW_FILE" ]; then
  ( openssl rand -hex 32 2>/dev/null \
    || head -c 32 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' \
    || printf '%s%s%s%s' "$$" "$RANDOM" "$RANDOM" "$(date +%s)" ) > "$PW_FILE"
  chmod 600 "$PW_FILE"
fi
OPENCODE_SERVER_PASSWORD="$(cat "$PW_FILE")"
export OPENCODE_SERVER_PASSWORD

# Both services are kept alive by a tiny supervisor loop: if the process exits
# (e.g. OpenCode/OpenChamber does an interactive self-update, which requires a
# restart to take effect, or just crashes), wait a few seconds and start it
# again. No systemd — this script is launched in the background by the kit's
# startup command, so each supervisor loop runs backgrounded here and lives for
# the container's lifetime.
#
# RESTART_DELAY: seconds to wait before respawning a stopped process.
RESTART_DELAY="${OPENCHAMBER_RESTART_DELAY:-5}"

# Guard against a second startup run (idempotent restarts) spawning a duplicate
# supervisor: only start a supervisor if one isn't already running for that
# service. Each loop is launched with a marker ARGUMENT ("supervisor:<name>")
# that the inner `sh -c` ignores; pgrep -f matches the whole command line, so it
# finds the loop by that marker. (An argument, not `exec -a` — the startup shell
# is POSIX `sh`/dash, which has no `exec -a`.) A single supervisor per service
# means we never spawn a duplicate — the loop only relaunches after the previous
# instance has actually exited.
supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

# Start the managed `opencode serve` supervisor unless already running. No health
# probe is needed: the loop only respawns after serve actually exits, so it can't
# start a duplicate against a live server.
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=port.
if ! supervisor_running opencode-serve; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting opencode serve at $(date -u +%FT%TZ)"
        opencode serve --hostname 127.0.0.1 --port "$2" || true
        echo "[supervisor] opencode serve exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:opencode-serve" "$RESTART_DELAY" "$OC_PORT" \
    >>/tmp/opencode-serve.log 2>&1 ) &
fi

# Start the OpenChamber supervisor unless already running. OpenChamber normally
# daemonizes; run it with OPENCHAMBER_NO_DAEMON so it stays in the foreground and
# the supervisor can see it exit (and thus restart it after a self-update). It
# inherits OPENCODE_SERVER_PASSWORD to authenticate to the managed server. The
# sandbox is the security boundary, so OpenChamber's own LAN access is
# unauthenticated.
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=OC_PORT, $3=CHAMBER_PORT.
if ! supervisor_running openchamber; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting openchamber at $(date -u +%FT%TZ)"
        OPENCODE_SKIP_START=true \
        OPENCODE_PORT="$2" \
        OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
        OPENCHAMBER_NO_DAEMON=true \
          openchamber --lan --port "$3" || true
        echo "[supervisor] openchamber exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:openchamber" "$RESTART_DELAY" "$OC_PORT" "$CHAMBER_PORT" \
    >>/tmp/openchamber.log 2>&1 ) &
fi
