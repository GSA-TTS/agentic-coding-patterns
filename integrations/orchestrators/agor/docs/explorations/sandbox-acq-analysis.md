# Using `acq` with Agor — Compatibility Analysis

**Status:** 🔬 Exploration
**Related:** [`sandbox-abstraction.md`](./sandbox-abstraction.md) (the Agor sandbox abstraction design)
**Date:** 2026-07-13

---

## Question

Can the notional `acq` CLI (from GSA-TTS/agentic-coding-quickstart v2) be used as the sandbox backend for Agor's executor? Specifically:

1. Could the Agor wrapper script call `acq` instead of `msb`/`sbx` directly?
2. How would the four kits (playbook clone, Zscaler CA, git-ssh-sign, USAi provider) interact with Agor?
3. Does Agor have a better way to populate playbook/skills in a sandbox?
4. Is SSH agent forwarding handled as normal by `acq`?
5. How would configuring agents (initially OpenCode) to use USAi work — which parts are Agor's responsibility vs. the wrapper's vs. `acq`'s?

---

## 1. Can the wrapper script call `acq`?

**Yes.** Like sbx, `acq` has a shell option (`acq run shell` / `acq create shell`) that provides a raw sandbox with no pre-installed agent. Since Agor's executor owns agent setup and lifecycle, the wrapper uses the shell mode and pipes `agor-executor --stdin` inside:

```bash
acq create shell "$WORKTREE_PATH" --name "$SANDBOX_NAME"
echo "$PAYLOAD" | acq exec "$SANDBOX_NAME" -- agor-executor --stdin
```

This mirrors how the wrapper uses sbx's `sbx run shell` or msb's generic `msb run ubuntu --` — the sandbox is just a box; Agor manages the agent inside it. `acq`'s agent-aware commands (`acq run opencode`) are not used.

`acq`'s kit system is the real value — it handles the four concerns (USAi, playbook, Zscaler, git-sign) declaratively, regardless of which agent mode is used. The question is whether those concerns overlap with things Agor already handles.

---

## 2. The Four Kits — How They Map to Agor

### 2.1 `usai-provider` — Agent model provider configuration

**What the kit does:** Drops an `opencode.jsonc` config file into the sandbox that points OpenCode at `api.gsa.usai.gov`, and merges it into OpenCode's global config at startup. The USAi API key is injected via MITM proxy (swap-on-access) — the agent never sees the key.

**What Agor does today:** Agor's executor handles agent credentials via `installProviderConnection()` (`base-executor.ts:350`), which resolves API keys from the daemon and sets them as env vars. **But OpenCode is explicitly excluded from this path** — `isProviderConnectionTool()` returns `false` for OpenCode (`tenant-agentic-tool.ts:92`). OpenCode manages its own provider connections via its config files.

**The conflict:** Both `acq` and Agor want to control agent configuration. For OpenCode specifically:

| Concern | Agor's role | `acq`'s role |
|---|---|---|
| Which model to use | Sets `model_config.provider` + `model_config.model` on the session, passes to OpenCode SDK | Not involved |
| Which API endpoint | **Not handled for OpenCode** (no `baseURL` field for OpenCode) | USAi kit configures `api.gsa.usai.gov` in `opencode.jsonc` |
| API key | **Not handled for OpenCode** (OpenCode reads its own config) | MITM proxy injects key on outbound (swap-on-access) |
| API key env var | Not set for OpenCode | Kit reads `USAI_API_KEY` env var (placeholder mode) or MITM injects (swap-on-access) |

**Recommendation:** For OpenCode + USAi, **`acq` should own the provider configuration.** Agor's executor doesn't handle OpenCode credentials, so there's no conflict. The kit's `opencode.jsonc` + MITM key injection is the right mechanism.

**For future agents (Claude, Codex):** Agor's `installProviderConnection()` DOES handle these. If USAi support is added for Claude/Codex, the configuration would need to be coordinated:
- Agor would set `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` (or `OPENAI_API_KEY` / `OPENAI_BASE_URL`) via its credential resolution
- OR `acq`'s MITM proxy would handle it (swap-on-access), and Agor would be configured to NOT install provider creds for sessions running in `acq` sandboxes

