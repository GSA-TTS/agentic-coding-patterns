# Decision: install CF CLI and use acq secret placeholder auth

**Status:** accepted

## Context

cloud.gov operations use the Cloud Foundry CLI (`cf`) against the cloud.gov
Cloud Foundry API. A sandbox used for this work needs the CLI, egress to exact
cloud.gov control-plane hosts, and access to cloud.gov and Cloud Foundry
documentation.

Authentication is sensitive. A token from `cf oauth-token` must not be committed,
printed in chat, or written into agent-readable workspace files. At the same
time, stock CF CLI auth paths may parse cached access tokens locally before
sending a request, so a non-JWT backend placeholder is not enough to prove
interactive `cf` authentication works.

## Decision

Create a neutral `cloud-gov` acq mixin kit for sbx and msb that:

1. Installs `cf` at sandbox startup (agent user, `~/.local/bin`) from pinned
   Cloud Foundry CLI release tarballs with committed SHA-256 values. See
   "Install phase" below for why this is not a create-time install.
2. Allow-lists exact cloud.gov control-plane/documentation hosts and Cloud
   Foundry docs domains, without wildcard semantics.
3. Uses acq's custom secret binding for a host-side token captured with
   `cf oauth-token`:

   ```sh
   cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
   ```

4. Validates any injected `CF_OAUTH_TOKEN` value as a recognized backend
   placeholder, including the documented msb guest-secret placeholder prefix,
   and refuses raw token-looking values. The placeholder can be used for direct
   HTTPS Cloud Foundry API calls that the backend proxy rewrites on the way to
   `api.fr.cloud.gov`.

The kit does not store the real Cloud Foundry OAuth token in `spec.yaml`, files,
or repository docs. The token remains in the host-side acq secret store and the
active backend's secret/proxy mechanism. The kit does not write a placeholder to
`~/.cf/config.json`; authenticated `cf` command support requires a separately
live-tested path because the stock CLI may parse cached tokens locally.

### Install phase

The tarball download is HTTPS. On a TLS-intercepting network the CA-trust kit
(`zscaler-ca-certificate`) installs the intercepting CA in its `startup` step.
A `phase: install` command runs at create time, before that CA is trusted, so
`curl -fsSL` failed with exit 60 and the sandbox create failed. The fetch is
therefore a `startup` command, which kit order runs after the CA kit's startup
step because the global bundle lists it first. It runs as the agent user, so it installs
into `~/.local/bin` (first on the image PATH) instead of `/usr/local/bin`, and no
root step executes the agent-writable script. The agent can replace
`~/.local/bin/cf`; the SHA-256 check covers the download only. It is non-fatal (a failed fetch
logs a warning and leaves the sandbox usable) and idempotent (retried on each
start). Rejected alternative: bundling the binaries in the kit, since kit file
delivery is for text and a pinned download with a SHA-256 check is the
reviewable form. Regression coverage: `scripts/tests/test_cloud_gov_kit_ordering.py`
(simulated intercepted network, offline) and `scripts/verify` with `RUN_ACQ=1`
on an intercepted network with `ACQ_BACKEND=sbx` (live).

## Consequences

- Agents can use `cf` for Cloud Foundry targeting and unauthenticated inspection.
  Authenticated operations should use direct HTTPS Cloud Foundry API calls until a
  live-tested path for authenticated stock `cf` commands exists.
- The real token remains outside the sandbox; the sandbox may contain only a
  backend-generated placeholder.
- The CA-trust kit must precede this kit on an intercepted network (the global
  bundle already orders `zscaler-ca-certificate` first; a second copy in
  `ACQ_EXTRA_KITS` is rejected by sbx as a duplicate kit name). If no CA kit
  precedes it, the startup install logs a warning and `cf` is absent until the
  order is fixed and the sandbox restarted.
- The install currently supports Linux x86_64/amd64 and arm64/aarch64 release
  tarballs. Other architectures should either preinstall `cf` or add a pinned,
  integrity-checked install path before being supported.
- Egress is exact-host only for shared-kit backend parity and least privilege.
  The kit includes the Cloud Foundry API, UAA/login, log streaming, cloud.gov
  documentation, Cloud Foundry documentation, and pinned CLI download hosts.
  The GitHub hosts are needed only when the base image lacks `cf`; if runtime
  access to those hosts is unacceptable, use a base image with `cf` preinstalled
  or a project-specific vetted artifact source. Public app routes, route
  services, and custom domains are intentionally not included because they are
  project-specific and should be added as exact host rules after review.
- Live verification with `RUN_ACQ=1` requires a configured `cloud-gov` secret and
  must exercise raw authenticated CF API access through the backend placeholder.
  Offline verification remains useful for schema/shell checks and auth guard
  tests, but it is not evidence that cloud.gov auth wiring works end to end.

## Links

- `../../README.md` - operator usage and troubleshooting entry points.
- `../../spec.yaml` - authoritative kit behavior.
