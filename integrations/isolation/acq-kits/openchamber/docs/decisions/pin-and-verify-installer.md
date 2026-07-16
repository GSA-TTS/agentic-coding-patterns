# Decision: pin and verify the OpenChamber installer (not `curl main | bash`)

**Status:** accepted

## Context

The first-boot install (see `install-at-startup.md`) fetches OpenChamber's
`install.sh` and runs it. The original implementation did:

```sh
curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash  # anti-pattern: USH001
```

Two problems with that, both flagged in review of PR #220:

1. **Unpinned `main`.** The whole sbx-kit model in this repo is SHA-pinning —
   the sibling `playbook-kit` clones a pinned tag *and* verifies the checked-out
   commit equals a pinned SHA before trusting the content. Fetching an installer
   from `main` on **every boot** breaks that posture: a compromised or
   accidentally-broken upstream `main` would run with the agent's full sandbox
   capabilities at every start.
2. **No integrity check + a MITM-inspected path.** The sibling
   `zscaler-ca-certificate` kit has the sandbox trust an inspecting proxy that
   sits on the fetch path. So even pinning to a tag is not sufficient on its own:
   a tag is a *mutable* ref, and the connection is inspected. The bytes that get
   piped to a shell must be verified.

The sandbox is still the security boundary (ephemeral container, proxied
allow-listed egress, no host FS), and the install is non-fatal (`|| true`, UI
degrades to "unavailable"). But "the sandbox contains it" is not a reason to run
unverified remote code every boot when a cheap pin closes the hole.

## Decision

**Fetch the installer from a pinned release tag and SHA-256-verify it before
running it.** The startup script:

1. `curl`s `install.sh` from `.../openchamber/openchamber/$OPENCHAMBER_REF/...`
   (a pinned tag, e.g. `v1.9.10`) to a temp file — never `main`.
2. Computes its SHA-256 and compares against `OPENCHAMBER_INSTALL_SHA256`.
3. Runs `bash <file>` **only on match**; on mismatch it logs and skips the
   install (UI unavailable, sandbox healthy) rather than piping unverified bytes
   to a shell.

Both pins live in the startup command's environment (with matching fallback
defaults in `files/home/openchamber-start.sh`) and are bumped together to adopt a
newer release.

## Why content SHA-256, not a git commit SHA

`agentic-coding-playbook` clones a git repo, so it can verify a commit SHA. This
kit fetches a single raw file over HTTP, so the meaningful integrity anchor is
the SHA-256 of the exact bytes piped to bash. Re-pin the hash whenever
`OPENCHAMBER_REF` changes:

```sh
curl -fsSL "https://raw.githubusercontent.com/openchamber/openchamber/<ref>/scripts/install.sh" | sha256sum
```

## Consequences

- Upstream can no longer change what runs at boot without the pin being bumped
  here (a reviewable diff), matching the repo's SHA-pin posture.
- Adopting a new OpenChamber release is a two-value edit (`OPENCHAMBER_REF` +
  `OPENCHAMBER_INSTALL_SHA256`); forgetting the hash fails closed (install
  skipped), not open.
- This pins the **installer script** only. The packages it then installs from
  npm are still resolved at install time; tightening that (lockfile / pinned
  `@openchamber/web` version) is possible future hardening, tracked separately.

## Links

- PR #220 review — requested pinning the installer per the repo's SHA-pin model.
- `../../agentic-coding-playbook/files/home/playbook-clone.sh` — the sibling
  SHA-pin precedent (tag + commit SHA over a clone).
- `install-at-startup.md` — why the install runs at startup at all.
