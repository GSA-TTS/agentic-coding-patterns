#!/bin/sh
# model-router-proxy-install.sh — point OpenCode at an EXTERNAL model-router
# service so every prompt auto-routes to the best model.
#
# WHAT IT DOES (startup phase, idempotent, fail-soft):
#   1. Fetch ONLY the harness-toggle code (a few stdlib-only Python modules) from
#      the model-router-service repo at a PINNED SHA (public GitHub tarball via
#      codeload). No server, no deps, no background process runs in the sandbox.
#   2. Install the `model-router-toggle` CLI on PATH.
#   3. Flip OpenCode's usai baseURL -> $MODEL_ROUTER_URL/v1 via that CLI
#      (merge-not-clobber; idempotent; saves the original so `off` restores it).
#
# WHY EXTERNAL: calling the decision service in-process per prompt was only ever a
# POC shape. The service now runs where you deploy it — your localhost during dev
# or a cloud.gov app in a real environment — and this kit simply ROUTES OpenCode
# at that URL. The service URL is REQUIRED config (MODEL_ROUTER_URL); nothing is
# hardcoded and no service is started here.
#
# FAIL-SOFT: a missing MODEL_ROUTER_URL, a failed toggle-code fetch, or any error
# leaves OpenCode on the DIRECT USAi gateway and exits 0 — never a dead sandbox.
# The service being down is likewise non-fatal: the toggle warns, and if you want
# a hard fallback leave MODEL_ROUTER_REQUIRE_READY unset (default) so routing is
# still flipped on and the service can come up later.
#
# SECURITY: no secret is created or read here. The target service authenticates
# the upstream itself (it holds ROUTER_UPSTREAM_API_KEY where it is deployed).
# This kit only edits a baseURL in the agent-side OpenCode config.

set -eu

# --- Pins / config (overridable via env) ------------------------------------
SERVICE_REPO="${MODEL_ROUTER_SERVICE_REPO:-btylerburton/model-router-service}"
SERVICE_REF="${MODEL_ROUTER_SERVICE_REF:-e0fad9608a0fd6309b6bcea95ab51190ca5255c2}"
# REQUIRED: the external model-router-service base URL (NO default host — this is
# the whole point of the external shape). Examples:
#   http://host.docker.internal:8080   (service on your laptop, Docker-based acq)
#   https://model-router.app.cloud.gov (deployed to cloud.gov)
MODEL_ROUTER_URL="${MODEL_ROUTER_URL:-}"
# If "1", only flip routing when the service answers /readyz (else leave direct).
REQUIRE_READY="${MODEL_ROUTER_REQUIRE_READY:-0}"

HOME_DIR="${HOME:-/home/agent}"
# Only the toggle CLI needs to live in-sandbox; it is pure stdlib (no pip).
APP_DIR="$HOME_DIR/.local/share/model-router/toggle-src"
STATE_DIR="$HOME_DIR/.local/state/model-router-proxy"
LOG="$STATE_DIR/install.log"
mkdir -p "$STATE_DIR" "$APP_DIR"
: > "$LOG"

note() { echo "model-router-proxy: $*"; }
warn() { echo "model-router-proxy: $*" >&2; }

# --- Preflight ---------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  warn "python3 not found; cannot install the toggle this boot (OpenCode stays on the direct gateway)"
  exit 0
fi

if [ -z "$MODEL_ROUTER_URL" ]; then
  warn "MODEL_ROUTER_URL not set in the GUEST environment. This kit routes OpenCode \
at an EXTERNAL service and needs its URL. The spec ships a default \
(http://host.docker.internal:8080); if you see this, the env did not reach the \
guest. Set it in the guest, e.g. the kit's environment block or \
'acq exec <sbx> -- env MODEL_ROUTER_URL=https://<app>.app.cloud.gov model-router-toggle on'. \
NOTE: a host-shell 'export MODEL_ROUTER_URL=...' does NOT reach the sandbox. \
Leaving OpenCode on the direct gateway."
  exit 0
fi

# --- 1. Fetch ONLY the toggle code at the pinned SHA (idempotent, ref-aware) --
# We pull the toggle.py + adapters/ modules (stdlib-only) from the service repo.
# Re-fetch when the pinned ref changes so a repin actually updates the sandbox.
STAMP="$APP_DIR/.model-router-ref"
TOGGLE_MOD="$APP_DIR/model_router_service/toggle.py"
need_fetch=1
if [ -f "$TOGGLE_MOD" ] && [ -f "$STAMP" ] \
   && [ "$(cat "$STAMP" 2>/dev/null)" = "$SERVICE_REF" ]; then
  need_fetch=0
  note "toggle code $SERVICE_REF already present; skipping fetch"
