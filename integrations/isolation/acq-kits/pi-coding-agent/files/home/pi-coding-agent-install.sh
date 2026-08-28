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
# fully idempotent: installs `pi` only if it isn't already present.
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

# Explicit, unprivileged per-user npm prefix — deliberately NOT pi's own
# installer's prefix-detection-with-$HOME/.local-fallback logic (pi's own
# installer tries the system global prefix first and only falls back to
# $HOME/.local if that isn't writable). An explicit, unconditional prefix is
# more auditable and idempotent in a sandbox startup script: it does not
# depend on probing whether the default global prefix happens to be writable
# this boot (which can vary by base image / prior kit ordering), and it
# lands packages in the same destination directory openchamber's own
# convention uses ($HOME/.npm-global) — though not via the same MECHANISM:
# openchamber sets the prefix with an `npm_config_prefix` env-var export,
# while this script passes `--prefix` on the npm command line instead (see
# the comment at the npm install call below for why the CLI flag, not the
# env var, is the correct choice here). This is an intentional divergence
# from pi's own installer, not an oversight.
NPM_PREFIX="$HOME/.npm-global"
case ":$PATH:" in *":$NPM_PREFIX/bin:"*) : ;; *) PATH="$NPM_PREFIX/bin:$PATH" ;; esac
export PATH

# --- Install pi if it isn't present yet (idempotent). -----------------------
if ! command -v pi >/dev/null 2>&1; then
  # Build a CA bundle for Node's HTTPS requests (both npm's own tarball
  # download here, and later pi's own LLM-provider calls at runtime).
  # NODE_EXTRA_CA_CERTS *appends* to Node's built-in roots, which lack both
  # the sandbox proxy CA and any HTTPS-inspection CA (e.g. Zscaler). This
  # block is ADAPTED from openchamber's own script (same PROXY_CA_CERT_B64
  # decode + system-bundle-append + NODE_EXTRA_CA_CERTS-export structure and
  # trust rationale), with one deliberate improvement: a failed base64 decode
  # is surfaced with a clear error instead of silently producing an
  # incomplete bundle (openchamber's own block swallows that same decode
  # failure via `2>/dev/null` — not fixed here, since that's a pre-existing,
  # separately-tracked concern in a different kit).
  _ca="$HOME/.local/state/pi-coding-agent/ca-bundle.pem"
  mkdir -p "$(dirname "$_ca")"
  : > "$_ca"
  if [ -n "${PROXY_CA_CERT_B64:-}" ]; then
    if ! printf %s "$PROXY_CA_CERT_B64" | base64 -d >> "$_ca" 2>/tmp/pi-coding-agent-ca-decode.err; then
      # Surface a decode failure instead of silently shipping a bundle
      # missing the proxy CA — an incomplete bundle behind an inspecting
      # proxy fails TLS with a confusing "unable to verify" error rather
      # than a clear signal that PROXY_CA_CERT_B64 itself is malformed.
      echo "pi-coding-agent: PROXY_CA_CERT_B64 failed to base64-decode; proxy CA NOT added to the bundle (see /tmp/pi-coding-agent-ca-decode.err)" >&2
    fi
  fi
  [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >> "$_ca"
  [ -s "$_ca" ] && export NODE_EXTRA_CA_CERTS="$_ca"

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
  # @earendil-works/pi-coding-agent declares NO preinstall/postinstall
  # lifecycle script, so this flag has nothing to skip for the top-level
  # package — it still blocks any transitive dependency's install-time
  # hooks. NOTE (residual risk, see spec.yaml header): --ignore-scripts does
  # NOT vet or sandbox code that runs when `pi` is later INVOKED; a
  # compromised package can still run arbitrary code on first `pi` execution
  # with full agent-user privilege. The sandbox itself remains the real
  # containment boundary.
  _pkg="@earendil-works/pi-coding-agent"
  [ "$_pi_version" != "latest" ] && _pkg="${_pkg}@${_pi_version}"

  _log="$(mktemp "${TMPDIR:-/tmp}/pi-coding-agent-install.XXXXXX.log" 2>/dev/null || true)"
  [ -n "$_log" ] || _log="/tmp/pi-coding-agent-install.$$.log"

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

command -v pi >/dev/null 2>&1 || {
  # This fires for ANY unsuccessful install, including TRANSIENT causes
  # (npm/registry 503, proxy blip) — it is not a definitive-failure signal on
  # its own, same caveat openchamber's script documents for its own
  # equivalent guard.
  echo "pi-coding-agent: pi install failed or pi not found on PATH" >&2
  exit 0   # never fail the sandbox over an optional CLI
}

echo "pi-coding-agent: pi is installed and on PATH ($(command -v pi))"
