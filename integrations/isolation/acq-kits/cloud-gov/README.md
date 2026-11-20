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

## Alternative credential: cloud.gov service account

The Prerequisites path above binds **your own** `cf oauth-token`. That token has
your full scope, the global binding (no `--sandbox`) applies to every sandbox,
it is tied to your host `cf` session (whether requests get a fresh or a cached
token was not measured; see Authority above), and what the agent does is
indistinguishable from what you do. The playbook's guidance is that an agent
SHOULD use a distinct service account or token. This section is an alternative
to, not a replacement for, the `cf oauth-token` path; either one fills the same
`CF_OAUTH_TOKEN` binding.

> **Status of this section: written from cloud.gov's documentation, not run.**
> Nothing here was executed against cloud.gov, `sbx`, or `acq`, so every command
> and behavior below is **untested**, and no line says otherwise. The
> "Untested" list at the end of the section names the specific assumptions. Do
> not read a command here as verified. Facts about the service itself come from the
> cloud.gov service-account page
> (<https://github.com/cloud-gov/cg-site/blob/main/_docs/services/cloud-gov-service-account.md>,
> read 2026-11-20, which labels the service Beta); check it for changes.

**Policy first.** cloud.gov says not to use service-account credentials to log in
to cloud.gov as a human; agency policy usually requires people to use their own
accounts. Whether an AI agent acting through a service account is acceptable
under your agency's policy is **not settled by this kit or by cloud.gov's page**.
Ask your ISSO before using it. This document does not claim any approval.

**Which plan.** Default to `space-auditor` (SpaceAuditor: read-only, one space).
Use `space-deployer` (SpaceDeveloper in one space) only when the agent must
deploy, and say so when you ask your ISSO. Scope the binding to one sandbox
(`--sandbox <name>` on sbx; a per-sandbox binding on msb) rather than the global
binding, so the account's reach is that sandbox's reach.

**Where the password goes.** The service key's username and password never enter
the sandbox, the workspace, the spec, argv, or shell history. They live on the
host only, used to authenticate `cf` into a **separate `CF_HOME`** so your own
`cf` session is untouched. The backend then reads a token from that `CF_HOME`
the same way it does for the `cf oauth-token` path, and the sandbox only ever
sees the backend placeholder.

1. **Create the account** from your own `cf` session, targeted at the one space
   it should reach (cloud.gov's documented commands):

   ```bash
   cf create-service cloud-gov-service-account space-auditor <instance-name>
   cf create-service-key <instance-name> <key-name>
   cf service-key <instance-name> <key-name>   # prints the username/password
   ```

   `cf service-key` prints the credentials to your terminal. Read them from
   there; do not copy them into chat, a file in the workspace, or a command line.

2. **Authenticate into a separate `CF_HOME`** from a host shell. This reads the
   credentials from a prompt into environment variables of a subshell, so they
   are not on argv or in history. It relies on `cf auth` reading
   `CF_USERNAME`/`CF_PASSWORD` when given no arguments, and on `CF_HOME`
   relocating the CLI's config directory: **both are untested here**.

   ```bash
   (
     umask 077
     export CF_HOME="$HOME/.cf-cloud-gov-agent"
     mkdir -p "$CF_HOME"
     printf 'service-key username: '; IFS= read -r CF_USERNAME
     printf 'service-key password: '; IFS= read -rs CF_PASSWORD; echo
     export CF_USERNAME CF_PASSWORD
     cf api https://api.fr.cloud.gov
     cf auth
   )
   ```

   Run it in `bash`. Do not use `cf auth <username> <password>`: that puts the
   password on argv. The `CF_HOME` directory holds that session's token on
   disk; keep it outside any workspace and mode 0700.

3. **Bind a token from that `CF_HOME`** instead of your own session. Replace
   `<sandbox-name>`; the `CF_HOME` path must be absolute.

   **msb** (the same pipe as the Prerequisites path, with `CF_HOME` set for
   that one command; the form of `acq secret set` with a sandbox name is the
   one already shown in `TROUBLESHOOTING.md`, and whether it can be set before
   the sandbox exists is untested):

   ```bash
   CF_HOME="$HOME/.cf-cloud-gov-agent" cf oauth-token \
     | acq secret set <sandbox-name> cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN
   ```

   **sbx** (a command source, as in Prerequisites; absolute paths because the
   sbx daemon's `PATH` and environment may differ from your shell). That sbx
   accepts this `env CF_HOME=... cf oauth-token` form as the `--command` is
   **untested**; if it does not, put those two words in a mode-0700 wrapper
   script at an absolute path outside any workspace and give that path as the
   `--command`:

   ```bash
   sbx secret set-custom --sandbox <sandbox-name> --host api.fr.cloud.gov --env CF_OAUTH_TOKEN \
     --command "$(command -v env) CF_HOME=$HOME/.cf-cloud-gov-agent $(command -v cf) oauth-token"
   ```

   Create the sandbox after registering, as on the other path. To make
   `scripts/verify`'s host control read this session, run it with the same
   `CF_HOME` in its environment (that this makes its `cf` calls use that
   session is untested). Without it, the control would send **your**
   token, which is not the one the sandbox holds.

4. **Rotate and revoke.** Rotation is deleting the service key and creating a new
   one (`cf delete-service-key <instance-name> <key-name>`, then
   `cf create-service-key`), re-running step 2 with the new credentials, and
   re-binding on msb (on sbx the command source reads the `CF_HOME` session, so
   re-authenticating is enough; untested). The password expires after 90 days:
   cloud.gov documents a `403 access_denied` "Your current password has
   expired" error when it does. Revocation is deleting the service key; also
   remove the backend binding (`sbx secret rm` on sbx; see `acq secret --help`
   on msb) and delete the `CF_HOME` directory. A token already issued may stay
   valid until it expires; whether it stops at key deletion is untested.

5. **Identity in logs.** Each service key is a separate account, and cloud.gov
   documents that its actions show as `service-account@cloud.gov` in event logs,
   so they are distinguishable from yours. cloud.gov's page does not say that the
   string tells one key from another; do not rely on it to.

**Untested (everything above; named so none is read as verified):**

- `cf auth` with no arguments reading `CF_USERNAME` and `CF_PASSWORD` from the
  environment, and keeping the password off argv that way.
- `CF_HOME` relocating the CLI config as step 2 assumes, leaving your default
  `cf` session unchanged.
- `cf oauth-token` refreshing (or failing cleanly) for a service-account
  session, and how long its token lasts. On msb the token is read once at
  sandbox creation (as for the other path), so a short-lived token needs a
  re-bind and a new sandbox.
- The sbx `--command` source working with an `env CF_HOME=...` prefix (and
  how sbx splits that string), or with a wrapper script.
- A per-sandbox binding (`--sandbox <name>` on sbx, a sandbox-named secret on msb)
  being settable before that sandbox exists; if not, bind after creating it and
  update the sandbox as the Prerequisites authority paragraph describes.
- Whether a `space-auditor` token is accepted by the `/v3/organizations` probe
  in `scripts/verify` step 8; a rejection could be role scope, not injection.
- That a token already issued stops working when the key is deleted.
- That the cloud.gov page is still current, and that `cf service-key` prints
  what step 1 says.

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

The live run names its sandbox `cloud-gov-verify-<pid>-<random>` and removes only
a sandbox whose `acq create` this invocation completed successfully. The offline
default never calls `acq`. If `acq create` fails or is interrupted, `verify`
removes nothing, because it cannot tell a half-built sandbox of its own from one
it has no claim to; it prints the name so you can check `acq ls` and remove it
yourself.
