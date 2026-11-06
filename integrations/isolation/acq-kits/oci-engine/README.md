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
storage mount work, and it **re-evaluates the system storage driver**. The elevated install and startup scripts, plus the storage helper sourced by
them, run only from a host-authoritative read-only mount (when the consumer honors
`readonly`; a missing mount file is a refusal, not a fallback) or, for a consumer
that ignores `readonly`, from root-owned copies under `/usr/local/lib/acq/oci-engine/`,
never from the agent-home staging files. `/dev` is a devtmpfs
re-created each boot, so both must re-run on restart, not just at create;
re-evaluating the driver each boot lets it **converge from `vfs` to `overlay`**
once `fuse-overlayfs` and `/dev/fuse` are both available (a transient `/dev/fuse`
miss at create is not permanently baked in). If podman is absent (install fell
soft, or the base had its own engine and the kit early-outed) this step
best-effort revokes any stale device grant and exits — it never leaves a fresh
wide grant for an engine that does not exist.

Also on **every start** (a second `startup` step, run as the **agent**) it runs a
rootless self-test — a real `podman build` FROM scratch, which opens `/dev/fuse`
and mounts a layer (stronger than `podman info`, which does not). The build is
bounded by `timeout` (`OCI_ENGINE_SELFTEST_TIMEOUT`, positive integer, default
120s) so a wedged mount cannot hang the boot. If `timeout` is unavailable, the
script skips the self-test/fallback path rather than running an unbounded
boot-path build. If the
bounded self-test fails, it writes a **user-level
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
  (`0666`). The startup script is podman-gated and best-effort reverts stale
  grants if podman disappears. No new host attack surface is opened: this is all
  inside the sandbox, which is itself the security boundary.
- **Trusted elevated code.** Files are staged in the agent home by the neutral
  kit mechanism, but root phases do not execute or source those mutable copies.
  The root command wrappers publish the install script into
  `/usr/local/lib/acq/oci-engine/`; the startup script and sourced helper run from
  the read-only mount when the consumer honors `readonly` (failing closed if the
  file is missing), else from root-owned copies published there for a consumer
  that ignores `readonly`. Neither runs from the mutable staging copies.
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

### Read-only startup code

The root `startup` step runs two kit files: `oci-engine-grant-devs.sh` and the
`oci-engine-storage-driver.sh` helper it sources. Both are declared
`readonly: true` and passed to the step as whole argv elements. A consumer that
honors the flag (acq `msb`, quickstart ADR-0035) runs them from a
host-authoritative read-only mount, so a guest user with `sudo` cannot edit what
root executes on each start. A consumer that ignores the flag copies them under
`/home/agent` as before (the *legacy* case), and the step then runs the
root-owned copy that `oci-engine-install.sh` published.

The step **fails closed**. It classifies the two tokens together:

| Tokens | Behavior |
|---|---|
| Both under `/var/lib/acq/host/kit-files/` | Run exactly those files. If either file is missing: error on stderr, run nothing as root, exit 1. It does **not** fall back to the root-owned copy, which came from `/home/agent` at create time and is not host-authoritative across restarts. |
| Both under `/home/agent/` | Legacy: run the root-owned copy that install published. If install published nothing, warn and exit 0, as before. |
| Anything else (one mounted and one not, `..`, an unknown prefix, an empty token) | Refuse: error on stderr, exit 1. |

`oci-engine-grant-devs.sh` applies the same rule to the helper it sources: a
missing selected mount helper is a refusal, not a fallback. A refusal costs only
the device grant and storage re-evaluation for that boot. Quickstart reports a
failing startup command as a warning and continues; it never treats it as an
escalation. `scripts/verify` fails in that state.

Pairing with Quickstart: the consumer keeps the
decision to use the read-only mount in a host-side record, so a guest cannot force
the legacy downgrade by tampering with a guest probe. When staging a read-only
file fails on the host, the consumer falls back to a guest copy for that file and
leaves its `/home/agent` token in argv. If both files fall back, that is the
legacy row above. If only one does, the pair is mixed (one mount token, one
`/home/agent` token) and the step refuses, so one failed host copy costs the
device grant and storage re-evaluation for that boot. The consumer's create-time
startup script derives its rewrite table without checking whether staging
succeeded, so it can name a mount file that was never staged; the step refuses
that case too.

