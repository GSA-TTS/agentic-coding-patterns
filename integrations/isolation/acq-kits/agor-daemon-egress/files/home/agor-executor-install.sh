#!/usr/bin/env bash
#
# agor-executor-install.sh — install the Agor executor into the sandbox (create-time).
#
# The orchestrators/agor wrapper runs `agor-executor --stdin` inside the sandbox,
# but agor-live's npm `bin` exposes only `agor`/`agor-daemon` — NOT `agor-executor`
# (which is dist/executor/cli.js). This script installs agor-live from npm and
# writes a thin `agor-executor` shim that execs the executor CLI with node.
#
# Idempotent: skips the npm install when the shim and the executor CLI are already
# present. Non-fatal: a failed install warns and exits 0 so the sandbox still
# starts (the executor can be re-installed on a later start) — matching the
# agentic-coding-playbook kit's degrade-gracefully contract.
#
# Runs as root (uid 0) at create time (phase: install). The executor is
# BUSL-licensed third-party code, so it is fetched from npm at runtime rather than
# committed to this CC0 kit.
#
# AGOR_EXECUTOR_VERSION: pin to a specific agor-live version to lock the executor
# to the daemon (default: latest).

set -uo pipefail

AGOR_EXECUTOR_VERSION="${AGOR_EXECUTOR_VERSION:-latest}"
EXECUTOR_BIN="/usr/local/bin/agor-executor"
NPM_GLOBAL_ROOT="$(npm root -g 2>/dev/null || echo '')"
CLI_PATH="${NPM_GLOBAL_ROOT}/agor-live/dist/executor/cli.js"

if [ -x "${EXECUTOR_BIN}" ] && [ -f "${CLI_PATH}" ]; then
  echo "agor-executor already installed; skipping." >&2
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "WARNING: npm not found in the sandbox; cannot install agor-executor." >&2
  echo "         The wrapper's \`acq exec … -- agor-executor --stdin\` will fail until" >&2
  echo "         the base image ships node/npm." >&2
  exit 0
fi

echo "Installing agor-live@${AGOR_EXECUTOR_VERSION} (executor runtime)…" >&2
if ! npm install -g --no-fund --no-audit "agor-live@${AGOR_EXECUTOR_VERSION}"; then
  echo "WARNING: npm install agor-live failed; agor-executor will not be available." >&2
  exit 0
fi

# npm install -g may have moved the global root; re-resolve it.
NPM_GLOBAL_ROOT="$(npm root -g 2>/dev/null || echo '')"
CLI_PATH="${NPM_GLOBAL_ROOT}/agor-live/dist/executor/cli.js"
if [ ! -f "${CLI_PATH}" ]; then
  echo "WARNING: installed agor-live but could not locate ${CLI_PATH}; agor-executor will not be available." >&2
  exit 0
fi

# Write the shim. agor-live's bin does not include agor-executor.
cat > "${EXECUTOR_BIN}" <<EOF
#!/usr/bin/env bash
exec node "${CLI_PATH}" "\$@"
EOF
chmod 0755 "${EXECUTOR_BIN}"

echo "agor-executor installed at ${EXECUTOR_BIN} -> ${CLI_PATH}" >&2
