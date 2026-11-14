# github-enterprise-kit (template for a GitHub Enterprise Server host, `hybrid/v1`)

A **template, not a deployable kit**: the starting point for a kit that lets
`git` and `gh` inside an `acq` sandbox authenticate to a GitHub Enterprise
Server (GHES) host. `acq` never applies this directory; you copy it, rename it,
and replace the example host. `hybrid/v1` has no parameters, so a kit cannot
take your hostname as an input. The pattern, the composition rules, the parser
rules to check against your `acq`, and the backend differences are in
`integrations/isolation/docs/scope-layers.md` in
[agentic-coding-patterns](https://github.com/GSA-TTS/agentic-coding-patterns)
(the pattern doc); the placement decision is ADR 0005 beside it, in
`docs/decisions/`.

Why a kit is needed. `acq`'s GitHub support is built for `github.com`: the
first-run token prompt, `acq github-scope`, and the built-in `github` secret
all cover only `github.com` and its API and codeload hosts. A custom GHES host
gets none of that, so push and pull fail in the sandbox. This kit supplies the
three pieces a kit can: egress to the host, git configuration that uses the
injected token, and `GH_HOST` for `gh`. The token itself is never in the kit.

## What is and is not verified

| Claim | Status |
|-------|--------|
| `spec.yaml` is valid `hybrid/v1`; `validate-kits.py --strict` and `acq kit validate` pass | Verified offline. |
| The startup step rewrites `git@HOST:` and `ssh://git@HOST/` remotes to HTTPS, leaves other hosts alone, and is idempotent | Verified offline in a scratch `HOME` (`scripts/verify`, section 4). |
| The credential helper prints `username=x-access-token` and `password=<value of GH_ENTERPRISE_TOKEN>`, expanded when git runs it, and the value is never written to git config | Verified offline (`scripts/verify`, section 4). |
| One GHES hostname serves git, REST (`/api/v3`), and uploads (`/api/uploads`), so one egress entry is enough | From GitHub's GHES documentation, not tested against a live instance. With subdomain isolation enabled, GHES also serves some content from subdomains such as `raw.`, `codeload.`, `uploads.`, and `media.`; `git` over HTTPS and `gh api` calls on the main host do not need them. Add a subdomain to `caps.network.allow` only if a feature you use fails (downloading a release asset or an archive, for example). |
| On msb, the proxy swaps the placeholder into git's `Authorization: Basic` header for the bound host | Documented for `github.com` in the quickstart repo's ADR 0011 and confirmed live there with a private-repo `git ls-remote`. **Not tested against a GHES host.** |
| On sbx, the custom-secret proxy rewrites `Authorization: Basic` for the bound host | **Unverified.** `acq` stores this service through `sbx secret set-custom`, which injects by environment placeholder; whether it rewrites Basic credentials has not been checked. Run the live checks on sbx before relying on it. |
| The sandbox gets the token end to end (`git ls-remote`, `gh api user` against a real GHES host) | **Needs a real host, a real token, and a sandbox.** `scripts/verify` runs these when you opt in (see "Verifying"). Nothing in this repo has run them. |

## Use

1. Copy this directory into a repo your team owns and **rename both the
   directory and `name:` in `spec.yaml`** (kebab-case; keep them equal). Update
   `displayName:` and `description:`.
2. **Replace the host in three places**, all marked `REPLACE`, with the same
   value (`scripts/verify` fails if they differ): the `caps.network.allow`
   entry, `GHE_HOST` in the startup step, and `GH_HOST` under `environment`.
   The shipped value, `ghe.example.org`, is an IANA-reserved example domain.
   Use the hostname only: no scheme, no path, no port.
3. Create a personal access token **in the GHES web UI**. `acq`'s pre-filled
   token link and `acq github-scope` are `github.com` only, so neither helps
   here. Give it the least access that does the job:
   - Prefer a **fine-grained** token limited to the repositories you need, if
     your GHES version and organization policy allow them, with repository
     permissions *Contents* (read and write), *Pull requests* and *Issues* (read
     and write, only if the agent uses them), and *Metadata* (read).
   - Otherwise a **classic** token with the `repo` scope. Add `read:org` only if
     a `gh` command you use needs it.
   - Set an expiry.
4. Store the token on the host, **before the sandbox is created** on msb:

   ```bash
   acq secret set -g github-enterprise --host ghe.example.org --env GH_ENTERPRISE_TOKEN
   ```

   `acq` prompts for the value without echoing it and never takes it on the
   command line. On msb it also reads one line from piped stdin; on sbx a piped
   value is not fed to sbx, so `acq` prints an `sbx secret set-custom` command
   to run yourself instead. `github-enterprise` is just a
   service name for `acq`'s secret store (letters, digits, `_`, `-`); the
   `--host` and `--env` flags are what bind it. Use the same host as in
   `spec.yaml`. Use `acq secret set SANDBOX github-enterprise ...` instead of
   `-g` to limit the token to one sandbox, which is safer than a global token;
   that needs the sandbox name fixed up front (`acq create --name`), and
   `scripts/verify` supports only the global form.
5. Validate, then start a sandbox with the kit:

   ```bash
   acq kit validate /path/to/your-copy
   acq run opencode --kit /path/to/your-copy .
   ```

   or put the path in `ACQ_EXTRA_KITS` (see "Host-side defaults" in the
   pattern doc). Egress is fixed when a sandbox is created, so after changing
   the host, run `acq rm <sandbox>` and create it again.

Inside the sandbox the token is a **placeholder**: `GH_ENTERPRISE_TOKEN` holds
a value that is useless anywhere else. The proxy substitutes the real token in
transit, only for the bound host. Do not run `env` or `printenv` in an agent
session (see "Backend differences" in the pattern doc).

## What it carries

| Extension point | Value | Why |
|-----------------|-------|-----|
| `caps.network.allow` | `ghe.example.org` | The strict and balanced egress tiers deny by default. |
| `commands[]` | One idempotent `startup` step, `user: "1000"` | Rewrites `git@HOST:` and `ssh://git@HOST/` to HTTPS, because SSH remotes do not work through msb's egress, and registers a credential helper that reads `GH_ENTERPRISE_TOKEN` when git runs it. |
| `environment` | `GH_HOST` | Points `gh` at the enterprise host. `gh` reads `GH_ENTERPRISE_TOKEN` for any host other than `github.com`. |

Both SSH forms are values of one `insteadOf` key: `--replace-all` sets the
first and `--add` appends the second, so a re-run never piles up duplicates. The
`ssh://` form ends in a slash so it cannot match a look-alike host, and an
`ssh://` URL with a port is not rewritten. The helper is written inside single quotes so `${GH_ENTERPRISE_TOKEN}` is expanded by
git's shell each time it asks for credentials, not when the step writes the
config.

## What it does not carry, on purpose

- **The token.** Host-side only, through `acq secret set`.
- **A real hostname.** The template ships a reserved example domain.
- **`github.com` routing.** The same recipe for `github.com` belongs in the
  global layer; see "Git over HTTPS" in the pattern doc.
- **Changes to `gh` for github.com.** `GH_HOST` makes the enterprise host `gh`'s
  default for the whole sandbox, so `gh` against `github.com` then needs
  `--repo github.com/OWNER/REPO` or `GH_HOST=github.com` on that command.
- **Several hosts.** One host, one copy. Make a second copy of the kit for a
  second GHES instance, with its own service name, env var, and `GH_HOST`;
  note that `GH_HOST` is last-wins, so only one copy can own it.

## Verifying

```bash
./scripts/verify
```

The offline checks run anywhere with `git` and `sh`, and need no sandbox and no
network. With a real host, a stored secret, and a sandbox-capable machine:

```bash
GHE_VERIFY=1 GHE_HOST=ghe.corp.example GHE_REPO=owner/private-repo ./scripts/verify
```

`GHE_HOST` must equal the host in `spec.yaml`. `GHE_REPO` should be a **private**
repository your token can read: a repository readable without credentials is
reported as SKIP, because it would prove nothing about the token. The live section creates a
throwaway sandbox with the kit applied, then checks `GH_HOST`, that the token
variable is set (it never prints it), the SSH-to-HTTPS rewrite, egress, `git
ls-remote` with only the placeholder, and `gh api user`. Without `GHE_VERIFY=1`
and `GHE_HOST` it prints SKIP, never PASS. Run it on each backend you use;
`ACQ_BACKEND` selects one. Set `GHE_SECRET_SERVICE` if you used a service name
other than `github-enterprise`.

## Backend parity

The kit is declarative only (`caps`, `commands[]`, `environment`), with no
`backend_shortcuts` or `backend_extras`, and `scripts/verify` uses only `acq`
verbs. The backends still differ for this kit:

- **msb** binds a secret to its host at sandbox **create**. Store it before the
  first `acq run`. msb cannot add a new secret to a running sandbox: for an
  existing sandbox, `acq stop` it and re-run `acq secret set` (a stopped sandbox
  accepts the binding), or recreate it. `acq secret set` can rotate an existing
  binding on a running sandbox. SSH remotes do not work, which
  is why the kit rewrites them. Git's `Authorization: Basic` header is rewritten
  by msb's TLS interception (ADR 0011 in the quickstart repo, confirmed for
  `github.com`).
- **sbx** injects a custom secret by placeholder. Whether it rewrites git's
  Basic credentials for a custom host is **unverified**. To rotate, `acq`
  refuses to overwrite an existing secret and prints the `sbx secret rm`
  command; see "Backend differences" in the pattern doc.

## Troubleshooting

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
