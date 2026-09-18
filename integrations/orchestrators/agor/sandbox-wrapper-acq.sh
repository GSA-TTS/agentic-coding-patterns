#!/usr/bin/env bash
#
# sandbox-wrapper-acq.sh — run an Agor executor task inside an `acq` sandbox.
#
# STATUS: DRAFT (v1, msb + sbx backends). Authored AFK via the wayfinder map
#   (GSA-TTS/agentic-coding-patterns#247, prototype ticket #253). Not yet
#   live-validated end to end — see the map's #257. Read before adopting.
#
# WHAT IT IS
#   Agor's daemon spawns an executor per task by running its configured
#   `executor_command_template` via `sh -c`, substituting a few variables and
#   piping a JSON payload to the process's stdin. This script is that template
#   target: it reads the payload, works out what to mount, creates an `acq`
#   sandbox, and pipes the payload into `agor-executor --stdin` INSIDE the
#   sandbox. The sandbox replaces `sudo -u` as the isolation boundary.
#
#   Wire it in ~/.agor/config.yaml:
#     execution:
#       executor_command_template: |
#         /path/to/sandbox-wrapper-acq.sh {session_id}
#
# DRY-RUN NOTE (deviation from the repo clean-script standard, documented)
#   This script's whole job is to MUTATE (create a sandbox, run the agent), and
#   Agor always invokes it for real — so a `--apply`-gated default that no-ops
#   would break the executor. Instead it honors the dry-run PRINCIPLE via an
#   explicit opt-in preview: set AGOR_SANDBOX_DRY_RUN=1 to print the acq commands
#   it WOULD run (mounts, egress kit, secret, exec) and exit 0 without creating a
#   sandbox. Operators should run it once in dry-run against a real payload
#   before wiring it live. See docs/clean-script-standard.md.
#
# SCOPE (v1)
#   - Backend: msb (microsandbox) is now acq's DEFAULT backend; sbx (Docker
#     Sandboxes) is still supported. `acq`'s msb adapter mounts each workspace at
#     its host path and supports multiple positional mounts (quickstart#230,
#     #233), so the worktree `.git` pointer resolves the same on both backends —
#     the wrapper is backend-agnostic here. A live msb run is tracked at map #257.
#   - Daemon egress is allow-listed via a small acq kit, NOT a flag (acq has no
#     --net-rule); see AGOR_EGRESS_KIT below and map #259.
#   - USAi key: provisioned to acq out-of-band by the operator (map #252). Agor
#     does not vend a USAi key to the sandbox today (#261).

set -euo pipefail
IFS=$'\n\t'

# --------------------------------------------------------------------------
# Config (environment, with safe defaults). None of these are secrets.
# --------------------------------------------------------------------------
: "${AGOR_ACQ_BIN:=acq}"                 # acq CLI on PATH
: "${AGOR_ACQ_AGENT:=shell}"             # raw sandbox; Agor owns the agent SDK
: "${AGOR_SANDBOX_PREFIX:=agor-}"        # sandbox name prefix
: "${AGOR_SANDBOX_DRY_RUN:=0}"           # 1 = print planned acq commands, don't run
: "${AGOR_EGRESS_KIT:=}"                 # acq kit ref that allow-lists the daemon
                                         #   (local dir or git+https #ref=&dir=);
                                         #   see integrations/isolation/acq-kits/agor-daemon-egress
: "${AGOR_DAEMON_HOST:=host.microsandbox.internal}"  # host alias the sandboxed
                                         #   executor uses to reach the daemon
                                         #   (msb, the default backend); sbx uses
                                         #   host.docker.internal instead
: "${AGOR_USAI_SECRET:=0}"               # 0 = assume a global `usai` acq secret
                                         #   is set (default); 1 = set a per-sandbox
                                         #   secret from AGOR_USAI_KEY_FILE
: "${AGOR_USAI_KEY_FILE:=}"              # optional file the operator populates with
                                         #   the USAi key (used when AGOR_USAI_SECRET=1);
                                         #   piped to `acq secret set`

