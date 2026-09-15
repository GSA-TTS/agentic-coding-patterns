#!/bin/sh
# goose-start.sh — merge the goose USAi config on first boot, then supervise the
# goosed ACP server (`goose serve`) so it auto-restarts if it exits.
#
# SCOPE: this startup script manages ONE thing — a single supervised
# `goose serve --host 0.0.0.0 --port <port> --platform desktop` (with a shared
# secret from GOOSE_SERVER__SECRET_KEY). The server runs under a respawn loop so a
# crash or a self-update self-heals. Because this script runs as a `startup`
# command — which fires on EVERY sandbox start, including a detached `acq create`
# with nobody attached, held open by the sandbox's tini keepalive (PID 1),
# independent of any interactive session — the goosed server comes up on its own.
# No `acq exec` / no `acq run` is needed to bring it up. A single `acq create` is
# enough; then point goose Desktop at the published host port (see the kit README).
#
# The goose CLI itself is installed at CREATE time (install phase) by
# goose-install.sh — a single pinned, sha-verified static binary. This script only
# assumes `goose` is on PATH; if it is not (a non-fatal install failure), it warns
# and exits 0 so the sandbox is never dead over the optional server.
#
# AUTH: goose Desktop 1.50.0's ACP client ALWAYS performs a secret-key handshake
# (X-Secret-Key on /status, ?token= on /acp), so a server started
# --dangerously-unauthenticated is rejected by Desktop with "server cannot connect"
# even though /status is reachable (confirmed on a live 1.50.0 Desktop). The server
# therefore runs WITH GOOSE_SERVER__SECRET_KEY (from the kit env; the operator
# pastes the same value into Desktop's Secret Key field). This is a cleartext
# loopback HANDSHAKE TOKEN, not a protected credential — it guards only a
# host-loopback port and must also live in Desktop's settings. The SANDBOX remains
# the real security boundary (ephemeral container/microVM, deny-default allow-listed
# egress, no host FS, injected credentials); the published port is HOST LOOPBACK
# ONLY. See docs/decisions/0002-plaintext-http-loopback.md.
#
# IN-GUEST BIND IS 0.0.0.0 (all guest interfaces), NOT 127.0.0.1 — the same lesson
# the openchamber/paseo kits document: acq's create-time port publish (msb
# `-p HOST:GUEST`) binds a HOST loopback listener but the publisher dials the
# sandbox's GUEST NETWORK IP, not guest loopback, so a 127.0.0.1-only bind answers
# `acq exec <sbx> -- curl 127.0.0.1:<port>` from inside the guest yet the published
# host port returns "Empty reply from server". Binding 0.0.0.0 makes the guest port
# reachable through create-time publishedPorts; the HOST side of the publish stays
# loopback-only, so 0.0.0.0 in-guest does not widen host exposure.
#
# Pins/config arrive via the environment (fallback defaults kept in sync with the
# kit spec):
#   GOOSE_SERVE_HOST     — bind address (default 0.0.0.0)
#   GOOSE_SERVE_PORT     — bind port (default 3284, goosed's ACP default)
#   GOOSE_RESTART_DELAY  — seconds before respawning a stopped server (default 5)

set -eu

GOOSE_SERVE_HOST="${GOOSE_SERVE_HOST:-0.0.0.0}"
GOOSE_SERVE_PORT="${GOOSE_SERVE_PORT:-3284}"
RESTART_DELAY="${GOOSE_RESTART_DELAY:-5}"

warn() { echo "goose-server(startup): $*" >&2; }

# goose is installed to /usr/local/bin at create time; make sure that is on PATH
# for THIS non-login shell (process-local; other `acq exec sh -c` callers must set
# their own PATH — the verify script does).
case ":$PATH:" in *":/usr/local/bin:"*) : ;; *) PATH="/usr/local/bin:$PATH" ;; esac
export PATH

STATE_DIR="$HOME/.local/state/goose"
mkdir -p "$STATE_DIR" 2>/dev/null || true

# --- Merge the USAi config primer into goose's global config (every boot). ------
# Idempotent + non-fatal (converges to a stable fixed point; see merge-config.mjs).
# goose's config dir is XDG: ~/.config/goose. We stage the primer at
# ~/goose-config/config.yaml (dropped by the kit) and merge it in.
GOOSE_CONFIG_DIR="${GOOSE_CONFIG_DIR:-$HOME/.config/goose}"
SOURCE_CONFIG="$HOME/goose-config/config.yaml"
MERGE_SCRIPT="$HOME/goose-config/merge-config.mjs"
if [ -f "$SOURCE_CONFIG" ] && [ -f "$MERGE_SCRIPT" ] && command -v node >/dev/null 2>&1; then
  node "$MERGE_SCRIPT" --source "$SOURCE_CONFIG" --global-dir "$GOOSE_CONFIG_DIR" \
    >>"$STATE_DIR/goose-config-merge.log" 2>&1 \
    || warn "config merge failed (non-fatal); see $STATE_DIR/goose-config-merge.log"
else
  warn "config primer or node missing; skipping goose config merge (non-fatal)."
