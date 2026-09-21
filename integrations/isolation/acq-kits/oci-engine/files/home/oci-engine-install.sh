#!/bin/sh
# oci-engine-install.sh — install + configure a rootless OCI engine (podman).
#
# Runs ONCE at sandbox create time, as root (uid 0), from the kit's `install`
# phase. It installs podman + the rootless prerequisites, selects a storage
# driver that works on an overlay root, installs the Docker-Hub-first registry
# config, and shadows the base image's (dead-socket) docker CLI with a wrapper
# that routes to podman. The engine itself RUNS ROOTLESS as the agent user; only
# this install/config step needs root. See README.md and the isolation ADR-0020
# ("rootless podman OCI engine") for the design rationale this reproduces.
#
# Idempotent + best-effort: re-running is safe (each step is guarded), and a
# missing package mirror or unsupported base fails soft with a clear message
# rather than aborting sandbox provisioning.
#
# POSIX sh only (no bashisms): the sandbox base shell may be dash/busybox.

set -eu

# Package set for the OCI engine + rootless prerequisites. Non-secret; may be
# overridden via the OCI_ENGINE_PKGS env var (declared in spec.yaml environment).
#   podman          — the daemonless OCI engine
#   podman-compose  — the `podman compose` / `docker compose` provider
#   fuse-overlayfs   — lets podman use the `overlay` graph driver on an overlay
#                      ROOT filesystem (the kernel `overlay` driver refuses to
#                      stack on overlayfs); without it we fall back to `vfs`
#   uidmap           — newuidmap/newgidmap setuid helpers rootless podman needs
#   passt, slirp4netns — rootless container networking backends
OCI_ENGINE_PKGS="${OCI_ENGINE_PKGS:-podman podman-compose fuse-overlayfs uidmap passt slirp4netns}"

# short-name resolution mode written into the registries drop-in. DEFAULT is
# "enforcing" (least-privilege / prompt-injection defense per ADR-0020): a single
# search registry (docker.io) still resolves unqualified names deterministically
# to Docker Hub, but interactively-ambiguous short names fail closed instead of
# being silently substituted (image-substitution / typosquatting defense). An
# operator MAY opt into the weaker "permissive" via OCI_ENGINE_SHORT_NAME_MODE;
# any invalid value falls back to "enforcing" (fail-closed) with a warning.
OCI_ENGINE_SHORT_NAME_MODE="${OCI_ENGINE_SHORT_NAME_MODE:-enforcing}"
_mode_lc="$(printf '%s' "$OCI_ENGINE_SHORT_NAME_MODE" | tr '[:upper:]' '[:lower:]')"
case "$_mode_lc" in
  enforcing|permissive|disabled) OCI_ENGINE_SHORT_NAME_MODE="$_mode_lc" ;;
  *)
    echo "oci-engine: WARNING: invalid OCI_ENGINE_SHORT_NAME_MODE='$OCI_ENGINE_SHORT_NAME_MODE'" \
         "(expected enforcing|permissive|disabled); falling back to enforcing" >&2
    OCI_ENGINE_SHORT_NAME_MODE="enforcing"
    ;;
esac
unset _mode_lc

# Charset-guard the package set: it is passed to the package manager unquoted
# (word-splitting is intentional — it is a space-separated list). Package names
# are word-safe (letters, digits, . _ + - and spaces); refuse anything else
# rather than risk a surprise token reaching the elevated install.
case "$OCI_ENGINE_PKGS" in
  *[!A-Za-z0-9._+\ -]*)
    echo "oci-engine: WARNING: OCI_ENGINE_PKGS contains unsafe characters; skipping OCI setup." >&2
    exit 0
    ;;
esac

# Where the kit staged its config payloads (dropped by files[] as the agent user,
# then installed into /etc/containers here by root). Same stage-in-home-then-
# move-as-root pattern the zscaler-ca-certificate kit uses.
STAGE_DIR="/home/agent/oci-engine-config"

