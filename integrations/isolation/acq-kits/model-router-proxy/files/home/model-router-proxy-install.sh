#!/bin/sh
# model-router-proxy-install.sh — route OpenCode through the model-router so
# every prompt auto-switches to the best model. Two MODES (default in-sandbox):
#
#   MODE=in-sandbox (DEFAULT): fetch the FULL service at a pinned SHA, install
#     its deps wheels-only into one --target dir, run it on 127.0.0.1 INSIDE the
#     sandbox (reusing the usai-provider USAI_API_KEY + the sandbox Zscaler CA),
#     wait for /readyz, then flip OpenCode's baseURL to the loopback service.
#     This is the shape that WORKS TODAY: USAi (api.gsa.usai.gov) is only
#     reachable from inside the GSA network / behind Zscaler, and the sandbox is
#     already there — so the decision service must run here, not on cloud.gov.
#     OpenCode->service is pure loopback (no host boundary, no VM-NAT, no proxy).
#
#   MODE=external (EXPERIMENTAL, UNSUPPORTED): do NOT run a server. Fetch only the
#     stdlib toggle, and flip OpenCode's baseURL to $MODEL_ROUTER_URL/v1 (a
#     cloud.gov app, or a host-run service via the backend host alias). This path
#     exists but has NO WORKING TARGET today and is not end-to-end verified:
#     cloud.gov cannot reach USAi (ADR 0001), and a host-run service is
#     unreachable over the microsandbox VM-NAT. Do not rely on it until an
#     external target is reachable. See the kit README "Known blockers".
#
# FAIL-SOFT everywhere: any failure (no python3, no key, fetch/dep/boot failure,
# service never ready, no resolvable external URL) leaves OpenCode on the DIRECT
# USAi gateway and exits 0 — never a dead sandbox.
#
# SECURITY: no secret is created here. in-sandbox reuses the injected
# USAI_API_KEY and the sandbox's own CA trust (the zscaler-ca-certificate kit
# put the proxy root in the system store), binds LOOPBACK only (not exposed
# outside the sandbox). external holds no key (the remote service does).

set -eu

# --- Pins / config (overridable via env) ------------------------------------
SERVICE_REPO="${MODEL_ROUTER_SERVICE_REPO:-btylerburton/model-router-service}"
SERVICE_REF="${MODEL_ROUTER_SERVICE_REF:-b5a1c9115721bce427f800594aa74a13fe21ea90}"
MODE="${MODEL_ROUTER_MODE:-in-sandbox}"      # in-sandbox (default) | external
PORT="${MODEL_ROUTER_PORT:-8080}"
JUDGE_MODEL="${MODEL_ROUTER_JUDGE_MODEL:-claude_4_5_haiku}"
DEFAULT_MODEL="${MODEL_ROUTER_DEFAULT_MODEL:-claude_4_5_sonnet}"
UPSTREAM_BASE_URL="${MODEL_ROUTER_UPSTREAM_BASE_URL:-https://api.gsa.usai.gov/api/v1}"
# external mode only: the remote service base URL (auto-detected host alias if
# unset — see the external branch below).
MODEL_ROUTER_URL="${MODEL_ROUTER_URL:-}"
REQUIRE_READY="${MODEL_ROUTER_REQUIRE_READY:-0}"

HOME_DIR="${HOME:-/home/agent}"
APP_DIR="$HOME_DIR/model-router-service"
# One flat deps dir via `pip install --target` (NOT --prefix): on this
# Debian/py3.14 image a --prefix install landed under
# ~/.local/local/lib/python3.14/dist-packages (a `local/` subdir AND dist- not
# site-packages), so a computed site-packages PYTHONPATH missed it and
# `import uvicorn` failed. --target is deterministic: everything is right there.
DEPS_DIR="$HOME_DIR/.local/share/model-router/deps"
STATE_DIR="$HOME_DIR/.local/state/model-router-proxy"
LOG="$STATE_DIR/install.log"
SRV_LOG="$STATE_DIR/service.log"
PIDF="$STATE_DIR/service.pid"
OPENCODE_CFG="$HOME_DIR/.config/opencode/opencode.jsonc"
mkdir -p "$STATE_DIR" "$DEPS_DIR"
: > "$LOG"

note() { echo "model-router-proxy: $*"; }
warn() { echo "model-router-proxy: $*" >&2; }

# --- Preflight ---------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  warn "python3 not found; cannot set up routing this boot (OpenCode stays on the direct gateway)"
  exit 0
fi

# --- Fetch the service repo at the pinned SHA (idempotent, ref-aware) --------
# Both modes fetch the repo (external needs only the stdlib toggle; in-sandbox
# needs the whole service). Re-fetch when the pinned ref changes.
STAMP="$APP_DIR/.model-router-ref"
need_fetch=1
if [ -f "$APP_DIR/src/model_router_service/__main__.py" ] && [ -f "$STAMP" ] \
   && [ "$(cat "$STAMP" 2>/dev/null)" = "$SERVICE_REF" ]; then
  need_fetch=0
  note "service $SERVICE_REF already present; skipping fetch"
