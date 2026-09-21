#!/bin/sh
# oci-engine-vfs-fallback.sh — rootless self-test + user-level vfs storage
# fallback for podman.
#
# Runs on EVERY sandbox start as the AGENT user (uid 1000), in the kit's
# `startup` phase, AFTER the root install (create) and the device-node grant.
# It reproduces the reference adapter's recovery path (_acq_msb_ensure_oci,
# rootless self-test + user-level vfs retry): the system storage.conf the install
# step wrote (overlay + fuse-overlayfs) works on most bases, but some bases reject
# the overlay+fuse-overlayfs combo UNDER ROOTLESS — there `podman info` passes but
# a real layer mount (`podman build` / `podman run`) fails. The documented
# recovery is a USER-level ~/.config/containers/storage.conf selecting the `vfs`
# driver (works everywhere, no /dev/fuse; disk-heavy but correct), which takes
# precedence over the system file for the rootless agent.
#
# Why a startup step run as the agent (not folded into the root install): the
# install phase runs as root (uid 0) and cannot cleanly own the agent's
# ~/.config; and /dev is re-created each boot, so the effective rootless storage
# situation is only knowable at start (after the device grant). This step is the
# agent-side complement to the root install + device grant.
#
# FAIL-SOFT: a failed self-test must NEVER abort the boot — the whole point is a
# best-effort recovery. This script always exits 0.
#
# Idempotent: it only writes the user storage.conf when a rootless build FAILS and
# the file does not already select a driver; once the vfs fallback is in place the
# self-test passes and the script no-ops. POSIX sh only.

set -u

# If podman is not installed (install failed soft, mirror unreachable), there is
# nothing to self-test. No-op, exit 0.
if ! command -v podman >/dev/null 2>&1; then
  echo "oci-engine: podman not installed; skipping rootless self-test." >&2
  exit 0
fi

HOME_DIR="${HOME:-/home/agent}"
USER_STORAGE_DIR="$HOME_DIR/.config/containers"
USER_STORAGE_CONF="$USER_STORAGE_DIR/storage.conf"

# A real LAYER MOUNT self-test: `podman build` FROM scratch opens /dev/fuse and
# mounts a layer, so it catches the rootless overlay+fuse-overlayfs trap that a
# bare `podman info` misses. No registry pull, no egress (FROM scratch).
_oci_selftest() {
  _d="$(mktemp -d)" || return 1
  printf 'FROM scratch\nCOPY hi /hi\n' > "$_d/Containerfile"
  echo hi > "$_d/hi"
  podman build -q -t oci-engine-selftest:local "$_d" >/dev/null 2>&1
  _rc=$?
  podman rmi -f oci-engine-selftest:local >/dev/null 2>&1 || true
  rm -rf "$_d"
  return $_rc
}

if _oci_selftest; then
  echo "oci-engine: rootless podman self-test passed (current storage driver works)."
  exit 0
fi

echo "oci-engine: rootless podman self-test failed with the current storage driver;" \
     "applying a user-level vfs fallback." >&2

# Only write the user storage.conf if it does not already name a driver (do not
# clobber an operator's own user config).
if grep -q '^[[:space:]]*driver' "$USER_STORAGE_CONF" 2>/dev/null; then
  echo "oci-engine: $USER_STORAGE_CONF already selects a driver; leaving it untouched." >&2
  exit 0
fi

mkdir -p "$USER_STORAGE_DIR" 2>/dev/null || {
  echo "oci-engine: WARNING: could not create $USER_STORAGE_DIR; cannot apply vfs fallback." >&2
  exit 0
}
printf '[storage]\ndriver = "vfs"\n' > "$USER_STORAGE_CONF" 2>/dev/null || {
  echo "oci-engine: WARNING: could not write $USER_STORAGE_CONF; cannot apply vfs fallback." >&2
  exit 0
}

# Re-test with the vfs fallback in place; report but never fail the boot.
if _oci_selftest; then
  echo "oci-engine: rootless podman self-test passed after the vfs fallback."
else
  echo "oci-engine: WARNING: rootless podman still cannot build after the vfs fallback;" \
       "OCI images may be unavailable in this sandbox." >&2
fi
exit 0
