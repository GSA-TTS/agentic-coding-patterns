#!/usr/bin/env sh
set -eu

# Configure the CF CLI to use cloud.gov. If acq injected a backend placeholder in
# CF_OAUTH_TOKEN, validate that it is not raw token material. The stock CF CLI
# parses AccessToken locally, so this script deliberately does not write a
# placeholder into ~/.cf/config.json and overclaim authenticated cf CLI support.

log() { printf '%s\n' "cloud-gov: $*" >&2; }

mkdir -p "$HOME/.cf"
chmod 0700 "$HOME/.cf"

if [ -n "${CF_OAUTH_TOKEN:-}" ]; then
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
    acq_placeholder_?*|sbx-cs-?*|MSB_PLACEHOLDER?*|\<MSB_PLACEHOLDER*\>)
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

  log "validated CF_OAUTH_TOKEN as a backend placeholder"
else
  log "no CF_OAUTH_TOKEN placeholder present; cf is targeted but unauthenticated"
fi

if command -v cf >/dev/null 2>&1; then
  env CF_OAUTH_TOKEN= cf api https://api.fr.cloud.gov >/dev/null 2>&1 || log "warning: cf api target failed; check egress/TLS"
fi
