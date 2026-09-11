#!/bin/sh
# pi-coding-agent-install.sh — install the pi CLI (@earendil-works/pi-coding-agent)
# via the standard npm registry path, unprivileged, on every sandbox start.
#
# SCOPE: this is the STARTUP-phase install step for the pi-coding-agent kit
# (see spec.yaml's header DESIGN note for why this is startup-only, not an
# install phase — no native-module lifecycle script exists to fail without a
# toolchain, unlike openchamber's better-sqlite3 dependency, so there is no
# create-vs-startup safety tension to resolve here). Runs as the agent user
# (whose uid is assigned at provision and is not necessarily 1000) and is
# fully idempotent: installs `pi` only if it isn't already present. The
# CA-bundle and the `pi` wrapper (both below) are rebuilt EVERY boot,
# regardless of whether a fresh install happened — see the comments at each.
#
# DELIBERATELY NOT the pi.dev curl-pipe-to-shell installer: that script is
# mutable, runs an interactive Node/npm preflight path meaningless in a
# non-interactive startup script, and needs pi.dev egress this kit's
# allow-list does not grant (see spec.yaml). This script instead runs the
# same underlying npm command pi's own installer runs, directly.
#
# VERSION PIN: PI_CODING_AGENT_VERSION selects the exact npm version to
# install. Pinned to a specific, reviewed release rather than "latest" — this
# kit's behavior must not silently drift to whatever npm resolves as newest
# on every sandbox boot. Bump this pin deliberately, as its own reviewed
# change, after checking the new release's own supply-chain posture (npm
# registry metadata: engines.node, absence of lifecycle scripts).
_pi_version="${PI_CODING_AGENT_VERSION:-0.84.3}"

set -eu

# --- Preflight: Node/npm must already be present. --------------------------
# THIS GUARD MUST RUN FIRST, before any use of `npm` below (including the npm
# prefix lookup) — under `set -eu`, a command substitution invoking a
# nonexistent `npm` binary trips errexit immediately with an opaque
# "command not found", bypassing the friendly message and non-fatal exit(0)
# this guard exists to provide. Installing Node itself is out of scope for
# this kit — the base image is expected to already carry it (the same
# assumption openchamber makes). pi's own installer offers an interactive
# Homebrew/apt/apk/standalone-Node install path when Node/npm are missing;
# that path is meaningless in a non-interactive startup script, so we skip it
# entirely and fail CLEARLY instead.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "pi-coding-agent: node and/or npm not found on PATH; cannot install pi this boot (installing Node is out of scope for this kit — see spec.yaml)" >&2
  exit 0   # never fail the sandbox over an optional CLI
fi

# pi requires Node >=22.19.0 (verified against its published npm registry
# metadata's engines.node field). npm's own engine-strict defaults to false,
# so `npm install` would otherwise proceed silently on an older Node and only
# fail later, opaquely, the first time `pi` itself runs. Check explicitly and
# fail clearly now instead — mirrors pi's own installer's preflight check.
if ! node -e 'var v=process.versions.node.split(".").map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=19)?0:1)' 2>/dev/null; then
  echo "pi-coding-agent: pi requires Node.js >=22.19.0, found $(node --version 2>/dev/null); cannot install pi this boot (installing/upgrading Node is out of scope for this kit)" >&2
  exit 0
fi

# Defensive format check on the version pin: a malformed
# PI_CODING_AGENT_VERSION (e.g. accidentally containing whitespace, shell
# metacharacters, or a stray flag-looking token) fails closed here with a
# clear message instead of silently becoming part of the npm package-spec
# string later. NOTE: a shell `case` glob's `*` is a WILDCARD, not a
# quantifier — `[0-9]*.[0-9]*.[0-9]*` matches "one digit followed by ANY
# characters" three times, so a string like "1.0.0; rm -rf /" or
# "1.0.0 --registry=evil" MATCHES this pattern too (verified live: it is not
# shell-injectable regardless — the value is always passed as a single quoted
# argv word, never re-parsed by the shell — but the format check itself was a
# silent no-op against exactly the strings it was meant to catch). The second
# `case` below closes that gap by explicitly rejecting any character outside
# a safe version-string charset.
case "$_pi_version" in
  latest) : ;;
  [0-9]*.[0-9]*.[0-9]*)
    case "$_pi_version" in
      *[!0-9A-Za-z.-]*)
        echo "pi-coding-agent: PI_CODING_AGENT_VERSION='$_pi_version' contains characters outside [0-9A-Za-z.-]; refusing to install" >&2
        exit 0
        ;;
    esac
    ;;
  *)
    echo "pi-coding-agent: PI_CODING_AGENT_VERSION='$_pi_version' doesn't look like a version; refusing to install" >&2
    exit 0
    ;;
