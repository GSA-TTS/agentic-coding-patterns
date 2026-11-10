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
  has one. If `cf` is missing, attempts to install Cloud Foundry CLI
  v8.19.0 into `~/.local/bin` at sandbox startup from pinned upstream release
  tarballs with committed SHA-256 checks. The install is best effort: a failed
  download logs a warning and does not fail sandbox start, so a started sandbox
  does not guarantee `cf` is present. Run `cf version` before relying on it.
- **cloud.gov egress** - allow-lists exact cloud.gov control-plane and
  documentation hosts: the Cloud Foundry API, login/UAA, log-stream hosts, and
  user-facing cloud.gov documentation. Public app routes and custom domains stay
  project-specific instead of using wildcard egress.
- **Cloud Foundry docs egress** - allow-lists upstream Cloud Foundry CLI and docs
  hosts so agents can look up command behavior and platform guidance.
- **Secret-safe authorization** - documents the per-backend secret binding for a
  host-side `cf oauth-token` (`acq secret set` on msb, `sbx secret set-custom` on
  sbx). The sandbox receives only the backend placeholder
  needed for direct Cloud Foundry API calls; the real token stays in the host-side
  secret store / backend proxy.

## Backend Parity

The kit declares `sbx` and `msb` support. Both backends consume the neutral kit
fields: `caps.network.allow`, file drops, and startup commands. There
is no backend shortcut.

