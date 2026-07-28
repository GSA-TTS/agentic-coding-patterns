#!/bin/sh
# playbook-clone.sh — clone the GSA agentic-coding-playbook at a pinned ref and
# link its AGENTS.md + skills into each supported agent's search paths.
#
# Extracted (Phase 2) from the former sbx kit's inline startup command into a
# standalone, testable script per the acq design doc §6. Behavior is unchanged:
# idempotent (clone-if-missing, no refetch) and NON-FATAL (any failure warns to
# stderr and exits 0 so the sandbox still starts; it self-heals on a later start
# once the clone can run).
#
# Pins are provided via the environment, with in-script fallback defaults kept
# in sync with the kit spec's documented pin:
#   PLAYBOOK_REF — human-legible release tag to clone (default below)
#   PLAYBOOK_SHA — exact commit the tag must resolve to (integrity pin)
#
# The tag is a MUTABLE ref over a (possibly Zscaler-MITM-inspected) path, so a
# tag match is not sufficient: after cloning we VERIFY HEAD == PLAYBOOK_SHA and
# refuse to link on mismatch.

set -u

# NON-INTERACTIVE: this script runs at sandbox startup with no terminal
# attached. git MUST NOT prompt — a private clone with no credential would
# otherwise block on "Username for 'https://github.com':" and hang the whole
# provision. Force git to fail fast instead of prompting, on every path:
#   - GIT_TERMINAL_PROMPT=0 disables git's own username/password prompt.
#   - GIT_ASKPASS / SSH_ASKPASS pointed at a non-interactive false so no helper
#     can pop a prompt either.
# When the backend injects a github credential on the wire (sbx proxy / msb
# header substitution) the clone still succeeds; when it can't, the clone fails
# fast and the kit degrades gracefully (warns + exit 0) as designed.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false
export SSH_ASKPASS=/bin/false
: "${GIT_CONFIG_NOSYSTEM:=0}"  # leave system config intact (proxy/CA settings)

ref="${PLAYBOOK_REF:-v0.14.0}"
sha="${PLAYBOOK_SHA:-cfadbc32b079d85c6328a20d3dadc583faa8aef1}"
repo="https://github.com/GSA-TTS/agentic-coding-playbook.git"
dir="$HOME/.agentic-coding-playbook"

warn() { echo "agentic-coding-playbook: $*" >&2; }

# 1) Clone once (clone-if-missing). Shallow-clone the pinned tag, then VERIFY the
#    checked-out commit equals PLAYBOOK_SHA. On SHA mismatch we drop the clone and
#    skip linking rather than trust unexpected content. No refetch on later starts.
if [ ! -e "$dir/.git" ]; then
  if ! git clone --quiet --depth 1 --branch "$ref" "$repo" "$dir" 2>/dev/null; then
    warn "clone of $repo@$ref failed (offline, missing GitHub token, or bad ref?);"
    warn "  starting WITHOUT playbook rules/skills. Will retry on next start."
    warn "  Fix: ensure the backend has a github credential and network allows github.com."
    exit 0
  fi
  got="$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$got" != "$sha" ]; then
    warn "SECURITY: cloned $ref resolved to $got, expected $sha."
    warn "  Refusing to link untrusted playbook content; removing the clone."
    warn "  If you intentionally bumped the playbook, update PLAYBOOK_SHA."
    rm -rf "$dir"
    exit 0
  fi
fi

agents="$dir/AGENTS.md"
skills="$dir/.agents/skills"
if [ ! -f "$agents" ]; then
  warn "cloned, but AGENTS.md not found at $agents; skipping linking."
  exit 0
fi

# link_file TARGET SOURCE — symlink a file, creating parent dirs.
link_file() {
  _t="$1"; _s="$2"
  [ -e "$_s" ] || return 0
  mkdir -p "$(dirname "$_t")" 2>/dev/null || return 0
  ln -sfn "$_s" "$_t" 2>/dev/null || warn "could not link $_t"
}

# link_skills_into ROOT — symlink each skill subdir under ROOT.
link_skills_into() {
  _root="$1"
  [ -d "$skills" ] || return 0
  mkdir -p "$_root" 2>/dev/null || return 0
  for _sk in "$skills"/*/; do
    [ -d "$_sk" ] || continue
    ln -sfn "${_sk%/}" "$_root/$(basename "$_sk")" 2>/dev/null \
      || warn "could not link skill $(basename "$_sk") into $_root"
  done
}

# 2) AGENTS.md per agent. Agents with a known user-level rules path:
#    OpenCode + Codex + Droid read a literal AGENTS.md; Claude expects CLAUDE.md;
#    Copilot expects copilot-instructions.md. Cursor, Kiro, and Docker Agent have
#    no user-level rules FILE convention (rules live in app settings / agent
#    YAML), so they are skills-only.
link_file "$HOME/.config/opencode/AGENTS.md"          "$agents"  # OpenCode
link_file "$HOME/.codex/AGENTS.md"                    "$agents"  # Codex
link_file "$HOME/.factory/AGENTS.md"                  "$agents"  # Droid (Factory.ai)
link_file "$HOME/.claude/CLAUDE.md"                   "$agents"  # Claude Code
link_file "$HOME/.copilot/copilot-instructions.md"    "$agents"  # GitHub Copilot CLI

# 3) Skills. ~/.agents/skills is the cross-agent standard root (Codex, OpenCode,
#    Docker Agent, Copilot). Per-agent roots follow for agents that only scan
#    their own dir.
link_skills_into "$HOME/.agents/skills"      # standard (multi-agent)
link_skills_into "$HOME/.claude/skills"      # Claude Code (+ compat)
link_skills_into "$HOME/.factory/skills"     # Droid (Factory.ai)
link_skills_into "$HOME/.cursor/skills"      # Cursor
link_skills_into "$HOME/.copilot/skills"     # GitHub Copilot CLI

exit 0
