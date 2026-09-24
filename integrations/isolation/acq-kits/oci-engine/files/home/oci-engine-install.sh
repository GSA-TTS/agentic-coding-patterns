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

# Validate the package set: it is passed to the package manager UNQUOTED
# (word-splitting is intentional — it is a space-separated list), so each token
# reaches an ELEVATED install verbatim. Two guards, both required:
#
#   (a) Charset: package names are word-safe (letters, digits, . _ + -).
#   (b) NO token may begin with `-`. A charset check ALONE is insufficient: `-`
#       is a legal char in package names, but a LEADING `-` makes the token an
#       OPTION, not a package. Without this, OCI_ENGINE_PKGS="podman
#       --allow-unauthenticated" (apt), "... --nogpgcheck" (dnf), or
#       "... --allow-untrusted" (apk) would word-split straight into the install
#       and DISABLE package-signature verification — a supply-chain hole. We
#       validate token-by-token so a leading `-` on ANY token is rejected, and
#       fail CLOSED (skip OCI setup) rather than run a tampered install.
_pkg_bad=0
for _pkg in $OCI_ENGINE_PKGS; do
  case "$_pkg" in
    -*)
      echo "oci-engine: WARNING: OCI_ENGINE_PKGS token '$_pkg' looks like an option (leading '-')," \
           "not a package name; refusing (would reach the elevated install)." >&2
      _pkg_bad=1
      ;;
    *[!A-Za-z0-9._+-]*)
      echo "oci-engine: WARNING: OCI_ENGINE_PKGS token '$_pkg' has unsafe characters; refusing." >&2
      _pkg_bad=1
      ;;
  esac
done
if [ "$_pkg_bad" -ne 0 ]; then
  echo "oci-engine: skipping OCI setup due to an unsafe OCI_ENGINE_PKGS value." >&2
  exit 0
fi
unset _pkg _pkg_bad

# Where the kit staged its config payloads (dropped by files[] as the agent user,
# then installed into root-owned locations here by root). Startup-time root code
# MUST NOT be read from the agent-writable staging path on later boots.
STAGE_DIR="/home/agent/oci-engine-config"
STAGED_GRANT_SCRIPT="/home/agent/oci-engine-grant-devs.sh"
TRUSTED_PARENT="/usr/local/lib/acq"
TRUSTED_DIR="$TRUSTED_PARENT/oci-engine"
TRUSTED_STORAGE_HELPER="$TRUSTED_DIR/oci-engine-storage-driver.sh"
TRUSTED_GRANT_SCRIPT="$TRUSTED_DIR/oci-engine-grant-devs.sh"

# 0) Install trusted helper/startup payloads into a root-owned path before any
#    fail-soft exit. The startup phase executes/sources ONLY these copies, not the
#    agent-home staging files, so an agent cannot tamper with root startup code
#    between restarts.
if ! mkdir -p "$TRUSTED_DIR" 2>/dev/null \
  || ! chown root:root "$TRUSTED_PARENT" "$TRUSTED_DIR" 2>/dev/null \
  || ! chmod 0755 "$TRUSTED_PARENT" "$TRUSTED_DIR" 2>/dev/null; then
  echo "oci-engine: WARNING: could not prepare trusted root startup directory; OCI setup unavailable." >&2
  exit 0
fi
if [ -f "$STAGE_DIR/oci-engine-storage-driver.sh" ]; then
  if ! install -m 0644 "$STAGE_DIR/oci-engine-storage-driver.sh" "$TRUSTED_STORAGE_HELPER"; then
    echo "oci-engine: WARNING: could not install trusted storage helper; OCI setup unavailable." >&2
    exit 0
  fi
else
  echo "oci-engine: WARNING: staged storage helper missing; cannot configure OCI storage." >&2
  exit 0
fi
if [ -f "$STAGED_GRANT_SCRIPT" ]; then
  if ! install -m 0755 "$STAGED_GRANT_SCRIPT" "$TRUSTED_GRANT_SCRIPT"; then
    echo "oci-engine: WARNING: could not install trusted startup grant script; OCI setup unavailable." >&2
    exit 0
  fi
else
  echo "oci-engine: WARNING: staged startup grant script missing; startup device grant unavailable." >&2
  exit 0
fi

