# Decision: Install the CA via `initFiles` + `startup`, not the docs' `files/` + `install`

**Status:** accepted
**Supersedes:** the approach in
[`ship-ca-in-files-install-at-create.md`](ship-ca-in-files-install-at-create.md)

## TL;DR

The [Docker "Install an internal CA certificate" kit example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
ships the certificate under `files/home/` and copies it into the trust store
with a `commands.install` step:

```yaml
# Docker docs example — does NOT work on the opencode-docker base
commands:
  install:
    - command: "install -m 0644 /home/agent/internal-ca.crt /usr/local/share/ca-certificates/internal-ca.crt && update-ca-certificates"
      user: "0"
```

On the `opencode-docker` base this **fails `sbx create`** with:

```
commands.install[0] (install -m 0644 /home/agent/zscaler-ca.crt /usr/local/share/ca-certificates/zscaler-ca.crt && update-ca-certificates): exited 1
install: No such file or directory
```

This kit instead **embeds the PEM inline in `commands.initFiles`** (written
directly to the system CA source dir) and runs `update-ca-certificates` in
**`commands.startup`**. If you hit the error above on another base image, this
is why and this is the fix.

## Context

A kit's lifecycle on sbx (observed on `sbx v0.34.0`,
`docker/sandbox-templates:opencode-docker`) runs phases in this order:

1. `commands.install` — runs **first**, during container creation, as root.
2. base-image sandbox setup — lays down the kit's `files/` payload **and**
   populates `/usr/local/share/ca-certificates/` (and the rest of the
   ca-certificates machinery).
3. `commands.initFiles` — written at sandbox start, **as the agent user
   (uid 1000)**.
4. `commands.startup` — runs at every start, after initFiles. Default user is
   uid 1000, but a step can request `user: "0"`.

The docs example assumes a base where `/usr/local/share/ca-certificates/` and
the source cert already exist by the time `commands.install` runs. On
`opencode-docker` neither is true at phase 1:

- The `files/home/zscaler-ca.crt` payload hasn't been laid down yet, so the
  **source** path doesn't exist.
- `/usr/local/share/ca-certificates/` hasn't been created yet, so the
  **destination** dir doesn't exist either.

GNU `install` reports both as `install: No such file or directory`. We first
tried `install -D` (to create the missing destination parent) — that still
failed, because the *source* (`files/`) also isn't present at phase 1. The
ordering, not the flag, is the problem.

We confirmed by probing a kit-less `opencode` sandbox that the base **does**
ship `update-ca-certificates` and `openssl`, and that
`/usr/local/share/ca-certificates/` and `/etc/ssl/certs/ca-certificates.crt`
exist **after** setup. So no package installation — and no network egress — is
needed; only the timing has to change.

There's a second gotcha that bites the obvious "just write initFiles to the
system dir" fix: **initFiles run as uid 1000**, which cannot write the
root-owned `/usr/local/share/ca-certificates/`. An initFiles entry targeting
that path fails at create with:

```
commands.initFiles[0] (/usr/local/share/ca-certificates/zscaler-ca.crt): exited 2
sh: 1: cannot create /usr/local/share/ca-certificates/zscaler-ca.crt: Permission denied
```

So the cert has to be staged somewhere uid 1000 can write, then moved into the
system dir by a root step.

## Decision

**Don't use `files/` + `commands.install`. Stage the certificate (embedded
inline) in the agent home via `commands.initFiles`, then move it into the system
CA dir and rebuild the trust store in a root `commands.startup` step.**

```yaml
commands:
  initFiles:
    - path: /home/agent/zscaler-ca.crt      # writable by uid 1000
      mode: "0644"
      content: |
        -----BEGIN CERTIFICATE-----
        ...the Zscaler Root CA, PEM...
        -----END CERTIFICATE-----
  startup:
    - command:
        - sh
        - -c
        - |
          set -eu
          install -m 0644 /home/agent/zscaler-ca.crt \
            /usr/local/share/ca-certificates/zscaler-ca.crt
          update-ca-certificates
      user: "0"
```

Why each piece:

- **`initFiles` instead of `files/`** — initFiles are written at sandbox start
  (phase 3), *after* the base populates the CA directory (phase 2). (The `files/`
  payload of the docs example isn't available at phase 1 when `install` runs.)
- **Stage in `/home/agent`, not the system dir** — initFiles run as uid 1000,
  which can't write `/usr/local/share/ca-certificates/`. Writing the cert to the
  writable agent home and moving it with a root startup step avoids the EACCES.
- **Inline `content` instead of a `files/` payload** — keeps the cert and the
  install logic in one declarative place; the kit has no `files/` tree at all.
  The cert is a small, public, static blob, so inlining costs nothing.
- **`install` + `update-ca-certificates` in `startup`, as root** — startup runs
  after initFiles (phase 4) and can request root. Both the move into the system
  dir and `update-ca-certificates` need root. The step is idempotent (`install`
  overwrites the same path; `update-ca-certificates` regenerates the same
  bundle), satisfying sbx's "startup must be idempotent" rule.
- **Still no `caps.network`** — nothing is downloaded; the tooling is in the
  base.

## Consequences

- **Trade-off vs. fail-closed-at-create:** the superseded design failed
  `sbx create` if the trust update couldn't run. This design moves the work to
  startup, which does **not** gate the agent entrypoint — a failed
  `update-ca-certificates` would log but not stop the sandbox. We accept this
  because the previous design didn't actually *work* on the target base, and
  because `update-ca-certificates` failing on a base that ships it is
  unlikely. `scripts/verify` asserts the end state (cert present, fingerprint
  matches, trust bundle updated) to catch regressions.
- The kit directory no longer contains a `files/` tree; the certificate lives
  only in `spec.yaml`. `scripts/verify` extracts the inlined PEM to fingerprint
  it, so it has no separate copy to drift from.
- The cert briefly exists at `/home/agent/zscaler-ca.crt` as well as in the
  system dir. It's a public root CA, so leaving the staged copy in place is
  harmless; we don't bother deleting it.
- The change is documented here and linked from `README.md` and
  `TROUBLESHOOTING.md` so anyone copying the Docker example and hitting the same
  `install: No such file or directory` (or the follow-on `Permission denied`)
  error can find the fix.

## See also

- Docker kit examples — [Install an internal CA certificate](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
- Docker kit spec reference — [Commands (`install`, `startup`, `initFiles`)](https://docs.docker.com/ai/sandboxes/customize/kit-reference/#commands)
