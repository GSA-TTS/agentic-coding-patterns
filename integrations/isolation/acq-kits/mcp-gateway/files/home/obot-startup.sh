#!/bin/sh
# obot-startup.sh — prime the obot CLI and link the search skill, every start.
#
# Runs on EVERY sandbox start as the AGENT user (uid 1000). It is idempotent and
# NON-FATAL: any failure warns to stderr and exits 0 so the agent still starts;
# it self-heals on a later start.
#
# What it does (empirically verified against obot v0.25.4 — see the kit README
# and docs/decisions/0001):
#   1. Drop the obot defaultURL config so `obot mcp search` resolves the gateway.
#      `obot mcp search` needs a stored default URL; without it the CLI falls back
#      to http://localhost:8080 and fails ("connection refused"). We DO NOT run
#      `obot setup` (it demands `llm` scope our MCP token lacks); instead we write
#      the tiny config.json directly — the same file `setup` would write.
#   2. Link the vendored `obot-search-mcp-servers` skill into the agent skill
#      search paths. We vendor a pinned copy rather than letting `obot setup
#      --clients` install obot's own bootstrap skills (provenance/pinning).
#
# The obot API key is NOT handled here — acq injects it as OBOT_TOKEN, and the
# CLI reads it from the env per-invocation (no `obot login`, no keyring needed).

set -u

# HOME may be unset in a bare startup environment; default to the agent home.
HOME="${HOME:-/home/agent}"

warn() { echo "mcp-gateway(startup): $*" >&2; }

# ---------------------------------------------------------------------------
# 1) Prime obot's defaultURL config.
#
# On Linux the obot CLI reads its config from the XDG config dir. Honor
# XDG_CONFIG_HOME if set, else ~/.config. (On macOS it is ~/Library/Application
# Support/obot; the sandbox is Linux, so XDG applies.)
# ---------------------------------------------------------------------------
xdg="${XDG_CONFIG_HOME:-$HOME/.config}"
obot_cfg_dir="$xdg/obot"
obot_cfg="$obot_cfg_dir/config.json"
staged_cfg="$HOME/obot-config/config.json"

if [ -f "$staged_cfg" ]; then
  if mkdir -p "$obot_cfg_dir" 2>/dev/null; then
    # Copy verbatim (idempotent: re-copying the same bytes is a no-op in effect).
    if cp "$staged_cfg" "$obot_cfg" 2>/dev/null; then
      echo "mcp-gateway(startup): primed obot defaultURL at $obot_cfg"
    else
      warn "could not write $obot_cfg (obot mcp search may fall back to localhost:8080)."
    fi
  else
    warn "could not create $obot_cfg_dir; skipping obot config prime."
  fi
else
  warn "staged obot config not found at $staged_cfg; skipping obot config prime."
fi

# ---------------------------------------------------------------------------
# 2) Link the vendored skill into the agent skill search paths.
#
# Only link a REAL in-tree directory: skip a symlinked entry or one whose
# resolved path escapes the vendored skills tree (defense-in-depth against a
# planted symlink pointing an agent's skills root at arbitrary content).
# ---------------------------------------------------------------------------
skills_src="$HOME/obot-skills"

link_skills_into() {
  _root="$1"
  [ -d "$skills_src" ] || return 0
  mkdir -p "$_root" 2>/dev/null || return 0
  for _sk in "$skills_src"/*/; do
    _sk="${_sk%/}"
    [ -d "$_sk" ] || continue
    if [ -L "$_sk" ]; then
      warn "skipping symlinked skill entry: $_sk"
      continue
    fi
    _real=$(readlink -f "$_sk" 2>/dev/null || printf '%s' "$_sk")
    case "$_real/" in
      "$skills_src"/*) : ;;
      *) warn "skipping out-of-tree skill entry: $_sk"; continue ;;
    esac
    ln -sfn "$_sk" "$_root/$(basename "$_sk")" 2>/dev/null \
      || warn "could not link skill $(basename "$_sk") into $_root"
  done
}

# ~/.agents/skills is the cross-agent standard root (Codex, OpenCode, Docker
# Agent, Copilot). Per-agent roots follow for agents that only scan their own dir.
link_skills_into "$HOME/.agents/skills"
link_skills_into "$HOME/.claude/skills"
link_skills_into "$HOME/.factory/skills"
link_skills_into "$HOME/.cursor/skills"
link_skills_into "$HOME/.copilot/skills"

echo "mcp-gateway(startup): skill link step complete."
exit 0
