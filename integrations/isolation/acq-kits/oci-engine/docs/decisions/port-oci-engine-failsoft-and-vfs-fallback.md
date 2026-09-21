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
