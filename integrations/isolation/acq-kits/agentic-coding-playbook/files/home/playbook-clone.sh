#!/bin/sh
# playbook-clone.sh — fetch the GSA agentic-coding-playbook at a pinned ref and
# link its AGENTS.md + skills into each supported agent's search paths.
#
# Extracted (Phase 2) from the former sbx kit's inline startup command into a
# standalone, testable script per the acq design doc §6. It is idempotent
# (fetch-if-missing, no refetch) and NON-FATAL (any failure warns to stderr and
# exits 0 so the sandbox still starts; it self-heals on a later start once the
# fetch can run).
#
# WHY A TARBALL, NOT `git clone` (cross-backend parity):
#   A `git clone` (or `gh repo clone`, which shells out to git) uses git's
#   smart-HTTP transport to github.com / codeload.github.com. The msb backend's
#   on-the-wire secret substitution does NOT cover that transport (verified on
#   msb 0.6.7: git clone of a private repo fails auth / TLS teardown), so a
#   private clone could not be authenticated there — the origin of quickstart#203.
#   The GitHub REST API on api.github.com IS substituted correctly (both the sbx
#   proxy and msb inject the token there). So we fetch the repo TARBALL via the
#   REST endpoint (api.github.com -> 302 codeload) with a Bearer token. This uses
#   the one channel both backends authenticate, needs no `.git`, and needs no
#   `gh` install. When no token is present the fetch simply fails and the kit
#   degrades gracefully (warns + exit 0).
#
# Pins are provided via the environment, with in-script fallback defaults kept
# in sync with the kit spec's documented pins:
#   PLAYBOOK_REF          — release tag to fetch (default below)
#   PLAYBOOK_AGENTS_SHA256 — sha256 of the extracted AGENTS.md (integrity pin)
#
# INTEGRITY: a GitHub source tarball is NOT byte-stable (server-side
# recompression), so we cannot pin the archive bytes. Instead we verify a sha256
# over the CONSUMED CONTENT — AGENTS.md plus every skill file under
# .agents/skills — computed from a sorted per-file digest manifest, and refuse to
# link on mismatch. This covers skills too (they are executable agent
# instructions), not just AGENTS.md. Bump PLAYBOOK_REF and PLAYBOOK_AGENTS_SHA256
# together (see the kit spec for how to regenerate the hash).
#
# In addition, skill entries are only linked if they are real in-tree directories
# (not symlinks, and their resolved path stays under the playbook dir), so a
# tampered/malicious tarball cannot plant a symlink that points an agent's skills
# root at an arbitrary path outside the verified tree.

set -u

# NON-INTERACTIVE: this script runs at sandbox startup with no terminal
# attached. Nothing here should ever prompt. curl is non-interactive by default;
# keep the git guards too (defense-in-depth, in case any git tooling is invoked
# by a future edit) so a stray git call fails fast instead of hanging provision.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false
export SSH_ASKPASS=/bin/false

ref="${PLAYBOOK_REF:-v0.14.0}"
agents_sha="${PLAYBOOK_AGENTS_SHA256:-a9c438acfe8082ba959fd248be9b667f26f17c10c1c763ca57fdcb2396e43759}"
owner_repo="GSA-TTS/agentic-coding-playbook"
api="https://api.github.com/repos/${owner_repo}/tarball/${ref}"
# HOME may be unset in a bare startup environment; default it rather than let
# `set -u` abort with a nonzero exit (that would violate the always-warn+exit-0
# non-fatal contract). The agent user's home is /home/agent by convention.
HOME="${HOME:-/home/agent}"
dir="$HOME/.agentic-coding-playbook"

warn() { echo "agentic-coding-playbook: $*" >&2; }

# The backend injects the github token into this env var (msb --secret
# GITHUB_TOKEN@api.github.com; the sbx proxy for the built-in github service).
# Accept either GITHUB_TOKEN or GH_TOKEN. Empty is allowed — the fetch will fail
# and the kit degrades gracefully.
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

# sha256 helper: prefer sha256sum, fall back to shasum -a 256. Echoes the hex
# digest of the file named in $1, or nothing if no tool is available.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  fi
}

# sha256_hex: read stdin, echo its sha256 hex digest (tool-agnostic).
sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 2>/dev/null | cut -d' ' -f1
  fi
}

