# Troubleshooting — github-enterprise-kit (template)

Failure modes any copy of this kit inherits. Every command is an `acq` command.
The rules behind these entries live in the pattern doc
(`integrations/isolation/docs/scope-layers.md`); each entry names the section.
Replace `HOST` with your GHES hostname.

## The host is blocked (curl code `000` or `403`)

`acq exec <sandbox> -- curl -sS -o /dev/null -w '%{http_code}\n' https://HOST/`
prints `000` (msb) or `403` (sbx's proxy) when the host is not allowed. The
kit's egress entry is missing, misspelled, or the kit was not applied to this
sandbox. Check the entry, then recreate: egress is fixed at creation on every
backend, and `acq run` alone does not add it.

```bash
acq rm <sandbox> && acq run opencode --kit /path/to/your-copy .
```

Under org governance, org network rules override kit rules; a host that stays
blocked despite the entry must be allowed at the org level.

## TLS errors: `unexpected eof`, or `certificate verify failed`

A GHES host often has a certificate from an internal CA. The guest must trust
that CA, and on msb so must the host-side proxy that rewrites the token
(`ACQ_MSB_UPSTREAM_CA_CERT`, in the quickstart repo's backend guide). This kit
carries no CA; use your organization's CA kit or host trust setup. Do not
disable certificate verification (`http.sslVerify false`).

## `git push` prompts for a username, or fails with `401`/`403`

Work through these in order:

1. **No token in the guest.** `acq exec <sandbox> -- sh -c 'test -n "$GH_ENTERPRISE_TOKEN" && echo set'`.
   If it prints nothing, the secret was not bound. On msb a secret is bound at
   create, and msb cannot add a new secret to a running sandbox. If you stored
   it afterwards, `acq stop <sandbox>` then re-run `acq secret set`, or store
   it first and recreate.
   `acq secret ls -g` shows the service, host, and env (never the value).
2. **Wrong host or env var in `acq secret set`.** The `--host` must equal the
   kit's host, and `--env` must be `GH_ENTERPRISE_TOKEN`: the helper reads that
   name. Set it again with the right flags.
3. **Credential helper not registered.** `acq exec <sandbox> -- git config --global --get-regexp 'credential|url'`
   should list the helper and both `insteadOf` rules. If empty, the startup step
   did not run: look for a "skipping command" warning in the create output (a
   comment after `phase:` or `user:`), and see "Check against your acq" in the
   pattern doc.
4. **The token is rejected by the server.** The placeholder was substituted but
   the real token is expired, revoked, lacks access to the repository, or the
   organization requires SSO authorization for it. Create a new token in the GHES
   web UI and rotate it (below).
5. **Basic-auth substitution not happening (sbx).** Unverified on sbx for a
   custom host. If the token is right and the sandbox is on sbx, this is the
   likely cause; report it and use msb until it is confirmed.

## An SSH remote hangs or is refused

`git@HOST:owner/repo.git` and `ssh://git@HOST/...` are rewritten to HTTPS by the
kit's startup step, but only for the host named in `GHE_HOST`. Check what git
will contact:

```bash
acq exec <sandbox> -- git -C /path/in/guest/to/repo ls-remote --get-url origin
```

If it still prints an SSH URL, the host in the remote differs from `GHE_HOST`
(a different name for the same server), or the step did not run. A remote with
a port, such as `ssh://git@HOST:2222/...`, is deliberately not rewritten: HTTPS
does not use the SSH port, so rewrite it yourself with `git remote set-url`, or
extend the step for the form you use.

## `gh` says it is not logged in, or targets the wrong host

`gh auth status` reports hosts from `gh`'s own config; with the environment
token it can still say you are not logged in to `github.com`, which is expected.
Check `acq exec <sandbox> -- sh -c 'echo $GH_HOST'` (should print your host) and
`acq exec <sandbox> -- gh api user -q .login`. Common causes:

- `GH_HOST` is shadowed: it is last-wins across kits, so a kit applied after this
  one that sets `GH_HOST` replaces it. Check the kits listed after this one.
- `GH_TOKEN` or `GITHUB_TOKEN` is set in the sandbox (for example by the global
  `github` secret). `gh` uses those for `github.com` only; for `GH_HOST` it reads
  `GH_ENTERPRISE_TOKEN`. Do not set `GH_TOKEN` to your enterprise token: it would
  go to `github.com`.
- You are in a repository whose remote points at `github.com`: `gh` then targets
  `github.com`. Use `gh --repo HOST/OWNER/REPO ...` or `GH_REPO=HOST/OWNER/REPO`.

## A `github.com` token went to the wrong host, or the reverse

Each token is bound to exactly one host by its `acq secret set --host` value. A
placeholder sent to a different host is not substituted; msb's proxy fails closed
and drops the connection, and the rest of that agent session breaks (see
"Backend differences" in the pattern doc). Keep the GHES token only under the
`github-enterprise` service and `GH_ENTERPRISE_TOKEN`, and never reuse one token
for both hosts.

## Rotating the token

On msb, re-run `acq secret set -g github-enterprise --host HOST --env GH_ENTERPRISE_TOKEN`
with the new value; it is re-fed to running sandboxes. On sbx, `acq` refuses to
overwrite and prints the `sbx secret rm` command: remove it, then set it again
with the same placeholder. See "Backend differences" in the pattern doc.

## Other failure modes

Kit content missing, create failures from the backend, SSH-fetched global kits,
and startup commands that run nothing despite a passing validate are shared with
every kit: see the `team-kit` template's `TROUBLESHOOTING.md` and "Check against
your acq" in the pattern doc.
