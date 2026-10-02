#!/bin/sh
# oci-engine-storage-driver.sh — shared helper: (re)write the SYSTEM podman
# storage.conf to a driver that works on the current sandbox filesystem.
#
# Sourced (NOT executed) by both:
#   - oci-engine-install.sh   (create-time, root) — seed a sane default; and
#   - oci-engine-grant-devs.sh (every boot, root) — RE-EVALUATE after the device
#     grant, so a transient /dev/fuse miss at create is not permanently baked in.
#
# WHY re-evaluate every boot (finding #4): /dev is a devtmpfs re-created on every
# boot (that is why the grant step exists at all). The create-time probe of
# `/dev/fuse` can miss — the node may not be present yet at create — and the old
# logic then wrote `vfs` AND guarded against ever rewriting it, permanently
# pinning the slow driver with no recovery path. This helper instead converges:
# it writes the BEST driver currently possible and will UPGRADE vfs -> overlay on
# a later boot once fuse-overlayfs + /dev/fuse are both available.
#
# It only ever REPLACES a config this kit itself wrote (marked with the sentinel
# comment below); it never clobbers an operator-authored /etc/containers/
# storage.conf that lacks the sentinel. POSIX sh only; safe to source under set -e.

# Sentinel marking a storage.conf as kit-owned (safe to overwrite/upgrade).
OCI_ENGINE_STORAGE_SENTINEL='# managed-by: acq oci-engine kit'

# Resolve the fuse-overlayfs mount program path, or empty if unavailable.
_oci_engine_find_fuse() {
  _f=""
  for _c in /usr/bin/fuse-overlayfs /usr/local/bin/fuse-overlayfs /bin/fuse-overlayfs; do
    if [ -x "$_c" ]; then _f="$_c"; break; fi
  done
  if [ -z "$_f" ] && command -v fuse-overlayfs >/dev/null 2>&1; then
    _f="$(command -v fuse-overlayfs)"
  fi
  printf '%s' "$_f"
  unset _c
}

# oci_engine_write_storage_conf — write /etc/containers/storage.conf for the best
# driver currently possible. Idempotent and convergent (upgrades vfs->overlay when
# /dev/fuse reappears). Never overwrites a non-kit (operator) storage.conf.
oci_engine_write_storage_conf() {
  _conf=/etc/containers/storage.conf
  mkdir -p /etc/containers 2>/dev/null || true

  # If a storage.conf exists that this kit did NOT write, leave it alone.
  if [ -f "$_conf" ] && ! grep -qF "$OCI_ENGINE_STORAGE_SENTINEL" "$_conf" 2>/dev/null; then
    echo "oci-engine: $_conf is operator-owned (no kit sentinel); leaving it untouched." >&2
    return 0
  fi

  _fuse="$(_oci_engine_find_fuse)"
  if [ -n "$_fuse" ] && [ -e /dev/fuse ]; then
    _want="overlay"
  else
    _want="vfs"
  fi

  # Converge only: if the kit-owned file already selects the desired driver, do
  # not rewrite (avoids churn + log noise every boot).
  if [ -f "$_conf" ] && grep -q "driver = \"$_want\"" "$_conf" 2>/dev/null; then
    return 0
  fi

  if [ "$_want" = "overlay" ]; then
    {
      printf '%s\n' "$OCI_ENGINE_STORAGE_SENTINEL"
      printf '[storage]\ndriver = "overlay"\n[storage.options.overlay]\nmount_program = "%s"\n' "$_fuse"
    } > "$_conf"
    echo "oci-engine: storage driver set to overlay (fuse-overlayfs=$_fuse)."
  else
    {
      printf '%s\n' "$OCI_ENGINE_STORAGE_SENTINEL"
      printf '[storage]\ndriver = "vfs"\n'
    } > "$_conf"
    echo "oci-engine: storage driver set to vfs (fuse-overlayfs and/or /dev/fuse unavailable this boot)." >&2
  fi
  unset _conf _fuse _want
}
