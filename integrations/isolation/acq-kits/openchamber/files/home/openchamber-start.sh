#!/bin/sh
# openchamber-start.sh — install OpenChamber on first boot, then supervise
# OpenChamber so it auto-restarts if it exits.
#
# SCOPE (new design): this startup script manages ONLY OpenChamber. It does NOT
# start `opencode serve`. The shared opencode server is owned by the kit's
# `opencode` wrapper (files/home/.local/bin/opencode), which the sandbox
# entrypoint runs on demand; OpenChamber attaches to that server on port 4096
# (OPENCODE_SKIP_START=true + OPENCODE_PORT=4096). Until the wrapper has started
# the server at least once, OpenChamber loads but shows no live server — that is
# the intended on-demand flow.
#
# Extracted (per the acq design doc §6, like agentic-coding-playbook's
# playbook-clone.sh) from the former sbx kit's inline startup command into a
# standalone, testable script.
#
# Runs as the agent user (uid 1000) in the background on every sandbox start and
# is fully idempotent: it installs OpenChamber only if missing, then starts a
# supervisor for OpenChamber only if one isn't already running.
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

# --- Supervise OpenChamber (idempotent). -------------------------------------
# OpenChamber runs in SKIP-START mode (OPENCODE_SKIP_START=true, OPENCODE_PORT=
# 4096): it does NOT start its own opencode server; it attaches to the shared
# server the `opencode` wrapper brings up on 127.0.0.1:4096. The shared server is
# UNSECURED (no OPENCODE_SERVER_PASSWORD) — the sandbox is the security boundary,
# so no per-sandbox password is generated here anymore.
#
# The service is kept alive by a tiny supervisor loop: if OpenChamber exits (e.g.
# an interactive self-update, which requires a restart to take effect, or a
# crash), wait a few seconds and start it again. No systemd — this script is
# launched in the background by the kit's startup command, so the supervisor loop
# runs backgrounded here and lives for the container's lifetime.
#
# RESTART_DELAY: seconds to wait before respawning a stopped process.
RESTART_DELAY="${OPENCHAMBER_RESTART_DELAY:-5}"

# Guard against a second startup run (idempotent restarts) spawning a duplicate
# supervisor: only start a supervisor if one isn't already running. The loop is
# launched with a marker ARGUMENT ("supervisor:<name>") that the inner `sh -c`
# ignores; pgrep -f matches the whole command line, so it finds the loop by that
# marker. (An argument, not `exec -a` — the startup shell is POSIX `sh`/dash,
# which has no `exec -a`.)
supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

# Start the OpenChamber supervisor unless already running. OpenChamber normally
# daemonizes; run it with OPENCHAMBER_NO_DAEMON so it stays in the foreground and
# the supervisor can see it exit (and thus restart it after a self-update). The
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