fi
if [ "$need_fetch" -eq 1 ]; then
  note "fetching toggle code from $SERVICE_REPO@$SERVICE_REF"
  TARBALL="https://codeload.github.com/$SERVICE_REPO/tar.gz/$SERVICE_REF"
  TMP="$STATE_DIR/src.tar.gz"
  if ! curl -fsSL "$TARBALL" -o "$TMP" >>"$LOG" 2>&1; then
    warn "could not fetch the toggle tarball (see $LOG); OpenCode stays on the direct gateway"
    exit 0
  fi
  rm -rf "$APP_DIR" && mkdir -p "$APP_DIR/model_router_service/adapters"
  TMPX="$STATE_DIR/src"
  rm -rf "$TMPX" && mkdir -p "$TMPX"
  if ! tar -xzf "$TMP" -C "$TMPX" --strip-components=1 >>"$LOG" 2>&1; then
    warn "could not extract the toggle tarball (see $LOG); staying on the direct gateway"
    exit 0
  fi
  SRCPKG="$TMPX/src/model_router_service"
  # Copy only the stdlib-only toggle surface; a minimal package __init__ keeps it
  # importable without dragging in app.py/httpx/pydantic (server-only deps).
  cp "$SRCPKG/toggle.py" "$APP_DIR/model_router_service/" 2>>"$LOG" || true
  cp "$SRCPKG/adapters/__init__.py" "$SRCPKG/adapters/opencode.py" \
     "$SRCPKG/adapters/openai_env.py" "$APP_DIR/model_router_service/adapters/" 2>>"$LOG" || true
  printf '"""minimal package shim for the model-router toggle (no server deps)."""\n' \
     > "$APP_DIR/model_router_service/__init__.py"
  rm -rf "$TMP" "$TMPX"
  if [ ! -f "$TOGGLE_MOD" ]; then
    warn "toggle code not found after extract (see $LOG); staying on the direct gateway"
    exit 0
  fi
  echo "$SERVICE_REF" > "$STAMP"
fi

# Preflight: the toggle must import (stdlib only, so this is just a sanity gate).
if ! PYTHONPATH="$APP_DIR" python3 -c 'import model_router_service.toggle' >>"$LOG" 2>&1; then
  warn "toggle code not importable (see $LOG); staying on the direct gateway"
  exit 0
fi

# --- 2. Install the model-router-toggle shim on PATH -------------------------
TOGGLE_BIN="$HOME_DIR/.local/bin/model-router-toggle"
mkdir -p "$HOME_DIR/.local/bin"
cat > "$TOGGLE_BIN" <<EOF
#!/bin/sh
exec env PYTHONPATH="$APP_DIR:\${PYTHONPATH:-}" \\
  python3 -m model_router_service.toggle "\$@"
EOF
chmod +x "$TOGGLE_BIN"

# --- 3. (Optional) require the external service be ready before flipping ------
if [ "$REQUIRE_READY" = "1" ]; then
  if ! curl -fsS "${MODEL_ROUTER_URL%/}/readyz" >/dev/null 2>&1; then
    warn "MODEL_ROUTER_REQUIRE_READY=1 but $MODEL_ROUTER_URL/readyz not reachable; \
leaving OpenCode on the direct gateway"
    exit 0
  fi
  note "external service ready at $MODEL_ROUTER_URL"
fi

# --- 4. Flip OpenCode's baseURL to the external service ----------------------
# model-router-toggle edits the agent-side global opencode.jsonc (merge, not
# clobber), saves the original, and is idempotent. OpenCode reads baseURL at
# init, so a session started AFTER this routes; the agentContext says so.
if MODEL_ROUTER_URL="$MODEL_ROUTER_URL" "$TOGGLE_BIN" --harness opencode on >>"$LOG" 2>&1; then
  note "OpenCode routed via the external service (${MODEL_ROUTER_URL%/}/v1)"
else
  warn "could not flip OpenCode baseURL (see $LOG); run 'model-router-toggle on' manually"
fi

exit 0
