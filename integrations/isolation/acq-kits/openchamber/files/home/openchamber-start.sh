#!/bin/sh
# openchamber-start.sh — install OpenChamber on first boot, then supervise BOTH
# the shared `opencode serve` and OpenChamber so each auto-restarts if it exits.
#
# SCOPE: this startup script manages the shared opencode server AND OpenChamber.
# It supervises a single shared `opencode serve` on 0.0.0.0:4096, and supervises
# OpenChamber (skip-start mode, OPENCODE_SKIP_START=true + OPENCODE_PORT=4096) so
# OpenChamber attaches to that shared server. BOTH run under respawn loops, so a
# crash or self-update self-heals. Because this script runs as a `startup`
# command — which fires on EVERY sandbox start, including a detached `acq create`
# with nobody attached, and runs under the sandbox's tini keepalive (PID 1),
# independent of any interactive session — the server and UI come up on their
# own. No `acq exec` / no `acq run` is needed to bring the server up.
#
# The kit's `opencode` WRAPPER (files/home/.local/bin/opencode) no longer OWNS
# the server. It is only the entrypoint on the interactive `acq run` path, where
# it offers a TUI and holds PID 1 so that session's sandbox stays up; it does not
# start `opencode serve` (this script does). See
# docs/decisions/startup-owns-shared-server.md.
#
# Extracted (per the acq design doc §6, like agentic-coding-playbook's
# playbook-clone.sh) from the former sbx kit's inline startup command into a
# standalone, testable script.
#
# Runs as the agent user (whose uid is assigned at provision and is not
# necessarily 1000) in the background on every sandbox start and
# is fully idempotent: it installs OpenChamber only if missing, then starts a
# supervisor for the shared server and one for OpenChamber, each only if one
# isn't already running.
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
#
# SCOPE LIMIT — this PATH addition is PROCESS-LOCAL. It cannot be persisted for
# other, later `acq exec … sh -c '…'` invocations from here: this script runs as
# the non-root agent user, which cannot write the only files a bare non-login
# `sh -c` would pick up PATH from — /etc/environment and /etc/profile.d/* are
# root-owned, and a plain `sh -c` sources neither /etc/profile nor ~/.profile
# anyway. So there is no agent-user-safe, portable way to make the npm-global bin
# / ~/.local/bin durably resolvable for a future bare `sh -c`. Callers that exec
# into the sandbox (e.g. the kit's verify probes) must therefore augment PATH
# themselves; the verify script's in_sbx() does exactly that. Do NOT attempt an
# unportable root-only write here.
NPM_BIN="$(npm prefix -g 2>/dev/null)/bin"
case ":$PATH:" in *":$NPM_BIN:"*) : ;; *) PATH="$NPM_BIN:$PATH" ;; esac
export PATH

