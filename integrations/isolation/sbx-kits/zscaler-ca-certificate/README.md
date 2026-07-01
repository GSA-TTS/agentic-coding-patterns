# zscaler-ca-certificate (sbx mixin kit)

An [sbx](https://docs.docker.com/ai/sandboxes/) **mixin kit** that installs the
public **Zscaler Root CA** into a sandbox's system trust store. With it, agents,
SDKs, and CLIs inside the sandbox trust TLS certificates signed by a Zscaler
HTTPS-inspecting proxy — so outbound HTTPS works on networks where Zscaler
intercepts and re-signs TLS traffic.

The kit embeds the certificate inline in its `spec.yaml` and installs it at
sandbox start with `update-ca-certificates`. It downloads nothing and needs no
network egress.

It's adapted from the
[Docker "Install an internal CA certificate" kit example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate),
but it does **not** use that example's `files/` + `commands.install` approach —
that fails on the `opencode-docker` base. See
[Why this differs from the Docker example](#why-this-differs-from-the-docker-example).

## Usage

```bash
sbx run --kit <path-to-this-kit> <agent> /path/to/project
```

The kit is a `mixin`, so it composes with other kits — apply it alongside an
agent/provider kit with additional `--kit` flags:

```bash
sbx run \
  --kit <path-to>/zscaler-ca-certificate \
  --kit <path-to>/usai-provider-kit \
  opencode /path/to/project
```

## Prerequisites

None beyond `sbx` (>= 0.34.0). The certificate is bundled in the kit, so there
is no secret to set and no egress to allow-list.

## What it does

1. Embeds the PEM-encoded Zscaler Root CA inline in `spec.yaml` and, via
   `commands.initFiles`, stages it at sandbox start in the agent home
   (`/home/agent/zscaler-ca.crt`).
2. In `commands.startup` (as root) moves it to
   `/usr/local/share/ca-certificates/zscaler-ca.crt` and runs
   `update-ca-certificates` to rebuild the system trust bundle. Tools that read
   the system bundle then trust the proxy's certificates with no further
   configuration.

## Why this differs from the Docker example

The [Docker "Install an internal CA certificate" example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
ships the cert under `files/home/` and copies it in a `commands.install` step:

```yaml
# Docker docs example — FAILS on the opencode-docker base
commands:
  install:
    - command: "install -m 0644 /home/agent/internal-ca.crt /usr/local/share/ca-certificates/internal-ca.crt && update-ca-certificates"
      user: "0"
```

On the `opencode-docker` base this fails `sbx create` with:

```
commands.install[0] (... && update-ca-certificates): exited 1
install: No such file or directory
```

`commands.install` runs **before** sandbox setup lays down the `files/` payload
and creates `/usr/local/share/ca-certificates/`, so at install time **neither
the source cert nor the destination directory exists**. (Adding `install -D`
doesn't help — that only fixes the missing destination, not the missing
source.)

This kit avoids the ordering trap by embedding the cert inline and writing it
with `commands.initFiles`, which run *after* setup. One more wrinkle: initFiles
run as the agent user (uid 1000), which can't write the root-owned
`/usr/local/share/ca-certificates/` (that fails with `Permission denied`). So
initFiles stages the cert in the writable agent home, and a root
`commands.startup` step moves it into the system dir and runs
`update-ca-certificates`. The tooling already ships in the base, so no packages
are installed and no network is needed.

Full analysis:
[`docs/decisions/initfiles-startup-instead-of-files-install.md`](docs/decisions/initfiles-startup-instead-of-files-install.md).

## About the certificate

This is the well-known **shared** Zscaler Root CA used by many Zscaler customer
organizations — it is not specific to one tenant, and as a root CA it is public.

| Field | Value |
|-------|-------|
| Subject / Issuer | `CN=Zscaler Root CA, O=Zscaler Inc., C=US` (self-signed) |
| SHA-256 fingerprint | `04:F6:1F:1D:13:AA:E1:D1:65:73:DC:2C:37:F7:96:FD:F4:AC:97:71:3A:69:59:EB:B1:1D:24:73:95:8B:1A:53` |
| Valid | 2014-12-19 → 2042-05-06 |

If you need to replace it with a different (e.g. tenant-specific) Zscaler root,
replace the PEM block in the `commands.initFiles` entry in `spec.yaml`. It MUST
be PEM (`-----BEGIN CERTIFICATE-----`). To convert a DER `.cer` to PEM first:

```bash
openssl x509 -inform DER -in zscaler.cer -outform PEM
```

If traffic can be signed by more than one internal proxy, add an `initFiles`
entry per proxy CA (each a distinct `.crt` path); the single `startup`
`update-ca-certificates` call picks up all of them.

## Verifying

```bash
sbx kit validate <path-to-this-kit>   # static spec check
<path-to-this-kit>/scripts/verify     # end-to-end: create a sandbox and assert trust
```

`scripts/verify` creates a throwaway sandbox, confirms the cert landed, checks
its SHA-256 fingerprint matches the cert embedded in `spec.yaml`, and confirms
`update-ca-certificates` wired it into `/etc/ssl/certs`. Set `KEEP=1` to leave
the sandbox up for inspection.

## Security note

A root CA certificate is **public** — it carries only a public key and issuer
identity, no private key — so committing it is safe. Installing it makes the
sandbox **trust** certificates the Zscaler proxy issues, which is what lets the
proxy decrypt and inspect the sandbox's HTTPS traffic. That TLS interception is
the intended behavior of a Zscaler-managed network, not a leak introduced by
this kit. Only apply this kit in environments where Zscaler inspection is
expected.

## Failure behavior

`update-ca-certificates` runs in `commands.startup`, which replays on every
sandbox start and is idempotent. Unlike `commands.install`, startup does not
gate the agent entrypoint, so a failure there is logged but doesn't abort the
sandbox. `scripts/verify` asserts the end state (cert present, fingerprint
matches, trust bundle updated) to catch regressions. See
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) and
[`docs/decisions/initfiles-startup-instead-of-files-install.md`](docs/decisions/initfiles-startup-instead-of-files-install.md).
