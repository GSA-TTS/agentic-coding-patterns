# Troubleshooting — git-ssh-sign kit

Failure modes specific to the git commit-signing kit. Assumes the kit is applied
to a sandbox (`sbx run <agent> --kit <kit> ...`).

## Commits fail with "no SSH agent" / "no keys in SSH agent"

**Symptom:** `git commit` fails; stderr shows
`[git-ssh-sign] no SSH agent - cannot sign commits` or `no keys in SSH agent`.

**Cause:** the sandbox forwards the host's SSH agent, but the host agent has no
key loaded (or the agent isn't running).

**Fix:** on the **host**, load your key, then retry the commit:

```console
ssh-add ~/.ssh/id_ed25519
ssh-add -L        # should now list your key
```

Inside the sandbox, confirm the forwarded agent exposes it:

```console
$ ssh-add -L
ssh-ed25519 AAAA... you@example.com
```

If it's still empty inside the sandbox, the agent isn't loaded on the host or the
sandbox was created before you loaded it — reload on the host and start a fresh
session.

## Commit signing worked but verification shows "No signature"

**Cause:** the commit was created outside this kit's git (e.g. a different tool),
or `commit.gpgSign` was overridden by a repo-local or global config.

**Fix:** confirm the system config is in place:

```console
git config --system --get commit.gpgSign        # true
git config --system --get gpg.format            # ssh
```

A repo-local `commit.gpgsign=false` or `--no-gpg-sign` overrides the system
setting; check `git config --show-origin --get commit.gpgSign`.

## My commit is signed locally but shows "Unverified" on GitHub

**This is not a kit bug** — it's how GitHub decides the "Verified" badge, which
is separate from local signature checks.

GitHub marks an SSH-signed commit **Verified** only when **both** are true:

1. The commit's `user.email` matches an **email verified on your GitHub account**, and
2. The signing key is registered on that account **as a _signing_ key** (Settings
   → SSH and GPG keys → _New SSH key_ → key type **Signing Key**). An
   authentication-only key does not make commits verified.

Note what GitHub does **not** use: the SSH key's _comment/principal_ and this
kit's local `allowed_signers` file are irrelevant to the GitHub badge. So a
mismatch between your committer email and the key comment does not cause
"Unverified" — an unverified account email or an unregistered signing key does.

**Fix:**

- Set `user.email` to an address verified on your GitHub account. Identity
  (`user.email` / `user.name`) belongs to your base agent / provider setup, not
  to this signing mixin — set it there (or globally) so every kit sees it:

  ```console
  git config --global user.email you@verified-on-github.example
  ```

- Add the **public** half of your signing key to GitHub as a **Signing Key**
  (the same key can also be an auth key; add it twice, once per type).

Then make a **new** commit — verification applies going forward.

## Local `git log --show-signature` says the signer is unknown

**Cause:** local verification uses this kit's `allowed_signers` file, which the
signing-key command generates from `git config user.email` at signing time. If
`user.email` was unset when the commit was made, the kit falls back to
`agent@sandbox.local`, so the recorded principal won't match the identity you
expect. `allowed_signers` is **local-only** and has no bearing on GitHub's badge
(see above).

**Fix:** set your identity (in the base/provider setup or globally), then commit
again so the key command regenerates `allowed_signers` from the current email:

```console
git config --global user.email you@example.com
```

## I want to commit without signing

The kit is deliberately fail-closed (signing is expected). To bypass for a single
commit:

```console
git commit --no-gpg-sign ...
```

To disable for a repo, set `git config commit.gpgsign false` in that repo.
