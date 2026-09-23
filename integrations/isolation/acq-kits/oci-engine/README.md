# oci-engine — rootless OCI container engine (podman) for acq sandboxes

A neutral, **opt-in** acq mixin kit (`schemaVersion: "hybrid/v1"`, `kind: mixin`,
`name: oci-engine`) that gives an agent a working OCI container engine inside the
sandbox, so it can run OCI images (`docker run`, `docker build`,
`docker compose`).

## What it installs

At sandbox **create time** (the `install` phase, run once as root) it:

- **Early-out on a base that already works.** If the base image already provides
  a **functional** container engine (a clean `docker info`), the kit leaves it
  alone and does nothing — it will not layer podman on top or shadow a working
  `docker`. It probes `docker info`, not merely the presence of a `docker`
  binary: many bases ship a docker CLI whose daemon socket is dead in the sandbox
  (the exact case this kit exists to fix), and only a working engine short-circuits.
- Installs **podman** and the rootless prerequisites (`podman-compose`,
  `fuse-overlayfs`, `uidmap`, `passt`, `slirp4netns`) via the base image's
  package manager (apt / dnf / apk, auto-detected).
- Writes `/etc/containers/storage.conf` selecting a storage driver that works on
  the sandbox's **overlay root** filesystem: `overlay` +
  `mount_program=fuse-overlayfs` when `fuse-overlayfs` and `/dev/fuse` are
  available (fast, thin on disk), otherwise a `vfs` fallback (works everywhere,
  no `/dev/fuse`, but disk-heavy).
- Writes a **Docker-Hub-first** registry config
  (`/etc/containers/registries.conf.d/00-acq-docker-first.conf` +
  `01-acq-shortnames.conf`): unqualified image names resolve to `docker.io`, and
  the podman `hello`/`hello-world` aliases map back to Docker Hub.
- Installs a `docker` -> `podman` wrapper at `/usr/local/bin/docker` (ahead of
  `/usr/bin` on `PATH`), **shadowing** the base image's bundled docker CLI (which
  talks to a dead socket here, since no `dockerd` runs). It never touches the base
  image's `/usr/bin/docker`.

The storage/registry config and the `docker` wrapper are **decoupled from the
package install**: they are applied whenever podman ends up present at that point
— whether this kit installed it or the base already had podman — not only when
the kit ran the package step.

On **every start** (the `startup` phase, run as root) — **only if podman is
installed** — it group-scopes `/dev/net/tun` and `/dev/fuse` to the agent
(`root:agent`, `0660`) so rootless podman networking and the fuse-overlayfs
storage mount work, and it **re-evaluates the system storage driver**. `/dev` is a
devtmpfs re-created each boot, so both must re-run on restart, not just at create;
re-evaluating the driver each boot lets it **converge from `vfs` to `overlay`**
once `fuse-overlayfs` and `/dev/fuse` are both available (a transient `/dev/fuse`
miss at create is not permanently baked in). If podman is absent (install fell
soft, or the base had its own engine and the kit early-outed) this step does
nothing — it never widens device access for an engine that does not exist.

Also on **every start** (a second `startup` step, run as the **agent**) it runs a
rootless self-test — a real `podman build` FROM scratch, which opens `/dev/fuse`
and mounts a layer (stronger than `podman info`, which does not). The build is
bounded by `timeout` (`OCI_ENGINE_SELFTEST_TIMEOUT`, default 120s) so a wedged
mount cannot hang the boot. If it fails, it writes a **user-level
`~/.config/containers/storage.conf`** selecting the `vfs` driver and retries. This
is the documented recovery for a base whose overlay+fuse-overlayfs combo is
rejected under rootless (where `podman info` passes but a layer mount fails). It
is idempotent (only writes on a failed build when no user driver is already set)
and fails soft (a failed self-test never aborts the boot).

Every step is **idempotent** and **best-effort**: a missing package mirror or an
unsupported base image produces a clear warning and leaves provision to continue
(OCI is simply unavailable) rather than aborting the sandbox. In particular the
`install` step **exits 0 even when the package install fails** — a non-zero
`install`-phase exit would fail `sbx create` (a dead sandbox), the opposite of
the promised fail-soft behavior, so the package-manager step is caught and falls
through to a single warn-and-exit-0 re-check. So that a fail-soft miss is not
*silent*, a genuinely-configured sandbox records a **success marker** at
`/var/lib/acq/oci-engine-ready` (`state=configured`, or `state=base-engine` for
the functional-engine early-out); the fail-soft paths deliberately do not write
it, so an operator, CI, or `scripts/verify` can tell a provisioned sandbox from
one where OCI setup fell soft. See `docs/decisions/`.

## Rootless / security posture (ADR-0020)