fi
if [ "$need_fetch" -eq 1 ]; then
  note "fetching $SERVICE_REPO@$SERVICE_REF"
  TARBALL="https://codeload.github.com/$SERVICE_REPO/tar.gz/$SERVICE_REF"
  TMP="$STATE_DIR/src.tar.gz"
  if ! curl -fsSL "$TARBALL" -o "$TMP" >>"$LOG" 2>&1; then
    warn "could not fetch the service tarball (see $LOG); OpenCode stays on the direct gateway"
    exit 0
  fi
  rm -rf "$APP_DIR" && mkdir -p "$APP_DIR"
  if ! tar -xzf "$TMP" -C "$APP_DIR" --strip-components=1 >>"$LOG" 2>&1; then
    warn "could not extract the service tarball (see $LOG); staying on the direct gateway"
    exit 0
  fi
  rm -f "$TMP"
  echo "$SERVICE_REF" > "$STAMP"
fi

# PYTHONPATH that makes the service package + installed deps importable. One
# deps dir, no guessing.
PP="$APP_DIR/src:$DEPS_DIR"

# --- Install the model-router-toggle + feedback shims on PATH ----------------
# Pin OPENCODE_GLOBAL_CONFIG so the toggle edits the kit-merged global config at
# the known path regardless of how $HOME resolves for the invoking user.
mkdir -p "$HOME_DIR/.local/bin"
cat > "$HOME_DIR/.local/bin/model-router-toggle" <<EOF
#!/bin/sh
exec env PYTHONPATH="$PP:\${PYTHONPATH:-}" \\
  OPENCODE_GLOBAL_CONFIG="\${OPENCODE_GLOBAL_CONFIG:-$OPENCODE_CFG}" \\
  MODEL_ROUTER_PREF="\${MODEL_ROUTER_PREF:-$HOME_DIR/.model-router/pref.json}" \\
  MODEL_ROUTER_TOGGLE_LOG="\${MODEL_ROUTER_TOGGLE_LOG:-$STATE_DIR/toggle-log.jsonl}" \\
  python3 -m model_router_service.toggle "\$@"
EOF
chmod +x "$HOME_DIR/.local/bin/model-router-toggle"
cat > "$HOME_DIR/.local/bin/model-router" <<EOF
#!/bin/sh
exec env PYTHONPATH="$PP:\${PYTHONPATH:-}" python3 -m model_router_service.cli "\$@"
EOF
chmod +x "$HOME_DIR/.local/bin/model-router"
TOGGLE_BIN="$HOME_DIR/.local/bin/model-router-toggle"

# =============================================================================
# EXTERNAL MODE — flip baseURL at a remote service; run NO server here.
# =============================================================================
if [ "$MODE" = "external" ]; then
  if [ -z "$MODEL_ROUTER_URL" ]; then
    # auto-detect the backend's host alias for a host-run service
    for _h in host.microsandbox.internal host.containers.internal host.docker.internal; do
      if getent hosts "$_h" >/dev/null 2>&1; then
        MODEL_ROUTER_URL="http://${_h}:${PORT}"
        note "external: auto-detected host alias ${_h}; MODEL_ROUTER_URL=${MODEL_ROUTER_URL}"
        break
      fi
    done
  fi
  if [ -z "$MODEL_ROUTER_URL" ]; then
    warn "external mode but no MODEL_ROUTER_URL and no host alias resolved; \
staying on the direct gateway. Set MODEL_ROUTER_URL in the guest to a reachable \
service (e.g. a cloud.gov app)."
    exit 0
  fi
  if [ "$REQUIRE_READY" = "1" ] && ! curl -fsS "${MODEL_ROUTER_URL%/}/readyz" >/dev/null 2>&1; then
    warn "external: $MODEL_ROUTER_URL/readyz not reachable and REQUIRE_READY=1; staying direct"
    exit 0
  fi
  if MODEL_ROUTER_URL="$MODEL_ROUTER_URL" OPENCODE_GLOBAL_CONFIG="$OPENCODE_CFG" \
       "$TOGGLE_BIN" --harness opencode on >>"$LOG" 2>&1; then
    note "external: OpenCode routed via ${MODEL_ROUTER_URL%/}/v1"
  else
    warn "external: could not flip OpenCode baseURL (see $LOG); run 'model-router-toggle on' manually"
  fi
  exit 0
fi

# =============================================================================
# IN-SANDBOX MODE (default) — run the service on 127.0.0.1 in the VM.
# =============================================================================
if [ -z "${USAI_API_KEY:-}" ]; then
  warn "in-sandbox mode needs USAI_API_KEY (is the usai-provider kit applied?); \
staying on the direct gateway"
  exit 0
fi

