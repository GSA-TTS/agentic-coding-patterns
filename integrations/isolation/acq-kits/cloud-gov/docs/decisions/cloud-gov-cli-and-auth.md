# Decision: install CF CLI and use acq secret placeholder auth

**Status:** accepted

## Context

cloud.gov operations use the Cloud Foundry CLI (`cf`) against the cloud.gov
Cloud Foundry API. A sandbox used for this work needs the CLI, egress to the
cloud.gov platform and application-route domains, and access to cloud.gov and
Cloud Foundry documentation.

Authentication is sensitive. A token from `cf oauth-token` must not be committed,
printed in chat, or written into agent-readable workspace files. At the same
time, stock CF CLI auth paths may parse cached access tokens locally before
sending a request, so a non-JWT backend placeholder is not enough to prove
interactive `cf` authentication works.

## Decision

Create a neutral `cloud-gov` acq mixin kit for sbx and msb that:

1. Installs `cf` at create time from pinned Cloud Foundry CLI release tarballs
   with committed SHA-256 values.
2. Allow-lists `cloud.gov`, all `cloud.gov` subdomains, and Cloud Foundry docs
   domains.
3. Uses acq's custom secret binding for a host-side token captured with
   `cf oauth-token`:

   ```sh
   cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
   ```

4. Validates any injected `CF_OAUTH_TOKEN` value as a recognized backend
   placeholder and refuses raw token-looking values. The placeholder can be used
   for direct HTTPS Cloud Foundry API calls that the backend proxy rewrites on the
   way to `api.fr.cloud.gov`.

The kit does not store the real Cloud Foundry OAuth token in `spec.yaml`, files,
or repository docs. The token remains in the host-side acq secret store and the
active backend's secret/proxy mechanism. The kit does not write a placeholder to
`~/.cf/config.json`; authenticated `cf` command support requires a separately
live-tested path because the stock CLI may parse cached tokens locally.

## Consequences

- Agents can use `cf` for Cloud Foundry targeting and unauthenticated inspection.
  Authenticated operations should use direct HTTPS Cloud Foundry API calls until a
  live-tested path for authenticated stock `cf` commands exists.
- The real token remains outside the sandbox; the sandbox may contain only a
  backend-generated placeholder.
- The install currently supports Linux x86_64/amd64 and arm64/aarch64 release
  tarballs. Other architectures should either preinstall `cf` or add a pinned,
  integrity-checked install path before being supported.
- `*.cloud.gov` is intentionally broad because this kit is specifically for
  cloud.gov work and Cloud Foundry app routes are assigned dynamically. A static
  shared kit cannot know which `*.app.cloud.gov` hosts belong to the current
  operator, so this widens egress to tenant app routes under `cloud.gov` as an
  accepted blast-radius tradeoff. Custom domains and internal routes outside
  `cloud.gov` should be added per project rather than broadening this shared kit.
- The wildcard is written as `*.cloud.gov` so current msb versions accept it
  directly as a suffix rule while sbx still treats it as a cloud.gov subdomain
  wildcard.
- Live verification with `RUN_ACQ=1` requires a configured `cloud-gov` secret and
  must exercise raw authenticated CF API access through the backend placeholder.
  Offline verification remains useful for schema/shell checks and auth guard
  tests, but it is not evidence that cloud.gov auth wiring works end to end.

## Links

- `../../README.md` - operator usage and troubleshooting entry points.
- `../../spec.yaml` - authoritative kit behavior.
