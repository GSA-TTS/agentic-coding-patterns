#!/usr/bin/env sh
set -eu

# Configure the CF CLI to use cloud.gov. If acq injected a backend placeholder in
# CF_OAUTH_TOKEN, write that placeholder into CF CLI config so the CLI sends an
# Authorization header; the backend proxy swaps the placeholder on the wire.

log() { printf '%s\n' "cloud-gov: $*" >&2; }

json_escape() {
  # CF_OAUTH_TOKEN should be a generated placeholder, but escape defensively
  # before embedding it in JSON. Newlines are not valid in this single-value path.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

mkdir -p "$HOME/.cf"

if command -v cf >/dev/null 2>&1; then
  cf api https://api.fr.cloud.gov >/dev/null 2>&1 || log "warning: cf api target failed; check egress/TLS"
fi

if [ -n "${CF_OAUTH_TOKEN:-}" ]; then
  case "$CF_OAUTH_TOKEN" in
    *eyJ*.*.*)
      log "CF_OAUTH_TOKEN looks like real JWT token material; refusing to write it"
      exit 1
      ;;
  esac
  escaped_token="$(json_escape "$CF_OAUTH_TOKEN")"
  cat >"$HOME/.cf/config.json" <<EOF
{
  "ConfigVersion": 3,
  "Target": "https://api.fr.cloud.gov",
  "AuthorizationEndpoint": "https://login.fr.cloud.gov",
  "UaaEndpoint": "https://uaa.fr.cloud.gov",
  "AccessToken": "${escaped_token}",
  "RefreshToken": ""
}
EOF
  chmod 0600 "$HOME/.cf/config.json"
  log "configured cf for cloud.gov using injected token placeholder"
else
  log "no CF_OAUTH_TOKEN placeholder present; cf is targeted but unauthenticated"
fi