The cleanest split: **`acq` owns network-level credential injection (MITM); Agor owns agent-level model selection.** Agor tells the agent *which* model to use; `acq` ensures the API key reaches the endpoint. This requires a config flag in Agor like `execution.sandbox.skip_provider_credential_install: true` when using sandbox mode.

### 2.2 `agentic-coding-playbook` — Playbook clone + skill symlinks

**What the kit does:** At sandbox startup, clones `GSA-TTS/agentic-coding-playbook` at a pinned commit into `~/.agentic-coding-playbook`, then symlinks `AGENTS.md` → `~/.config/opencode/AGENTS.md` and skills → `~/.agents/skills/`.

**What Agor does today:** Agor doesn't place any files in agent search paths. The agent discovers `AGENTS.md` / `CLAUDE.md` from the worktree's cwd (the branch path). Agor injects its system prompt via the SDK's API, not via files.

**Does Agor have a better way?** Potentially yes:

1. **Mount the playbook read-only into the sandbox.** Instead of cloning inside the sandbox at startup (which requires network access + a GitHub token), the wrapper script could clone the playbook on the host and mount it read-only:
   ```bash
   # In the wrapper script:
   PLAYBOOK_DIR="$HOME/.agor-cache/agentic-coding-playbook"
   if [ ! -d "$PLAYBOOK_DIR/.git" ]; then
     git clone https://github.com/GSA-TTS/agentic-coding-playbook.git "$PLAYBOOK_DIR"
   fi
   git -C "$PLAYBOOK_DIR" fetch && git -C "$PLAYBOOK_DIR" checkout <pinned-ref>
   # Mount read-only into the sandbox
   MOUNT_ARGS+=(-v "$PLAYBOOK_DIR:$PLAYBOOK_DIR:ro")
   ```
   This is faster (no clone at startup), works offline, and doesn't require network egress to GitHub from inside the sandbox.

2. **Symlink from the worktree.** If the playbook is mounted at a known path, the wrapper script could create symlinks in the worktree before mounting it:
   ```bash
   ln -sf "$PLAYBOOK_DIR/AGENTS.md" "$WORKTREE_PATH/AGENTS.md"
   ln -sf "$PLAYBOOK_DIR/.agents/skills" "$WORKTREE_PATH/.agents/skills"
   ```
   But this modifies the worktree, which may not be desirable (it shows up in `git status`).

3. **Use Agor's MCP server.** Agor exposes itself as an MCP server. The playbook could be exposed as MCP resources, and the agent would discover them via the MCP protocol. This is the most "Agor-native" approach but requires MCP resource support in the agent (OpenCode supports this).

**Recommendation:** **Let `acq`'s kit handle it for now.** The kit's clone-at-startup approach works, and the GitHub token is handled by `acq`'s MITM proxy. If performance (clone time) or offline use becomes a concern, the host-side clone + read-only mount approach is a straightforward optimization. Agor doesn't need to change.

### 2.3 `zscaler-ca-certificate` — Install Zscaler Root CA

**What the kit does:** Installs the Zscaler Root CA into the sandbox's system trust store so HTTPS works through Zscaler-intercepting proxies. Uses `--trust-host-cas` on msb (imports host CAs automatically) or file-drop + `update-ca-certificates` on sbx/ppp.

**What Agor does today:** Nothing — this is purely a sandbox-level concern. Agor's executor runs as a process on the host, which already trusts the Zscaler CA.

**Conflict?** None. This is entirely `acq`'s domain. The Agor wrapper script doesn't need to know about Zscaler at all.

**Recommendation:** **`acq` owns this entirely.** No Agor changes needed.

### 2.4 `git-ssh-sign` — Sign git commits with forwarded SSH key

**What the kit does:** Configures git inside the sandbox to sign commits/tags with the host's SSH agent key. The SSH agent socket is forwarded into the sandbox; a signing-key-command script reads `ssh-add -L` at signing time.

