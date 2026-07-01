# Troubleshooting — zscaler-ca-certificate kit

These are failure modes specific to the Zscaler CA kit, which writes the public
Zscaler Root CA into the sandbox system trust store at startup. They assume you
applied the kit (`sbx run --kit <kit> <agent> <project>`).

## HTTPS still fails with certificate errors inside the sandbox

**Symptoms:** `curl`, `git`, `pip`, `npm`, etc. report errors like
`SSL certificate problem: unable to get local issuer certificate` or
`self-signed certificate in certificate chain` from inside the sandbox.

**Cause:** the trust store wasn't updated, or the tool isn't reading the system
trust store.

**Fix / diagnose:**

- Confirm the cert landed and is trusted — run `scripts/verify`, or manually:
  ```bash
  sbx exec <sandbox> -- sh -c 'ls -l /usr/local/share/ca-certificates/zscaler-ca.crt'
  sbx exec <sandbox> -- sh -c 'ls -l /etc/ssl/certs | grep -i zscaler'
  ```
- If the cert is missing, `initFiles` didn't write it or `update-ca-certificates`
  didn't run — check the sandbox startup logs.
- If the cert is present and trusted but a specific tool still fails, that tool
  uses its **own** CA bundle, not the system one. Point it at the system bundle:

  | Tool | Setting |
  |------|---------|
  | Node.js | `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` |
  | Python `requests` | `REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt` |
  | Python / OpenSSL | `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` |
  | Git | `git config --global http.sslCAInfo /etc/ssl/certs/ca-certificates.crt` |
  | curl | `CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt` |

  You can set the env vars for every shell via `/etc/sandbox-persistent.sh` (see
  the [shell-customization kit example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#customize-the-shell-environment)).

## Trust store wasn't updated

**Symptoms:** the cert is at `/usr/local/share/ca-certificates/zscaler-ca.crt`
but there's no matching entry under `/etc/ssl/certs`.

**Cause:** the `commands.startup` `update-ca-certificates` step didn't run or
errored.

**Fix:**

- **`update-ca-certificates: command not found`** — the base image isn't
  Debian/Ubuntu-based (the command ships in the `ca-certificates` package). Use
  this kit on a Debian-family base, or add an install step for `ca-certificates`
  (which would also require allow-listing the apt mirrors via `caps.network`).
- Startup runs as `user: "0"` so permissions shouldn't be the issue; confirm
  that hasn't been changed in `spec.yaml`.
- Check the sandbox startup logs for the `update-ca-certificates` output. Startup
  replays on restart, so a stop/start re-runs it.

## "skipping, it does not contain exactly one certificate or CRL"

**Symptoms:** `update-ca-certificates` warns and ignores `zscaler-ca.crt`.

**Cause:** the embedded cert isn't a single PEM-encoded certificate.
`update-ca-certificates` requires PEM (`-----BEGIN CERTIFICATE-----`), not DER,
and one cert per `.crt` file.

**Fix:** ensure the `commands.initFiles` `content` block in `spec.yaml` is PEM.
Convert a DER `.cer` before pasting it in:

```bash
openssl x509 -inform DER -in zscaler.cer -outform PEM
```

## Trusting the wrong / an unexpected certificate

**Symptoms:** you want to confirm the sandbox trusts exactly the intended root.

**Fix:** compare fingerprints. The embedded cert's SHA-256 should be
`04:F6:1F:...:8B:1A:53` (the shared Zscaler Root CA). Check inside the sandbox:

```bash
sbx exec <sandbox> -- openssl x509 \
  -in /usr/local/share/ca-certificates/zscaler-ca.crt -noout -fingerprint -sha256
```

If it differs, the PEM in `spec.yaml`'s `commands.initFiles` was replaced —
confirm that was intentional (e.g. a tenant-specific root).
