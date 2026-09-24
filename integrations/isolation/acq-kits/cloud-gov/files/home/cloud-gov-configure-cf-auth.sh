#!/usr/bin/env sh
set -eu

# Configure the CF CLI to use cloud.gov. If acq injected a backend placeholder in
# CF_OAUTH_TOKEN, validate that it is not raw token material. The stock CF CLI
# parses AccessToken locally, so this script deliberately does not write a
# non-JWT placeholder into ~/.cf/config.json and overclaim authenticated cf CLI
# support.

log() { printf '%s\n' "cloud-gov: $*" >&2; }

mkdir -p "$HOME/.cf"
chmod 0700 "$HOME/.cf"

if [ -n "${CF_OAUTH_TOKEN:-}" ]; then
  case "$CF_OAUTH_TOKEN" in
    acq_placeholder_?*|sbx-cs-?*)
      :
      ;;
    *)
      log "CF_OAUTH_TOKEN is not a recognized acq/sbx placeholder; refusing startup"
      exit 1
      ;;
  esac

  case "$CF_OAUTH_TOKEN" in
    *[!A-Za-z0-9_-]*)
      log "CF_OAUTH_TOKEN placeholder contains an unexpected character; refusing startup"
      exit 1
      ;;
  esac

  log "validated CF_OAUTH_TOKEN as a backend placeholder"
else
  log "no CF_OAUTH_TOKEN placeholder present; cf is targeted but unauthenticated"
fi

if command -v cf >/dev/null 2>&1; then
  CF_OAUTH_TOKEN= cf api https://api.fr.cloud.gov >/dev/null 2>&1 || log "warning: cf api target failed; check egress/TLS"
fi