**What Agor does today:** Agor's executor authenticates git operations via HTTPS + token (per `clone-redesign.md`). SSH agent forwarding was explicitly dropped: "Agent sockets are per-Unix-session and don't transfer across `sudo -u`." The env whitelist for impersonated spawns does NOT include `SSH_AUTH_SOCK`.

**But:** In a sandbox, there's no `sudo -u` boundary — the sandbox has its own SSH agent forwarding mechanism. `acq`'s kit handles this per-backend (sbx: SSH agent socket forwarded; msb: `msb ssh authorize`; ppp: `podman machine ssh -A`).

**Conflict?** No, but there's a question of **which git identity** the agent uses:

| Concern | Agor's role | `acq`'s role |
|---|---|---|
| Git auth (push/pull) | HTTPS + token via `fetchUserGitEnvironment()` | GitHub token via MITM proxy (swap-on-access) |
| Git commit signing | Not handled | SSH agent forwarding via kit |
| Git author identity | `required_user_env_vars` can enforce `GIT_AUTHOR_NAME`/`EMAIL` | Kit warns if missing |

**Potential issue:** If both Agor and `acq` inject GitHub tokens, they could conflict. Agor injects the token via `GIT_CONFIG_COUNT`/`http.extraheader` env vars; `acq`'s MITM proxy injects `Authorization` headers on outbound HTTPS. These are different mechanisms and shouldn't conflict — Agor's env vars are for the executor process's git operations, while `acq`'s MITM is for the sandbox's outbound traffic.

**But:** If the sandbox's git is configured to use SSH (for signing), it needs the SSH agent. If it's configured to use HTTPS (for push/pull), it needs the token. The kit handles SSH; Agor handles HTTPS tokens. They're complementary.

**Recommendation:** **`acq` owns commit signing; Agor owns push/pull auth.** The wrapper script should ensure `SSH_AUTH_SOCK` is available to `acq` (it is — `acq` runs on the host and handles agent forwarding itself). No Agor changes needed.

---

## 3. Does Agor Have a Better Way to Populate Playbook/Skills?

**Short answer: No, and that's fine.**

Agor's context injection is SDK-specific:
- **Claude:** System prompt via SDK's `systemPrompt` option (not file-based)
- **Codex:** Temp file with instructions (not `AGENTS.md`)
- **OpenCode:** Discovers `AGENTS.md` from the worktree cwd (no injection)
- **Gemini:** Temp file with context (not `GEMINI.md`)

The playbook's `AGENTS.md` and skills are designed to be discovered via the agent's normal file-walking (from cwd). Agor doesn't interfere with this — it just sets the cwd to the worktree path. If the playbook is cloned into the sandbox at `~/.agentic-coding-playbook` and symlinked into the agent's search paths, the agent discovers it naturally.

**Could Agor do better?** A future enhancement could be:
- Agor mounts a "context directory" into the sandbox at a well-known path (e.g., `/agor-context/`)
- This directory contains the playbook, skills, and any other shared context
- The wrapper script creates symlinks from the agent's search paths into this directory

But this is an optimization, not a requirement. `acq`'s kit-based approach works today.

---

## 4. Is SSH Agent Forwarding Handled as Normal by `acq`?

**Yes.** `acq` handles SSH agent forwarding per-backend:
- **sbx:** SSH agent socket forwarded into the sandbox (built-in)
- **msb:** `msb ssh authorize --file ~/.ssh/id_ed25519.pub` registers the key; `msb ssh <name>` attaches with agent forwarding
- **ppp:** `podman machine ssh -A <name>` propagates `SSH_AUTH_SOCK`

The Agor wrapper script doesn't need to do anything special — `acq` runs on the host where the SSH agent lives, and `acq` handles the forwarding into the sandbox. The `git-ssh-sign` kit then configures git inside the sandbox to use the forwarded agent.

