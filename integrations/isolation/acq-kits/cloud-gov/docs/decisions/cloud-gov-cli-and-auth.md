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

1. Attempts to install `cf` at sandbox startup (agent user, `~/.local/bin`) from pinned
   Cloud Foundry CLI release tarballs with committed SHA-256 values. See
   "Install phase" below for why this is not a create-time install.
2. Allow-lists exact cloud.gov control-plane/documentation hosts and Cloud
   Foundry docs domains, without wildcard semantics.
3. Uses the backend's custom secret binding for a host-side token from
   `cf oauth-token`. On msb, acq feeds it from its secret store:

   ```sh
   cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
   ```

   On sbx the same command is not enough: `sbx secret set-custom` takes no stdin
   input, so acq stores the value but sbx's proxy never receives it and the
   sandbox sees no `CF_OAUTH_TOKEN`. The sbx binding is registered with sbx
   directly, as a dynamic command source so the token stays off argv:

   ```sh
   sbx secret set-custom --host api.fr.cloud.gov --env CF_OAUTH_TOKEN \
     --command "$(command -v cf) oauth-token"
   ```

   Observed working on sbx 0.50.1 (the registration failed on 0.48.0 with a
   `verify command failed` error whose cause was not determined). Docker's sbx
   credentials documentation (checked 2026-10-31) marks custom secrets
   experimental, so the flags and placeholder format may change. The claims that
   `acq secret set` cannot feed sbx's proxy for this host and that
   `sbx secret set-custom` takes no stdin hold for the versions tested; re-check
   them when either tool changes.

4. Checks any injected `CF_OAUTH_TOKEN` value against known backend placeholder
   prefixes, including the documented msb guest-secret placeholder prefix, and
   refuses raw token-looking values before making any filesystem change. This is
   a best-effort format check, not proof of backend substitution. The placeholder can be used for direct
   HTTPS Cloud Foundry API calls that the backend proxy rewrites on the way to
   `api.fr.cloud.gov`.

The kit does not store the real Cloud Foundry OAuth token in `spec.yaml`, files,
or repository docs. The token remains outside the sandbox: in acq's host-side
secret store (msb) or resolved by the sbx daemon from the host `cf` session (sbx
`--command`), and in the active backend's proxy. The kit does not write a placeholder to
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
reviewable form.

Coverage and its limits. `scripts/tests/test_cloud_gov_kit_ordering.py` (offline)
runs the CA kit's real startup command and the cloud-gov install wrapper against
a fixture, in kit order and in reverse, with a `curl` stub that exits 60 until the
fixture trust bundle is rebuilt. It also checks the SHA-256 logic against real
fixture bytes, with a changed-byte negative control. It does NOT prove that acq
runs the bundle's startup commands in kit order, and it does not check the pinned
digests against upstream. On 2026-10-31 both pins were checked by hand: the
`linux_x86-64` and `linux_arm64` v8.19.0 tarballs were downloaded from the
upstream release, and their SHA-256 values equal the committed pins and the
digests GitHub publishes for those release assets. Repeat that check whenever
the version or a digest changes.

That ordering guarantee rests on acq's documented behavior plus a live check:
`scripts/verify` with `RUN_ACQ=1 ACQ_BACKEND=sbx` on a Zscaler-intercepted
network. A create with the install-phase fetch failed there with curl exit 60
(2026-10-29, sbx); a create with this startup-phase design succeeded and `cf
version` reported 8.19.0. The guest architecture of that live run was not
recorded; the pin check above covers both architectures.

Post-install integrity is not claimed. The SHA-256 check covers the downloaded
archive only; `~/.local/bin/cf` is agent-writable by design.

Authority note for the sbx `--command` binding: unless scoped with `--sandbox`,
it is global, and while the host `cf` session is valid any sandbox's request to
`api.fr.cloud.gov` may be authorized as the user (refresh behavior was not
measured). This is potentially a wider and longer-lived grant than a pasted
short-lived token. Scope it to a
sandbox where possible and remove it when done.

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
- Live verification with `RUN_ACQ=1` requires the token binding for the backend
  under test and must exercise raw authenticated CF API access through the
  backend placeholder. On sbx (0.50.1, Zscaler-intercepted network) the full
  `scripts/verify` run, including that authenticated probe, passed 38 of 38.
  Offline verification remains useful for schema/shell checks and auth guard
  tests, but it is not evidence that cloud.gov auth wiring works end to end.

## Links

- `../../README.md` - operator usage and troubleshooting entry points.
- `../../spec.yaml` - authoritative kit behavior.