esac

# Single shared log for this boot's run — the CA-decode-failure path and the
# npm-install-failure path both append to it, rather than each creating its
# own separate mktemp file (an earlier version of this script did that; the
# second file was created even on a fully successful boot, as an empty,
# never-read leftover under /tmp — mktemp creates the file immediately on
# call, not lazily on first write).
_log="$(mktemp "${TMPDIR:-/tmp}/pi-coding-agent-install.XXXXXX.log" 2>/dev/null || true)"
[ -n "$_log" ] || _log="/tmp/pi-coding-agent-install.$$.log"

# Explicit, unprivileged per-user npm prefix. $HOME/.local, specifically —
# NOT $HOME/.npm-global (the convention openchamber/paseo use), and NOT pi's
# own installer's prefix-detection-with-$HOME/.local-fallback logic either
# (pi's own installer tries the system global prefix first and only falls
# back to $HOME/.local if that isn't writable).
#
# WHY $HOME/.local, specifically: it is on this kit's target base images'
# DEFAULT guest PATH already (confirmed live). $HOME/.npm-global/bin is NOT
# — which is exactly why openchamber's and paseo's own startup scripts each
# have to prepend it to PATH themselves, and why their `scripts/verify`
# probes have to inject the same prepend into every `sh -c` they run inside
# the sandbox (see either sibling's `in_sbx()` helper and its own comment on
# why: a bare, later `sh -c` — e.g. the one a real user's interactive shell
# runs, or `acq exec … -- pi` — gets NEITHER kit's PATH prepend, since that
# prepend is this PROCESS-local, not persisted anywhere a root-owned
# /etc/profile.d or similar could pick up as the non-root agent user; see
# openchamber-start.sh's own "SCOPE LIMIT" comment for the full explanation
# of why there is no agent-user-safe way to persist it). By choosing a
# prefix whose bin/ directory the base image ALREADY has on PATH, this kit
# sidesteps that whole class of problem instead of working around it: no
# process-local PATH prepend is needed here, in `scripts/verify`, or for a
# user's own later shell — `pi` is reachable the same way regardless of who
# invokes it or when. See docs/decisions/local-prefix-not-npm-global.md.
#
# An explicit, unconditional prefix (rather than probing at runtime whether
# some OTHER prefix happens to be writable) is also more auditable and
# idempotent in a sandbox startup script — this remains true independent of
# the .local-vs-.npm-global choice above, and is why this script still does
# not use pi's own installer's runtime-detection logic.
NPM_PREFIX="$HOME/.local"

# Build a CA bundle for Node's HTTPS requests — UNCONDITIONALLY, on every
# boot, not only when pi is freshly installed: (1) npm's own tarball download
# below needs it during an install, and (2) the exported wrapper this script
# writes near the end needs an ALWAYS-CURRENT bundle path for pi's own later
# LLM-provider calls, since a proxy CA could change between boots and a stale
# bundle would fail closed with a confusing TLS error rather than a clear one.
# NODE_EXTRA_CA_CERTS *appends* to Node's built-in roots, which lack both the
# sandbox proxy CA and any HTTPS-inspection CA (e.g. Zscaler). This block is
# ADAPTED from openchamber's own script (same PROXY_CA_CERT_B64 decode +
# system-bundle-append + NODE_EXTRA_CA_CERTS-export structure and trust
# rationale), with one deliberate improvement: a failed base64 decode is
# surfaced with a clear error (into the shared $_log above, not a second,
# separate temp file) instead of silently producing an incomplete bundle
# (openchamber's own block swallows that same decode failure via
# `2>/dev/null` — not fixed here, since that's a pre-existing, separately-
# tracked concern in a different kit).
_ca="$HOME/.local/state/pi-coding-agent/ca-bundle.pem"
mkdir -p "$(dirname "$_ca")"
: > "$_ca"
if [ -n "${PROXY_CA_CERT_B64:-}" ]; then
  if ! printf %s "$PROXY_CA_CERT_B64" | base64 -d >> "$_ca" 2>>"$_log"; then
    # Surface a decode failure instead of silently shipping a bundle missing
    # the proxy CA — an incomplete bundle behind an inspecting proxy fails
    # TLS with a confusing "unable to verify" error rather than a clear
    # signal that PROXY_CA_CERT_B64 itself is malformed.
    echo "pi-coding-agent: PROXY_CA_CERT_B64 failed to base64-decode; proxy CA NOT added to the bundle (see $_log)" >&2
  fi