**One caveat:** Agor's executor process (running inside the sandbox) inherits the sandbox's environment. If `SSH_AUTH_SOCK` is set in the sandbox (by `acq`'s forwarding), the executor's git operations could use it. But Agor's git operations use HTTPS + token, not SSH. This shouldn't conflict, but the wrapper script should be aware that both mechanisms may be present.

---

## 5. USAi Configuration — Who Owns What?

This is the most complex question. The answer depends on the agent:

### For OpenCode (the initial target)

| Layer | Owner | Mechanism |
|---|---|---|
| **Which model** | Agor | `model_config.provider` + `model_config.model` on the session → passed to OpenCode SDK |
| **Which endpoint** | `acq` (usai-provider kit) | `opencode.jsonc` in sandbox configures `api.gsa.usai.gov` |
| **API key** | `acq` (MITM proxy) | Swap-on-access: agent sends request with no auth header, MITM injects `Authorization: Bearer <key>` |
| **Network egress** | `acq` (kit caps) | `caps.network.allow: [api.gsa.usai.gov]` → `--net-rule` flags |
| **Config file merge** | `acq` (kit commands) | `merge-global-config.mjs` runs at startup |

**Agor's role is minimal for OpenCode:** it just tells OpenCode which model to use. `acq` handles everything else. This is clean because Agor explicitly doesn't manage OpenCode credentials.

### For Claude/Codex (future, if USAi support is added)

| Layer | Owner | Mechanism |
|---|---|---|
| **Which model** | Agor | `model_config.model` on the session |
| **Which endpoint** | **Conflict** — Agor sets `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` via `installProviderConnection()`; `acq` kit would also configure the endpoint | Needs coordination |
| **API key** | **Conflict** — Agor sets `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` via `installProviderConnection()`; `acq` MITM would inject on outbound | Needs coordination |
| **Network egress** | `acq` (kit caps) | Same as OpenCode |
| **Config file** | N/A (Claude/Codex don't use `opencode.jsonc`) | `acq` kit would need Claude/Codex-specific config |

**Resolution for future agents:** Two options:

1. **`acq` owns credentials, Agor disables credential install.** Add a config flag like `execution.sandbox.skip_provider_credential_install: true`. When running in sandbox mode, Agor's executor skips `installProviderConnection()` and lets `acq`'s MITM proxy handle API key injection. Agor still sets the model name and provider, but not the endpoint or key.

2. **Agor owns credentials, `acq` only handles network egress.** Agor resolves the USAi API key via its existing credential resolution (user stores USAi key in Agor settings as a custom provider), and `acq` only allow-lists the USAi endpoint. No MITM injection needed.

**Recommendation:** Option 1 is cleaner for the GSA use case. `acq`'s MITM model is specifically designed for this (swap-on-access, cross-host leak guard, per-sandbox key scoping for billing codes). Agor's credential resolution is more general-purpose. For the GSA/USAi case, `acq`'s model is a better fit. The Agor flag to skip credential install is a small, clean change.

### The Daemon Reachability Question

Agor's executor (inside the sandbox) must connect to the daemon (on the host) via WebSocket. The sandbox network policy must allow this. `acq`'s kit caps would need to include the daemon URL:

```yaml
caps:
  network:
    allow:
      - api.gsa.usai.gov
      - host.microsandbox.internal:3030  # or host.docker.internal:3030 for sbx
```

Or the wrapper script adds this as an extra network rule:
```bash
acq create opencode "$WORKTREE_PATH" --name "$SANDBOX_NAME" \
  --extra-net-rule "allow@host.microsandbox.internal:3030"
```

**This is a wrapper-script concern, not an `acq` or Agor concern.** The wrapper script knows the daemon URL and adds it to the sandbox's allow-list.

---

## 6. Revised Wrapper Script Using `acq`

```bash
#!/bin/bash
# ~/.agor/sandbox-wrapper-acq.sh
# Uses acq as the sandbox backend.

set -euo pipefail
SESSION_ID="$1"
SANDBOX_NAME="agor-${SESSION_ID:0:8}"
DAEMON_URL="${AGOR_DAEMON_URL:-http://localhost:3030}"

# Buffer stdin (JSON payload)
PAYLOAD=$(cat)
WORKTREE_PATH=$(echo "$PAYLOAD" | jq -r '.params.cwd')

# Discover main repo .git path from the worktree's .git file
if [ -f "$WORKTREE_PATH/.git" ]; then
  GITDIR_LINE=$(cat "$WORKTREE_PATH/.git")
  MAIN_GIT=$(echo "$GITDIR_LINE" | sed 's|gitdir: \(.*\)/worktrees/.*|\1|')
  # For acq, we pass the workspace path — acq handles mounting
  # But we also need the .git dir. acq's kit system doesn't know about
  # Agor's worktree structure, so we use --extra-mount
  EXTRA_MOUNTS="--extra-mount $MAIN_GIT:$MAIN_GIT:rw"
elif [ -d "$WORKTREE_PATH/.git" ]; then
  EXTRA_MOUNTS=""  # Clone mode: self-contained
fi

# Create sandbox using acq (applies the four pinned kits automatically)
# The workspace is the worktree path; acq mounts it
acq create opencode "$WORKTREE_PATH" \
  --name "$SANDBOX_NAME" \
  $EXTRA_MOUNTS \
  --extra-net-rule "allow@host.microsandbox.internal:3030"

# Cleanup on exit
trap "acq rm --force $SANDBOX_NAME 2>/dev/null" EXIT

# Pipe JSON payload to agor-executor inside the sandbox
echo "$PAYLOAD" | acq exec "$SANDBOX_NAME" -- agor-executor --stdin
```

**Key differences from the raw `msb` wrapper:**
1. `acq create` handles kit application (USAi, playbook, Zscaler, git-sign) automatically
2. The wrapper doesn't need to handle Zscaler certs, SSH agent forwarding, or USAi config files — `acq` + kits do that
3. The wrapper still handles the Agor-specific concerns: discovering the `.git` path from the worktree, mounting it, allowing daemon access, piping the executor payload
4. `acq` is worktree-unaware — the wrapper tells it what to mount, and `acq` mounts at the same host path
5. The USAi API key is fetched from Agor's credential resolution and passed to `acq` per-sandbox — `acq` does NOT own key rotation

---

## 7. Summary — Who Owns What

| Concern | Agor | Wrapper Script | `acq` + Kits |
|---|---|---|---|
| Agent model selection | ✅ `model_config` | | |
| Agent credentials (OpenCode) | ❌ (not handled) | | ✅ MITM swap-on-access |
| Agent credentials (Claude/Codex) | ✅ `installProviderConnection()` | | ⚠️ Needs coordination (skip flag) |
| Worktree mount | | ✅ Discover from `.git` file | |
| Main repo `.git` mount | | ✅ Mount rw | |
| Daemon network access | | ✅ `--extra-net-rule` | |
| USAi API key storage & rotation | ✅ User profiles (encrypted) | | |
| USAi API key injection | | ✅ Fetch from Agor, pass to `acq` | ✅ MITM proxy (per-sandbox secret) |
| USAi endpoint config | | | ✅ `usai-provider` kit |
| Playbook/skills | | | ✅ `agentic-coding-playbook` kit |
| Zscaler CA | | | ✅ `zscaler-ca-certificate` kit |
| Git commit signing | | | ✅ `git-ssh-sign` kit |
| Git push/pull auth | ✅ HTTPS + token | | (complementary — MITM handles GH token) |
| Sandbox lifecycle | | ✅ Create/cleanup | ✅ `acq create`/`acq rm` |
| Executor process | ✅ `agor-executor --stdin` | ✅ Pipe payload | |

**Bottom line:** `acq` is usable with Agor. The wrapper script calls `acq create` + `acq exec` instead of `msb`/`sbx` directly. `acq` is worktree-unaware — the wrapper discovers what to mount and tells `acq`. `acq`'s kits handle the GSA-specific concerns (USAi config, Zscaler, playbook, git-sign). Agor owns API key storage/rotation (per-user, per-project) and agent model selection. The wrapper fetches the resolved key from Agor and passes it to `acq` as a per-sandbox secret. `acq` does NOT own key rotation. The only Agor code change needed for future agents (Claude/Codex) is a flag to skip `installProviderConnection()` in sandbox mode; for OpenCode, no Agor changes are needed at all.

---

## 8. Open Questions — Resolved

### Q1: Does `acq` support extra mounts and network rules?

**Resolved.** `acq` builds on the existing multi-mount facility in sbx (and equivalent in msb/ppp). The wrapper script tells `acq` what directories to mount, each at the same absolute path as on the host. `acq` is **worktree-unaware** — it doesn't know about git worktrees, `.git` pointer files, or shared object stores. The wrapper script is responsible for understanding worktree structure and telling `acq` exactly which directories to mount:

```bash
# Wrapper tells acq: mount the worktree as workspace, and also mount .git
acq create opencode "$WORKTREE_PATH" \
  --name "$SANDBOX_NAME" \
  --mount "$MAIN_GIT:$MAIN_GIT:rw" \
  --net-rule "allow@host.microsandbox.internal:3030"
```

This is the right split: `acq` is a general-purpose sandbox tool; the wrapper is Agor-specific and knows git worktree mechanics.

### Q2: How does `acq` handle the worktree `.git` file?

**Resolved by Q1.** The wrapper script reads the worktree's `.git` file to discover the main repo's `.git` path, then tells `acq` to mount both. `acq` doesn't need to understand the `.git` pointer — it just mounts the two directories at their host paths. Inside the sandbox, the `.git` file's `gitdir:` target resolves correctly because both paths are mounted.

### Q3: USAi per-sandbox keys + Agor sessions — billing codes

**Resolved.** The model is:

- **One Agor "user" per project's USAi API key.** When a board is created for a project, that project user is added. Sessions on that board are owned by the project user; other users have view/read-write access.
- **For local dev** (unrelated to a team/project), the user has their own USAi API key stored in their Agor profile, used for sessions they start (e.g., on a private board).

This maps cleanly to `acq`'s per-sandbox secret model:

1. **Agor resolves which USAi key to use** based on the session's owning user (project user or personal user).
2. **The wrapper script fetches the key** from Agor's credential resolution (via the daemon API or the executor payload) and sets it as a per-sandbox secret via `acq secret set usai --host api.gsa.usai.gov --sandbox <name>`.
3. **`acq`'s MITM proxy** injects the key on outbound requests. The agent never sees it.

**Key implication: `acq` should NOT own API key rotation.** API keys are managed alongside users in Agor (user settings, encrypted at rest). `acq`'s `usai-rotate-api-key` command is not used in the Agor integration — rotation happens in Agor's user settings, and the wrapper script picks up the new key on the next session spawn. The `acq secret set` call is per-session-creation, not a one-time global setup.

**Revised credential flow:**

```
Agor user profile (encrypted USAi key)
  ↓ Agor credential resolution (per session, based on owning user)
  ↓ Executor payload or daemon API response
  ↓ Wrapper script extracts key
  ↓ acq secret set usai --host api.gsa.usai.gov --sandbox <name>
  ↓ acq MITM proxy injects on outbound
  ↓ Agent sends request (no auth header) → MITM adds Authorization → USAi
```

This means:
- **Agor owns** API key storage, rotation, and per-user/per-project attribution
- **The wrapper owns** fetching the key from Agor and passing it to `acq`
- **`acq` owns** the injection mechanism (MITM swap-on-access)
- **The agent** never sees the key

### Q4: OpenCode server URL

**Resolved.** `agor-executor` (running inside the sandbox via `acq exec`) starts the OpenCode server. `acq`'s `opencode run` is NOT used — `acq` just provides the sandbox. The `usai-provider` kit configures OpenCode's config files (provider, endpoint), but the actual server lifecycle is managed by Agor's executor.

### Q5: MCP server access

**Deferred.** Agor's internal MCP server (`daemon:3030/mcp`) is handled by the wrapper's `--net-rule` for daemon access. External MCP servers would need to be added to the sandbox's network policy, but this is a future concern — the initial integration only needs daemon + USAi + GitHub (for playbook clone) egress.
