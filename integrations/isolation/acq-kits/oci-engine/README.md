# oci-engine — rootless OCI container engine (podman) for acq sandboxes

A neutral, **opt-in** acq mixin kit (`schemaVersion: "hybrid/v1"`, `kind: mixin`,
`name: oci-engine`) that gives an agent a working OCI container engine inside the
sandbox, so it can run OCI images (`docker run`, `docker build`,
`docker compose`).

## What it installs

At sandbox **create time** (the `install` phase, run once as root) it:

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

On **every start** (the `startup` phase, run as root) it group-scopes
`/dev/net/tun` and `/dev/fuse` to the agent (`root:agent`, `0660`) so rootless
podman networking and the fuse-overlayfs storage mount work. `/dev` is a devtmpfs
re-created each boot, so this must re-run on restart, not just at create.

Every step is **idempotent** and **best-effort**: a missing package mirror or an
unsupported base image produces a clear warning and leaves provision to continue
(OCI is simply unavailable) rather than aborting the sandbox.

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

This kit declares **no `caps.network.allow`**. The install pulls packages from
the OS package **mirror**, whose host depends on the base distro. Under acq's
default **balanced** egress tier (isolation ADR-0002; see
`integrations/isolation/network-tiers/balanced.yaml`) the OS-package-mirror hosts
are already in the curated `core` baseline, so no kit-level egress is needed for
the common case — and hardcoding one distro's mirror host would be wrong for the
others. With `ACQ_NETWORK_TIER=strict` (kit hosts only) or a narrowed base, the
mirror is unreachable and the install fails soft; the operator then widens egress
or bakes the packages into the base image.

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

`scripts/verify` creates a throwaway sandbox with this kit applied and confirms
rootless podman actually works (a real `podman build` from `scratch` as the
agent, plus that the `docker` -> `podman` wrapper resolves). It needs a
sandbox-capable host (`sbx` installed and logged in) and is **skipped in CI**
(CI cannot nest sandboxes), exactly like the `zscaler-ca-certificate` kit's
verify. It cleans up the temporary sandbox on exit/interrupt; set `KEEP=1` to
retain it for inspection.

```sh
integrations/isolation/acq-kits/oci-engine/scripts/verify
KEEP=1 integrations/isolation/acq-kits/oci-engine/scripts/verify   # keep the sandbox
```

The backend-agnostic gate (schema + cross-field rules) is
`integrations/isolation/acq-kits/validate-kits.py` (`make validate-kits`).
