#!/usr/bin/env bash
#
# sandbox-wrapper-acq.sh — run an Agor executor task inside an `acq` sandbox.
#
# STATUS: DRAFT (v1, sbx backend). Authored AFK via the wayfinder map
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
#   - Backend: sbx only. `acq`'s msb adapter mounts at a FIXED guest path
#     (/home/agent/workspace), not the host path, which breaks the worktree
#     `.git` pointer and Agor's same-absolute-path assumption. msb is tracked
#     as a gap (map #260).
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
: "${AGOR_USAI_SECRET:=1}"               # 1 = set the per-sandbox `usai` acq secret
: "${AGOR_USAI_KEY_FILE:=}"              # optional file the operator populates with
                                         #   the USAi key; piped to `acq secret set`

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
  AGOR_USAI_SECRET     1 = provision the per-sandbox `usai` acq secret (default: 1)
  AGOR_USAI_KEY_FILE   file holding the USAi key to pipe to `acq secret set`
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
  # Remove the payload temp file (may contain a session JWT — never leave it).
  [[ -n "${PAYLOAD_FILE}" && -f "${PAYLOAD_FILE}" ]] && rm -f "${PAYLOAD_FILE}"
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
  agor_data_home="${AGOR_DATA_HOME:-${AGOR_HOME:-${HOME}/.agor}}"
  # Allow operators to extend the managed-root allowlist (colon-separated),
  # e.g. AGOR_MANAGED_ROOTS="/mnt/efs/agor:/srv/agor-data".
  managed_roots="${agor_data_home}${AGOR_MANAGED_ROOTS:+:${AGOR_MANAGED_ROOTS}}"

  managed=0
  _IFS_SAVE="${IFS}"
  IFS=':'
  for root in ${managed_roots}; do
    [[ -z "${root}" ]] && continue
    case "${main_repo_dir}/" in
    "${root%/}"/*)
      managed=1
      break
      ;;
    esac
  done
  IFS="${_IFS_SAVE}"

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
# map #252). The key is piped on stdin so it never appears in argv/process list.
# --------------------------------------------------------------------------
if [[ "${AGOR_USAI_SECRET}" -eq 1 ]]; then
  if [[ -n "${AGOR_USAI_KEY_FILE}" && -r "${AGOR_USAI_KEY_FILE}" ]]; then
    "${AGOR_ACQ_BIN}" secret set "${SANDBOX_NAME}" usai <"${AGOR_USAI_KEY_FILE}" ||
      echo "WARNING: 'acq secret set ${SANDBOX_NAME} usai' failed; USAi calls may fail." >&2
  else
    echo "NOTE: AGOR_USAI_KEY_FILE unset/unreadable; skipping per-sandbox USAi secret." >&2
    echo "      Provide it, or set a global secret once: acq secret set -g usai" >&2
  fi
fi

# --------------------------------------------------------------------------
# Run the executor inside the sandbox, piping the buffered payload to its stdin.
# The executor connects back to the daemon over WebSocket using the payload's
# sessionToken; the egress kit must allow that route.
# --------------------------------------------------------------------------
"${AGOR_ACQ_BIN}" exec "${SANDBOX_NAME}" -- agor-executor --stdin <"${PAYLOAD_FILE}"
