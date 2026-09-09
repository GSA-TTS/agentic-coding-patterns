# Decision: install CF CLI and use acq secret placeholder auth

**Status:** accepted

## Context

cloud.gov operations use the Cloud Foundry CLI (`cf`) against the cloud.gov
Cloud Foundry API. A sandbox used for this work needs the CLI, egress to the
cloud.gov platform and application-route domains, and access to cloud.gov and
Cloud Foundry documentation.

Authentication is sensitive. A token from `cf oauth-token` must not be committed,
printed in chat, or written into agent-readable workspace files. At the same
time, the stock CF CLI expects an auth token in its own config before it will send
an authenticated request.

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

4. Writes only the injected backend placeholder to `~/.cf/config.json` at
   startup, so `cf` sends an auth header that the backend proxy can rewrite on the
   way to `api.fr.cloud.gov`.

The kit does not store the real Cloud Foundry OAuth token in `spec.yaml`, files,
or repository docs. The token remains in the host-side acq secret store and the
active backend's secret/proxy mechanism.

## Consequences

- Agents can use normal `cf` commands after the user supplies a host-side token.
- The real token remains outside the sandbox; the sandbox may contain only a
  backend-generated placeholder.
- The install currently supports Linux x86_64/amd64 and arm64/aarch64 release
  tarballs. Other architectures should either preinstall `cf` or add a pinned,
  integrity-checked install path before being supported.
- `**.cloud.gov` is intentionally broad because this kit is specifically for
  cloud.gov work and the requested working surface includes all cloud.gov
  subdomains. This widens egress to tenant app routes under `cloud.gov`; reviewers
  should treat that as an accepted blast-radius tradeoff for this shared kit, not
  as a generic default for other kits. Custom domains and internal routes outside
  `cloud.gov` should be added per project rather than broadening this shared kit.
- msb support depends on acq translating the neutral per-kit `**.cloud.gov` entry
  into msb's suffix rule form (`*.cloud.gov`). Without that adapter behavior,
  exact cloud.gov hosts may work but the all-subdomains contract is not met.
- Live verification with `RUN_ACQ=1` requires a configured `cloud-gov` secret and
  must exercise both raw authenticated CF API access and an authenticated `cf`
  command. Offline verification remains useful for schema/shell checks, but it is
  not evidence that cloud.gov auth wiring works.

## Links

- `../../README.md` - operator usage and troubleshooting entry points.
- `../../spec.yaml` - authoritative kit behavior.