fi
[ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >> "$_ca"
[ -s "$_ca" ] && export NODE_EXTRA_CA_CERTS="$_ca"

# --- Install pi if it isn't present yet (idempotent). -----------------------
if ! command -v pi >/dev/null 2>&1; then
  mkdir -p "$NPM_PREFIX"
  # `--prefix` on the command line (below), not just an npm_config_prefix
  # env-var export: verified live that some base images persistently export
  # NPM_CONFIG_PREFIX (uppercase) — npm's config precedence reads that over
  # a lowercase npm_config_prefix export, so setting only the env var here
  # can silently install into whatever the base image's own uppercase
  # variable points at instead of this kit's intended per-user prefix. The
  # CLI flag has the highest precedence and always wins regardless of what
  # the base image has already exported.

  # The standard install path pi's own installer itself runs — NOT the
  # experimental PI_EXPERIMENTAL=1 managed-install mode (unstable upstream,
  # could change or break without notice). --ignore-scripts: verified
  # against the published npm registry metadata that
  # @earendil-works/pi-coding-agent AND every one of its transitive
  # dependencies (checked individually, not assumed) declare NO
  # preinstall/postinstall lifecycle script, so this flag has nothing to
  # skip anywhere in the dependency tree for this exact pinned version.
  # NOTE (residual risk, see spec.yaml header): --ignore-scripts blocks
  # lifecycle HOOKS only — npm still performs ordinary package-manager
  # bookkeeping regardless (e.g. linking the package's declared `bin` entry
  # onto PATH), and none of that vets the code that runs when `pi` is later
  # INVOKED. A compromised package can still run arbitrary code on first
  # `pi` execution with full agent-user privilege. The sandbox itself
  # remains the real containment boundary.
  _pkg="@earendil-works/pi-coding-agent"
  [ "$_pi_version" != "latest" ] && _pkg="${_pkg}@${_pi_version}"

  # --fetch-timeout bounds how long a hanging (not merely erroring)
  # connection to the registry can block sandbox startup — verified live,
  # e.g. a firewall that silently drops packets rather than refusing the
  # connection outright. --fetch-retries=0: this is a STARTUP-phase script
  # that runs on every boot, not a one-shot manual install — retrying against
  # a systemic failure just multiplies the timeout for no benefit, since the
  # NEXT sandbox start already retries naturally. Fail fast instead.
  if npm install -g --ignore-scripts --prefix "$NPM_PREFIX" \
      --fetch-timeout=30000 --fetch-retries=0 \
      "$_pkg" >>"$_log" 2>&1; then
    :
  else
    _rc=$?
    # Surface the real exit code; still exit 0 below — an optional CLI must
    # not fail the sandbox — but a definite install failure stays visible in
    # the log rather than being silently swallowed.
    echo "pi-coding-agent: npm install exited $_rc (prefix=$NPM_PREFIX); pi unavailable this boot. See $_log" \
      | tee -a "$_log" >&2
  fi
fi

# --- Wrapper: make the CA bundle actually apply to a USER's later `pi`. -----
# Rebuilt UNCONDITIONALLY (regardless of whether a fresh install happened
# above), for two reasons: (1) it must self-heal a sandbox that already had
# `pi` installed from a boot BEFORE this wrapper existed, and (2) the CA
# bundle it points at is rebuilt every boot (see above), so the wrapper must
# be too, or it would keep exporting a stale bundle path forever after the
# first boot that created it.
#
# WHY A WRAPPER, NOT JUST THE NODE_EXTRA_CA_CERTS EXPORT ABOVE: that export
# is scoped to THIS SCRIPT's own process. It does nothing for the `pi`
# process a user launches later, in a completely separate shell — an
# install-time env-var export cannot reach a process that starts after this
# script has already exited. Concretely, without this wrapper, behind the
# Zscaler-inspecting proxy this kit is designed for: first boot installs
# `pi` successfully (the CA bundle IS exported for that process, so npm's own
# HTTPS calls work), then the user runs `pi` themselves and its first HTTPS
# call to the LLM provider fails with SELF_SIGNED_CERT_IN_CHAIN /
# UNABLE_TO_GET_ISSUER_CERT_LOCALLY — the exact failure this kit's CA-bundle
# logic exists to prevent, just not actually prevented for the process that
# matters. See docs/decisions/ca-bundle-wrapper-not-env-var.md.
#
# _pi_real is whatever npm's own global-install bin symlink actually points
# at — resolved via readlink rather than hardcoding pi's internal package
# layout, so this does not silently break if a future pi release restructures
# its own dist/ tree. That symlink only EXISTS right after npm creates it,
# though: once this script has replaced it with the wrapper below (a plain
# file, not a symlink), a LATER boot has nothing left to readlink from — so
# the resolved path is cached in a sidecar file the first time it's found,
# and read back from there on every subsequent boot where $_pi_bin is
# already our own wrapper rather than npm's symlink.
_pi_real_cache="$HOME/.local/state/pi-coding-agent/real-bin-path"
_pi_bin="$NPM_PREFIX/bin/pi"
_pi_real=""
if [ -L "$_pi_bin" ]; then
  _pi_real="$(readlink "$_pi_bin" 2>/dev/null || true)"
  case "$_pi_real" in
    /*) : ;;                                   # already absolute
    "") : ;;                                   # readlink failed; handled below
    *) _pi_real="$NPM_PREFIX/bin/$_pi_real" ;;  # resolve relative to bin/
  esac
  if [ -n "$_pi_real" ]; then
    mkdir -p "$(dirname "$_pi_real_cache")"
    printf '%s\n' "$_pi_real" > "$_pi_real_cache"
  fi
elif [ -e "$_pi_bin" ] && [ -f "$_pi_real_cache" ]; then
  # $_pi_bin already our wrapper from an earlier boot (a plain file, not
  # npm's symlink) — recover the real path from the cache written above the
  # first time this ever ran.
  _pi_real="$(cat "$_pi_real_cache" 2>/dev/null || true)"
fi

if [ -n "$_pi_real" ] && [ -e "$_pi_real" ]; then
  # `> "$_pi_bin"` alone would be WRONG here on the very first rewrite: at
  # that point $_pi_bin is still npm's own symlink (from the readlink call
  # just above), and a shell redirection into a symlink follows it and
  # truncates the REAL target file underneath — which is $_pi_real itself,
  # i.e. this would silently clobber the actual `pi` binary with the
  # wrapper's own shell-script text (reproduced live: Node then fails to
  # parse the clobbered file as JS). Remove the symlink first so the
  # redirection creates a fresh regular file at $_pi_bin instead.
  rm -f "$_pi_bin"
  cat > "$_pi_bin" <<WRAPPER
#!/bin/sh
# Auto-generated by pi-coding-agent-install.sh — do not edit by hand; this
# file is overwritten on every sandbox boot. Exports the CA bundle this kit
# rebuilds every boot, then execs the real npm-installed entrypoint, so a
# user's own \`pi\` invocation gets the same TLS trust the installer itself
# used. See docs/decisions/ca-bundle-wrapper-not-env-var.md.
NODE_EXTRA_CA_CERTS="$_ca"
export NODE_EXTRA_CA_CERTS
exec node "$_pi_real" "\$@"
WRAPPER
  chmod 0755 "$_pi_bin"
elif [ ! -e "$_pi_bin" ]; then
  : # No install this boot and none from a prior boot either; nothing to wrap.
else
  echo "pi-coding-agent: could not resolve $_pi_bin's real target; leaving it unwrapped (pi will run without the managed CA bundle) — see $_log" >&2
fi

command -v pi >/dev/null 2>&1 || {
  # This fires for ANY unsuccessful install, including TRANSIENT causes
  # (npm/registry 503, proxy blip) — it is not a definitive-failure signal on
  # its own, same caveat openchamber's script documents for its own
  # equivalent guard.
  echo "pi-coding-agent: pi install failed or pi not found on PATH" >&2
  exit 0   # never fail the sandbox over an optional CLI
}

echo "pi-coding-agent: pi is installed and on PATH ($(command -v pi))"