This kit reproduces the design of the isolation **ADR-0020 ("rootless podman OCI
engine")** decision, declaratively:

- **Rootless.** The engine runs as the **agent user, never root**. Only the
  install/config step and the device-node grant need root; the containers
  themselves are unprivileged (defense-in-depth, aligned container/host UIDs).
- **No docker-in-docker daemon.** podman is daemonless — it forks `runc`/`crun`
  per invocation. There is no Docker socket and no supervisor process to start or
  keep alive across restarts.
- **Explicit, minimal device handling.** Exactly two device nodes are exposed,
  and they are **group-scoped `0660` to the agent** — not world-writable
  (`0666`). No new host attack surface is opened: this is all inside the sandbox,
  which is itself the security boundary.
- **Least-privilege registry resolution.** `short-name-mode` defaults to
  **`enforcing`**, not `permissive`. Because there is a single search registry
  (`docker.io`), unqualified names still resolve deterministically to Docker Hub
  (migration ergonomics preserved), but an interactively-ambiguous short name
  **fails closed** instead of being silently substituted. This is the
  prompt-injection / image-substitution (typosquatting) defense a federal sandbox
  wants: an injected `docker run <name>` cannot be silently resolved to an
  attacker's image without a fully-qualified name or an explicit alias. An
  operator MAY opt into the weaker `permissive` via `OCI_ENGINE_SHORT_NAME_MODE`,
  which explicitly removes that guardrail.

Nothing in this kit is a secret. podman needs no credentials to run rootless.

## Network egress

Two distinct egress needs, handled differently on purpose:

- **Container registry (declared).** The kit's *purpose* — pulling images at
  runtime (`docker run` / `docker compose`) — needs Docker Hub, which is *not*
  distro-dependent. The kit declares the Docker Hub hosts explicitly in
  `caps.network.allow` (`registry-1.docker.io`, `auth.docker.io`,
  `index.docker.io`, and the `production.cloudflare.docker.com` /
  `production.cloudfront.docker.com` blob CDNs), so pulls work even on a `strict`
  tier that carries no baseline. deny-by-default is preserved (it is an
  allow-list).
- **OS package mirror (left to the baseline).** The create-time install pulls
  podman from the distro package mirror, whose host *is* distro-dependent
  (`archive/ports/security.ubuntu.com`, `*.debian.org`,
  `dl-cdn.alpinelinux.org`, …). Under acq's default **balanced** tier (isolation
  ADR-0002; see `integrations/isolation/network-tiers/balanced.yaml`) those hosts
  are already in the curated `core` baseline, so hardcoding one distro's mirror
  here would be wrong for the others and redundant. With `ACQ_NETWORK_TIER=strict`
  or a narrowed base the mirror is unreachable and the install fails soft
  (recorded by the absence of the success marker); the operator then widens
  egress or bakes podman into the base image.

## Opt-in

This capability is **off by default**. Per **ADR-0030** the OCI-engine
provisioning was moved out of the msb backend adapter into this neutral kit so it
is a deliberate, auditable opt-in rather than always-on behavior. acq selects
this kit only when the operator sets **`ACQ_ENABLE_OCI_KIT`** on the quickstart
side, which fetches and validates this kit at the pinned patterns ref (requiring
exactly `schemaVersion: "hybrid/v1"`, `kind: mixin`, `name: oci-engine`).

## Backend parity

Written entirely in the neutral hybrid/v1 vocabulary (`caps` / `files` /
`commands` / `environment`) with **no backend shortcut or extras**. Neither `sbx`
nor `msb` has a native primitive for "provide a rootless container engine", so
both apply the identical file-drop + install + device-grant sequence through
acq's kit translation. Behavioral parity: the guest ends up with a working
rootless podman (and `docker` aliased to it) either way.

## Verifying (host-side live check)

`scripts/verify` creates a throwaway **msb** sandbox with this kit applied
**through acq** (`acq --backend msb create shell … --kit …`) and confirms rootless
podman actually works: podman reports `rootless=true`, a real `podman build` from
`scratch` mounts a layer as the agent, and the `docker` -> `podman` wrapper this
kit drops resolves and routes to podman.

msb-only, on purpose: msb is acq's default backend and (per ADR-0020) the backend
that demonstrates the OCI-engine behavior; sbx has its own base-image selection
logic that is out of scope here.

The check disables the msb adapter's **legacy OCI auto-install**
(`ACQ_MSB_ENSURE_OCI=0`) for its run. That auto-install is the pre-kit path
ADR-0030 is retiring; leaving it on would install podman regardless of whether
this kit did, masking a broken kit with a false pass. With it off, podman — and
especially the `docker` wrapper at `/usr/local/bin/docker` — is attributable to
this kit. Once the adapter's auto-install is removed, that setting becomes a
harmless no-op and this script is the standing regression test that the kit still
provisions podman on its own.

For the same attribution reason it pins an **engine-free base image**
(`VERIFY_OCI_IMAGE`, default `docker/sandbox-templates:shell`) via acq's
`--image`. Per the Docker sandbox-templates docs, the msb *default* base
(`…:shell-docker`, a `*-docker` variant) runs a full Docker Engine (`dockerd`)
inside the sandbox — so `docker info` succeeds there, the kit correctly
early-outs (it will not shadow a working engine), and no podman is installed:
right behavior, but it proves nothing about this kit. The non-`-docker` `shell`
template ships the Docker *CLI* but no engine (a dead socket) — the exact case
this kit fixes, which does not early-out — so on it the kit is the only thing
that can produce a working rootless podman. It installs podman from the OS
package mirror at create, so the base must reach that mirror under the active
egress tier (the balanced baseline, ADR-0002, allows the common Debian/Ubuntu
mirrors). Override with `VERIFY_OCI_IMAGE=<engine-free ref>` (do NOT use a
`*-docker` variant — its live engine would trigger the early-out).

It needs a sandbox-capable host with `acq` on `PATH` and a ready msb backend
(`msb doctor`), and is **skipped in CI** (CI cannot nest sandboxes), like the
`zscaler-ca-certificate` kit's verify. It cleans up the temporary sandbox on
exit/interrupt; set `KEEP=1` to retain it for inspection.

```sh
integrations/isolation/acq-kits/oci-engine/scripts/verify
KEEP=1 integrations/isolation/acq-kits/oci-engine/scripts/verify   # keep the sandbox
VERIFY_OCI_IMAGE=docker.io/library/ubuntu:24.04 \
  integrations/isolation/acq-kits/oci-engine/scripts/verify        # different base
```

The backend-agnostic gate (schema + cross-field rules) is
`integrations/isolation/acq-kits/validate-kits.py` (`make validate-kits`).