usage() {
  cat >&2 <<'EOF'
Usage: sandbox-wrapper-acq.sh <session_id>

  Reads the Agor executor JSON payload on stdin, creates an `acq` sandbox with
  the branch worktree mounted, allow-lists the daemon, and runs
  `agor-executor --stdin` inside it.

  Intended as an Agor executor_command_template target:
    executor_command_template: |
      /path/to/sandbox-wrapper-acq.sh {session_id}

Env (all optional; none are secrets):
  AGOR_ACQ_BIN         acq binary (default: acq)
  AGOR_ACQ_AGENT       acq agent mode (default: shell)
  AGOR_SANDBOX_PREFIX  sandbox name prefix (default: agor-)
  AGOR_SANDBOX_DRY_RUN 1 = print the acq commands and exit without creating a sandbox
  AGOR_DATA_HOME       Agor git-data root (repos/ + worktrees/); used to tell an
                       Agor-managed repo from a user local repo. Falls back to
                       AGOR_HOME, then ~/.agor. Export it if your deploy sets
                       paths.data_home only in config.yaml.
  AGOR_MANAGED_ROOTS   extra colon-separated managed roots to allow (e.g. an EFS
                       mount), in addition to AGOR_DATA_HOME
  AGOR_EGRESS_KIT      acq kit ref allow-listing the daemon (local dir or git+https)
  AGOR_DAEMON_HOST     host alias the executor uses to reach the daemon (default: host.microsandbox.internal)
  AGOR_USAI_SECRET     0 = assume a global `usai` secret is set (default);
                       1 = set a per-sandbox secret from AGOR_USAI_KEY_FILE
  AGOR_USAI_KEY_FILE   file holding the USAi key (used when AGOR_USAI_SECRET=1)
EOF
}

