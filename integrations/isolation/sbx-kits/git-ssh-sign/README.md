# git-ssh-sign (sbx mixin kit)

An [sbx](https://docs.docker.com/ai/sandboxes/) **mixin kit** that configures
git inside the sandbox to sign commits and tags using the SSH key forwarded from
your host's SSH agent. Works with any base agent kit (OpenCode, Claude, Codex, …).

Your **private key never leaves the host** — the sandbox forwards the SSH agent,
and signing resolves the public key from that agent at signing time.

> Vendored from [docker/sbx-kits-contrib](https://github.com/docker/sbx-kits-contrib/tree/main/git-ssh-sign)
> (Apache-2.0; see [`NOTICE`](NOTICE) and [`LICENSE`](LICENSE)) and ported to the
> sbx v2 spec. See [`docs/decisions/`](docs/decisions/) and the public-source
> [intake record](docs/security-skill-intake.md).

## Prerequisites

On the **host**, load your signing key into the SSH agent before starting the
sandbox:

```console
ssh-add ~/.ssh/id_ed25519
```

If no key is loaded, git signing fails **with a clear error** — commits are
refused rather than silently unsigned (fail-closed). Verify inside the sandbox:

```console
$ ssh-add -L
ssh-ed25519 AAAA... you@example.com
```

## Usage

```console
sbx run <agent> --kit "<this-kit-ref>" ~/my-project
```

The kit is a `mixin`, so it composes with other kits via additional `--kit`
flags.

## Verifying

```console
$ git log --show-signature -1
Good "git" signature for you@example.com with ED25519 key SHA256:...
```

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) if signing fails.

## How it works

Git signing needs two things when it signs a commit: the signing *config* (what
format, how to find a key) and the *key material* from the forwarded agent.

- **Config — written at install time to the system gitconfig.** The install
  command sets `gpg.format ssh`, `commit.gpgSign true`, `tag.gpgSign true`,
  `gpg.ssh.defaultKeyCommand`, and `gpg.ssh.allowedSignersFile`. System config is
  read at git startup and is never overwritten by the sandbox, so it's always
  present when `git commit` begins.
- **Key material — resolved at signing time.** `gpg.ssh.defaultKeyCommand` points
  at `~/.config/git/ssh-signing-key-command`, which reads the first public key
  from `ssh-add -L`, writes `allowed_signers` for verification, and prints the
  key in git's inline `key::…` format. Nothing is written at create/startup time,
  when the forwarded agent may not be connected yet.

The kit does **not** set `core.hooksPath` or install a pre-commit hook, so
project-level hooks and hook managers run independently of commit signing.

## Verifying the kit

Run the bundled host-side check (needs `sbx` and a key in your SSH agent):

```console
./scripts/verify
```

It validates the spec, creates a throwaway sandbox with the kit, and confirms
the system signing config is in place and the key command resolves. `KEEP=1`
keeps the sandbox for inspection.
