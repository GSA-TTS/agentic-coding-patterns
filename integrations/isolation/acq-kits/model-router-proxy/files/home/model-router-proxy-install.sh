#!/bin/sh
# model-router-proxy-install.sh — POC: run the model-router proxy INSIDE the
# sandbox and point OpenCode at it, so every prompt auto-routes to the best model.
#
# WHAT IT DOES (startup phase, idempotent, fail-soft):
#   1. Fetch the model-router-service repo at a PINNED SHA (public GitHub tarball
#      via codeload — the one channel both sbx and msb reach without extra egress)
#      into the agent home, unless already present.
#   2. Launch it in the BACKGROUND with the sandbox's python3 (stdlib + a few
#      pinned deps installed to a local prefix), reusing the usai-provider kit's
#      injected USAI_API_KEY as ROUTER_UPSTREAM_API_KEY and the sandbox's own CA
#      trust (the zscaler-ca-certificate kit handles the proxy root in-sandbox) —
#      no new secret, no ROUTER_CA_BUNDLE needed.
#   3. Wait for /readyz, then flip OpenCode's usai baseURL to 127.0.0.1:<port>/v1
#      (reachable in-sandbox) via the installed `model-router-toggle` CLI.
#
# FAIL-SOFT: this is an OPTIONAL routing convenience. Missing python3, a failed
# fetch, deps that won't install, or a proxy that never comes ready all leave
# OpenCode pointed at the DIRECT USAi gateway and exit 0 — never a dead sandbox.
#
# SECURITY: no secret is created here; it reuses USAI_API_KEY already injected by
# usai-provider. The proxy binds LOOPBACK only (127.0.0.1) — it is not exposed
# outside the sandbox. The request text is only pattern-matched/forwarded.
#
# POC SCOPE: single pinned SHA, loopback bind, background process (no supervisor).
# Not a production deployment — that's the cloud.gov path in the service repo.

set -eu

# --- Pins / config (overridable via env) ------------------------------------
SERVICE_REPO="${MODEL_ROUTER_SERVICE_REPO:-btylerburton/model-router-service}"
SERVICE_REF="${MODEL_ROUTER_SERVICE_REF:-03175b33cd232d7b372e5d9f1bd85c700eef5ce5}"
PORT="${MODEL_ROUTER_PORT:-8080}"
JUDGE_MODEL="${MODEL_ROUTER_JUDGE_MODEL:-claude_4_5_haiku}"
DEFAULT_MODEL="${MODEL_ROUTER_DEFAULT_MODEL:-claude_4_5_sonnet}"
UPSTREAM_BASE_URL="${MODEL_ROUTER_UPSTREAM_BASE_URL:-https://api.gsa.usai.gov/api/v1}"

HOME_DIR="${HOME:-/home/agent}"
APP_DIR="$HOME_DIR/model-router-service"
VENV_PREFIX="$HOME_DIR/.local"           # pip --prefix target (no root, no venv dep)
STATE_DIR="$HOME_DIR/.local/state/model-router-proxy"
LOG="$STATE_DIR/install.log"
SRV_LOG="$STATE_DIR/service.log"
PIDF="$STATE_DIR/service.pid"
mkdir -p "$STATE_DIR"
: > "$LOG"

note() { echo "model-router-proxy: $*"; }
warn() { echo "model-router-proxy: $*" >&2; }

# --- Preflight ---------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  warn "python3 not found; cannot run the proxy this boot (OpenCode stays on the direct gateway)"
  exit 0
fi

if [ -z "${USAI_API_KEY:-}" ]; then
  warn "USAI_API_KEY not set (is the usai-provider kit applied?); leaving OpenCode on the direct gateway"
  exit 0
fi

# --- 1. Fetch the service at the pinned SHA (idempotent) ---------------------
if [ ! -f "$APP_DIR/src/model_router_service/__main__.py" ]; then
  note "fetching $SERVICE_REPO@$SERVICE_REF"
  TARBALL="https://codeload.github.com/$SERVICE_REPO/tar.gz/$SERVICE_REF"
  TMP="$STATE_DIR/src.tar.gz"
  if ! curl -fsSL "$TARBALL" -o "$TMP" >>"$LOG" 2>&1; then
    warn "could not fetch the service tarball (see $LOG); OpenCode stays on the direct gateway"
    exit 0
  fi
  rm -rf "$APP_DIR" && mkdir -p "$APP_DIR"
  # Strip the top-level <repo>-<sha>/ directory from the archive.
  if ! tar -xzf "$TMP" -C "$APP_DIR" --strip-components=1 >>"$LOG" 2>&1; then
    warn "could not extract the service tarball (see $LOG); staying on the direct gateway"
    exit 0
  fi
  rm -f "$TMP"
