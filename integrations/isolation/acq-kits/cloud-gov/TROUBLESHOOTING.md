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

- **Missing or expired host-side token.** Cloud Foundry OAuth tokens are
  short-lived. If `scripts/verify` reports `authenticated /v3/organizations ->
  401` or `403`, read the lines above its FAIL: it also sends the host's own
  token to the same endpoint as a control. A rejected control means the token
  expired (run `cf login` first); an accepted control with a rejected sandbox
  request means the backend did not substitute the placeholder or holds a stale
  secret, which re-minting the token will not fix. A `class=unset` result on sbx
  most likely means sbx's proxy has no `CF_OAUTH_TOKEN` custom secret for this
  sandbox (see the sbx bullet below); it can also mean the secret was registered
  after the sandbox was created, is scoped to another sandbox, or the exec session
  does not carry the variable. To refresh from a host shell where you are logged in to cloud.gov:

  ```bash
  # msb
  cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  # sbx: registers a command source, so the token is resolved by sbx and not stored here
  sbx secret set-custom --host api.fr.cloud.gov --env CF_OAUTH_TOKEN \
    --command "$(command -v cf) oauth-token"
  ```

- **sbx: `CF_OAUTH_TOKEN` is unset in the sandbox.** `acq secret set` cannot feed
  sbx's proxy for this host (sbx's `set-custom` has no stdin input), so a secret
  stored only through acq never reaches the sandbox. Run `sbx secret ls` and look
  for `CF_OAUTH_TOKEN` under CUSTOM SECRETS; if it is absent, register it with the
  `sbx secret set-custom` command above and create a new sandbox.
- **sbx: `verify command failed (exit_status)` when registering.** sbx ran the
  `--command` when you registered it and it exited non-zero. Run it the way the
  daemon does: from a temporary directory with a minimal environment
  (`cd "$(mktemp -d)" && env -i HOME="$HOME" PATH=/usr/bin:/bin "$(command -v cf)" oauth-token`).
  Use `--show-error` for sbx's own message, and upgrade sbx (registration failed on
  0.48.0 and worked on 0.50.1).

- **Wrong scope.** If the sandbox has a sandbox-scoped secret, update that one
  instead of the global one:

  ```bash
  # msb
  cf oauth-token | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
  # sbx (see `sbx secret ls` for the scope of each CF_OAUTH_TOKEN entry)
  sbx secret set-custom --sandbox <sandbox-name> --host api.fr.cloud.gov --env CF_OAUTH_TOKEN \\
    --command "$(command -v cf) oauth-token"
  ```

- **Unexpected token value in the sandbox.** The startup script only accepts
  recognized backend placeholders in `CF_OAUTH_TOKEN`, including sbx/acq forms
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