# 1) Ensure the podman binary is present (idempotent; distro-detected).
#
# FAIL-SOFT (critical): this is an `install`-phase command, and a non-zero
# install exit FAILS `sbx create` (a dead sandbox) — see the sibling
# zscaler-ca-certificate kit's docs/decisions and this kit's docs/decisions. The
# package-manager step MUST NOT abort the script on failure (an unreachable
# mirror, a locked dpkg, an unsupported base). The top-level `set -eu` would
# otherwise abort on the FIRST non-zero return from apt-get/dnf/apk before the
# fail-soft re-check below is ever reached. So we run the whole install in a
# SUBSHELL under its own `set -e` and swallow its exit: any failure inside falls
# through to the single fail-soft exit at the `command -v podman` re-check, which
# prints a clear warning and exits 0 so provision continues.
#
# The reference adapter (_acq_msb_ensure_oci) did not have this bug only because
# its `set -e` install block ran inside an outer `if _acq_msb_cli exec … ; then …
# else <warn>; return 0; fi` that caught the failure. As a standalone kit script
# there is no outer catch, so we provide the equivalent catch here.
if ! command -v podman >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    ( set -e
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      # shellcheck disable=SC2086  # deliberate word-split of the package list
      apt-get install -y --no-install-recommends $OCI_ENGINE_PKGS
    ) || echo "oci-engine: WARNING: apt-get install failed (mirror unreachable?); OCI may be unavailable." >&2
  elif command -v dnf >/dev/null 2>&1; then
    ( set -e
      # shellcheck disable=SC2086
      dnf install -y $OCI_ENGINE_PKGS
    ) || echo "oci-engine: WARNING: dnf install failed (mirror unreachable?); OCI may be unavailable." >&2
  elif command -v apk >/dev/null 2>&1; then
    ( set -e
      # shellcheck disable=SC2086
      apk add --no-cache $OCI_ENGINE_PKGS
    ) || echo "oci-engine: WARNING: apk add failed (mirror unreachable?); OCI may be unavailable." >&2
  else
    echo "oci-engine: no supported package manager (apt-get/dnf/apk); cannot install podman." >&2
    echo "oci-engine: OCI images (docker run / docker compose) will be unavailable." >&2
    exit 0
  fi
fi

# Single fail-soft exit: if podman is still absent (install failed or the mirror
# was unreachable), warn and exit 0 so `sbx create` succeeds — the sandbox is
# usable, it just cannot run OCI images.
if ! command -v podman >/dev/null 2>&1; then
  echo "oci-engine: WARNING: podman still not on PATH after install; OCI images unavailable." >&2
  echo "oci-engine: the OS package mirror may be unreachable (see README egress note)." >&2
  exit 0
fi

# 2) Select a storage driver that works on an overlay ROOT filesystem. Only write
#    the config if none already names a driver (idempotent; do not clobber an
#    operator file). Prefer overlay+fuse-overlayfs (fast, thin on disk); else vfs
#    (works everywhere, no /dev/fuse, but disk-heavy — a full copy per layer).
mkdir -p /etc/containers
if ! grep -q '^[[:space:]]*driver' /etc/containers/storage.conf 2>/dev/null; then
  _fuse=""
  for _c in /usr/bin/fuse-overlayfs /usr/local/bin/fuse-overlayfs /bin/fuse-overlayfs; do
    if [ -x "$_c" ]; then _fuse="$_c"; break; fi
  done
  if [ -z "$_fuse" ] && command -v fuse-overlayfs >/dev/null 2>&1; then
    _fuse="$(command -v fuse-overlayfs)"
  fi
  if [ -n "$_fuse" ] && [ -e /dev/fuse ]; then
    printf '[storage]\ndriver = "overlay"\n[storage.options.overlay]\nmount_program = "%s"\n' \
      "$_fuse" > /etc/containers/storage.conf
  else
    printf '[storage]\ndriver = "vfs"\n' > /etc/containers/storage.conf
  fi
  unset _fuse _c
fi

# 3) Docker-Hub-first registry resolution (ADR-0020). System-level so it applies
#    to the rootless agent (read as the lowest-precedence source). Install the
#    staged drop-ins verbatim (idempotent: overwrite our own files each run). The
#    short-name drop-in is templated with the resolved mode.
mkdir -p /etc/containers/registries.conf.d
if [ -f "$STAGE_DIR/01-acq-shortnames.conf" ]; then
  install -m 0644 "$STAGE_DIR/01-acq-shortnames.conf" \
    /etc/containers/registries.conf.d/01-acq-shortnames.conf
fi
printf 'unqualified-search-registries = ["docker.io"]\nshort-name-mode = "%s"\n' \
  "$OCI_ENGINE_SHORT_NAME_MODE" \
  > /etc/containers/registries.conf.d/00-acq-docker-first.conf

# 4) Shadow the base image's (dead-socket) docker CLI with a wrapper that routes
#    to podman. Placed in /usr/local/bin (ahead of /usr/bin on PATH); we never
#    touch the base image's /usr/bin/docker. `docker compose` -> `podman compose`
#    drives the podman-compose provider. Install the staged wrapper (0755).
if [ -f "$STAGE_DIR/docker" ]; then
  mkdir -p /usr/local/bin
  install -m 0755 "$STAGE_DIR/docker" /usr/local/bin/docker
fi

echo "oci-engine: rootless podman installed and configured (short-name-mode=$OCI_ENGINE_SHORT_NAME_MODE)."
