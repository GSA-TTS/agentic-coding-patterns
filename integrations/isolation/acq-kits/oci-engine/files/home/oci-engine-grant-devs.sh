#!/bin/sh
# oci-engine-grant-devs.sh — grant the agent the device nodes rootless podman
# needs, re-applied on EVERY sandbox start.
#
# Runs as root (uid 0) in the kit's `startup` phase. /dev is a devtmpfs re-created
# on every boot, so a create-time grant would be lost after a restart — this step
# re-applies the grant each start (idempotent, cheap). See README.md and the
# isolation ADR-0020.
#
# WHAT + WHY (ADR-0020):
#   /dev/net/tun — rootless podman's network backend (netavark/pasta or
#     slirp4netns) must open it to set up container networking. It is root-only
#     (crw------- root root) on the default image; we group-scope it to the agent
#     (root:agent, 0660) so the unprivileged agent can bring up networking.
#   /dev/fuse    — the fuse-overlayfs storage driver mounts layers through it.
#     Same root:agent 0660 group-scoping.
#
# This is INSIDE the sandbox (the security boundary) only — it opens no new host
# attack surface. It is a group-scope, not world-writable (0666): only the agent
# (in the `agent` group) gains access, not every uid in the guest.
#
# Best-effort per device: a missing node (e.g. /dev/net/tun absent because the
# kernel module is not present) is a clear message, not a hard failure — podman
# then falls back to a networking/storage mode that does not need that node.
#
# POSIX sh only (no bashisms).

set -eu

# The unprivileged user the engine runs as. Non-secret; overridable via the
# OCI_ENGINE_AGENT_USER env var (declared in spec.yaml environment) for a base
# image whose agent account is not named "agent".
AGENT_USER="${OCI_ENGINE_AGENT_USER:-agent}"

# Guard the user name before it reaches chown: a POSIX user name is word-safe
# (letters, digits, . _ -). Refuse anything else rather than risk a surprise
# token in the chown target.
case "$AGENT_USER" in
  ""|*[!A-Za-z0-9._-]*)
    echo "oci-engine: WARNING: unsafe OCI_ENGINE_AGENT_USER='$AGENT_USER'; using 'agent'." >&2
    AGENT_USER="agent"
    ;;
esac

# Group-scope one device node to the agent (root:<user>, 0660) if it exists.
_grant() {
  _dev="$1"
  if [ -e "$_dev" ]; then
    if chown "root:$AGENT_USER" "$_dev" 2>/dev/null && chmod 0660 "$_dev" 2>/dev/null; then
      echo "oci-engine: granted $_dev to group $AGENT_USER (0660)."
    else
      echo "oci-engine: WARNING: could not adjust permissions on $_dev (rootless podman may be limited)." >&2
    fi
  else
    echo "oci-engine: note: $_dev absent; skipping (podman will fall back where possible)." >&2
  fi
  unset _dev
}

# /dev/net/tun lives under /dev/net, which may not exist yet; create it so the
# node can be granted (the kernel populates the node when the tun module loads).
[ -d /dev/net ] || mkdir -p /dev/net 2>/dev/null || true

_grant /dev/net/tun
_grant /dev/fuse
