#!/bin/sh
# model-router-install.sh — register the model-router stdio MCP server with
# OpenCode, on every sandbox start (idempotent).
#
# SCOPE: this is the STARTUP-phase step for the model-router kit. It does NOT
# install Python packages or download anything — the MCP server
# (files/home/model-router/*.py) is pure standard-library Python and was already
# dropped by the kit's files[] block. This script's only job is to WIRE that
# server into OpenCode's config so the `model_select` tool is available to the
# agent, matching how the usai-provider kit merges its provider block in.
#
# WHY STARTUP, NOT INSTALL: nothing is fetched or compiled, so there is no
# create-vs-startup safety tension (contrast the opencode kit's create-time
# binary install). Running at startup also means the wiring self-heals if a
# later boot's config was reset.
#
# FAIL-SOFT: a model router is an OPTIONAL convenience. Any failure here
# (missing python3, unreadable config) logs a clear message and exits 0 — it
# must never fail the sandbox over an optional tool. The only hard requirement
# is python3 on PATH (standard library only; no pip, no venv).
#
# SECURITY: writes only to the agent's own OpenCode global config. No network.
# The config edit is a MERGE that preserves existing keys (see below) — it never
# clobbers another kit's provider/permission config.

set -eu

SERVER_DIR="/home/agent/model-router"
GLOBAL_DIR="${OPENCODE_GLOBAL_DIR:-$HOME/.config/opencode}"
GLOBAL_CONFIG="$GLOBAL_DIR/opencode.jsonc"
LOG="$HOME/.local/state/model-router/install.log"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"

# --- Preflight: python3 must be present (stdlib only; nothing to install). ---
if ! command -v python3 >/dev/null 2>&1; then
  echo "model-router: python3 not found on PATH; cannot register the MCP server this boot (installing Python is out of scope for this kit)" >&2
  exit 0
fi

if [ ! -f "$SERVER_DIR/mcp_server.py" ]; then
  echo "model-router: $SERVER_DIR/mcp_server.py missing (files[] payload not dropped?); nothing to register" >&2
  exit 0
fi

# Smoke-test: the server module must at least import and the scorer must run
# once, so a syntax/typo regression surfaces here rather than silently at the
# first tool call. Also imports adapter (adapter mode) so a break there is
# caught too. Uses the bundled modules only; no network.
if ! PYTHONPATH="$SERVER_DIR" python3 -c \
  'import catalog, model_router, adapter; model_router.route("fix a typo", catalog.load_catalog())' \
  >>"$LOG" 2>&1; then
  echo "model-router: self-test failed (see $LOG); NOT registering the MCP server this boot" >&2
  exit 0
fi

# --- Merge the MCP-server block into OpenCode's global config. ---------------
# OpenCode registers local MCP servers under the top-level "mcp" key:
#   "mcp": { "<name>": { "type": "local", "command": [...], "enabled": true } }
# We deep-merge ONLY our own "mcp.model-router" entry, preserving every other
# key (and every other MCP server) a prior kit or the user wrote. The merge is
# done in Python (stdlib json) so we never shell-template JSON.
mkdir -p "$GLOBAL_DIR"

MERGE_PY=$(cat <<'PYEOF'
import json, os, sys

global_config = os.environ["GLOBAL_CONFIG"]
server_dir = os.environ["SERVER_DIR"]

# Load existing config if present. OpenCode's file is JSONC (allows comments);
# if the existing file carries comments we cannot round-trip them with stdlib
# json, so we only parse when it is plain JSON. A parse failure is reported and
# we DO NOT overwrite — refusing to clobber a config we cannot safely merge.
existing = {}
if os.path.isfile(global_config):
    raw = open(global_config, encoding="utf-8").read().strip()
    if raw:
        try:
            existing = json.loads(raw)
        except json.JSONDecodeError:
            sys.stderr.write(
                "model-router: existing global config is JSONC/!pure-JSON and "
                "cannot be safely merged by this stdlib step; leaving it "
                "untouched. Add the mcp.model-router block manually (see README).\n"
            )
            sys.exit(3)

if not isinstance(existing, dict):
    sys.stderr.write("model-router: global config root is not an object; leaving it untouched.\n")
    sys.exit(3)

mcp = existing.setdefault("mcp", {})
if not isinstance(mcp, dict):
    sys.stderr.write("model-router: existing 'mcp' key is not an object; leaving it untouched.\n")
    sys.exit(3)

# Idempotent: overwrite only our own entry; everything else is preserved.
mcp["model-router"] = {
    "type": "local",
    "command": ["python3", os.path.join(server_dir, "mcp_server.py")],
    "enabled": True,
}

tmp = global_config + ".model-router.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(existing, f, indent=2)
    f.write("\n")
os.replace(tmp, global_config)
sys.stderr.write("model-router: registered mcp.model-router in %s\n" % global_config)
PYEOF
)

if GLOBAL_CONFIG="$GLOBAL_CONFIG" SERVER_DIR="$SERVER_DIR" \
    python3 -c "$MERGE_PY" >>"$LOG" 2>&1; then
  echo "model-router: MCP server registered (model_select tool available to OpenCode)"
else
  rc=$?
  echo "model-router: did not register the MCP server this boot (exit $rc); see $LOG" >&2
  # Exit 0 regardless — optional tool must not fail the sandbox.
fi

# --- Install the companion skill (tells the agent WHEN to call model_select). -
# Copied (not symlinked) into OpenCode's global skills dir so a fresh session
# discovers it. Idempotent: overwrites our own skill file only. A copy failure
# is logged but never fatal — the MCP tool still works without the skill; the
# skill only improves WHEN the agent reaches for it.
SKILL_SRC="$SERVER_DIR/SKILL.md"
SKILL_DST_DIR="$HOME/.config/opencode/skills/model-router-mcp"
if [ -f "$SKILL_SRC" ]; then
  if mkdir -p "$SKILL_DST_DIR" && cp "$SKILL_SRC" "$SKILL_DST_DIR/SKILL.md"; then
    echo "model-router: companion skill installed at $SKILL_DST_DIR/SKILL.md"
  else
    echo "model-router: could not install the companion skill (non-fatal); see $LOG" >&2
  fi
fi

exit 0