The Cloud Foundry token is not a kit field. The user binds it to
`api.fr.cloud.gov` with the backend's own secret mechanism (see
[Prerequisites](#prerequisites)); the active backend maps that to its proxy or
secret-substitution mechanism. The kit does a best-effort format
check on any injected `CF_OAUTH_TOKEN` value (known placeholder prefixes, no
bearer/JWT shape); that is not proof the backend will substitute it.

The network allow-list avoids wildcard semantics. Both sbx and msb receive the
same exact host list, which keeps the shared kit least-privilege and makes app
route/custom-domain access an explicit project-specific decision.

## Usage

Apply the kit alongside an agent sandbox:

```bash
acq run --kit <path-to-this-kit> opencode /path/to/project
```

The kit is a `mixin`, so it composes with the other acq-kits.

**On a TLS-intercepting network (for example Zscaler), the CA-trust kit must
come before this kit.** Startup commands run in kit order (per acq's documented
behavior; the live sbx check below is what confirms it) and the CF CLI
download is HTTPS. The global kit bundle applies `zscaler-ca-certificate` before
`ACQ_EXTRA_KITS`, so the default needs no action. Do **not** add the CA kit to
`ACQ_EXTRA_KITS` when the global bundle already has it: sbx rejects a
composition with two kits of the same name (`duplicate kit name`). Only if your
bundle has no CA-trust kit, list one before this kit:

```bash
export ACQ_EXTRA_KITS="<path>/your-ca-kit <path>/cloud-gov"
```

## CF CLI Installation Pin

If the base image already has `cf`, the install step exits successfully without
network package installation. If `cf` is missing, the kit installs Cloud Foundry
CLI v8.19.0 from the upstream GitHub release tarball for `linux_x86-64` or
`linux_arm64`, then verifies the archive SHA-256 before installing it. Unsupported
architectures are refused (the install fails; sandbox start still succeeds).

The install is a **startup** step (as the agent user, into `~/.local/bin`), not
an install-phase step. An install-phase command runs at create time, before a
CA-trust kit's startup step has trusted an intercepting proxy's CA, so the HTTPS
fetch failed with `curl` exit 60 and failed the whole create. The startup step is
non-fatal and idempotent: a failed download logs a warning and is retried on the
next start.

To update the CLI, change the version and both SHA-256 constants in
`files/home/cloud-gov-install-cf-cli.sh` together after reviewing the upstream
release metadata.

When installed, `cf` is in `~/.local/bin`. A bare `acq exec` runs a non-login shell
that may not have that directory on `PATH`; prepend it
(`PATH="$HOME/.local/bin:$PATH"`) when probing from the host.

## Prerequisites

From a host shell, log in to cloud.gov with the normal human-controlled flow:

```bash
cf login -a https://api.fr.cloud.gov --sso
```

Then bind the Cloud Foundry OAuth token to `api.fr.cloud.gov` on the backend you
use. `cf oauth-token` returns the full authorization value, including the
`bearer` prefix. Do not paste it into chat or write it to a file. The command
differs by backend, because sbx feeds its proxy through a different mechanism
than `acq secret set` can drive for an arbitrary host.

**msb** - pipe the token into the acq secret store (acq's msb backend reads it
at sandbox creation; `scripts/verify` passed its authenticated probe this way
on msb during development, but not on the final head):

```bash
cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
```

**sbx** - register a custom secret with sbx itself. `acq secret set` alone is not
enough on sbx: `sbx secret set-custom` cannot read a piped value, so acq stores
the value in its own store and sbx's proxy never receives it, and the sandbox
then sees no `CF_OAUTH_TOKEN`. A dynamic `--command` source keeps the token off
argv and shell history, and sbx resolves it on the host. Whether each request
gets a freshly minted token or a cached one was not measured here; if a long
session starts getting 401s, re-run `scripts/verify` step 8 to separate a
host-token problem (expiry, revocation, scope) from a failed injection:

```bash
sbx secret set-custom --host api.fr.cloud.gov --env CF_OAUTH_TOKEN \
  --command "$(command -v cf) oauth-token"
```

Use the absolute path to `cf`: the command is replayed by the sbx daemon, whose
`PATH` and environment may differ from your shell.

**Authority.** Without `--sandbox`, this secret is global: while your host `cf`
session is valid, every sandbox's request to `api.fr.cloud.gov` is authorized as
you, and requests may resolve a current token (refresh behavior was not measured
here). That is potentially a wider and longer-lived grant than a pasted
short-lived token. Prefer `--sandbox <name>` for a specific sandbox,
and remove the secret (`sbx secret rm`) when you no longer need it. The placeholder (`sbx-cs-...`) is captured when
a sandbox is created, so create a new sandbox after registering; an existing one
needs its `CF_OAUTH_TOKEN` updated to the printed placeholder. Observed working
on sbx 0.50.1 with acq at the time of writing; the same registration failed with a
`verify command failed` error on sbx 0.48.0 (cause not determined), so upgrade if
registration fails. The statements that `acq secret set` cannot feed sbx's proxy
here and that `sbx secret set-custom` takes no stdin were true of those versions;
re-check them if either tool changes.

The `CF_OAUTH_TOKEN` name is a placeholder binding for backend proxy/secret
substitution. At startup the kit targets `https://api.fr.cloud.gov` and, when
that value is present, refuses to continue unless it matches a recognized
backend-placeholder prefix, including the documented msb guest-secret placeholder
prefix. This is a best-effort format check, not proof that the backend will
substitute the value: it rejects bearer/JWT-shaped values, and the script makes
no filesystem change until the check passes. A raw token that already reached the
sandbox environment is not removed by the check; the script only refuses to
continue. The stock CF CLI
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
| `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` | Pinned Cloud Foundry CLI release tarball download during the startup install; if runtime access to these hosts is not acceptable for a deployment context, use a base image with `cf` preinstalled or a project-specific vetted artifact source. |

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

If authenticated API calls fail, run `scripts/verify` with `RUN_ACQ=1` (its step 8
separates a host-token problem from a failed injection). On msb, refresh the secret
with `cf oauth-token | acq secret set ...`; on sbx, check `sbx secret ls` for a
`CF_OAUTH_TOKEN` custom secret, and recreate the sandbox so the placeholder is
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
egress allow-list assertions, and that the CF CLI fetch is not an install-phase
command. Set `RUN_ACQ=1` to create a throwaway sandbox and
verify that `cf` is installed, cloud.gov/docs endpoints are reachable, and the
injected placeholder reaches the CF API through a direct HTTPS request. If
that last probe is rejected, `verify` also sends the host's own `cf oauth-token`
to the same endpoint and reports the sandbox variable's class (never its value),
so a host-token problem (expiry, revocation, or scope) and a failed placeholder
injection are told apart. The host token is only read and sent when `cf api`
reports exactly `https://api.fr.cloud.gov`.
`RUN_ACQ=1` requires the token binding from Prerequisites (a global `cloud-gov`
acq secret on `ACQ_BACKEND=msb`, or a `CF_OAUTH_TOKEN` custom secret in sbx on
`ACQ_BACKEND=sbx`). `ACQ_BACKEND` is required with `RUN_ACQ=1`, so the secret is
checked against the backend that will run. On an
intercepted network, run it as is: the global bundle supplies the CA kit ahead
of this one, which is the live regression for the CA-before-fetch ordering. Set
`CA_KIT=<path>` only if your bundle has no CA-trust kit (a kit with the same
name as one already in the bundle is rejected by sbx). `ACQ_BACKEND`
passes `--backend` to `acq` without changing your persisted default; the CA-before-fetch failure only reproduces on sbx, because
msb trusts host CAs natively. The script prints which backend the create log
names and fails if it differs from the one requested. Set `KEEP=1` with
`RUN_ACQ=1` to keep the sandbox for inspection.