The mount is enforced by the backend. A guest user with `sudo` who can unmount or
bind-mount over `/var/lib/acq/host/kit-files` is outside what token validation
can defend against; the read-only property rests on the backend's mount
enforcement.

The install step still trusts `/home/agent` at create time (it publishes the
staged copies into the root-owned directory, before the agent's first session).
The read-only mount protects the startup code on every later start.

Not marked `readonly`, on purpose: `oci-engine-install.sh` (an inline install
command copies it by path), `oci-engine-vfs-fallback.sh` (runs as the agent,
not root), and the `docker` wrapper and `01-acq-shortnames.conf` (the install
script copies them by path, which needs them at `/home/agent`). When the flag is
honored, the install step does not publish the grant script or helper; the
`startup` step configures the storage driver on that same boot.

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

## Installation and storage verification (legacy host-side live check)

`scripts/verify` is the existing installation/storage check, not resource
qualification. It retains its legacy two-state verdict: exit 0 means that nothing
it counted failed, not that all evidence was available. In particular, its
missing-rootless-field fallback checks only the agent UID. Neither that fallback,
the installation marker, nor a successful storage build proves that memory, CPU,
and PID limits are effective. See the [shared verdict contract](../README.md#what-a-scriptsverify-exit-code-means).

`scripts/verify` creates a throwaway **msb** sandbox with this kit applied
**through acq** (`acq --backend msb create shell … --kit …`) and confirms rootless
installation/storage behavior: it requests `rootless=true`, a real `podman build` from
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

## Managed runtime (guest-only, opt-in metadata experiment)

`scripts/managed-runtime.py` separates stable, volatile runtime paths from a
**new** persistent graphroot. It is not installed or selected by `spec.yaml`,
startup scripts, the Docker wrapper, or either verifier. It needs Python 3
(standard library only) and local `/usr/bin/podman` in the intended Linux guest.
Deliver the reviewed helper through a trusted path; root must not run an
agent-writable copy. `--guest` acknowledges guest placement but does not detect
or attest it. Do not run these commands on the host.

Before preparation, the operator must independently provide a dedicated,
writable tmpfs **exactly** at `/run/acq-oci-runtime`, root-owned 0755, with an
explicit positive size at most 128 MiB. The helper verifies mountinfo and
no-symlink directory paths; it does not create or repair mounts. Operators must
also review existing system/user Podman configuration, including any prototype
`cgroup_parent` in `containers.conf`. That configuration remains effective:
the helper does not hide, edit or fix it.

From the kit directory, using the trusted delivered copy **inside the guest**:

```sh
# Root, once per fresh runtime tmpfs; no Podman execution occurs here.
python3 -I -B scripts/managed-runtime.py --guest prepare --user agent

# Agent, once for a NEW dedicated store (re-running initialization refuses).
python3 -I -B scripts/managed-runtime.py --guest init-store

# Agent, supported metadata calls; Podman is never invoked as root.
python3 -I -B scripts/managed-runtime.py --guest exec -- info --format json
python3 -I -B scripts/managed-runtime.py --guest exec -- volume ls
```

Prepared paths are `/run/acq-oci-runtime/UID/storage` (runroot) and
`/run/acq-oci-runtime/UID/libpod` (tmpdir), in a user-owned 0700 UID directory.
The dedicated persistent graphroot is the passwd user's
`~/.local/share/acq-oci-runtime/store`. Its parent contains a strict, path-bound
JSON marker. Existing or interrupted initialization is refused, not adopted or
deleted. After stop/start, retain the graphroot, provide fresh tmpfs at the same
path, and repeat root `prepare`; do **not** repeat `init-store`.

Only `info [--format json]`, `images`, `image exists REFERENCE`,
`volume ls [--format json]`, and `volume exists|inspect|create NAME` are supported.
Global options and workload commands are refused. Exec replaces inherited
environment configuration with a small fixed allowlist and supplies explicit
local-engine, store/runtime and `cgroupfs` flags. It does not migrate storage,
change drivers, reset Podman, override cgroup parents, or change limits.

**Not a security sandbox or an argument permission system.** The operator/agent
controls the writable graphroot and can call Podman outside this helper. Default
`podman`, `docker`, and the existing verifiers do not implicitly use this store.
An operator-reported native MSB 0.7.11 / Podman 5.7 metadata-only stop/start
observation preserved a volume content hash with fresh stable-path tmpfs; this
does **not** qualify workloads or resources, nor validate this helper. Direct
parent/delegation and freezer prerequisites remain unresolved for workload exec.
See the [managed-runtime decision](docs/decisions/managed-runtime.md) for the
bounded evidence, pinned public sources, configuration prerequisites, exact
argument contract and interrupted-state handling.

Offline validation commands, from the repository root, **only inside the approved
workspace sandbox**:

```sh
python3 -I -B integrations/isolation/acq-kits/oci-engine/tests/managed-runtime-test.py
node --test 'integrations/isolation/acq-kits/oci-engine/tests/*.test.mjs'
```

The wrapper needs no Node packages. The root `make test-kits` target includes
these fixtures, so the existing kit CI job runs them.

## Resource qualification (guest-only, experimental)

Run `scripts/verify-resources` **inside the intended Linux guest**, as its
non-root agent. It needs Python 3 (standard library only), an explicitly selected
absolute installed Podman executable, and a trusted image already loaded in that
agent's local store. The image must have `/bin/sh` and `sleep`, and its reference
must be a fully qualified registry/repository plus `@sha256:` and 64 lowercase
hex digits. There is no default image and no pull, install, root fallback, or
cgroup repair. Copy the wrapper and adjacent `verify_resources.py` into the guest
through the operator's normal trusted delivery path; the kit does not autorun it.

```sh
# In the guest; substitute the actual preloaded digest-qualified reference.
sh scripts/verify-resources --guest --podman /usr/bin/podman \
  --image "$PRELOADED_DIGEST_REF"
```

`--guest` is an operator acknowledgment, **not guest detection or attestation**.
Linux and non-root checks cannot distinguish a Linux host from a guest. Never
invoke it on the host, through a remote Podman client, or with the Docker wrapper.
The environment is allowlisted, with the local user's home/runtime directory and
a fixed `/usr/bin:/bin` path; every engine call uses `--remote=false`.

The gate requires an explicit JSON boolean `host.security.rootless=true`, cgroup
v2, and reported delegation of `memory`, `cpu`, and `pids` before creation. It
creates then starts one probe, overriding its entrypoint with `/bin/sh`, with
network `none`, user `65534:65534`, all capabilities dropped, no-new-privileges,
128 MiB memory, one CPU, and 32 PIDs. It supplies no mounts, ignores image-declared
volumes, disables healthchecks/logging, and uses a read-only root filesystem.
The command is `exec sleep 120`; it is a bounded observation window, not a stress
test. Each CLI call has a 10-second deadline and 64 KiB combined-output cap.

The verifier maps the live inspected guest PID's `/proc/PID/cgroup` membership
through `/proc/self/mountinfo` to the cgroup2 mount, rejecting traversal,
ambiguous mappings, and symlink resolution. It reads **kernel** `memory.max`,
`cpu.max`, and `pids.max`, not just requested inspect limits. It also checks live
UIDs, effective capabilities and no-new-privileges, and rechecks PID start time,
membership, and the engine's running PID. It requires exact leaf limits;
stricter ancestor limits may further restrict the probe. No throughput, OOM,
fork-exhaustion, hostile-image containment, or outer-VM limit claim follows.

| Exit | Resource verifier result |
|---|---|
| `0` | Measured prerequisites, live kernel limits and exact-ID cleanup passed |
| `1` | An observed rootful engine or wrong effective policy/limit failed |
| `3` | Missing tools/image/controllers/evidence, malformed data, interrupted transport, or unverified cleanup; no measured failure |

This follows the coverage semantics of [verify-report.sh](../verify-report.sh):
a measured failure retains exit 1 even if another check is unverified. Cleanup
runs in `finally` against only the full returned container ID and requires
`container exists` to report absence. A lost/malformed create response cannot
identify an owned container and therefore reports cleanup **UNVERIFIED**, never
a pass. The operator must reconcile that guest's container store; there is no
name-based or broad cleanup. Uncatchable termination cannot guarantee cleanup.

Offline tests use fake executables/injected transport and synthetic kernel
evidence; they never invoke a real engine:

```sh
python3 -I -B scripts/tests/test_oci_resource_verifier.py
```

See [resource qualification decision](docs/decisions/resource-qualification.md)
for the trust boundary and limitations. Storage success and resource success are
separate evidence; neither substitutes for the other.
