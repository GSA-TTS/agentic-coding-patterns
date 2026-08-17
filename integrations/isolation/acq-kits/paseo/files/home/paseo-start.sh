#!/bin/sh
# paseo-start.sh — install the Paseo CLI on first boot, then supervise the Paseo
# daemon (which serves the API, the WebSocket, AND the bundled web UI on one port)
# so it auto-restarts if it exits.
#
# SCOPE: this startup script manages the Paseo daemon only. It supervises a single
# `paseo daemon start --foreground --listen 0.0.0.0:6767 --web-ui`. The daemon
# runs under a respawn loop, so a crash, a self-update, or a wrapper-triggered
# bounce (to apply a new worktrees.root) self-heals. Because this script runs as a
# `startup` command — which fires on EVERY sandbox start, including a detached
# `acq create` with nobody attached, and runs under the sandbox's tini keepalive
# (PID 1), independent of any interactive session — the daemon + UI come up on
# their own. No `acq exec` / no `acq run` is needed to bring the daemon up.
#
# The kit's `opencode` WRAPPER (files/home/.local/bin/opencode) does NOT own the
# daemon. It is only the entrypoint on the interactive `acq run` path, where it
# pins Paseo's worktree root under the current project, prints connect info, and
# holds PID 1 so that session's sandbox stays up. See
# docs/decisions/supervisor-owns-daemon-wrapper-pins-worktrees.md.
#
# Runs as the agent user (whose uid is assigned at provision and is not
# necessarily 1000) in the background on every sandbox start and is fully
# idempotent: it installs the Paseo CLI only if missing, then starts a supervisor
# for the daemon only if one isn't already running.
#
# Pins are provided via the environment, with an in-script fallback default kept
# in sync with the kit spec's documented pin:
#   PASEO_CLI_VERSION   — @getpaseo/cli version to install (default 0.4.0)
#   PASEO_LISTEN        — daemon bind address (default 0.0.0.0:6767)
#   PASEO_RESTART_DELAY — seconds to wait before respawning the daemon (default 5)

set -eu

# Daemon bind. Keep in sync with the kit spec's publishedPorts guest port (6767)
# and PASEO_LISTEN env. We derive the port from PASEO_LISTEN so a single override
# moves both the bind and the health probe.
PASEO_LISTEN="${PASEO_LISTEN:-0.0.0.0:6767}"
PASEO_PORT="$(printf '%s' "$PASEO_LISTEN" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
[ -n "$PASEO_PORT" ] || PASEO_PORT=6767

# npm global installs land in this prefix's bin, which is NOT on the startup
# shell's PATH by default. Put it on PATH up front so a freshly-installed `paseo`
# resolves in THIS shell (otherwise the post-install `command -v paseo` guard
# trips and the supervisor section never runs on first boot).
#
# SCOPE LIMIT — this PATH addition is PROCESS-LOCAL. It cannot be persisted for
# other, later `acq exec … sh -c '…'` invocations from here: this script runs as
# the non-root agent user, which cannot write the only files a bare non-login
# `sh -c` would pick up PATH from (/etc/environment, /etc/profile.d/* are
# root-owned, and a plain `sh -c` sources neither /etc/profile nor ~/.profile).
# Callers that exec into the sandbox (e.g. the kit's verify probes) must augment
# PATH themselves; the verify script's in_sbx() does exactly that.
NPM_BIN="$(npm prefix -g 2>/dev/null)/bin"
case ":$PATH:" in *":$NPM_BIN:"*) : ;; *) PATH="$NPM_BIN:$PATH" ;; esac
export PATH

