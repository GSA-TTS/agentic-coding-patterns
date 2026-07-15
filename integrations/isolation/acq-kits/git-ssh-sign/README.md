# git-ssh-sign (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that configures git inside the sandbox to sign commits and tags using the
SSH key forwarded from your host's SSH agent. Works with any base agent kit
(OpenCode, Claude, Codex, …).

Your **private key never leaves the host** — the sandbox forwards the SSH agent,
and signing resolves the public key from that agent at signing time.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend (`sbx` today; `msb`
> from Phase 2). It replaces the former `sbx-kits/git-ssh-sign/` sbx-only spec.
> See [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

> Vendored from [docker/sbx-kits-contrib](https://github.com/docker/sbx-kits-contrib/tree/main/git-ssh-sign)
> (Apache-2.0; see [`NOTICE`](NOTICE) and [`LICENSE`](LICENSE)), ported to the
> sbx v2 spec and then to the neutral `hybrid/v1` spec. See
> [`docs/decisions/`](docs/decisions/) and the public-source
> [intake record](docs/security-skill-intake.md).

## Backend parity

The config half (system gitconfig) and the key-resolution script are identical
across backends. The only per-backend difference is **how the host SSH agent is
forwarded into the guest** — SSH-agent forwarding is the shared mechanism, with
no spec shortcut:

| Backend | SSH-agent forwarding |
|---------|----------------------|
| **sbx** | The SSH agent socket is forwarded into the sandbox. |
| **msb** | `msb ssh authorize` registers the key with the sandbox's host-controlled sshd; attach forwards the agent. |
| **ppp** (later) | `podman machine ssh -A` propagates `SSH_AUTH_SOCK`. |

**Behavioral parity:** git signs commits/tags with the forwarded host key on
every backend; the private key never enters the guest.

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
acq run opencode ~/my-project        # acq applies the pinned kits, incl. this one
```

The kit is a `mixin`, so it composes with the other acq-kits.

## Verifying signatures

```console
$ git log --show-signature -1
Good "git" signature for you@example.com with ED25519 key SHA256:...
```

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) if signing fails.

## How it works

Git signing needs two things when it signs a commit: the signing *config* (what
format, how to find a key) and the *key material* from the forwarded agent.

- **Config — written at the `install` phase to the system gitconfig.** The
  install command sets `gpg.format ssh`, `commit.gpgSign true`,
  `tag.gpgSign true`, `gpg.ssh.defaultKeyCommand`, and
  `gpg.ssh.allowedSignersFile`. System config is read at git startup and is never
  overwritten by the sandbox, so it's always present when `git commit` begins.
- **Key material — resolved at signing time.** `gpg.ssh.defaultKeyCommand` points
  at `~/.config/git/ssh-signing-key-command` (shipped as a `files/` payload at
  the `initFiles` phase), which reads the first public key from `ssh-add -L`,
  writes `allowed_signers` for verification, and prints the key in git's inline
  `key::…` format. Nothing is written at create/startup time, when the forwarded
  agent may not be connected yet.

The kit does **not** set `core.hooksPath` or install a pre-commit hook, so
project-level hooks and hook managers run independently of commit signing.

## Verifying the kit

Run the bundled host-side check (needs a backend CLI and a key in your SSH
agent):

```console
./scripts/verify
```

It validates the spec, creates a throwaway sandbox with the kit, and confirms
the system signing config is in place and the key command resolves. `KEEP=1`
keeps the sandbox for inspection.