# --- Install OpenChamber if it isn't present yet (first boot). ---------------
if ! command -v openchamber >/dev/null 2>&1; then
  # Route prebuild-install (and npm) through the sandbox proxy.
  [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && export npm_config_https_proxy="${HTTPS_PROXY:-$https_proxy}"
  [ -n "${HTTP_PROXY:-${http_proxy:-}}" ]  && export npm_config_proxy="${HTTP_PROXY:-$http_proxy}"
  # Force the OpenChamber installer to use npm. Its install.sh auto-detects a
  # package manager (pnpm > bun > yarn > npm) and would pick `yarn` on the
  # node:22-bookworm base — but yarn resolves its own registry
  # (registry.yarnpkg.com), which is NOT on this kit's egress allow-list
  # (spec.yaml permits registry.npmjs.org, not yarn's). The installer honors
  # $npm_config_user_agent (an `npm*` value selects npm), and all this kit's
  # proxy/CA plumbing is npm-oriented, so pin npm explicitly.
  export npm_config_user_agent="npm"
  # Build a CA bundle for Node-based downloads (the prebuilt native binary).
  # NODE_EXTRA_CA_CERTS *appends* to Node's built-in roots, which lack both the
  # sandbox proxy CA and any HTTPS-inspection CA (e.g. Zscaler). Concatenate BOTH
  # the sandbox proxy CA (PROXY_CA_CERT_B64) and the system trust store
  # (populated with the inspection CA by the zscaler-ca-certificate kit at
  # startup) so the full chain validates — the proxy CA alone is not sufficient
  # behind an inspecting proxy.
  #
  # ACCEPTED RISK (trust surface): this bundle lives at an AGENT-WRITABLE path and
  # is forwarded (via `sudo env NODE_EXTRA_CA_CERTS=...`) into the ROOT installer
  # below. An actor who already controls the agent user could therefore add a
  # trust anchor the root download honors. This is bounded — that actor already
  # has agent-level code execution inside the sandbox (the security boundary), and
  # the installer it feeds is independently SHA-256-pinned — so we accept it here
  # rather than stage a root-owned bundle before the sudo hand-off.
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
  _ref="${OPENCHAMBER_REF:-v1.20.0}"
  _want_sha="${OPENCHAMBER_INSTALL_SHA256:-964df00e6b163fefdc8ae0a10608a764bbb326a3d076d1d2fd9af65dbe4e1b34}"
  _installer="$HOME/.local/state/openchamber/install.sh"
  if curl -fsSL "https://raw.githubusercontent.com/openchamber/openchamber/$_ref/scripts/install.sh" \
       -o "$_installer" 2>/tmp/openchamber-install.log; then
    _got_sha="$( (sha256sum "$_installer" 2>/dev/null || shasum -a 256 "$_installer" 2>/dev/null) | cut -d' ' -f1)"
    if [ "$_got_sha" = "$_want_sha" ]; then
      # Run the (SHA-verified) installer, which internally does
      # `npm install -g @openchamber/web`. On the sbx-template base the npm
      # global prefix's lib/ dir is ROOT-owned (as on sbx: the template
      # provisions global tooling as root), so the agent's `npm install -g`
      # fails EACCES. Run the whole installer via `sudo -n` (the agent has
      # passwordless sudo on the template). The sudoers env_keep covers
      # HTTP(S)_PROXY/NO_PROXY but NOT NODE_EXTRA_CA_CERTS (bare sudo resets it
      # to msb's default /.msb/tls/ca.pem, dropping the kit's assembled bundle),
      # so forward proxy + CA + HOME explicitly via `sudo env`. HOME keeps npm
      # cache/config in the agent home rather than /root. The `${VAR:+NAME=...}`
      # idiom omits an arg entirely when the var is empty/unset (safe under
      # set -u), so an empty proxy does not pass an empty npm_config_*. When
      # sudo is unavailable (a plain-OCI override without the template's sudo),
      # fall back to an agent-owned per-user npm prefix so the global install
      # needs no root.
      if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo -n env \
          npm_config_user_agent="${npm_config_user_agent:-npm}" \
          ${npm_config_https_proxy:+npm_config_https_proxy="$npm_config_https_proxy"} \
          ${npm_config_proxy:+npm_config_proxy="$npm_config_proxy"} \
          ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"} \
          HOME="$HOME" \
          bash "$_installer" >>/tmp/openchamber-install.log 2>&1 || true
      else
        export npm_config_prefix="$HOME/.npm-global"
        mkdir -p "$HOME/.npm-global"
        # NPM_BIN (line 58) was computed from the DEFAULT global prefix, so the
        # `command -v openchamber` guard below and the supervisor probe would
        # otherwise never see a package installed under this per-user prefix.
        # Prepend the per-user bin so the whole no-sudo path is resolvable.
        case ":$PATH:" in *":$HOME/.npm-global/bin:"*) : ;; *) PATH="$HOME/.npm-global/bin:$PATH" ;; esac
        export PATH
        bash "$_installer" >>/tmp/openchamber-install.log 2>&1 || true
      fi
    else
      echo "openchamber: install.sh SHA-256 mismatch (got $_got_sha, want $_want_sha) at $_ref; refusing to run it" >>/tmp/openchamber-install.log 2>&1
    fi
    rm -f "$_installer"
  fi