# Install deps WHEELS-ONLY into one --target dir. --only-binary=:all: fails fast
# with a clear message if no prebuilt wheel exists for this Python/arch, instead
# of a from-source Rust build of pydantic-core (needs a C/Rust toolchain the
# image lacks — the "linker cc not found" failure). Bounded ranges in the
# service's requirements.txt let pip pick a version that HAS a wheel.
if [ -f "$APP_DIR/requirements.txt" ]; then
  note "installing service deps to $DEPS_DIR (wheels only, --target)"
  if ! python3 -m pip install --quiet --only-binary=:all: --target "$DEPS_DIR" \
        -r "$APP_DIR/requirements.txt" >>"$LOG" 2>&1; then
    warn "could not install service deps as wheels for $(python3 -V 2>&1) (see $LOG); \
staying on the direct gateway. Likely no prebuilt wheel for this Python/arch."
    exit 0
  fi
fi

# Preflight: deps must IMPORT before launch, so a layout problem fails HERE with
# a clear message instead of a silent dead background process.
if ! PYTHONPATH="$PP" python3 -c 'import uvicorn, fastapi, httpx, pydantic, pydantic_settings' >>"$LOG" 2>&1; then
  warn "service deps not importable from $DEPS_DIR after install (see $LOG); staying on the direct gateway"
  exit 0
fi

# Launch the service in the background (idempotent — reuse a live one).
if curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; then
  note "service already serving on 127.0.0.1:$PORT"
else
  note "starting service on 127.0.0.1:$PORT (judge off by default; scorer only)"
  # setsid env VAR=… python3: wrapping in `env` guarantees the DETACHED process
  # inherits PYTHONPATH + the ROUTER_* config (an inline `VAR=… setsid …` can
  # drop them across the session detach). Reuse USAI_API_KEY + sandbox CA trust
  # (no ROUTER_CA_BUNDLE — the zscaler-ca-certificate kit put the root in the
  # system store).
  setsid env \
    ROUTER_UPSTREAM_BASE_URL="$UPSTREAM_BASE_URL" \
    ROUTER_UPSTREAM_API_KEY="$USAI_API_KEY" \
    ROUTER_JUDGE_MODEL="$JUDGE_MODEL" \
    ROUTER_DEFAULT_MODEL="$DEFAULT_MODEL" \
    ROUTER_HOST="127.0.0.1" ROUTER_PORT="$PORT" \
    MODEL_ROUTER_DECISION_LOG="$STATE_DIR/decisions.jsonl" \
    MODEL_ROUTER_FEEDBACK="$STATE_DIR/feedback.jsonl" \
    MODEL_ROUTER_TUNING="$STATE_DIR/tuning.json" \
    PYTHONPATH="$PP" \
    python3 -m model_router_service >"$SRV_LOG" 2>&1 &
  echo $! > "$PIDF"

  i=0
  until curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -ge 45 ] && break
    sleep 1
  done
  if ! curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; then
    warn "service did not become ready within 45s (see $SRV_LOG); leaving OpenCode on the direct gateway"
    exit 0
  fi
  note "service ready on 127.0.0.1:$PORT"
fi

# Flip OpenCode's baseURL to the loopback service — UNLESS the user has turned
# routing OFF and that preference is sticky. OpenCode reads baseURL at session
# init, so a toggle only takes effect on the next session/boot; without honoring
# a persisted preference here, every boot would re-flip routing ON and
# `model-router-toggle off` could never survive a restart (the bug this fixes).
# Default (no preference recorded) is ON — routing is the point of the kit.
PREF_FILE="$HOME_DIR/.model-router/pref.json"
DESIRED="$(MODEL_ROUTER_PREF="$PREF_FILE" "$TOGGLE_BIN" --harness opencode pref 2>/dev/null || echo on)"
if [ "$DESIRED" = "off" ]; then
  note "routing left OFF per saved user preference (model-router-toggle on to re-enable). Service is running on 127.0.0.1:$PORT."
  exit 0
fi

# The toggle records an auditable ON/OFF line to $STATE_DIR/toggle-log.jsonl, and
# the session-start acknowledgement (A3) is emitted via `model-router-toggle ack`
# (suppressible with MODEL_ROUTER_ACK=off for log-only).
if MODEL_ROUTER_URL="http://127.0.0.1:$PORT" OPENCODE_GLOBAL_CONFIG="$OPENCODE_CFG" \
   MODEL_ROUTER_TOGGLE_LOG="$STATE_DIR/toggle-log.jsonl" \
   MODEL_ROUTER_PREF="$PREF_FILE" \
     "$TOGGLE_BIN" --harness opencode on >>"$LOG" 2>&1; then
  note "OpenCode routed via the in-sandbox service (http://127.0.0.1:$PORT/v1)"
else
  warn "could not flip OpenCode baseURL (see $LOG); the service is up — run 'model-router-toggle on' manually"
fi

exit 0
