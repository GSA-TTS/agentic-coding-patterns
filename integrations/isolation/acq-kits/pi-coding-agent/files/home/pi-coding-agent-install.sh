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
# "1.0.0 --registry=evil" MATCHES this pattern too, so a format check using
# only this glob would be a silent no-op against exactly the strings it is
# meant to catch (it is not a shell-injection risk either way — the value is
# always passed as a single quoted argv word, never re-parsed by the shell —
# but a malformed pin should still be refused loudly rather than reaching the
# npm package-spec string unchecked). The second `case` below closes that gap
# by explicitly rejecting any character outside a safe version-string
# charset.
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

# Single shared, FIXED log path for this boot's run (see
# docs/decisions/ for why fixed, not mktemp).
_log="$HOME/.local/state/pi-coding-agent/install.log"
mkdir -p "$(dirname "$_log")"
: > "$_log"

# Explicit, unprivileged per-user npm prefix — see
# docs/decisions/local-prefix-not-npm-global.md for why $HOME/.local.
NPM_PREFIX="$HOME/.local"

# Build a CA bundle for Node's HTTPS requests, unconditionally, every boot —
# see docs/decisions/ca-bundle-wrapper-not-env-var.md.
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
  # env-var export: some base images persistently export NPM_CONFIG_PREFIX
  # (uppercase), which npm's config precedence reads over a lowercase
  # npm_config_prefix export — the CLI flag always wins regardless.

  # The standard install path pi's own installer itself runs — NOT the
  # experimental PI_EXPERIMENTAL=1 managed-install mode. --ignore-scripts
  # residual risk: see docs/decisions/ for the full analysis; in short, it
  # blocks npm lifecycle hooks at install time only, not code that runs when
  # `pi` is later invoked.
  _pkg="@earendil-works/pi-coding-agent"
  [ "$_pi_version" != "latest" ] && _pkg="${_pkg}@${_pi_version}"

  # --fetch-timeout bounds a hanging (not merely erroring) registry
  # connection; --fetch-retries=0 because the next boot already retries.
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
# WHY A WRAPPER, NOT JUST THE NODE_EXTRA_CA_CERTS EXPORT ABOVE: see
# docs/decisions/ca-bundle-wrapper-not-env-var.md — that export is scoped to
# this script's own process and cannot reach a `pi` a user launches later.
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
  # wrapper's own shell-script text, and Node would then fail to parse the
  # clobbered file as JS. Remove the symlink first so the redirection
  # creates a fresh regular file at $_pi_bin instead.
  rm -f "$_pi_bin"
  {
    cat <<WRAPPER
#!/bin/sh
# Auto-generated by pi-coding-agent-install.sh — do not edit by hand; this
# file is overwritten on every sandbox boot. Exports the CA bundle this kit
# rebuilds every boot (when non-empty — mirrors the same-guarded export
# above), then execs the real npm-installed entrypoint, so a user's own
# \`pi\` invocation gets the same TLS trust the installer itself used. See
# docs/decisions/ca-bundle-wrapper-not-env-var.md.
WRAPPER
    # Match the CA bundle's own export above ([ -s "$_ca" ]): only emit the
    # wrapper's export when the bundle is actually non-empty, so a `pi`
    # invocation on a boot with no proxy CA and no system bundle falls back
    # to Node's default CA behavior instead of pointing at a useless,
    # zero-length cert file.
    if [ -s "$_ca" ]; then
      cat <<WRAPPER
NODE_EXTRA_CA_CERTS="$_ca"
export NODE_EXTRA_CA_CERTS
WRAPPER
    fi
    # `exec "$_pi_real"`, not `exec node "$_pi_real"`: preserves whatever
    # interpreter/flags $_pi_real's own shebang declares (matching how npm's
    # own bin symlink invokes it), rather than hardcoding `node`. npm sets
    # the executable bit on a package's declared `bin` entry during
    # install, so $_pi_real is directly executable by convention.
    cat <<WRAPPER
exec "$_pi_real" "\$@"
WRAPPER
  } > "$_pi_bin"
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
