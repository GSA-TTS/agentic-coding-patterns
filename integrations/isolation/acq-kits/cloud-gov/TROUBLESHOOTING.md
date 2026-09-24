# Troubleshooting - cloud-gov kit

These are failure modes specific to the cloud-gov acq mixin kit.

## `cf` Is Not Installed

**Symptoms:** `cf version` fails inside the sandbox.

**Causes and fixes:**

- **Install egress blocked.** Check the sandbox policy log and confirm the CF CLI
  package hosts in `spec.yaml` are allowed.
- **Unsupported architecture.** The install script supports upstream Linux
  x86_64/amd64 and arm64/aarch64 tarballs. For another architecture, install the
  CF CLI in the base image or extend `files/home/cloud-gov-install-cf-cli.sh`
  with a pinned artifact and SHA-256.
- **Release artifact changed.** The install script verifies the downloaded
  tarball SHA-256. A mismatch fails closed; review the upstream release metadata
  before changing the pinned version or hash.

## `cf api https://api.fr.cloud.gov` Fails

**Symptoms:** `cf api` times out or cannot resolve/reach the API host.

**Causes and fixes:**

- **Kit not applied.** Recreate the sandbox with this kit applied.
- **Egress blocked by org policy.** Check `acq policy log <sandbox>` or the
  active backend's policy log for `api.fr.cloud.gov`.
- **TLS trust issue.** If your network uses TLS inspection, compose this kit with
  `zscaler-ca-certificate` or the local equivalent CA-trust kit.

## CF Authentication Fails

**Symptoms:** cloud.gov is reachable, but `cf` reports unauthorized, forbidden,
or no current user.

**Causes and fixes:**

- **Missing or expired host-side token.** Cloud Foundry OAuth tokens are
  short-lived. If `scripts/verify` reports `authenticated /v3/organizations ->
  401` or `403`, refresh the acq secret from a host shell where you are logged in
  to cloud.gov:

  ```bash
  cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **Wrong scope.** If the sandbox has a sandbox-scoped `cloud-gov` secret, update
  that scoped secret instead of the global one:

  ```bash
  cf oauth-token | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **Unexpected token value in the sandbox.** The startup script only accepts
  recognized backend placeholders (`acq_placeholder_*` or `sbx-cs-*`) in
  `CF_OAUTH_TOKEN`. If a raw `bearer ...` token, a JWT-looking value, or a value
  with control characters appears in the sandbox, startup fails closed. Refresh
  the acq secret from the host and recreate the sandbox. Do not paste the token
  into chat or commit it to the workspace.
- **CF CLI wants a local login.** The kit does not write the placeholder into
  `~/.cf/config.json` because stock `cf` may parse cached tokens locally before
  sending a request. Use direct Cloud Foundry API calls with the placeholder auth
  header for authenticated probes unless a live-tested backend path for
  authenticated `cf` commands is added later.

## A cloud.gov App Route Is Blocked

**Symptoms:** `curl https://<app>.app.cloud.gov` or a browser/API request to a
cloud.gov app route fails because egress is denied.

**Causes and fixes:**

- **Route outside cloud.gov.** The kit allow-lists `cloud.gov` and
  `*.cloud.gov` because Cloud Foundry app routes are assigned dynamically and a
  reusable kit cannot know which `*.app.cloud.gov` hosts belong to the current
  operator at static kit-definition time. If your app uses a custom domain or an
  internal route outside `cloud.gov`, add a separate project-specific network
  allow-list entry rather than broadening this shared kit.
- **Wildcard not supported by the active backend.** Confirm the generated backend
  policy from `acq`; if needed, add the specific app host as a per-sandbox allow.

## Docs Are Not Reachable

**Symptoms:** Requests to cloud.gov or Cloud Foundry docs fail.

**Causes and fixes:**

- Confirm the requested host is one of `cloud.gov`, `www.cloud.gov`,
  `docs.cloud.gov`, `docs.cloudfoundry.org`, or `cli.cloudfoundry.org`.
- If docs pull assets from another host and the backend blocks them, add the
  specific observed host after review instead of adding a broad wildcard.