# content_digest DIR — a single sha256 over the CONSUMED content surface of the
# playbook tree: AGENTS.md plus every regular file under .agents/skills. Built by
# hashing each file, sorting the "<hash>  <relpath>" lines (stable ordering), and
# hashing that manifest. REGULAR FILES ONLY (`find -type f` does not follow
# symlinks for the listing, and we hash file contents), so a symlink planted in
# the tarball cannot smuggle out-of-tree content into the digest. Echoes the hex
# digest, or nothing if no sha tool is available.
content_digest() {
  _cd_dir="$1"
  { sha256_of "$_cd_dir/AGENTS.md"
    if [ -d "$_cd_dir/.agents/skills" ]; then
      find "$_cd_dir/.agents/skills" -type f 2>/dev/null | LC_ALL=C sort | while IFS= read -r _f; do
        sha256_of "$_f"
      done
    fi
  } | sha256_hex
}

# 1) Fetch once (fetch-if-missing). Download the pinned-ref tarball via the REST
#    API and extract it. No refetch on later starts (the dir persists).
if [ ! -e "$dir/AGENTS.md" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found in base image; cannot fetch the playbook."
    warn "  starting WITHOUT playbook rules/skills. Will retry on next start."
    exit 0
  fi

  tgz="$(mktemp "${TMPDIR:-/tmp}/acp-playbook.XXXXXX.tgz" 2>/dev/null)" || tgz="/tmp/acp-playbook.$$.tgz"
  cerr="$(mktemp "${TMPDIR:-/tmp}/acp-playbook-err.XXXXXX" 2>/dev/null)" || cerr="/tmp/acp-playbook-err.$$"
  # -f: fail on HTTP error; -sSL: quiet but show errors (-S), follow redirects.
  # The Authorization header is passed via a config file read from stdin
  # (curl -K -) rather than an argv flag, so the token never appears in the
  # process argv (ps) — and so a POSIX sh can't word-split a "Bearer <tok>"
  # value. When no token is present, no auth line is written (public/anon fetch).
  #
  # curl's stderr is captured (not discarded) so the real cause (403 vs DNS vs
  # TLS) is surfaced on failure. This is safe: the token lives in the -K config,
  # never on the URL/argv, so curl's error text cannot contain it.
  #
  # -L follows the api.github.com -> codeload.github.com 302 redirect. curl
  # re-sends the Authorization header to codeload; on msb (which substitutes the
  # placeholder ONLY for api.github.com) the literal placeholder reaches codeload
  # — harmless in practice because the codeload tarball URL is pre-signed and
  # ignores the header. If GitHub ever required auth at codeload, the msb fetch
  # would need codeload added to the --secret host list (see quickstart#203).
  if [ -n "$token" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$token" | \
      curl -fsSL -K - \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -o "$tgz" "$api" 2>"$cerr"
    _fetch_rc=$?
  else
    curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -o "$tgz" "$api" 2>"$cerr"
    _fetch_rc=$?
  fi
  if [ "$_fetch_rc" -ne 0 ]; then
    warn "fetch of ${owner_repo}@${ref} tarball failed (offline, missing/rejected"
    warn "  GitHub token, or bad ref?). Starting WITHOUT playbook rules/skills;"
    warn "  will retry on next start. Fix: ensure the backend injects a github"
    warn "  token to api.github.com and network allows api.github.com + codeload.github.com."
    [ -s "$cerr" ] && warn "  curl: $(tr '\n' ' ' < "$cerr")"
    rm -f "$tgz" "$cerr"
    exit 0
  fi
  rm -f "$cerr"

  # Extract into a FRESH dir. The tarball's top-level is a single owner-repo-<sha>
  # directory; --strip-components=1 drops it so files land directly under $dir.
  # Remove any partial/stale tree first so a prior aborted run can't leave content
  # we then extract on top of. Distinguish an unwritable target (a mis-provisioned
  # home, e.g. /home/agent not owned by the agent user) from a corrupt archive —
  # the messages point at very different fixes.
  rm -rf "$dir"
  if ! mkdir -p "$dir" 2>/dev/null; then
    rm -f "$tgz"
    warn "cannot create $dir (is \$HOME writable by this user?). Skipping;"
    warn "  will retry on next start. This usually means the sandbox's agent"
    warn "  home is not owned by the user running this kit."
    exit 0
  fi
  if ! tar xzf "$tgz" -C "$dir" --strip-components=1 2>/dev/null; then
    rm -f "$tgz"; rm -rf "$dir"
    warn "downloaded tarball but extraction failed (corrupt archive?); skipping."
    warn "  Will retry on next start."
    exit 0
  fi
  rm -f "$tgz"
fi

agents="$dir/AGENTS.md"
skills="$dir/.agents/skills"
if [ ! -f "$agents" ]; then
  warn "fetched, but AGENTS.md not found at $agents; removing and skipping linking."
  rm -rf "$dir"
  exit 0
fi

# 2) INTEGRITY: verify the CONSUMED content (AGENTS.md + all skill files) matches
#    the pinned sha256. The ref is a mutable tag over a possibly MITM-inspected
#    path, so content — not just a successful download — must be checked, and
#    skills (executable agent instructions) must be covered, not just AGENTS.md.
#    On mismatch, drop the tree and skip linking rather than trust it.
got_sha="$(content_digest "$dir")"
if [ -z "$got_sha" ]; then
  warn "no sha256 tool (sha256sum/shasum) available; cannot verify integrity."
  warn "  Refusing to link unverified playbook content; removing the tree."
  rm -rf "$dir"
  exit 0
fi
if [ "$got_sha" != "$agents_sha" ]; then
  warn "SECURITY: playbook content sha256 is $got_sha, expected $agents_sha."
  warn "  Refusing to link untrusted playbook content; removing the tree."
  warn "  If you intentionally bumped the playbook, update PLAYBOOK_AGENTS_SHA256."
  rm -rf "$dir"
  exit 0
fi

# link_file TARGET SOURCE — symlink a file, creating parent dirs.
link_file() {
  _t="$1"; _s="$2"
  [ -e "$_s" ] || return 0
  mkdir -p "$(dirname "$_t")" 2>/dev/null || return 0
  ln -sfn "$_s" "$_t" 2>/dev/null || warn "could not link $_t"
}

# link_skills_into ROOT — symlink each skill subdir under ROOT. Only links a
# skill that is a REAL in-tree directory: skip it if the entry is a symlink, or
# if its resolved path escapes the verified playbook tree. This prevents a
# tarball-planted symlink (e.g. skills/evil -> /etc or -> ../../..) from pointing
# an agent's skills root at attacker-chosen content outside $dir.
link_skills_into() {
  _root="$1"
  [ -d "$skills" ] || return 0
  mkdir -p "$_root" 2>/dev/null || return 0
  for _sk in "$skills"/*/; do
    _sk="${_sk%/}"
    [ -d "$_sk" ] || continue
    # Reject a symlinked entry outright (the trailing-slash glob would follow it).
    if [ -L "$_sk" ]; then
      warn "skipping symlinked skill entry: $_sk"
      continue
    fi
    # Belt-and-suspenders: resolved path must stay under the playbook tree.
    _real=$(readlink -f "$_sk" 2>/dev/null || printf '%s' "$_sk")
    case "$_real/" in
      "$dir"/*) : ;;
      *) warn "skipping out-of-tree skill entry: $_sk"; continue ;;
    esac
    ln -sfn "$_sk" "$_root/$(basename "$_sk")" 2>/dev/null \
      || warn "could not link skill $(basename "$_sk") into $_root"
  done
}

# 3) AGENTS.md per agent. Agents with a known user-level rules path:
#    OpenCode + Codex + Droid read a literal AGENTS.md; Claude expects CLAUDE.md;
#    Copilot expects copilot-instructions.md. Cursor, Kiro, and Docker Agent have
#    no user-level rules FILE convention (rules live in app settings / agent
#    YAML), so they are skills-only.
link_file "$HOME/.config/opencode/AGENTS.md"          "$agents"  # OpenCode
link_file "$HOME/.codex/AGENTS.md"                    "$agents"  # Codex
link_file "$HOME/.factory/AGENTS.md"                  "$agents"  # Droid (Factory.ai)
link_file "$HOME/.claude/CLAUDE.md"                   "$agents"  # Claude Code
link_file "$HOME/.copilot/copilot-instructions.md"    "$agents"  # GitHub Copilot CLI

# 4) Skills. ~/.agents/skills is the cross-agent standard root (Codex, OpenCode,
#    Docker Agent, Copilot). Per-agent roots follow for agents that only scan
#    their own dir.
link_skills_into "$HOME/.agents/skills"      # standard (multi-agent)
link_skills_into "$HOME/.claude/skills"      # Claude Code (+ compat)
link_skills_into "$HOME/.factory/skills"     # Droid (Factory.ai)
link_skills_into "$HOME/.cursor/skills"      # Cursor
link_skills_into "$HOME/.copilot/skills"     # GitHub Copilot CLI

exit 0