# 1) EARLY-OUT if the base image already provides a FUNCTIONAL container engine.
#
# If the operator picked a base that bundles a working docker/Docker-daemon setup
# (e.g. the msb default `…:shell-docker`), this kit should NOT layer podman on top
# and shadow the working `docker` — that only complicates a setup that already
# works. We probe `docker info` (as the invoking user); a clean exit means a
# usable engine is already present, so we leave the base alone and exit 0.
#
# We deliberately do NOT early-out merely because a `docker` BINARY exists: many
# bases ship a docker CLI whose daemon socket is dead in the sandbox (the exact
# case this kit exists to fix). Only a functional `docker info` counts. If podman
# is already present and working we likewise leave it (the config step below is
# idempotent and will still ensure our drop-ins, but we do not reinstall).
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "oci-engine: a functional 'docker' engine is already present on this base; leaving it as-is." >&2
  echo "oci-engine: (skipping podman install + docker->podman wrapper to avoid shadowing a working engine)." >&2
  # Record the DELIBERATE early-out so it is distinguishable from a fail-soft
  # miss (finding #1). state=base-engine means "kit ran, chose to defer".
  mkdir -p /var/lib/acq 2>/dev/null || true
  printf 'installed_at=%s\nstate=base-engine\npodman=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
    "$(command -v podman || echo none)" \
    > /var/lib/acq/oci-engine-ready 2>/dev/null || true
  exit 0
fi

# 2) Ensure the podman binary is present (idempotent; distro-detected).
#
# FAIL-SOFT (critical): this is an `install`-phase command, and a non-zero
# install exit FAILS `sbx create` (a dead sandbox) — see the sibling
# zscaler-ca-certificate kit's docs/decisions and this kit's docs/decisions. The
# package-manager step MUST NOT abort the script on failure (an unreachable
# mirror, a locked dpkg, an unsupported base). The top-level `set -eu` would
# otherwise abort on the FIRST non-zero return from apt-get/dnf/apk. So we run the
# whole install in a SUBSHELL under its own `set -e` and swallow its exit: a
# failure just leaves podman absent, which the config step below detects and
# skips (warning, exit 0) so provision continues.
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

# CONFIG GATE (decoupled from the package step): the storage/registry/wrapper
# config below runs whenever podman is PRESENT at this point — whether this kit
# just installed it OR it was already on the base (installed by other means). It
# is NOT gated on "the kit ran the package install", so a base that already ships
# podman still gets the Docker-Hub-first config and the docker->podman wrapper.
# If podman is still absent (install failed / mirror unreachable), warn and
# exit 0 so `sbx create` succeeds — the sandbox is usable, just without OCI.
if ! command -v podman >/dev/null 2>&1; then
  echo "oci-engine: WARNING: podman not present after install; OCI images unavailable." >&2
  echo "oci-engine: the OS package mirror may be unreachable (see README egress note)." >&2
  exit 0
fi

# 3) Select a storage driver that works on an overlay ROOT filesystem, via the
#    shared helper the every-boot grant step also calls. Writing it here at create
#    seeds a sane default; the grant step (root, every boot) RE-EVALUATES it so a
#    transient /dev/fuse miss at create is not permanently baked in — see the
#    helper's comment and finding #4 in the kit's docs/decisions.
mkdir -p /etc/containers
# shellcheck source=files/home/oci-engine-config/oci-engine-storage-driver.sh
. "$TRUSTED_STORAGE_HELPER"
oci_engine_write_storage_conf

# 4) Docker-Hub-first registry resolution (ADR-0020). System-level so it applies
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

# 5) Shadow the base image's (dead-socket) docker CLI with a wrapper that routes
#    to podman. Placed in /usr/local/bin (ahead of /usr/bin on PATH); we never
#    touch the base image's /usr/bin/docker. `docker compose` -> `podman compose`
#    drives the podman-compose provider. Install the staged wrapper (0755).
if [ -f "$STAGE_DIR/docker" ]; then
  mkdir -p /usr/local/bin
  install -m 0755 "$STAGE_DIR/docker" /usr/local/bin/docker
fi

# 6) SUCCESS MARKER (observability — finding #1). Record that the kit reached a
#    configured state, so an operator / CI / the host-side scripts/verify can tell
#    a genuinely-provisioned sandbox from one where the install fell soft (the
#    fail-soft `exit 0` paths above deliberately do NOT touch this marker). This
#    is the same durable-marker discipline the msb adapter uses (/var/lib/acq/*).
mkdir -p /var/lib/acq
printf 'installed_at=%s\nstate=configured\npodman=%s\ndocker_wrapper=%s\nshort_name_mode=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
  "$(command -v podman || echo none)" \
  "$([ -x /usr/local/bin/docker ] && echo /usr/local/bin/docker || echo none)" \
  "$OCI_ENGINE_SHORT_NAME_MODE" \
  > /var/lib/acq/oci-engine-ready

echo "oci-engine: rootless podman installed and configured (short-name-mode=$OCI_ENGINE_SHORT_NAME_MODE)."
