# Decision: port the msb-adapter OCI engine into a neutral kit, fail-soft install, and a rootless vfs fallback

**Status:** accepted

## TL;DR

The `oci-engine` kit provides a rootless podman OCI engine as a neutral, opt-in
acq mixin. Three decisions are worth recording:

1. **Where the logic lives (ADR-0030).** The podman provisioning used to live in
   the msb backend adapter (sibling `agentic-coding-quickstart` repo). It is
   ported here into the neutral `hybrid/v1` vocabulary so every acq backend
   applies it the same way, and so it is **off by default** — acq selects this
   kit only when the operator opts in via `ACQ_ENABLE_OCI_KIT`.

2. **The `install` step must fail SOFT.** A non-zero `commands.install` exit
   **fails `sbx create`** (a dead sandbox) — the same lifecycle fact the sibling
   `zscaler-ca-certificate` kit documents in
   [`ship-ca-in-files-install-at-create.md`](../../zscaler-ca-certificate/docs/decisions/ship-ca-in-files-install-at-create.md)
   and its superseding note. Our promise is the opposite: an unreachable package
   mirror (e.g. `ACQ_NETWORK_TIER=strict`) or an unsupported base must leave the
   sandbox usable, just without OCI support.

3. **A rootless vfs fallback belongs in a startup step run as the agent.** The
   reference adapter did not stop at writing a system `storage.conf`; it ran a
   rootless self-test and, on failure, wrote a user-level vfs `storage.conf` and
   retried. We preserve that recovery.

## Context

### Fail-soft install

The reference `_acq_msb_ensure_oci` ran its `set -e` install block inside an
outer `if _acq_msb_cli exec … ; then … else <warn>; return 0; fi`, so a failed
package install was caught and treated as non-fatal. As a **standalone kit
script** there is no outer catch: a top-level `set -eu` plus bare `apt-get` /
`dnf` / `apk` calls means the first non-zero return aborts the script with a
non-zero exit — which fails `sbx create` before the fail-soft `command -v podman`
re-check is ever reached.

**Decision.** Run the distro-detected install inside a subshell under its own
`set -e` and swallow its exit (`( set -e; … ) || echo WARNING >&2`). Any failure
falls through to a single fail-soft exit at the `command -v podman` re-check,
which warns and `exit 0`s so provision continues. Verified by stubbing a failing
`apt-get`/`dnf`/`apk` on `PATH` and confirming the script prints the warning and
exits 0.

### Rootless overlay+fuse-overlayfs can be rejected under rootless

On most bases the system `storage.conf` (overlay + fuse-overlayfs) works. On some
bases the combo is rejected **under rootless**: `podman info` passes (it does not
open `/dev/fuse` or mount a layer) but a real `podman build`/`run` fails at mount
time. The documented recovery is a **user-level**
`~/.config/containers/storage.conf` selecting `vfs`, which takes precedence over
the system file for the rootless agent.

**Decision.** Because the `install` phase runs as root (uid 0) and cannot cleanly
own the agent's `~/.config`, and because the effective rootless situation is only
knowable at start (after the per-boot device grant), the recovery is a separate
`startup` step run **as the agent (uid 1000)**:
`files/home/oci-engine-vfs-fallback.sh`. It runs a real layer-mount self-test
(`podman build` FROM scratch) and, on failure, writes the user-level vfs
`storage.conf` and retries. It is idempotent (only writes on a failed build when
no user driver is set) and **fails soft** (always exits 0 — a failed self-test
must not abort the boot).

## Consequences

- The sandbox is never bricked by an OCI provisioning failure; OCI support simply
  degrades to "unavailable" with a clear warning.
- Bases that reject rootless overlay+fuse-overlayfs still get a working (if
  disk-heavier) engine via the vfs fallback, matching the reference adapter.
- Security posture (rootless, no dind daemon, group-scoped devices,
  Docker-Hub-first with `short-name-mode=enforcing` by default) follows the
  isolation ADR-0020 decision; the neutral-egress-tier reliance follows ADR-0002.