# --- Install the Paseo CLI if it isn't present yet (first boot). -------------
if ! command -v paseo >/dev/null 2>&1; then
  _ver="${PASEO_CLI_VERSION:-0.4.0}"
  # Route npm through the sandbox proxy. npm honors HTTP(S)_PROXY automatically,
  # but be explicit so any Node-side downloads (none expected for the sherpa
  # prebuilt, which is a plain npm tarball) also proxy.
  [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && export npm_config_https_proxy="${HTTPS_PROXY:-$https_proxy}"
  [ -n "${HTTP_PROXY:-${http_proxy:-}}" ]  && export npm_config_proxy="${HTTP_PROXY:-$http_proxy}"
  export npm_config_user_agent="npm"
  # Build a CA bundle for Node-based downloads. NODE_EXTRA_CA_CERTS *appends* to
  # Node's built-in roots, which lack both the sandbox proxy CA and any
  # HTTPS-inspection CA (e.g. Zscaler). Concatenate the sandbox proxy CA
  # (PROXY_CA_CERT_B64) and the system trust store (populated with the inspection
  # CA by the zscaler-ca-certificate kit) so the full chain validates behind an
  # inspecting proxy — the proxy CA alone is not sufficient.
  _ca="$HOME/.local/state/paseo/ca-bundle.pem"
  mkdir -p "$(dirname "$_ca")"
  : > "$_ca"
  [ -n "${PROXY_CA_CERT_B64:-}" ] && printf %s "$PROXY_CA_CERT_B64" | base64 -d >> "$_ca" 2>/dev/null
  [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >> "$_ca"
  [ -s "$_ca" ] && export NODE_EXTRA_CA_CERTS="$_ca"
  # On the sbx-template base the npm global prefix's lib/ dir is ROOT-owned (the
  # template provisions global tooling as root), so the agent's `npm install -g`
  # fails EACCES. Run the install via `sudo -n` (the agent has passwordless sudo
  # on the template). The sudoers env_keep covers HTTP(S)_PROXY/NO_PROXY but NOT
  # NODE_EXTRA_CA_CERTS (bare sudo resets it), so forward proxy + CA + HOME
  # explicitly via `sudo env`. HOME keeps npm cache/config in the agent home
  # rather than /root. The `${VAR:+NAME=...}` idiom omits an arg entirely when the
  # var is empty/unset (safe under set -u). When sudo is unavailable (a plain-OCI
  # override without the template's sudo), fall back to an agent-owned per-user
  # npm prefix so the global install needs no root.
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n env \
      npm_config_user_agent="${npm_config_user_agent:-npm}" \
      ${npm_config_https_proxy:+npm_config_https_proxy="$npm_config_https_proxy"} \
      ${npm_config_proxy:+npm_config_proxy="$npm_config_proxy"} \
      ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"} \
      ONNXRUNTIME_NODE_INSTALL="${ONNXRUNTIME_NODE_INSTALL:-skip}" \
      HOME="$HOME" \
      npm install -g "@getpaseo/cli@${_ver}" >>"$HOME/.local/state/paseo/paseo-install.log" 2>&1 || true
  else
    export npm_config_prefix="$HOME/.npm-global"
    mkdir -p "$HOME/.npm-global"
    # NPM_BIN (above) was computed from the DEFAULT global prefix, so the
    # `command -v paseo` guard below and the supervisor probe would otherwise
    # never see a package installed under this per-user prefix. Prepend it.
    case ":$PATH:" in *":$HOME/.npm-global/bin:"*) : ;; *) PATH="$HOME/.npm-global/bin:$PATH" ;; esac
    export PATH
    npm install -g "@getpaseo/cli@${_ver}" >>"$HOME/.local/state/paseo/paseo-install.log" 2>&1 || true
  fi
fi
command -v paseo >/dev/null 2>&1 || {
  # Route the marker to BOTH the log and stderr. This is written for ANY
  # unsuccessful install (the install above runs with `|| true`), including
  # TRANSIENT causes (npm/registry 503, a proxy blip). It is NOT a
  # definitive-failure signal — verify's fast-fail path does not trip on it, so a
  # transient failure can ride the normal readiness timeout.
  echo "paseo install failed; see $HOME/.local/state/paseo/paseo-install.log" \
    | tee -a "$HOME/.local/state/paseo/paseo-install.log" >&2
  exit 0   # never fail the sandbox over an optional UI
}

# --- Supervise the Paseo daemon (idempotent). --------------------------------
# The daemon runs UNSECURED (no PASEO_PASSWORD) — the sandbox is the security
# boundary, and the published host port is loopback only. `--foreground` keeps it
# in the foreground so the supervisor can see it exit and restart it (after a
# crash, a self-update, or a wrapper-triggered bounce to apply a new
# worktrees.root). `--web-ui` (redundant with PASEO_WEB_UI_ENABLED=true from the
# kit env, set for belt-and-suspenders) serves the bundled browser UI on the same
# port. No systemd — this script is launched in the background by the kit's
# startup command, so the supervisor loop runs backgrounded here and lives for the
# container's lifetime, held open by the sandbox's tini keepalive (PID 1)
# regardless of whether anyone attaches.
#
# RESTART_DELAY: seconds to wait before respawning a stopped daemon.
RESTART_DELAY="${PASEO_RESTART_DELAY:-5}"

# Guard against a second startup run (idempotent restarts) spawning a duplicate
# supervisor: only start one if it isn't already running. The loop is launched
# with a marker ARGUMENT ("supervisor:paseo-daemon") that the inner `sh -c`
# ignores; pgrep -f matches the whole command line, so it finds the loop by that
# marker. (An argument, not `exec -a` — the startup shell is POSIX sh/dash, which
# has no `exec -a`.)
supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

DAEMON_LOG="$HOME/.local/state/paseo/paseo-daemon.log"
mkdir -p "$(dirname "$DAEMON_LOG")" 2>/dev/null || true

# Start the daemon supervisor unless already running. `paseo daemon start
# --foreground` blocks, so the supervisor can see it exit and relaunch it.
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=PASEO_LISTEN.
if ! supervisor_running paseo-daemon; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting paseo daemon at $(date -u +%FT%TZ)"
        paseo daemon start --foreground --listen "$2" --web-ui || true
        echo "[supervisor] paseo daemon exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:paseo-daemon" "$RESTART_DELAY" "$PASEO_LISTEN" \
    >>"$DAEMON_LOG" 2>&1 ) &
fi