# --------------------------------------------------------------------------
# Args
# --------------------------------------------------------------------------
if [[ $# -ne 1 || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && exit 0
  exit 2
fi
SESSION_ID="$1"

# --------------------------------------------------------------------------
# Preconditions
# --------------------------------------------------------------------------
command -v jq >/dev/null 2>&1 || {
  echo "ERROR: jq is required to parse the executor payload" >&2
  exit 3
}
command -v "${AGOR_ACQ_BIN}" >/dev/null 2>&1 || {
  echo "ERROR: acq binary not found: ${AGOR_ACQ_BIN}" >&2
  exit 3
}

# Sandbox name: prefix + first 8 chars of the session id (matches the guides).
SANDBOX_NAME="${AGOR_SANDBOX_PREFIX}${SESSION_ID:0:8}"

# --------------------------------------------------------------------------
# Buffer stdin (the JSON payload) so we can BOTH parse it and pipe it onward.
# The payload is written to a mktemp file; the trap removes it on any exit.
# --------------------------------------------------------------------------
PAYLOAD_FILE="$(mktemp)"
SANDBOX_CREATED=0
cleanup() {
  # Remove the payload temp file (may contain a session JWT — never leave it),
  # plus any rewrite temp file from the daemonUrl step below.
  [[ -n "${PAYLOAD_FILE}" && -f "${PAYLOAD_FILE}" ]] && rm -f "${PAYLOAD_FILE}"
  [[ -n "${PAYLOAD_FILE}" && -f "${PAYLOAD_FILE}.rewrite" ]] && rm -f "${PAYLOAD_FILE}.rewrite"
  # Tear the sandbox down if we created one (best effort). acq rm is already
  # force; do NOT pass --force (acq would misparse it as the sandbox name).
  if [[ "${SANDBOX_CREATED}" -eq 1 ]]; then
    "${AGOR_ACQ_BIN}" rm "${SANDBOX_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cat >"${PAYLOAD_FILE}"

WORKTREE_PATH="$(jq -r '.params.cwd // empty' <"${PAYLOAD_FILE}")"
if [[ -z "${WORKTREE_PATH}" ]]; then
  echo "ERROR: payload has no params.cwd (worktree path)" >&2
  exit 4
fi
if [[ ! -e "${WORKTREE_PATH}/.git" ]]; then
  echo "ERROR: ${WORKTREE_PATH} is not a git workspace (.git missing)" >&2
  exit 4
fi

# --------------------------------------------------------------------------
# Work out the mount set from the worktree's own .git (zero daemon calls).
#
#   worktree mode: .git is a FILE containing "gitdir: <main>/.git/worktrees/<n>"
#     -> mount the worktree + the main repo dir so the pointer resolves.
#        (v1: for Agor-managed REMOTE repos the main dir is a clean clone with
#        no user secrets. For LOCAL repos, mounting the main parent would expose
#        the user's working tree — the wrapper refuses; use clone-mode branches.
#        The exact .git-only hiding mechanism is an open prototype question,
#        map #251/#253.)
#   clone mode: .git is a DIRECTORY (self-contained) -> mount just the clone dir.
#
# On sbx, extra mounts are positional workspace paths mounted at their ABSOLUTE
# HOST path (there is no --mount flag; see map #248). We can't bind only `.git`
# without its parent, so we mount whole directories.
# --------------------------------------------------------------------------
POSITIONAL_MOUNTS=("${WORKTREE_PATH}")

if [[ -f "${WORKTREE_PATH}/.git" ]]; then
  # Worktree mode: derive <main>/.git from the gitdir pointer.
  gitdir_line="$(cat "${WORKTREE_PATH}/.git")"
  # "gitdir: /path/to/main/.git/worktrees/<name>" -> "/path/to/main/.git"
  main_git="${gitdir_line#gitdir: }"
  main_git="${main_git%%/worktrees/*}"
  if [[ -z "${main_git}" || ! -d "${main_git}" ]]; then
    echo "ERROR: could not resolve main .git from worktree pointer: ${gitdir_line}" >&2
    exit 4
  fi
  main_repo_dir="${main_git%/.git}"

  # v1 safety gate: refuse to mount a LOCAL repo's parent checkout, which would
  # expose the user's working tree / .env. Agor-managed repos live UNDER
  # $AGOR_DATA_HOME (its `repos/` bare clones + `worktrees/` trees); anything
  # else is a user's local repo (`agor repo add-local`) and is refused. Per
  # map #251, and confirmed against Agor's path model:
  #   AGOR_DATA_HOME  (env, highest priority)
  #     else paths.data_home in config.yaml   (not readable here — see NOTE)
  #     else AGOR_HOME  (env)
  #     else ~/.agor    (default)
  # Env-driven so it works for k8s/EFS deployments where data_home != ~/.agor.
  # NOTE: this wrapper cannot read config.yaml's paths.data_home; if a deploy
  # sets data_home ONLY in config (not via env), export AGOR_DATA_HOME (or
  # AGOR_MANAGED_ROOTS) for this wrapper too. See the README.
  # Normalize a host path so the gitdir-derived repo path and the managed-root
  # allowlist compare in the same form. Under MSYS/Git Bash, Agor writes the
  # worktree gitdir in native Windows form (C:/...) while $HOME is MSYS form
  # (/c/...); cygpath folds both to mixed Windows form (mirrors acq's
  # canonicalize_path convention, quickstart#463). Elsewhere, resolve symlinks
  # and `..` so the prefix check cannot be fooled by a symlink or a traversing
  # gitdir. Best-effort: if no normalizer is available the path is used as-is.
  _canon_path() {
    local _p="${1:-}"
    [[ -n "${_p}" ]] || { printf '\n'; return 0; }
    if command -v cygpath >/dev/null 2>&1; then
      local _m
      _m="$(cygpath -m "${_p}" 2>/dev/null)" && [[ -n "${_m}" ]] && _p="${_m}"
    else
      local _r
      _r="$(realpath -m "${_p}" 2>/dev/null || realpath "${_p}" 2>/dev/null || true)"
      [[ -n "${_r}" ]] && _p="${_r}"
    fi
    printf '%s\n' "${_p}"
  }

  agor_data_home="${AGOR_DATA_HOME:-${AGOR_HOME:-${HOME:-}/.agor}}"
  # Allow operators to extend the managed-root allowlist (colon-separated),
  # e.g. AGOR_MANAGED_ROOTS="/mnt/efs/agor:/srv/agor-data". A Windows drive
  # letter ("C:/...") also contains a colon, so the list is split with a drive-
  # prefix guard below rather than a bare IFS=':' word-split.
  managed_roots="${agor_data_home}${AGOR_MANAGED_ROOTS:+:${AGOR_MANAGED_ROOTS}}"
  main_repo_dir="$(_canon_path "${main_repo_dir}")"

  managed=0
  _roots=()
  _cur=""
  IFS=':' read -r -a _raw <<< "${managed_roots}" || true
  for _tok in "${_raw[@]}"; do
    if [[ -z "${_cur}" ]]; then
      _cur="${_tok}"
    elif [[ "${_cur}" =~ ^[A-Za-z]$ ]]; then
      _cur="${_cur}:${_tok}"       # re-join a Windows drive letter with its path
    else
      _roots+=("${_cur}")
      _cur="${_tok}"
    fi
  done
  [[ -n "${_cur}" ]] && _roots+=("${_cur}")

  for _root in "${_roots[@]}"; do
    [[ -z "${_root}" ]] && continue
    _root="$(_canon_path "${_root}")"
    case "${main_repo_dir}/" in
    "${_root%/}"/*)
      managed=1
      break
      ;;
    esac
  done

  if [[ "${managed}" -eq 1 ]]; then
    # Agor-managed clean clone under AGOR_DATA_HOME: safe to mount the main .git.
    POSITIONAL_MOUNTS+=("${main_git}")
  else
    echo "ERROR: refusing to mount a non-Agor-managed repo checkout (${main_repo_dir})." >&2
    echo "       It is outside AGOR_DATA_HOME (${agor_data_home}), so it looks like a" >&2
    echo "       user's local repo — mounting its parent could expose .env/working files." >&2
    echo "       v1 supports Agor-managed remote repos or clone-mode branches only." >&2
    echo "       If this IS Agor-managed, export AGOR_DATA_HOME/AGOR_MANAGED_ROOTS." >&2
    echo "       See map #251 (mount strategy)." >&2
    exit 5
  fi
elif [[ -d "${WORKTREE_PATH}/.git" ]]; then
  : # Clone mode: self-contained .git; the worktree mount alone is enough.
fi

# --------------------------------------------------------------------------
# Assemble the acq create argv. Agent positional FIRST, then workspace(s).
# The egress kit (if provided) is applied via --kit (repeatable).
# --------------------------------------------------------------------------
create_args=("create" "${AGOR_ACQ_AGENT}")
for m in "${POSITIONAL_MOUNTS[@]}"; do
  create_args+=("${m}")
done
create_args+=("--name" "${SANDBOX_NAME}")
if [[ -n "${AGOR_EGRESS_KIT}" ]]; then
  create_args+=("--kit" "${AGOR_EGRESS_KIT}")
else
  echo "WARNING: AGOR_EGRESS_KIT is unset — the sandbox may not reach the daemon." >&2
  echo "         Provide the agor-daemon-egress kit ref (see map #259)." >&2
fi

# --------------------------------------------------------------------------
# Dry-run: print the plan and exit without touching acq.
# --------------------------------------------------------------------------
if [[ "${AGOR_SANDBOX_DRY_RUN}" -eq 1 ]]; then
  echo "[dry-run] worktree:      ${WORKTREE_PATH}"
  echo "[dry-run] mounts:        ${POSITIONAL_MOUNTS[*]}"
  echo "[dry-run] ${AGOR_ACQ_BIN} ${create_args[*]}"
  if [[ "${AGOR_USAI_SECRET}" -eq 1 ]]; then
    echo "[dry-run] ${AGOR_ACQ_BIN} secret set ${SANDBOX_NAME} usai   (key piped on stdin)"
  fi
  echo "[dry-run] <payload> | ${AGOR_ACQ_BIN} exec ${SANDBOX_NAME} -- agor-executor --stdin"
  echo "[dry-run] ${AGOR_ACQ_BIN} rm ${SANDBOX_NAME}   (on exit)"
  exit 0
fi

# --------------------------------------------------------------------------
# Create the sandbox.
# --------------------------------------------------------------------------
"${AGOR_ACQ_BIN}" "${create_args[@]}"
SANDBOX_CREATED=1

# --------------------------------------------------------------------------
# Provision the per-sandbox USAi secret (out-of-band; not fetched from Agor —
# map #252). By default (AGOR_USAI_SECRET=0) a GLOBAL `usai` secret is assumed to
# have been set once via `acq secret set -g usai`, so nothing happens here. When
# AGOR_USAI_SECRET=1, set a per-sandbox secret from AGOR_USAI_KEY_FILE, piped on
# stdin so it never appears in argv/process list.
# --------------------------------------------------------------------------
if [[ "${AGOR_USAI_SECRET}" -eq 1 ]]; then
  if [[ -n "${AGOR_USAI_KEY_FILE}" && -r "${AGOR_USAI_KEY_FILE}" ]]; then
    "${AGOR_ACQ_BIN}" secret set "${SANDBOX_NAME}" usai <"${AGOR_USAI_KEY_FILE}" ||
      echo "WARNING: 'acq secret set ${SANDBOX_NAME} usai' failed; USAi calls may fail." >&2
  else
    echo "NOTE: AGOR_USAI_SECRET=1 but AGOR_USAI_KEY_FILE is unset/unreadable; no per-sandbox secret." >&2
    echo "      Provide AGOR_USAI_KEY_FILE, or set AGOR_USAI_SECRET=0 to use the global secret." >&2
  fi
fi

# --------------------------------------------------------------------------
# Rewrite a loopback daemonUrl in the payload to the sandbox-reachable host
# alias before handing it to agor-executor. Agor advertises
# http://localhost:3030 by default, but inside the sandbox localhost/127.0.0.1
# is the GUEST's own loopback — it never reaches the host daemon. The executor
# connects to payload.daemonUrl, so we point a loopback host at AGOR_DAEMON_HOST
# (host.docker.internal for sbx, host.microsandbox.internal for msb), preserving
# scheme and :port. A non-loopback URL (remote daemon) is left untouched.
# --------------------------------------------------------------------------
_durl="$(jq -r '.daemonUrl // empty' <"${PAYLOAD_FILE}")"
if [[ -n "${_durl}" ]]; then
  _d_scheme="${_durl%%://*}"
  _d_rest="${_durl#*://}"
  if [[ "${_d_rest}" != "${_durl}" ]]; then
    _d_authority="${_d_rest%%/*}"
    _d_host="${_d_authority%%:*}"
    # Case-insensitive host match (URL hosts are case-insensitive); keep the
    # original for the suffix slice. IPv6 loopback ([::1]) is not handled — it is
    # left untouched rather than corrupted.
    _d_host_lc="$(printf '%s' "${_d_host}" | tr '[:upper:]' '[:lower:]')"
    case "${_d_host_lc}" in
      localhost|127.0.0.1)
        _d_path="${_d_rest#"${_d_authority}"}"
        _d_suffix="${_d_authority#"${_d_host}"}"
        # umask 077 keeps the rewrite file private (it holds the session JWT);
        # mktemp's 0600 on the original is otherwise lost to the redirect.
        (umask 077; jq --arg u "${_d_scheme}://${AGOR_DAEMON_HOST}${_d_suffix}${_d_path}" \
          '.daemonUrl = $u' <"${PAYLOAD_FILE}" >"${PAYLOAD_FILE}.rewrite")
        mv "${PAYLOAD_FILE}.rewrite" "${PAYLOAD_FILE}"
        chmod 600 "${PAYLOAD_FILE}" 2>/dev/null || true
        ;;
    esac
  fi
fi

# --------------------------------------------------------------------------
# Run the executor inside the sandbox, piping the buffered payload to its stdin.
# The executor connects back to the daemon over WebSocket using the payload's
# sessionToken; the egress kit must allow that route.
# --------------------------------------------------------------------------
"${AGOR_ACQ_BIN}" exec "${SANDBOX_NAME}" -- agor-executor --stdin <"${PAYLOAD_FILE}"
