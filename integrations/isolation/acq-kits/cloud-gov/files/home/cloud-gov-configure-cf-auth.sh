#!/usr/bin/env sh
set -eu

# Configure the CF CLI to use cloud.gov. If acq injected a value in
# CF_OAUTH_TOKEN, check its FORMAT before doing anything else: this script makes
# no filesystem change and runs no program until that check passes. The check is a
# best-effort prefix match against known backend placeholder shapes. It catches
# an obviously raw token (bearer prefix, JWT-shaped) but is NOT proof that the
# backend will substitute the value. The stock CF CLI parses AccessToken locally,
# so this script deliberately does not write a placeholder into ~/.cf/config.json
# and overclaim authenticated cf CLI support.

# The install step puts cf in ~/.local/bin; startup shells may not have it on PATH.
PATH="$HOME/.local/bin:$PATH"

log() { printf '%s\n' "cloud-gov: $*" >&2; }

if [ -n "${CF_OAUTH_TOKEN:-}" ]; then
  msb_prefix='$'MSB_
  case "$CF_OAUTH_TOKEN" in
    *[![:print:]]*|*[[:space:]]*)
      log "CF_OAUTH_TOKEN placeholder contains an unsafe character; refusing startup"
      exit 1
      ;;
  esac

  case "$CF_OAUTH_TOKEN" in
    bearer*|Bearer*|BEARER*)
      log "CF_OAUTH_TOKEN looks like raw token material; refusing startup"
      exit 1
      ;;
    acq_placeholder_?*|sbx-cs-?*|"$msb_prefix"?*)
      :
      ;;
    *.*.*)
      log "CF_OAUTH_TOKEN looks like raw token material; refusing startup"
      exit 1
      ;;
    *)
      log "CF_OAUTH_TOKEN is not a recognized backend placeholder; refusing startup"
      exit 1
      ;;
  esac

  log "CF_OAUTH_TOKEN matches a known placeholder format (a format check only, not proof of backend substitution)"
else
  log "no CF_OAUTH_TOKEN placeholder present; cf is targeted but unauthenticated"
fi

mkdir -p "$HOME/.cf"
chmod 0700 "$HOME/.cf"

if command -v cf >/dev/null 2>&1; then
  env CF_OAUTH_TOKEN= cf api https://api.fr.cloud.gov >/dev/null 2>&1 || log "warning: cf api target failed; check egress/TLS"
fi
