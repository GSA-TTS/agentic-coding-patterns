# zscaler-ca-certificate (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that makes a sandbox trust the public **Zscaler Root CA**. With it, agents,
SDKs, and CLIs inside the sandbox trust TLS certificates signed by a Zscaler
HTTPS-inspecting proxy — so outbound HTTPS works on networks where Zscaler
intercepts and re-signs TLS traffic.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend (`msb` — the
> default — and `sbx` today; `ppp` later). It replaces the former `sbx-kits/zscaler-ca-certificate/`
> sbx-only spec. See [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

On backends without a native host-CA-trust primitive, the kit ships the
certificate as a `files/` payload and installs it at sandbox start with
`update-ca-certificates`. It downloads nothing and needs no network egress.

## Backend parity

This kit is the **showcase** for `backend_shortcuts`: two backends reach the same
end state (the guest trusts the Zscaler CA) by different mechanisms.

| Backend | Mechanism |
|---------|-----------|
| **msb** | Native `--trust-host-cas` — propagates the host's already-trusted CAs (including the org's Zscaler CA) into the guest at boot. The adapter takes this shortcut and **ignores** the kit's `files`/`commands`. |
| **sbx** (and ppp later) | The file-drop path: stage the embedded PEM in the agent home, then move it into the system CA dir and run `update-ca-certificates` as root at startup. |

**Behavioral parity:** the guest ends up trusting the Zscaler CA either way. The
`msb` shortcut is declared in `spec.yaml` as `backend_shortcuts.msb.trust_host_cas: true`.

## Usage

```bash
acq run opencode /path/to/project        # acq applies the pinned kits, incl. this one
```

The kit is a `mixin`, so it composes with the other acq-kits.

## Prerequisites

None. The certificate is bundled in the kit (`files/home/zscaler-ca.crt`), so
there is no secret to set and no egress to allow-list.

## What it does (file-drop path)

1. Ships the PEM-encoded Zscaler Root CA at `files/home/zscaler-ca.crt` and, via
   the `initFiles` phase, stages it at sandbox start in the agent home
   (`/home/agent/zscaler-ca.crt`).
2. In the `startup` phase (as root) moves it to
   `/usr/local/share/ca-certificates/zscaler-ca.crt` and runs
   `update-ca-certificates` to rebuild the system trust bundle. Tools that read
   the system bundle then trust the proxy's certificates with no further
   configuration.

On `msb`, steps 1–2 are skipped in favor of `--trust-host-cas` (see
[backend parity](#backend-parity)).

## Why initFiles + startup, not files + install

The [Docker "Install an internal CA certificate" example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
copies the cert in a `commands.install` step, which on the `opencode-docker` base
runs **before** sandbox setup lays down `files/` and creates
`/usr/local/share/ca-certificates/` — so at install time neither the source cert
nor the destination dir exists, and `sbx create` fails. And `initFiles` run as
the agent user (uid 1000), which can't write the root-owned system CA dir. So the
kit stages the cert in the writable agent home at the `initFiles` phase, then a
root `startup` step moves it into the system dir. Full analysis:
[`docs/decisions/initfiles-startup-instead-of-files-install.md`](docs/decisions/initfiles-startup-instead-of-files-install.md).

> The neutral spec keeps the cert as a `files/` payload (`files/home/zscaler-ca.crt`)
> assigned the `initFiles` phase, rather than inline in the spec — the schema's
> `phase` hint preserves the exact create-time ordering the sbx kit relied on.

## About the certificate

This is the well-known **shared** Zscaler Root CA used by many Zscaler customer
organizations — it is not specific to one tenant, and as a root CA it is public.

| Field | Value |
|-------|-------|
| Subject / Issuer | `CN=Zscaler Root CA, O=Zscaler Inc., C=US` (self-signed) |
| SHA-256 fingerprint | `04:F6:1F:1D:13:AA:E1:D1:65:73:DC:2C:37:F7:96:FD:F4:AC:97:71:3A:69:59:EB:B1:1D:24:73:95:8B:1A:53` |
| Valid | 2014-12-19 → 2042-05-06 |

To replace it with a different (e.g. tenant-specific) Zscaler root, replace
`files/home/zscaler-ca.crt`. It MUST be PEM (`-----BEGIN CERTIFICATE-----`). To
convert a DER `.cer` to PEM first:

```bash
openssl x509 -inform DER -in zscaler.cer -outform PEM
```

If traffic can be signed by more than one internal proxy, add a `files` entry per
proxy CA (each a distinct `.crt` path); the single `startup`
`update-ca-certificates` call picks up all of them.

## Verifying

```bash
./scripts/verify     # end-to-end: create a sandbox and assert trust
```

`scripts/verify` creates a throwaway sandbox, confirms the cert landed, checks
its SHA-256 fingerprint matches the shipped cert, and confirms
`update-ca-certificates` wired it into `/etc/ssl/certs`. Set `KEEP=1` to leave
the sandbox up for inspection. (This is the sbx-path check; on `msb` the trust is
established by `--trust-host-cas`, verified in Part B's `scripts/verify-backends`.)

## Security note

A root CA certificate is **public** — it carries only a public key and issuer
identity, no private key — so committing it is safe. Installing it makes the
sandbox **trust** certificates the Zscaler proxy issues, which is what lets the
proxy decrypt and inspect the sandbox's HTTPS traffic. That TLS interception is
the intended behavior of a Zscaler-managed network, not a leak introduced by
this kit. Only apply this kit in environments where Zscaler inspection is
expected.

## Failure behavior

The `startup` command replays on every sandbox start and is idempotent. Unlike an
install-phase command, startup does not gate the agent entrypoint, so a failure
there is logged but doesn't abort the sandbox. `scripts/verify` asserts the end
state to catch regressions. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) and
[`docs/decisions/initfiles-startup-instead-of-files-install.md`](docs/decisions/initfiles-startup-instead-of-files-install.md).