fi
command -v openchamber >/dev/null 2>&1 || {
  # Route the marker to BOTH the log and stderr. NOTE: this marker is written for
  # ANY unsuccessful install (the installer above runs with `|| true`, so the only
  # signal is `command -v openchamber`), including TRANSIENT causes (npm/registry
  # 503, proxy blip). It is therefore NOT a definitive-failure signal — verify's
  # fast-fail path deliberately does not trip on it, so a transient failure can
  # ride the normal readiness timeout. Only the SHA-256 refusal above (line ~129)
  # is definitive.
  echo "openchamber install failed; see /tmp/openchamber-install.log" | tee -a /tmp/openchamber-install.log >&2
  exit 0   # never fail the sandbox over an optional UI
}

# --- Supervise the shared server and OpenChamber (idempotent). ---------------
# The shared `opencode serve` runs on 0.0.0.0:4096 and is UNSECURED (no
# OPENCODE_SERVER_PASSWORD) — the sandbox is the security boundary, and the
# published host port is loopback only. OpenChamber runs in SKIP-START mode
# (OPENCODE_SKIP_START=true, OPENCODE_PORT=4096): it does NOT start its own
# opencode server; it attaches to the shared server this script brings up on
# 127.0.0.1:4096.
#
# Each service is kept alive by a tiny supervisor loop: if it exits (a crash, or
# an OpenChamber self-update, which requires a restart to take effect), wait a
# few seconds and start it again. No systemd — this script is launched in the
# background by the kit's startup command, so the supervisor loops run
# backgrounded here and live for the container's lifetime, held open by the
# sandbox's tini keepalive (PID 1) regardless of whether anyone attaches.
#
# RESTART_DELAY: seconds to wait before respawning a stopped process.
RESTART_DELAY="${OPENCHAMBER_RESTART_DELAY:-5}"

# Guard against a second startup run (idempotent restarts) spawning a duplicate
# supervisor: only start a supervisor if one isn't already running. Each loop is
# launched with a marker ARGUMENT ("supervisor:<name>") that the inner `sh -c`
# ignores; pgrep -f matches the whole command line, so it finds the loop by that
# marker. (An argument, not `exec -a` — the startup shell is POSIX `sh`/dash,
# which has no `exec -a`.)
supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

# Start the shared-server supervisor unless already running. This is the single
# `opencode serve` that both OpenChamber and any attached TUI drive, so they
# share one live session. It binds 0.0.0.0 so the published host port reaches it.
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=OC_HOST, $3=OC_PORT.
SERVE_LOG="$HOME/.local/state/openchamber/opencode-serve.log"
mkdir -p "$(dirname "$SERVE_LOG")" 2>/dev/null || true
if ! supervisor_running opencode-serve; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting opencode serve at $(date -u +%FT%TZ)"
        opencode serve --hostname "$2" --port "$3" || true
        echo "[supervisor] opencode serve exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:opencode-serve" "$RESTART_DELAY" "0.0.0.0" "$OC_PORT" \
    >>"$SERVE_LOG" 2>&1 ) &
fi

# Start the OpenChamber supervisor unless already running. OpenChamber
# DAEMONIZES by default; run it with the `--foreground` FLAG so it stays in the
# foreground and the supervisor can see it exit (and thus restart it after a
# self-update). NOTE: there is no `OPENCHAMBER_NO_DAEMON` env var — OpenChamber
# only honors the `--foreground` (alias `--no-daemon`) command-line flag. Passing
# the env var (as an earlier version did) was a silent no-op: OpenChamber
# daemonized, its real server reparented to PID 1 (detaching from this
# supervisor), the foreground child exited immediately, and every respawn then
# failed with "OpenChamber is already running on port <N>" in an endless loop.
# The sandbox is the security boundary, so OpenChamber's own LAN access is
# unauthenticated.
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=OC_PORT, $3=CHAMBER_PORT.
if ! supervisor_running openchamber; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting openchamber at $(date -u +%FT%TZ)"
        OPENCODE_SKIP_START=true \
        OPENCODE_PORT="$2" \
        OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
          openchamber --lan --port "$3" --foreground || true
        echo "[supervisor] openchamber exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:openchamber" "$RESTART_DELAY" "$OC_PORT" "$CHAMBER_PORT" \
    >>/tmp/openchamber.log 2>&1 ) &
fi