## Addendum: functional-engine early-out and config/install decoupling

Live testing on a base that already bundles a docker CLI (the msb default
`…:shell-docker`) surfaced two structural issues:

1. **Do not shadow a working engine.** If the base already provides a *functional*
   engine, layering podman on top and shadowing `docker` only complicates a setup
   that already works. The install script now **early-outs on a clean
   `docker info`** — probing the engine's *function*, not merely the presence of a
   `docker` binary (many bases ship a docker CLI whose daemon socket is dead in
   the sandbox — the exact case this kit fixes, which must NOT early-out).

2. **Config/wrapper decoupled from the package step.** Previously the storage +
   registry config and the `docker`->podman wrapper only ran as a consequence of
   the kit's package install succeeding; on a base that already had podman (or
   where the wrapper was wanted regardless), a skipped package step skipped the
   config too. The config + wrapper now run whenever **podman is present** at that
   point — installed by the kit *or* pre-existing — so the outcome is the same
   regardless of who installed the engine.

Both keep the fail-soft posture: the early-out and every skip path exit 0.

## Addendum: adversarial-review hardening

An AI-assisted 5-role adversarial PR review (advisory) confirmed the design
direction and flagged six implementation defects, all addressed here:

1. **Fail-SILENT vs fail-soft / no verifiability.** Fail-soft is right (a
   non-zero `install` exit fails `sbx create`), but a silent one is not
   observable. The install now writes a durable success marker
   `/var/lib/acq/oci-engine-ready` (`state=configured` on a real install,
   `state=base-engine` on the deliberate functional-engine early-out); the
   fail-soft paths deliberately do NOT write it. `scripts/verify` (the
   kit-library convention this kit follows) checks the marker first, so a
   "kit applied but did nothing" sandbox is legible to CI/operators.

2. **Package-manager flag injection.** The old `OCI_ENGINE_PKGS` sanitizer
   allowed a leading `-` in a token, so `OCI_ENGINE_PKGS="podman
   --allow-unauthenticated"` (apt) / `--nogpgcheck` (dnf) / `--allow-untrusted`
   (apk) passed validation and word-split into the elevated install, disabling
   signature verification. The sanitizer now validates **token by token** and
   rejects any leading-`-` token (and any non-word-safe char), failing closed
   (skip OCI setup) rather than running a tampered install.

3. **Unconditional device grant.** `oci-engine-grant-devs.sh` chown/chmod'd
   `/dev/net/tun` + `/dev/fuse` on every boot even when podman was never
   installed — widening in-guest device access (`/dev/net/tun` is
   egress-relevant) for a capability that does not exist. It is now **gated on
   `command -v podman`**: no engine, no grant.

4. **Storage driver permanently mis-pinned from a boot-transient probe.** The
   driver was chosen from `[ -e /dev/fuse ]` at create and then never rewritten,
   so a transient miss at create permanently pinned slow `vfs`. Driver selection
   moved into a shared helper (`oci-engine-storage-driver.sh`) that the
   every-boot grant step also runs, **converging** vfs→overlay once
   fuse-overlayfs + `/dev/fuse` are both present. It only ever rewrites a
   kit-owned `storage.conf` (sentinel comment), never an operator's.

5. **Missing `caps.network` for the registry.** The kit's *purpose* (pulling
   images) needs Docker Hub, which — unlike the distro package mirror — is not
   distro-dependent. `spec.yaml` now declares the Docker Hub registry + auth +
   blob-CDN hosts in `caps.network.allow`, so runtime pulls work even on a
   `strict` tier. The distro mirror is still left to the balanced baseline (it
   is distro-specific and already in the baseline `core` set).

6. **Unbounded self-test build on the boot path.** The per-boot rootless
   `podman build` self-test now runs under `timeout`
   (`OCI_ENGINE_SELFTEST_TIMEOUT`, default 120s) when available, so a wedged
   mount / stalled `newuidmap` cannot hang the boot; a timeout is treated as a
   failed self-test and triggers the vfs fallback.

