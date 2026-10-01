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
: "${AGOR_ACQ_BACKEND:=}"                # optional acq backend selector (msb or sbx);
                                         #   passed through as `acq --backend ...`
: "${AGOR_DAEMON_HOST:=}"                # optional override for the sandbox host
                                         #   alias used to reach the daemon
: "${AGOR_USAI_SECRET:=0}"               # 0 = assume a global `usai` acq secret
                                         #   is set (default); 1 = set a per-sandbox
                                         #   secret from AGOR_USAI_KEY_FILE
: "${AGOR_USAI_KEY_FILE:=}"              # optional file the operator populates with
                                         #   the USAi key (used when AGOR_USAI_SECRET=1);
                                         #   piped to `acq secret set`

_daemon_host_for_backend() {
  case "${1}" in
    ""|msb) printf '%s\n' "host.microsandbox.internal" ;;
    sbx) printf '%s\n' "host.docker.internal" ;;
    *)
      echo "ERROR: unsupported AGOR_ACQ_BACKEND '${1}' (expected msb or sbx)" >&2
      exit 2
      ;;
  esac
}

# Normalize a host path so gitdir-derived paths and managed-root allowlist entries
# compare in the same form. On MSYS/Git Bash, cygpath folds /c/... and C:/...
# into one comparable form; elsewhere realpath resolves symlinks and traversals.
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

_split_managed_roots() {
  _roots=()
  _cur=""
  IFS=':' read -r -a _raw <<< "${1}" || true
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
}

_join_args() {
  local IFS=' '
  printf '%s' "$*"
}

_is_agor_managed_path() {
  local _path
  _path="$(_canon_path "${1}")"
  local _root
  _split_managed_roots "${managed_roots}"
  for _root in "${_roots[@]}"; do
    [[ -z "${_root}" ]] && continue
    _root="$(_canon_path "${_root}")"
    case "${_path}/" in
    "${_root%/}"/*)
      return 0
      ;;
    esac
  done
  return 1
}

AGOR_DAEMON_HOST="${AGOR_DAEMON_HOST:-$(_daemon_host_for_backend "${AGOR_ACQ_BACKEND}")}"

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
  AGOR_ACQ_BACKEND     optional acq backend selector (msb or sbx); passed through
                       as `acq --backend ...` and used for the daemon host alias
  AGOR_DAEMON_HOST     optional host-alias override; otherwise derived from
                       AGOR_ACQ_BACKEND, defaulting to msb's host alias
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
ACQ_BASE_ARGS=()
if [[ -n "${AGOR_ACQ_BACKEND}" ]]; then
  ACQ_BASE_ARGS+=("--backend" "${AGOR_ACQ_BACKEND}")
fi

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
    "${AGOR_ACQ_BIN}" "${ACQ_BASE_ARGS[@]}" rm "${SANDBOX_NAME}" >/dev/null 2>&1 || true
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
#   clone mode: .git is a DIRECTORY (self-contained) -> mount just the clone dir
#     after verifying the clone is under an Agor managed root.
#
# On sbx, extra mounts are positional workspace paths mounted at their ABSOLUTE
# HOST path (there is no --mount flag; see map #248). We can't bind only `.git`
# without its parent, so we mount whole directories.
# --------------------------------------------------------------------------
POSITIONAL_MOUNTS=("${WORKTREE_PATH}")
agor_data_home="${AGOR_DATA_HOME:-${AGOR_HOME:-${HOME:-}/.agor}}"
# Allow operators to extend the managed-root allowlist (colon-separated), e.g.
# AGOR_MANAGED_ROOTS="/mnt/efs/agor:/srv/agor-data". A Windows drive letter
# also contains a colon, so _split_managed_roots handles C:/... entries.
managed_roots="${agor_data_home}${AGOR_MANAGED_ROOTS:+:${AGOR_MANAGED_ROOTS}}"

if [[ -f "${WORKTREE_PATH}/.git" ]]; then
  # Worktree mode: derive <main>/.git from the gitdir pointer.
  gitdir_line="$(cat "${WORKTREE_PATH}/.git")"
  # "gitdir: /path/to/main/.git/worktrees/<name>" -> "/path/to/main/.git"
  main_git="${gitdir_line#gitdir: }"
  if [[ "${main_git}" != */.git/worktrees/* ]]; then
    echo "ERROR: unexpected worktree gitdir path (missing /.git/worktrees/): ${gitdir_line}" >&2
    exit 4
  fi
  main_git="${main_git%/worktrees/*}"
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
  main_repo_dir="$(_canon_path "${main_repo_dir}")"

  if ! _is_agor_managed_path "${WORKTREE_PATH}"; then
    echo "ERROR: refusing to mount a non-Agor-managed worktree (${WORKTREE_PATH})." >&2
    echo "       It is outside AGOR_DATA_HOME (${agor_data_home}), so it looks like a" >&2
    echo "       user's local worktree — mounting it could expose .env/working files." >&2
    echo "       If this IS Agor-managed, export AGOR_DATA_HOME/AGOR_MANAGED_ROOTS." >&2
    exit 5
  fi

  if _is_agor_managed_path "${main_repo_dir}"; then
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
  # Clone mode is self-contained, but still must be Agor-managed. Otherwise any
  # arbitrary host clone with a .git/ directory could be mounted into the sandbox.
  if ! _is_agor_managed_path "${WORKTREE_PATH}"; then
    echo "ERROR: refusing to mount a non-Agor-managed clone (${WORKTREE_PATH})." >&2
    echo "       It is outside AGOR_DATA_HOME (${agor_data_home}), so it looks like a" >&2
    echo "       user's local clone. v1 supports Agor-managed remote repos only." >&2
    echo "       If this IS Agor-managed, export AGOR_DATA_HOME/AGOR_MANAGED_ROOTS." >&2
    exit 5
  fi
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
  echo "[dry-run] mounts:        $(_join_args "${POSITIONAL_MOUNTS[@]}")"
  echo "[dry-run] ${AGOR_ACQ_BIN} $(_join_args "${ACQ_BASE_ARGS[@]}" "${create_args[@]}")"
  if [[ "${AGOR_USAI_SECRET}" -eq 1 ]]; then
    echo "[dry-run] ${AGOR_ACQ_BIN} $(_join_args "${ACQ_BASE_ARGS[@]}" secret set "${SANDBOX_NAME}" usai)   (key piped on stdin)"
  fi
  echo "[dry-run] <payload> | ${AGOR_ACQ_BIN} $(_join_args "${ACQ_BASE_ARGS[@]}" exec "${SANDBOX_NAME}" -- agor-executor --stdin)"
  echo "[dry-run] ${AGOR_ACQ_BIN} $(_join_args "${ACQ_BASE_ARGS[@]}" rm "${SANDBOX_NAME}")   (on exit)"
  exit 0
fi

# --------------------------------------------------------------------------
# Create the sandbox.
# --------------------------------------------------------------------------
"${AGOR_ACQ_BIN}" "${ACQ_BASE_ARGS[@]}" "${create_args[@]}"
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
    "${AGOR_ACQ_BIN}" "${ACQ_BASE_ARGS[@]}" secret set "${SANDBOX_NAME}" usai <"${AGOR_USAI_KEY_FILE}" ||
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
"${AGOR_ACQ_BIN}" "${ACQ_BASE_ARGS[@]}" exec "${SANDBOX_NAME}" -- agor-executor --stdin <"${PAYLOAD_FILE}"
