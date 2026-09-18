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

- **Missing or expired host-side token.** From a host shell where you are logged
  in to cloud.gov, refresh the acq secret:

  ```bash
  cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **Wrong scope.** If the sandbox has a sandbox-scoped `cloud-gov` secret, update
  that scoped secret instead of the global one:

  ```bash
  cf oauth-token | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **Client-side token cache mismatch.** The kit writes only the injected
  placeholder to `~/.cf/config.json`, never the real token. If the CF CLI needs
  an interactive login before making requests, complete authentication from the
  host, refresh the acq secret, and restart or recreate the sandbox so the
  placeholder is written into CF CLI config. Do not paste the token into chat or
  commit it to the workspace.

## A cloud.gov App Route Is Blocked

**Symptoms:** `curl https://<app>.app.cloud.gov` or a browser/API request to a
cloud.gov app route fails because egress is denied.

**Causes and fixes:**

- **Route outside cloud.gov.** The kit allow-lists `cloud.gov` and
  `**.cloud.gov`. If your app uses a custom domain or an internal route outside
  `cloud.gov`, add a separate project-specific network allow-list entry rather
  than broadening this shared kit.
- **Wildcard not supported by the active backend.** Confirm the generated backend
  policy from `acq`; if needed, add the specific app host as a per-sandbox allow.

## Docs Are Not Reachable

**Symptoms:** Requests to cloud.gov or Cloud Foundry docs fail.

**Causes and fixes:**

- Confirm the requested host is one of `cloud.gov`, `www.cloud.gov`,
  `docs.cloud.gov`, `docs.cloudfoundry.org`, or `cli.cloudfoundry.org`.
- If docs pull assets from another host and the backend blocks them, add the
  specific observed host after review instead of adding a broad wildcard.
