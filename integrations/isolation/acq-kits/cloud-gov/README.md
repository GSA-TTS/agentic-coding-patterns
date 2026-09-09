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
- **cloud.gov egress** - allow-lists the `cloud.gov` apex and all `cloud.gov`
  subdomains, covering the Cloud Foundry API, login/UAA, log-stream hosts,
  dashboard, public app routes, and user-facing cloud.gov documentation.
- **Cloud Foundry docs egress** - allow-lists upstream Cloud Foundry CLI and docs
  hosts so agents can look up command behavior and platform guidance.
- **Secret-safe authorization** - documents the `acq secret set` binding for a
  host-side `cf oauth-token`. The sandbox receives only the backend placeholder
  needed for `cf` to send an auth header; the real token stays in the host-side
  secret store / backend proxy.

## Backend Parity

The kit declares `sbx` and `msb` support. Both backends consume the neutral kit
fields: `caps.network.allow`, file drops, and create-time/startup commands. There
is no backend shortcut.

The Cloud Foundry token is not a kit field. The user stores it in the acq secret
store and binds it to `api.fr.cloud.gov`; the active backend maps that to its
own proxy or secret-substitution mechanism. The kit writes only the injected
placeholder into CF CLI config so `cf` can send an auth header for the proxy to
rewrite.

The only backend-specific network nuance is the cloud.gov wildcard. sbx consumes
`**.cloud.gov` directly. msb support requires acq to translate that per-kit
wildcard to msb's suffix rule form (`*.cloud.gov`).

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
that placeholder is present, writes it into `~/.cf/config.json` so the stock CF
CLI can send `Authorization: Bearer ...`. That file contains only the backend
placeholder, not the real OAuth token.

## Network Allow-List

The kit allow-lists:

| Host | Purpose |
|------|---------|
| `cloud.gov`, `**.cloud.gov` | cloud.gov apex and all cloud.gov subdomains, including API, login/UAA, dashboard, docs, and public app routes. This is intentionally broad for cloud.gov work; custom domains outside `cloud.gov` stay project-specific. |
| `docs.cloudfoundry.org`, `cli.cloudfoundry.org` | Cloud Foundry documentation |
| `github.com`, `objects.githubusercontent.com` | Pinned Cloud Foundry CLI release tarball download |

## Using `cf`

Inside the sandbox, target cloud.gov normally:

```bash
cf api https://api.fr.cloud.gov
cf target
cf apps
```

If the CLI requires an interactive login or reports that no user is logged in,
refresh the host-side secret with `cf oauth-token | acq secret set ...` and
restart or recreate the sandbox so the placeholder reaches CF CLI config. Do not
paste the token into chat or commit it to the workspace.

## Troubleshooting

Failure-mode notes are in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Design Decisions

- [`docs/decisions/cloud-gov-cli-and-auth.md`](docs/decisions/cloud-gov-cli-and-auth.md)
  - why this kit installs `cf`, uses broad `cloud.gov` egress, and relies on acq
  placeholder-based auth.

## Verifying

Run the bundled check:

```bash
./scripts/verify
```

By default it runs offline checks only: repository kit validation and shell
syntax for the install script. Set `RUN_ACQ=1` to create a throwaway sandbox and
verify that `cf` is installed, cloud.gov/docs endpoints are reachable, the
injected placeholder reaches the CF API, and an authenticated `cf orgs` command
works. `RUN_ACQ=1` requires a global `cloud-gov` acq secret. Set `KEEP=1` with
`RUN_ACQ=1` to keep the sandbox for inspection.
