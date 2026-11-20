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
- **Secret-safe authorization** - documents how to hand a host-side
  `cf oauth-token` to `acq secret set` on stdin; acq decides how the backend you
  configured stores and injects it. By design the sandbox receives only a
  placeholder, usable for direct Cloud Foundry API calls, and the real token stays
  in acq's host-side store / the backend proxy (this design is not re-verified on
  a live backend by the current docs; `scripts/verify` step 8 is the check).

## Backend Parity

The kit declares `sbx` and `msb` support. Both backends consume the neutral kit
fields: `caps.network.allow`, file drops, and startup commands. There
is no backend shortcut.

The Cloud Foundry token is not a kit field. The user binds it to
`api.fr.cloud.gov` with `acq secret set` (see [Prerequisites](#prerequisites));
acq is intended to map that to the active backend's proxy or secret-substitution
mechanism (not re-verified on a live backend; see Prerequisites).
The kit does a best-effort format
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
behavior; an earlier live run on sbx checked it, and `scripts/verify` with
`RUN_ACQ=1` is the check to repeat) and the CF CLI
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

Then hand the Cloud Foundry OAuth token to acq for `api.fr.cloud.gov`.
`cf oauth-token` returns the full authorization value, including the `bearer`
prefix. Pipe it straight into `acq secret set` so it is on stdin only: never on
argv, never pasted into chat, never written to a file. Use whatever backend acq
is configured for; the command does not name one.

```bash
cf oauth-token | acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
```

To scope it to one sandbox instead of every sandbox, replace `-g` with the
sandbox name (`acq secret set <sandbox-name> cloud-gov ...`, the form acq's own
help describes; check `acq secret set --help` for your version).

**Authority.** With `-g`, this secret is global: while your host `cf` session is
valid, every sandbox's request to `api.fr.cloud.gov` is authorized as you. The
value is a token read once when you run the command; whether and when it expires
or refreshes was not measured here, so if a long session starts getting 401s,
re-run the command and use `scripts/verify` step 8 to separate a host-token
problem (expiry, revocation, scope) from a failed injection. That is potentially
a wider grant than you intend: prefer a sandbox-scoped binding, and remove the
secret when you no longer need it (`acq secret --help` lists the remove
command). Create a new sandbox after binding so it receives the placeholder.

**Not re-verified on a live backend.** The command above is the acq form of this
binding. This change did not run it against a live backend or cloud.gov, and does
not claim that it works on any particular backend or version. The notes below
record what was observed earlier with raw backend commands, which this kit no
longer documents; they are history, not claims about the `acq secret set` path.

**Historical verification notes (raw backend commands, before this kit used
`acq secret set`).** On an earlier head, `scripts/verify` passed its authenticated
probe on msb using the binding documented then (not on the final head, and not
evidence for the current instructions). On sbx
0.50.1, registering the token with sbx's own custom-secret command and a dynamic
command source worked, and the same registration failed with a `verify command
failed` error on sbx 0.48.0 (cause not determined). At that time, `acq secret
set` alone did not reach sbx's proxy for this host and sbx's custom-secret
command read no stdin. A sandbox's placeholder was captured when the sandbox was
created. Re-check all of this before relying on it: if `acq secret set` does not
reach the sandbox on your backend, report it as an acq issue rather than working
around it with the backend's own tools.

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

## Alternative credential: cloud.gov service account

The Prerequisites path binds **your own** `cf oauth-token`: your full scope, a
global binding unless you scope it to a sandbox, tied to your host `cf` session,
and indistinguishable from you. The playbook says an agent SHOULD use a distinct
service account or token. This section is an alternative to that path, not a
replacement; both end in `acq secret set` for the same `CF_OAUTH_TOKEN` binding.

> **Status: written from documentation, not run.** The script below was never
> run against cloud.gov or `acq`; its tests use stub `cf` and `acq`. Every
> command and behavior here is **untested** except what the stubs check about the
> script's own logic. Facts about the service come from
> cloud.gov's page
> (<https://github.com/cloud-gov/cg-site/blob/main/_docs/services/cloud-gov-service-account.md>,
> read 2026-11-20, which labels the service Beta).

**Policy first.** cloud.gov says not to use service-account credentials to log in
as a human, and agency policy usually requires people to use their own accounts.
Whether an AI agent acting through a service account is acceptable under your
agency's policy is **not settled by this kit or by cloud.gov's page**. Ask your
ISSO before using it. Nothing here claims approval.

**How to use it** (on the host, never in the sandbox):

```bash
cf login -a https://api.fr.cloud.gov --sso
cf target -o <org> -s <space>
./scripts/setup-service-account --sandbox <sandbox-name>
CLOUD_GOV_VERIFY_CF_HOME=<the CF_HOME it prints> CLOUD_GOV_VERIFY_SANDBOX=<sandbox-name> RUN_ACQ=1 ./scripts/verify
```

`scripts/setup-service-account` uses your logged-in session to create the
service account for the targeted space, authenticates it into a separate private
`CF_HOME` (mode 0700, outside any project) so your own `cf` session is untouched,
and gives a token from that session to `acq secret set` on stdin, so the sandbox
only ever sees acq's placeholder. The script takes no backend option and runs no
backend command: it relies only on acq, which uses the backend you configured
there. If acq fails, the script shows acq's message and stops. The service key's username and password stay on
the host: the script reads them in-process and hands them to `cf auth` through
its environment only, never argv. It never prints the token, username, or
password. Run it with `--help` for every step, the safety properties, the exit
codes, and the untested list.

Flags that matter:

- `--sandbox NAME` (scoped) or `--global` (every sandbox; one is required, and
  `--global` prints the authority warning).
- `--plan space-auditor` (default, read-only) or `space-deployer` (only when the
  agent must deploy).
- `--name`, `--key-name`, `--cf-home`: override the generated names and path.
- `--dry-run` shows the plan and changes nothing; `--yes` skips the prompt.
- `--rotate` rotates the service **key**: it deletes and recreates it,
  re-authenticates, and rebinds. A re-run without it never creates a second key.
  Passwords expire after 90 days (cloud.gov documents a `403 access_denied`
  "Your current password has expired" error), so rotate on that schedule.
  Revocation is deleting the key and the acq secret; the script prints the
  commands.
- **Token expiry.** The value acq stores is a static token read once, and a
  service-account token can expire. When it does, re-run the script, or use
  `--refresh` (re-reads a token from the existing private `CF_HOME` and rebinds
  it, without touching the key, instance, or password), then create a new
  sandbox. Whether `cf oauth-token` yields a fresh token for that session is
  untested.

**Untested (named so none is read as verified):**

- `cf auth` with no arguments reading `CF_USERNAME` and `CF_PASSWORD` from the
  environment, which is what keeps the password off argv.
- `CF_HOME` relocating the CLI config and leaving your own `cf` session unchanged.
- The shape of `cf service-key` output (header lines, then JSON with `username`
  and `password`), and the output of `cf service`, `cf service-keys`, and
  `cf target` that the script parses.
- The service name `cloud-gov-service-account` and plan names `space-auditor`
  and `space-deployer` exactly as the script passes them.
- `cf oauth-token` working, and refreshing, for a service-account session.
- `acq secret set [-g|<sandbox>] cloud-gov --host api.fr.cloud.gov --env
  CF_OAUTH_TOKEN` reading the token from stdin, accepting a sandbox that does not
  exist yet, and injecting the value on the backend you configured in acq. This
  applies to the Prerequisites path too; neither was run against a live backend
  by this change.
- `scripts/verify` step 8 passing for a `space-auditor` token; a rejection could
  be role scope rather than injection. `CLOUD_GOV_VERIFY_CF_HOME` only changes
  which host `cf` session the control reads; that this selects the service
  account's session is untested.
- That a token already issued stops working when its key is deleted.
- That the cloud.gov page above is still current.

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
separates a host-token problem from a failed injection). Refresh the secret with
`cf oauth-token | acq secret set ...` (see Prerequisites), and recreate the
sandbox so the placeholder is injected. Do not paste the token into chat or
commit it to the workspace.

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
to the same endpoint (or the session in `CLOUD_GOV_VERIFY_CF_HOME`, when set) and reports the sandbox variable's class (never its value),
so a host-token problem (expiry, revocation, or scope) and a failed placeholder
injection are told apart. The host token is only read and sent when `cf api`
reports exactly `https://api.fr.cloud.gov`.
`RUN_ACQ=1` requires the global token binding from Prerequisites (checked with
`acq secret has -g cloud-gov`), or `CLOUD_GOV_VERIFY_SANDBOX=<name>` to name the
throwaway sandbox so a binding scoped to that name applies (the name must not
already exist; a failed create removes nothing). `ACQ_BACKEND` is optional: when
set, `verify` passes `--backend` to `acq` without changing your persisted default,
and fails if the create log names a different backend; when unset, acq uses its
own default and the log's backend is reported. `verify` never touches a backend's
secret store except through `acq secret`. On an intercepted network, run it as
is: the global bundle supplies the CA kit ahead of this one, which is the live
regression for the CA-before-fetch ordering. Set `CA_KIT=<path>` only if your
bundle has no CA-trust kit (a kit with the same name as one already in the bundle
is rejected as a duplicate). The CA-before-fetch failure only reproduces on a
backend that uses the file-drop path (the sbx path, in earlier runs), because
backends that trust host CAs natively cannot reproduce it. Set `KEEP=1` with
`RUN_ACQ=1` to keep the sandbox for inspection.

The live run names its sandbox `cloud-gov-verify-<pid>-<random>` (or the name in
`CLOUD_GOV_VERIFY_SANDBOX`, refused if `acq ls` already shows it or cannot be read) and removes only
a sandbox whose `acq create` this invocation completed successfully. The offline
default never calls `acq`. If `acq create` fails or is interrupted, `verify`
removes nothing, because it cannot tell a half-built sandbox of its own from one
it has no claim to; it prints the name so you can check `acq ls` and remove it
yourself.
