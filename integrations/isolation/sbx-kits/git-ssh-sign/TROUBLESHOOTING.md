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

## The signing email doesn't match my key's identity

**Cause:** `allowed_signers` is generated from `git config user.email`. If that
isn't set, the kit falls back to `agent@sandbox.local`, which won't match your
key's principal for verification.

**Fix:** set your identity (the playbook/provider setup or your own config):

```console
git config --global user.email you@example.com
```

Then make a new commit (the key command regenerates `allowed_signers` from the
current email at signing time).

## I want to commit without signing

The kit is deliberately fail-closed (signing is expected). To bypass for a single
commit:

```console
git commit --no-gpg-sign ...
```

To disable for a repo, set `git config commit.gpgsign false` in that repo.
