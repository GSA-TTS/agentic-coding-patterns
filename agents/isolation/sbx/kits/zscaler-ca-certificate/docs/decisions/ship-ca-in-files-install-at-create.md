# Decision: Ship the Zscaler CA in `files/` and install it at sandbox creation

**Status:** superseded by
[`initfiles-startup-instead-of-files-install.md`](initfiles-startup-instead-of-files-install.md)

> **Superseded.** This design (`files/` payload + `commands.install`, following
> the Docker docs example) does **not** work on the `opencode-docker` base:
> `commands.install` runs before sandbox setup lays down `files/` and creates
> `/usr/local/share/ca-certificates/`, so the copy fails with
> `install: No such file or directory` and `sbx create` aborts. The kit now
> embeds the cert inline via `commands.initFiles` and runs
> `update-ca-certificates` in `commands.startup`. See the superseding record for
> the full analysis. The original rationale is kept below for context.

## Context

Agents in an sbx sandbox running on a Zscaler-managed network fail TLS
verification on every outbound HTTPS call: Zscaler intercepts the connection and
re-signs it with the Zscaler Root CA, which the sandbox's default trust store
doesn't recognize. The sandbox needs that root CA in its system trust store.

The certificate involved is the **public, shared Zscaler Root CA** — a root CA
cert is public (no private key), and this particular root is the one many
Zscaler customer organizations share, so it is safe to commit to a public repo.

[Docker's kit documentation](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
shows the canonical pattern for exactly this: ship the cert under `files/home/`
and `update-ca-certificates` in an install command. This kit follows it.

## Decision

**Vendor the certificate in the kit's `files/` tree and install it via
`commands.install` at sandbox creation.**

- `files/home/zscaler-ca.crt` — the PEM-encoded Zscaler Root CA. sbx maps
  `files/home/` to `/home/agent/`, so it lands at `/home/agent/zscaler-ca.crt`.
- `commands.install` (as `user: "0"`) copies it into
  `/usr/local/share/ca-certificates/` and runs `update-ca-certificates`.

### Why vendor in `files/` (not download)

The cert is small, public, and static. Shipping it in the kit means the kit is
**self-contained** — it validates and applies with no network access and no
secret. Downloading it would add an egress allow-list (`caps.network`), a point
of failure, and an integrity-verification burden (pin a digest) for no benefit.
Consequently the kit declares **no `caps.network`** at all.

### Why `commands.install`, not `commands.startup`

`install` runs **once**, at create time, and a non-zero exit **fails
`sbx create`**. The trust store only needs writing once, and a sandbox whose
trust update failed is broken for HTTPS — failing loudly at create is the
correct, fail-closed behavior. `startup` would re-run the same write on every
start (wasteful) and is the right tool for things that must reconverge each boot
or degrade gracefully; neither applies here. (Contrast the playbook kit, which
*does* use `startup` precisely because it wants graceful degradation and
self-heal.)

### Why `user: "0"`

Writing `/usr/local/share/ca-certificates/` and running
`update-ca-certificates` require root. The agent otherwise runs as uid 1000;
this single install step is the documented root exception. Nothing the agent
does at runtime needs root.

### Certificate format

`update-ca-certificates` requires PEM-encoded files with a `.crt` extension, one
certificate per file. The bundled cert is PEM. A DER `.cer` source must be
converted (`openssl x509 -inform DER ... -outform PEM`) at authoring time.

### `install -D`, not the docs example's plain `install`

The [Docker docs example](https://docs.docker.com/ai/sandboxes/customize/kit-examples/#install-an-internal-ca-certificate)
uses `install -m 0644 ... /usr/local/share/ca-certificates/...`. On the
`opencode-docker` base that fails with `install: No such file or directory`,
because the kit's `commands.install` runs *before* sandbox setup populates
`/usr/local/share/ca-certificates/`, and GNU `install` won't create a missing
target parent directory. Adding `-D` makes `install` create the parent dir,
which is order- and base-image-independent. We confirmed (by probing a
kit-less `opencode` sandbox) that `update-ca-certificates` and `openssl` already
ship in the base, so no package install — and therefore no `caps.network`
egress — is required; the fix is purely the `-D` flag.

## Considered alternatives

- **Download the cert at install/startup** — rejected: adds egress, a failure
  mode, and digest-pinning overhead to deliver a tiny static public file.
- **`commands.startup` with graceful degradation** — rejected: a missing trust
  root should fail the sandbox, not silently produce one that can't verify TLS.
- **`commands.initFiles`** — rejected: `initFiles` is for content that needs a
  runtime value substituted (e.g. `${WORKDIR}`); a static cert doesn't, so a
  plain `files/` payload is simpler and the documented approach.

## Consequences

- A sandbox with this kit trusts Zscaler-signed TLS; HTTPS works on the
  intercepted network with no per-tool configuration for anything that reads the
  system trust bundle.
- The kit is fully self-contained, portable, and needs no network or secret.
- Tools that maintain their own CA bundle (Node, some Python stacks, Git) still
  need to be pointed at the system bundle — documented in `TROUBLESHOOTING.md`.
- A failed trust-store update fails `sbx create` rather than producing a
  silently-broken sandbox.