else
  note "service already present at $APP_DIR; skipping fetch"
fi

# --- 2. Install the pinned deps to a local prefix (no root, no network beyond pip)
# The service pins fastapi/uvicorn/httpx/pydantic in requirements.txt. Install to
# the user prefix so we need neither root nor a venv tool. If pip egress is
# blocked this fails soft.
if [ -f "$APP_DIR/requirements.txt" ]; then
  note "installing service deps to $VENV_PREFIX"
  if ! python3 -m pip install --quiet --prefix "$VENV_PREFIX" -r "$APP_DIR/requirements.txt" >>"$LOG" 2>&1; then
    warn "could not install service deps (see $LOG); staying on the direct gateway"
    exit 0
  fi
fi

# Make the service package + installed deps importable.
PYSITE="$(python3 -c 'import sys;print("python%d.%d"%sys.version_info[:2])')"
export PYTHONPATH="$APP_DIR/src:$VENV_PREFIX/lib/$PYSITE/site-packages:${PYTHONPATH:-}"

# --- Install the model-router-toggle shim (so `model-router-toggle` is on PATH)
TOGGLE_BIN="$HOME_DIR/.local/bin/model-router-toggle"
mkdir -p "$HOME_DIR/.local/bin"
cat > "$TOGGLE_BIN" <<EOF
#!/bin/sh
exec env PYTHONPATH="$APP_DIR/src:$VENV_PREFIX/lib/$PYSITE/site-packages:\${PYTHONPATH:-}" \\
  python3 -m model_router_service.toggle "\$@"
EOF
chmod +x "$TOGGLE_BIN"

TOGGLE_FEEDBACK="$HOME_DIR/.local/bin/model-router"
cat > "$TOGGLE_FEEDBACK" <<EOF
#!/bin/sh
exec env PYTHONPATH="$APP_DIR/src:$VENV_PREFIX/lib/$PYSITE/site-packages:\${PYTHONPATH:-}" \\
  python3 -m model_router_service.cli "\$@"
EOF
chmod +x "$TOGGLE_FEEDBACK"

# --- 3. Launch the proxy in the background (idempotent) ----------------------
# If a prior boot's process is still alive and serving, reuse it.
already_up=0
if curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; then
  already_up=1
  note "proxy already serving on 127.0.0.1:$PORT"
fi

if [ "$already_up" -eq 0 ]; then
  note "starting proxy on 127.0.0.1:$PORT (judge=$JUDGE_MODEL default=$DEFAULT_MODEL)"
  # Reuse the sandbox's injected USAi key + its CA trust (no ROUTER_CA_BUNDLE —
  # the zscaler-ca-certificate kit put the proxy root in the system store).
  ROUTER_UPSTREAM_BASE_URL="$UPSTREAM_BASE_URL" \
  ROUTER_UPSTREAM_API_KEY="$USAI_API_KEY" \
  ROUTER_JUDGE_MODEL="$JUDGE_MODEL" \
  ROUTER_DEFAULT_MODEL="$DEFAULT_MODEL" \
  ROUTER_HOST="127.0.0.1" ROUTER_PORT="$PORT" \
  MODEL_ROUTER_DECISION_LOG="$STATE_DIR/decisions.jsonl" \
  MODEL_ROUTER_FEEDBACK="$STATE_DIR/feedback.jsonl" \
  MODEL_ROUTER_TUNING="$STATE_DIR/tuning.json" \
  PYTHONPATH="$PYTHONPATH" \
    setsid python3 -m model_router_service >"$SRV_LOG" 2>&1 &
  echo $! > "$PIDF"

  # Wait for readiness (bounded). Fail-soft if it never comes up.
  i=0
  until curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -ge 30 ] && break
    sleep 1
  done
  if ! curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; then
    warn "proxy did not become ready within 30s (see $SRV_LOG); leaving OpenCode on the direct gateway"
    exit 0
  fi
  note "proxy ready on 127.0.0.1:$PORT"
fi

# --- 4. Flip OpenCode's baseURL to the proxy ---------------------------------
# model-router-toggle edits the agent-side global opencode.jsonc (merge, not
# clobber) and is idempotent. OpenCode reads baseURL at init, so a session
# started AFTER this will route; the agentContext tells the user that.
if MODEL_ROUTER_URL="http://127.0.0.1:$PORT" "$TOGGLE_BIN" --harness opencode on >>"$LOG" 2>&1; then
  note "OpenCode routed via the proxy (http://127.0.0.1:$PORT/v1)"
else
  warn "could not flip OpenCode baseURL (see $LOG); the proxy is up — run 'model-router-toggle on' manually"
fi

exit 0