fi

# --- Stage the custom_usai provider definition into goose's config dir. ---------
# goose Desktop drives the external server by NAMED provider (`custom_usai`). The
# server must define that same provider or agent init fails and Desktop cannot
# connect. The kit ships custom_usai.json (base_url + models, NO secret — goose
# reads the key from the CUSTOM_USAI_API_KEY env acq injects). Copy it into
# ~/.config/goose/custom_providers/ only if it is not already the same bytes, so a
# provider the user later edited in Desktop is not clobbered on every boot.
# Non-fatal: a copy failure warns but never fails the sandbox.
CUSTOM_SRC="$HOME/goose-config/custom_providers/custom_usai.json"
CUSTOM_DEST_DIR="$GOOSE_CONFIG_DIR/custom_providers"
CUSTOM_DEST="$CUSTOM_DEST_DIR/custom_usai.json"
if [ -f "$CUSTOM_SRC" ]; then
  if [ ! -f "$CUSTOM_DEST" ] || ! cmp -s "$CUSTOM_SRC" "$CUSTOM_DEST"; then
    mkdir -p "$CUSTOM_DEST_DIR" 2>/dev/null || true
    if cp "$CUSTOM_SRC" "$CUSTOM_DEST" 2>/dev/null; then
      echo "goose-server(startup): staged custom_usai provider to $CUSTOM_DEST" \
        >>"$STATE_DIR/goose-config-merge.log" 2>&1 || true
    else
      warn "could not stage custom_usai.json to $CUSTOM_DEST (non-fatal)."
    fi
  fi
else
  warn "custom_usai.json primer missing; Desktop's custom_usai provider will be undefined on the server (non-fatal)."
fi

# --- Require the goose binary. -------------------------------------------------
if ! command -v goose >/dev/null 2>&1; then
  warn "goose binary not found on PATH (install may have failed at create time)."
  warn "  The goosed server will not start; the sandbox is otherwise unaffected."
  warn "  See the install log and TROUBLESHOOTING.md."
  exit 0   # never fail the sandbox over the optional server
fi

# --- Supervise `goose serve` (idempotent). -------------------------------------
# Guard against a second startup run spawning a duplicate supervisor: only start
# one if it isn't already running. The loop carries a marker ARGUMENT
# ("supervisor:goose-serve") that the inner `sh -c` ignores; pgrep -f matches the
# whole command line and finds the loop by that marker. (An argument, not
# `exec -a` — the startup shell is POSIX sh/dash, which has no `exec -a`.)
supervisor_running() { pgrep -u "$(id -u)" -f "supervisor:$1" >/dev/null 2>&1; }

SERVE_LOG="$STATE_DIR/goose-serve.log"

# `goose serve` blocks in the foreground, so the supervisor can see it exit and
# relaunch it. Flags:
#   --host/--port                    the bind, published to the host by the kit
#   --platform desktop               tells goosed it is backing a Desktop client
#                                    (the remote-server guide's recommended flag)
#   --enable-scheduler               allow scheduled recipes (parity with the
#                                    launchd example in goose's remote-server guide)
#
# AUTH: goose Desktop 1.50.0's ACP client ALWAYS performs a secret-key handshake —
# its health check sends `X-Secret-Key: <secret>` to /status and builds the ACP
# URL as `/acp?token=<secret>`. A server started `--dangerously-unauthenticated`
# does not satisfy that contract, so Desktop reports "server cannot connect" even
# though /status is reachable (empirically confirmed on a live 1.50.0 Desktop).
# We therefore run WITH a shared secret from GOOSE_SERVER__SECRET_KEY (set by the
# kit env; the operator pastes the same value into Desktop's Secret Key field).
# goose reads GOOSE_SERVER__SECRET_KEY from the environment, so we do not pass it
# on argv (keeps it out of the process command line / logs). See
# docs/decisions/0002-plaintext-http-loopback.md.
#
# argv to the inner sh -c: $0=marker, $1=RESTART_DELAY, $2=HOST, $3=PORT.
# GOOSE_SERVER__SECRET_KEY is inherited from this script's environment.
if [ -z "${GOOSE_SERVER__SECRET_KEY:-}" ]; then
  warn "GOOSE_SERVER__SECRET_KEY is not set; goose Desktop 1.50.0 will not connect."
  warn "  The kit env should set it. See TROUBLESHOOTING.md."
fi
export GOOSE_SERVER__SECRET_KEY
if ! supervisor_running goose-serve; then
  ( sh -c '
      while :; do
        echo "[supervisor] starting goose serve at $(date -u +%FT%TZ)"
        goose serve \
          --host "$2" \
          --port "$3" \
          --platform desktop \
          --enable-scheduler || true
        echo "[supervisor] goose serve exited; restarting in ${1}s"
        sleep "$1"
      done
    ' "supervisor:goose-serve" "$RESTART_DELAY" "$GOOSE_SERVE_HOST" "$GOOSE_SERVE_PORT" \
    >>"$SERVE_LOG" 2>&1 ) &
fi
