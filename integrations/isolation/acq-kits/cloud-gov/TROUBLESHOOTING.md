# Troubleshooting - cloud-gov kit

These are failure modes specific to the cloud-gov acq mixin kit.

## `cf` Is Not Installed

**Symptoms:** `cf version` fails inside the sandbox. The CLI install is best
effort and a failed download does not fail sandbox start, so a started sandbox
does not mean `cf` is ready. Look for `cloud-gov: WARNING: cf CLI is not
installed` in the sandbox startup log, and check `PATH="$HOME/.local/bin:$PATH"
cf version`.

**Causes and fixes:**

- **TLS chain untrusted at install (`curl exit 60`).** On a network that
  intercepts TLS, the CF CLI download needs the intercepting CA. The install
  runs in the startup phase so a CA-trust kit's startup step can run first, but
  only if that kit comes **before** `cloud-gov`. The global bundle already does
  this. Only if your bundle has no CA-trust kit, list one before `cloud-gov` in
  `ACQ_EXTRA_KITS`; do not add a second copy of a kit the bundle already has
  (sbx fails the create with `duplicate kit name`). Fix the order, then
  `acq restart <sandbox>`: the install step is idempotent and retries on every
  start. A failed download never blocks sandbox start; it logs
  `cloud-gov: WARNING: cf CLI is not installed`.
- **Install egress blocked.** Check the sandbox policy log and confirm the CF CLI
  package hosts in `spec.yaml` are allowed.
- **Unsupported architecture.** The install script supports upstream Linux
  x86_64/amd64 and arm64/aarch64 tarballs. For another architecture, install the
  CF CLI in the base image or extend `files/home/cloud-gov-install-cf-cli.sh`
  with a pinned artifact and SHA-256.
- **Release artifact changed.** The install script verifies the downloaded
  tarball SHA-256. A mismatch refuses the install (sandbox start still succeeds); review the upstream release metadata
  before changing the pinned version or hash.

## `cf api https://api.fr.cloud.gov` Fails

**Symptoms:** `cf api` times out or cannot resolve/reach the API host.

**Causes and fixes:**

- **Kit not applied.** Recreate the sandbox with this kit applied.
- **Egress blocked by org policy.** Check `acq policy log <sandbox>` or the
  active backend's policy log for `api.fr.cloud.gov`.
- **TLS trust issue.** If your network uses TLS inspection, compose this kit with
  `zscaler-ca-certificate` or the local equivalent CA-trust kit, ordered before
  this one (the global bundle already does this for Zscaler).

## CF Authentication Fails

**Symptoms:** cloud.gov is reachable, but `cf` reports unauthorized, forbidden,
or no current user.

**Causes and fixes:**

- **Missing, stale, or unauthorized host-side token.** Cloud Foundry OAuth tokens
  are short-lived. If `scripts/verify` reports `authenticated /v3/organizations ->
  401` or `403`, read the lines above its FAIL: when the host `cf` targets exactly
  `https://api.fr.cloud.gov`, it also sends the host's own token to the same
  endpoint as a control. A rejected control means the token may be expired or
  revoked, or may lack the scope or authorization the endpoint needs (check
  `cf target`, then run `cf login`); an accepted control with a rejected sandbox
  request means the backend did not substitute the placeholder or holds a stale
  secret, which re-minting the token will not fix. A `class=unset` result
  most likely means acq has no `CF_OAUTH_TOKEN` secret for this sandbox's scope;
  it can also mean the secret was set after the sandbox was created, is scoped to
  another sandbox, or the exec session does not carry the variable. To refresh
  from a host shell where you are logged in to cloud.gov (not re-verified on a
  live backend), then create a new sandbox:

  ```bash
  cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **`CF_OAUTH_TOKEN` is unset in the sandbox even though you ran `acq secret
  set`.** Check that the scope you set matches the sandbox (global with `-g`, or
  the sandbox name), that you created the sandbox after setting it, and that acq
  was pointed at the backend you are running on. If acq accepted the secret but
  the placeholder still never reaches the sandbox on your backend, that is an acq
  or backend issue to report; do not work around it with the backend's own secret
  tools, which this kit does not document.

- **Wrong scope.** If the sandbox has a sandbox-scoped secret, update that one
  instead of the global one (not re-verified on a live backend; acq may refuse to
  overwrite an existing secret and tell you how to remove it first):

  ```bash
  cf oauth-token | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  ```

- **Service-account path: `403 access_denied`, "Your current password has
  expired".** cloud.gov documents this for service-account passwords, which
  expire every 90 days. Re-run `scripts/setup-service-account` with the same
  flags plus `--rotate`. For an expired token alone, re-run it with `--refresh`. That script is untested against cloud.gov; this symptom
  is as cloud.gov documents it, not something this kit reproduced.
- **Unexpected token value in the sandbox.** The startup script only accepts
  recognized placeholders in `CF_OAUTH_TOKEN`, including acq forms
  and the documented msb guest-secret placeholder prefix.
  If a raw `bearer ...` token, a JWT-looking value, or a value with control
  characters appears in the sandbox, the auth script refuses to continue, before it
  creates `~/.cf` or runs `cf`. Refresh the secret from the host and recreate the sandbox. Do
  not paste the token into chat or commit it to the workspace.
- **CF CLI wants a local login.** The kit does not write the placeholder into
  `~/.cf/config.json` because stock `cf` may parse cached tokens locally before
  sending a request. Use direct Cloud Foundry API calls with the placeholder auth
  header for authenticated probes unless a live-tested backend path for
  authenticated `cf` commands is added later.

## A cloud.gov App Route Is Blocked

**Symptoms:** `curl https://<app>.app.cloud.gov` or a browser/API request to a
cloud.gov app route fails because egress is denied.

**Causes and fixes:**

- **Expected shared-kit limit.** The kit intentionally allow-lists exact
  cloud.gov control-plane and documentation hosts only. It does not include a
  `*.cloud.gov` wildcard, because wildcard semantics differ by backend and widen
  egress beyond least privilege. Add the specific app route, route service, or
  custom domain as a project-specific network allow-list entry after review.
- **Backend parity check.** Confirm the generated backend policy from `acq`
  contains the exact host you added; both sbx and msb should receive concrete
  host allow rules, not a suffix wildcard.

## Docs Are Not Reachable

**Symptoms:** Requests to cloud.gov or Cloud Foundry docs fail.

**Causes and fixes:**

- Confirm the requested host is one of `cloud.gov`, `www.cloud.gov`,
  `docs.cloud.gov`, `docs.cloudfoundry.org`, `cli.cloudfoundry.org`, or an exact
  cloud.gov control-plane host listed in `spec.yaml`.
- If docs pull assets from another host and the backend blocks them, add the
  specific observed host after review instead of adding a broad wildcard.
