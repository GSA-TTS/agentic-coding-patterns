# cloud-gov (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** for working with [cloud.gov](https://cloud.gov/) from an isolated coding
sandbox.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which abstracts the isolation backend. See
> [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## What It Does

- **Cloud Foundry CLI** - uses an existing `cf` binary when the base image already
  has one. If `cf` is missing, installs Cloud Foundry CLI v8.19.0 from pinned
  upstream release tarballs with committed SHA-256 checks.
- **cloud.gov egress** - allow-lists exact cloud.gov control-plane and
  documentation hosts: the Cloud Foundry API, login/UAA, log-stream hosts, and
  user-facing cloud.gov documentation. Public app routes and custom domains stay
  project-specific instead of using wildcard egress.
- **Cloud Foundry docs egress** - allow-lists upstream Cloud Foundry CLI and docs
  hosts so agents can look up command behavior and platform guidance.
- **Secret-safe authorization** - documents the `acq secret set` binding for a
  host-side `cf oauth-token`. The sandbox receives only the backend placeholder
  needed for direct Cloud Foundry API calls; the real token stays in the host-side
  secret store / backend proxy.

## Backend Parity

The kit declares `sbx` and `msb` support. Both backends consume the neutral kit
fields: `caps.network.allow`, file drops, and create-time/startup commands. There
is no backend shortcut.

The Cloud Foundry token is not a kit field. The user stores it in the acq secret
store and binds it to `api.fr.cloud.gov`; the active backend maps that to its
own proxy or secret-substitution mechanism. The kit validates that any injected
`CF_OAUTH_TOKEN` value is a backend placeholder, not raw token material.

The network allow-list avoids wildcard semantics. Both sbx and msb receive the
same exact host list, which keeps the shared kit least-privilege and makes app
route/custom-domain access an explicit project-specific decision.

## Usage

Apply the kit alongside an agent sandbox:

```bash
acq run --kit <path-to-this-kit> opencode /path/to/project
```

The kit is a `mixin`, so it composes with the other acq-kits.

## CF CLI Installation Pin

If the base image already has `cf`, the install step exits successfully without
network package installation. If `cf` is missing, the kit installs Cloud Foundry
CLI v8.19.0 from the upstream GitHub release tarball for `linux_x86-64` or
`linux_arm64`, then verifies the archive SHA-256 before installing it. Unsupported
architectures fail closed.

To update the CLI, change the version and both SHA-256 constants in
`files/home/cloud-gov-install-cf-cli.sh` together after reviewing the upstream
release metadata.

## Prerequisites

From a host shell, log in to cloud.gov with the normal human-controlled flow:

```bash
cf login -a https://api.fr.cloud.gov --sso
```

Then store the short-lived Cloud Foundry OAuth token string in acq. `cf
oauth-token` returns the full authorization value, including the `bearer` prefix;
this command passes that value over stdin to the host-side secret store. Do not
paste it into chat or write it to a file:

```bash
cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
```

For a sandbox-specific token, scope the secret to that sandbox:

```bash
cf oauth-token | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
```

The `CF_OAUTH_TOKEN` name is a placeholder binding for backend proxy/secret
substitution. At startup the kit targets `https://api.fr.cloud.gov` and, when
that value is present, refuses to continue unless it matches a recognized
backend-placeholder prefix, including the msb placeholder form represented in
tests as `MSB_PLACEHOLDER_TOKEN`. The startup guard rejects bearer/JWT-like raw
token material before anything can be written to the workspace. The stock CF CLI
may parse `AccessToken` locally, so the kit does not write the placeholder into
CF CLI config or claim authenticated `cf` commands work without live
verification.

## Network Allow-List

The kit allow-lists:

| Host | Purpose |
|------|---------|
| `api.fr.cloud.gov` | Cloud Foundry API |
| `uaa.fr.cloud.gov`, `login.fr.cloud.gov` | cloud.gov UAA and browser-login control plane |
| `doppler.fr.cloud.gov`, `log-cache.fr.cloud.gov` | Cloud Foundry log streaming/control-plane endpoints |
| `cloud.gov`, `www.cloud.gov`, `docs.cloud.gov` | cloud.gov public documentation |
| `docs.cloudfoundry.org`, `cli.cloudfoundry.org` | Cloud Foundry documentation |
| `github.com`, `objects.githubusercontent.com` | Pinned Cloud Foundry CLI release tarball download during kit install; if runtime access to these hosts is not acceptable for a deployment context, use a base image with `cf` preinstalled or a project-specific vetted artifact source. |

The kit intentionally does not allow `*.cloud.gov`. If the project needs a
specific app route, route service, or custom domain, add that exact host in a
project-specific kit or sandbox policy after review.

## Using `cf`

Inside the sandbox, use `cf` for unauthenticated operations such as targeting the
cloud.gov API:

```bash
cf api https://api.fr.cloud.gov
cf target
```

For authenticated checks, use direct HTTPS calls to the Cloud Foundry API so the
backend can rewrite the placeholder on the wire:

```bash
curl -H "Authorization: $CF_OAUTH_TOKEN" https://api.fr.cloud.gov/v3/organizations
```

If authenticated API calls fail, refresh the host-side secret with `cf oauth-token
| acq secret set ...` and restart or recreate the sandbox so the placeholder is
injected. Do not paste the token into chat or commit it to the workspace.

## Troubleshooting

Failure-mode notes are in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Design Decisions

- [`docs/decisions/cloud-gov-cli-and-auth.md`](docs/decisions/cloud-gov-cli-and-auth.md)
  - why this kit installs `cf`, uses exact cloud.gov egress, and relies on acq
  placeholder-based auth.

## Verifying

Run the bundled check:

```bash
./scripts/verify
```

By default it runs offline checks only: repository kit validation, shell syntax
for kit scripts, auth-script guard tests with synthetic placeholders, and exact
egress allow-list assertions. Set `RUN_ACQ=1` to create a throwaway sandbox and
verify that `cf` is installed, cloud.gov/docs endpoints are reachable, and the
injected placeholder reaches the CF API through a direct HTTPS request.
`RUN_ACQ=1` requires a global `cloud-gov` acq secret. Set `KEEP=1` with
`RUN_ACQ=1` to keep the sandbox for inspection.
