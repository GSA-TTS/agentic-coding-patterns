# Sandboxing CLI Abstraction for Agor's Executor Hook

**Status:** 🔬 Exploration
**Related issues:** [#1631](https://github.com/preset-io/agor/issues/1631), [#1684](https://github.com/preset-io/agor/issues/1684)
**Last Updated:** 2026-07-13

---

## Context

- **#1631** — Add OpenShell as a managed sandboxed runtime (gRPC-based, podman/microVM/k8s backends). Blocked by OpenShell overriding the model in agent requests.
- **#1684** — Investigate sandboxing via Docker `sbx`, nono.sh, and Lima. Calls for a **common abstraction** across multiple sandbox providers, with worked examples.

**Goal:** Define the general "shape" of a sandboxing CLI abstraction that plugs into Agor's existing Executor spawn path, using `sbx` and `microsandbox` (`msb`) as the reference CLI patterns.

---

## 1. What the Executor Hook Is Today

The executor is Agor's single isolation boundary. The relevant chokepoints:

| Component | File | Role |
|---|---|---|
| **`buildSpawnArgs()`** | `packages/core/src/unix/run-as-user.ts:219` | THE single sandbox boundary. Wraps command in `sudo -u $asUser`. Today only knows Unix impersonation. |
| **`spawnExecutor()`** | `apps/agor-daemon/src/utils/spawn-executor.ts:223` | Single entry point. Two paths: `spawnExecutorLocal` (node child_process) and `spawnExecutorWithTemplate` (sh -c template for k8s/docker). |
| **`executor_command_template`** | `packages/core/src/config/types.ts:487` | Config-driven escape hatch — already supports `kubectl run` and `docker run` with `{unix_user_uid}`, `{session_id}`, etc. variable substitution. |
| **`createExecuteHandler()`** | `apps/agor-daemon/src/register-services.ts:699` | Resolves Unix user, env vars, builds payload, calls `spawnExecutor()`. |
| **`executeToolTask()`** | `packages/executor/src/handlers/sdk/base-executor.ts:374` | In-executor lifecycle: git setup → key resolution → `tool.executePromptWithStreaming()` → git capture → normalize → patch task. |

**Key architectural fact:** The executor process runs the agent SDK **in-process** (Claude SDK, Codex app-server, Gemini SDK, etc.). It connects back to the daemon via WebSocket/Feathers using a scoped JWT. The daemon writes the JSON payload to the executor's stdin.

**The `executor_command_template` is already a sandbox abstraction** — it's just string-based and operator-configured. The goal is to make it programmatic and provider-aware.

---

## 2. sbx vs microsandbox CLI — Common Shape

Both CLIs share a remarkably similar command surface. Here's the common denominator:

### Lifecycle Commands

| Operation | sbx | msb | Purpose |
|---|---|---|---|
| Create + run | `sbx run <agent> [workspace]` | `msb run <image> -- <cmd>` | Create sandbox, optionally attach |
| Create only | `sbx create <agent> <workspace>` | `msb create <image>` | Boot without attaching |
| Exec in running | `sbx exec <name> <cmd>` | `msb exec <name> -- <cmd>` | Run command in existing sandbox |
| List | `sbx ls` | `msb ls` / `msb ps` | List sandboxes |
| Stop | `sbx stop <name>` | `msb stop <name>` | Graceful shutdown |
| Remove | `sbx rm <name>` | `msb rm <name>` | Delete sandbox + state |
| Copy files | `sbx cp <src> <dst>` | `msb copy <src> <dst>` | Host ↔ sandbox file transfer |
| Port forward | `sbx ports <name> --publish` | `msb run -p <host>:<guest>` | Forward host port into sandbox |
| Logs | (agent session) | `msb logs <name>` | Captured stdout/stderr |
| Inspect | (sbx ls shows details) | `msb inspect <name>` | Detailed config/status |
| Metrics | (dashboard) | `msb metrics` | CPU/memory/network stats |

### Mount / Workspace Model

| Feature | sbx | msb |
|---|---|---|
| **Direct mount** | Default: workspace mounted rw at same absolute path | `-v <host_path>:<dest>[:ro\|rw]` |
| **Clone mode** | `--clone`: repo mounted ro, clone inside sandbox, exposed as git remote on host | (not built-in; can be scripted) |
| **Extra mounts** | Positional paths, `:ro` suffix | `-v` repeatable, `:ro`/`rw` options |
| **Named volumes** | (not supported) | `msb volume create` + `--mount-named` |

### Network Policy

| Feature | sbx | msb |
|---|---|---|
| **Default** | Routes through host HTTP proxy, policy-enforced | Public internet allowed; private/loopback/metadata denied |
| **Disable net** | (policy-based) | `--no-net` |
| **Custom rules** | `sbx policy allow/deny <host>` | `--net-rule "allow@target:proto:ports"` |
| **Secret injection** | Credentials injected via proxy, never on filesystem | `--secret NAME@HOST` (host-held, injected for allowed TLS dests) |

### Resource Limits

| Feature | sbx | msb |
|---|---|---|
| CPU | (managed) | `-c`, `--max-cpus` (hotplug ceiling) |
| Memory | (managed) | `-m`, `--max-memory` (hotplug ceiling) |
| Live resize | (no) | `msb modify --cpus N --memory M` |

### Agent-Aware vs Agent-Agnostic — Both Have a Raw Mode

- **sbx** has built-in agent presets (`sbx run claude`, `sbx run codex`, etc.) that auto-configure the agent. But it also has a **`shell` agent** (`sbx run shell`) — an agent-less sandbox with just a bash login shell, no pre-installed agent binary. This is the right mode for Agor: the sandbox is a raw box, and `agor-executor --stdin` runs inside it.
- **msb** is agent-agnostic by design (`msb run ubuntu -- bash` is a generic microVM).

**For Agor:** Both CLIs are equally suitable. Use `sbx run shell` or `msb run <image> --` to get a raw sandbox, then pipe the executor payload to `agor-executor --stdin` inside it. The agent-awareness of sbx is irrelevant — Agor's executor already manages the agent SDK.

---

## 2a. Can This Be Done Without Modifying Agor at All?

**Yes.** The existing `executor_command_template` is already a sandbox abstraction — it's just string-based and operator-configured. A wrapper script can provide the full sandbox lifecycle without touching Agor core.

### How It Works Today

The daemon's `spawnExecutorWithTemplate()` (`spawn-executor.ts:406`) does:
1. Reads `executor_command_template` from config
2. Substitutes variables: `{task_id}`, `{command}`, `{unix_user}`, `{unix_user_uid}`, `{unix_user_gid}`, `{session_id}`, `{branch_id}`, `{log_level}`
3. Runs `sh -c "<substituted template>"`
4. Writes the JSON executor payload to the process's stdin
5. The template command is expected to pipe that stdin to `agor-executor --stdin`

### What Information the Script Has Access To

**Template variables (as argv):** The prompt handler (`register-services.ts:948-952`) passes only `{session_id}`, `{task_id}`, `{unix_user}`. `branch_id` is in the interface but not populated for prompt spawns (it IS populated for environment lifecycle spawns at `branches.ts:447`). No path information is passed as template variables.

**JSON payload on stdin:** The full executor payload is written to the script's stdin. For `prompt` commands, this includes (`PromptPayloadSchema` at `payload-types.ts:151`):
- `sessionToken` — JWT for daemon API auth
- `params.cwd` — **the worktree/clone absolute path** (set at `register-services.ts:780` as `branch.path`)
- `params.sessionId`, `params.taskId`, `params.prompt`, `params.tool`

So the script can parse stdin JSON to get `params.cwd` (the worktree path) without any API calls. But it does NOT get the main repo's `local_path` directly.

### How the Script Discovers the Main Repo's `.git` Path

The script can derive the main repo's `.git` path from the worktree itself, with zero API calls:

**For worktree-mode branches:** The worktree's `.git` is a **file** (not a directory) containing `gitdir: <main_repo>/.git/worktrees/<name>`. The script reads this file to extract the path:

```bash
WORKTREE_PATH=$(echo "$STDIN_JSON" | jq -r '.params.cwd')

# Check if .git is a file (worktree) or directory (clone)
if [ -f "$WORKTREE_PATH/.git" ]; then
  # Worktree mode: .git file points to main repo's .git
  GITDIR_LINE=$(cat "$WORKTREE_PATH/.git")     # "gitdir: /home/user/code/myapp/.git/worktrees/feat-auth"
  MAIN_GIT=$(echo "$GITDIR_LINE" | sed 's|gitdir: \(.*\)/worktrees/.*|\1|')  # /home/user/code/myapp/.git
  # Mount worktree rw + main .git rw
  MOUNTS="-v $WORKTREE_PATH:$WORKTREE_PATH:rw -v $MAIN_GIT:$MAIN_GIT:rw"
elif [ -d "$WORKTREE_PATH/.git" ]; then
  # Clone mode: self-contained .git directory, no path back to main repo
  # Mount just the clone dir rw
  MOUNTS="-v $WORKTREE_PATH:$WORKTREE_PATH:rw"
fi
```

**For clone-mode branches:** The `.git` is a real directory — the clone is self-contained, no external `.git` to mount. The script just mounts the clone directory.

This approach:
- Works for both remote and local repos (the `.git` file contains the absolute path either way)
- Requires zero daemon API calls
- Requires zero Agor modifications
- Handles the worktree vs. clone distinction automatically

### The Wrapper Script (Revised)

```yaml
# ~/.agor/config.yaml
execution:
  executor_command_template: |
    /home/user/.agor/sandbox-wrapper.sh {session_id}
```

```bash
#!/bin/bash
# ~/.agor/sandbox-wrapper.sh
# Args: session_id (from template variable)
# Stdin: JSON executor payload — buffer it, extract cwd, pipe to agor-executor inside sandbox

set -euo pipefail
SESSION_ID="$1"
SANDBOX_NAME="agor-${SESSION_ID:0:8}"

# Buffer stdin (the JSON payload) so we can both parse it and pipe it to the sandbox
PAYLOAD=$(cat)
WORKTREE_PATH=$(echo "$PAYLOAD" | jq -r '.params.cwd')

# Discover main repo .git path from the worktree's .git file
if [ -f "$WORKTREE_PATH/.git" ]; then
  # Worktree mode: read .git file → extract main repo's .git path
  GITDIR_LINE=$(cat "$WORKTREE_PATH/.git")
  MAIN_GIT=$(echo "$GITDIR_LINE" | sed 's|gitdir: \(.*\)/worktrees/.*|\1|')
  MOUNT_ARGS=(-v "$WORKTREE_PATH:$WORKTREE_PATH:rw" -v "$MAIN_GIT:$MAIN_GIT:rw")
elif [ -d "$WORKTREE_PATH/.git" ]; then
  # Clone mode: self-contained, just mount the clone dir
  MOUNT_ARGS=(-v "$WORKTREE_PATH:$WORKTREE_PATH:rw")
else
  echo "ERROR: $WORKTREE_PATH is not a git workspace" >&2
  exit 1
fi

# Create sandbox with workspace mounted, allow daemon access
msb run --name "$SANDBOX_NAME" -d \
  "${MOUNT_ARGS[@]}" \
  --net-rule "allow@host.microsandbox.internal:3030" \
  ubuntu

# Cleanup on exit
trap "msb rm --force $SANDBOX_NAME 2>/dev/null" EXIT

# Pipe the buffered JSON payload to agor-executor inside the sandbox
echo "$PAYLOAD" | msb exec "$SANDBOX_NAME" -- agor-executor --stdin
```

### What Works Without Agor Changes

| Feature | Works? | How |
|---|---|---|
| Create sandbox per task | Yes | Wrapper script calls `msb run` / `sbx run shell` |
| Discover worktree path | Yes | Parse `params.cwd` from stdin JSON payload |
| Discover main repo `.git` path | Yes | Read worktree's `.git` file (worktree mode) or detect self-contained `.git` dir (clone mode) |
| Mount worktree + `.git` only | Yes | `-v` flags with paths discovered above |
| Run executor inside sandbox | Yes | `msb exec -- agor-executor --stdin` pipes the JSON payload |
| Network policy | Yes | `--net-rule` flags on sandbox creation |
| Secret injection | Yes | `--secret` flags (msb) or proxy policy (sbx) |
| Cleanup on exit | Yes | `trap` on script exit removes sandbox |
| Git operations (commit, push) | Yes | Worktree + `.git` mounted rw |
| Daemon API access from sandbox | Yes | `--net-rule` allows `host.microsandbox.internal:3030` |

### What Doesn't Work Without Agor Changes

| Feature | Why | What it needs |
|---|---|---|
| Sandbox status in UI | Daemon doesn't know about sandboxes, only PIDs | First-class `SandboxProvider` in daemon |
| `agor sandbox ls/stop/rm` CLI | Daemon can't manage sandboxes it didn't create | Provider registered in daemon |
| Orphan cleanup on daemon crash | Wrapper script's `trap` only fires if the script exits cleanly | Daemon-managed sandbox lifecycle |
| Capability detection before spawn | Daemon can't check if `msb` is installed | `isAvailable()` check in spawn path |
| Sandbox-level heartbeat | Daemon tracks executor PID, not sandbox | Provider-integrated heartbeat |
| Session reconnect to existing sandbox | Daemon always spawns fresh | Sandbox reuse logic in daemon |

### Recommendation: Two Tiers

1. **Tier 1 — Wrapper scripts (no Agor changes):** Ship worked examples for `msb` and `sbx` as wrapper scripts + `executor_command_template` configs. This is what issue #1684 asks for. Proves the concept, identifies rough edges, requires zero Agor modifications.

2. **Tier 2 — First-class `SandboxProvider` (Agor changes):** If the worked examples reveal that users need UI status, CLI management, or orphan cleanup, then add the `SandboxProvider` interface to Agor core. Tier 1 informs the interface design.

This is the right order: **worked examples first, abstraction second.**

---

## 3. The Worktree Mount Question

### The Original Hypothesis

> Sandboxes should load the git repository read-only, and the worktree read-write.

### Why Read-Only `.git` Breaks Commits

Git worktrees share the main repository's `.git` directory. When an agent commits in a worktree, git writes **new objects to the shared `objects/` directory** and **updates the branch ref in `refs/heads/`**. If `.git` is mounted read-only, `git commit` fails. Since Agor agents must be able to commit, read-only `.git` is a non-starter.

**sbx confirms this limitation**: its `--clone` mode explicitly **does not work from inside a git worktree** ("The read-only bind mount can't resolve the worktree's `.git` pointer file").

### The Real Concern: Can the Agent See the Host User's Checkout?

The read-only hypothesis is really about a deeper concern: **can we prevent the agent from seeing the user's working directory — current branch, untracked files like `.env` with real secrets?**

This matters most for **local repos** (`agor repo add-local ~/code/myapp`), where the user's main checkout IS the repo that worktrees branch from. For **remote repos** (`agor repo add <url>`), Agor's main checkout at `~/.agor/repos/<slug>` is under Agor's control and typically doesn't have user secrets in it.

### Agor's Two Repo Models

| | Remote repo | Local repo |
|---|---|---|
| **How added** | `agor repo add <url>` | `agor repo add-local <path>` |
| **Main checkout** | `~/.agor/repos/<slug>` (Agor-managed clone) | User's path (e.g. `~/code/myapp`) — used in-place, no copy |
| **Worktrees share** | `~/.agor/repos/<slug>/.git/` | `~/code/myapp/.git/` |
| **User's `.env` at risk?** | Unlikely (Agor's clone is clean) | **Yes** — `.env` is in `~/code/myapp/`, right next to `.git/` |
| **Clone mode available?** | Yes (re-clones from `remote_url`) | **No** — `createBranchAsClone` requires `repo.remote_url` |

The local repo case is where the concern bites: mounting the main repo's `.git` means mounting inside `~/code/myapp/`, and if you mount the whole directory, the agent sees `.env`.

### The Solution: Mount ONLY `.git`, Not the Parent Directory

Both sbx and msb (and Docker/Podman in general) support mounting a specific subdirectory without mounting its parent. The sandbox creates empty parent dirs to hold the mount point.

**For worktree mode:**

```
-v {worktree_path}:{worktree_path}:rw          # the agent's working files
-v {main_repo}/.git:{main_repo}/.git:rw        # ONLY the git database, not the checkout
```

Inside the sandbox, the filesystem looks like:

```
~/code/myapp/              ← empty directory (auto-created as mount parent)
  .git/                    ← mounted rw (objects, refs, worktree admin)
  (no .env, no source files, no working directory)
```

The agent can:
- `git commit`, `git push`, `git pull` — `.git` is rw
- `git status`, `git diff`, `git log` — worktree + `.git` both available

The agent cannot:
- Read `~/code/myapp/.env` — the file isn't mounted (only `.git/` is)
- See the user's working directory — it's an empty dir in the sandbox
- Traverse to other paths on the host — the sandbox only has what's explicitly mounted

**What about discovering other worktrees?** The `.git/worktrees/` directory lists all worktree admin entries, so the agent can see that other branches exist. But those worktrees' working directories (at `~/.agor/worktrees/<slug>/<other-branch>/`) are **not mounted** in this sandbox — each sandbox only mounts its own worktree. The agent can know other branches exist (which is not a secret) but can't read their files.

**What about the path in the `.git` pointer?** The worktree's `.git` file contains `gitdir: ~/code/myapp/.git/worktrees/<branch>`, which reveals the path `~/code/myapp`. But `~/code/myapp/` is an empty directory in the sandbox — only `.git/` exists there. The path is visible but the contents are not.

### Three Mount Strategies

| Strategy | Mounts | Agent sees user's checkout? | Git commit works? | Works for local repos? |
|---|---|---|---|---|
| **A. Worktree + `.git` only** (recommended) | Worktree rw + `<main>/.git` rw | No (only `.git/` mounted, not the checkout) | Yes | Yes |
| **B. Clone + clone dir** | Clone dir rw (self-contained `.git/`) | No (no path back to main repo at all) | Yes | No (clone mode requires `remote_url`) |
| **C. Worktree + full main repo** | Worktree rw + `<main>` rw | **Yes** (full checkout mounted) | Yes | Yes (but exposes everything) |

**Strategy A** is the recommended default — it works for both remote and local repos, allows git commits, and prevents the agent from seeing the user's working directory. **Strategy B** (clone mode) is stronger but only available for remote repos. **Strategy C** is the naive approach and should be avoided for local repos.

### What About Committed Secrets?

Both strategies A and B share one limitation: if secrets were **committed to git history** (even accidentally, then removed), the objects are still in `.git/objects/` and the agent can access them via `git log --all` + `git show`. Purging committed secrets requires `git filter-repo` or BFG, which is a separate concern orthogonal to sandboxing.

### What About No-Git Workflows?

Agor requires git at every layer — every session needs a branch, every branch needs a repo, every repo must be a valid git repo (`isValidGitRepo()` check in `addLocalRepository`). There is no gitless path today. The sandboxing abstraction doesn't need to handle non-git workspaces.

### Recommendation

**Strategy A (mount `.git` only) as the default for all worktree-mode branches.** It's simple, works for both remote and local repos, and solves the core concern. For clone-mode branches, **Strategy B** (mount the clone dir) is automatically safe since the clone is self-contained.

For the wrapper script approach (section 2a), the script should:
1. Fetch the branch's `storage_mode` and `path` from the daemon API
2. If `worktree`: mount `{branch_path}` rw + `{main_repo}/.git` rw (Strategy A)
3. If `clone`: mount `{branch_path}` rw only (Strategy B — self-contained)
4. Auto-allow the daemon URL in the sandbox network policy

---

## 4. Proposed Abstraction Shape

### SandboxProvider Interface

```typescript
// packages/core/src/sandbox/sandbox-provider.ts

interface SandboxProvider {
  readonly name: string;  // 'sbx' | 'msb' | 'openshell' | 'local' | 'template'

  // Lifecycle
  createSandbox(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(sandboxId: string, command: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  stopSandbox(sandboxId: string, opts?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  removeSandbox(sandboxId: string, opts?: { force?: boolean }): Promise<void>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;

  // Capability detection
  isAvailable(): Promise<boolean>;  // Is the CLI installed/daemon running?
  getCapabilities(): SandboxCapabilities;
}

interface SandboxSpec {
  // Identity
  name: string;                    // e.g. `agor-{session_short_id}`
  image: string;                   // base image (e.g. 'ubuntu', 'node:20', custom)

  // Mounts
  mounts: SandboxMount[];
  workdir?: string;                // working directory inside sandbox

  // Network
  network: 'disabled' | 'default' | { rules: NetworkRule[]; defaultEgress: 'allow' | 'deny' };

  // Secrets / env
  env: Record<string, string>;     // non-secret env vars
  secrets: SecretInjection[];      // secret refs (never written to filesystem)

  // Resources
  cpus?: number;
  memory?: string;                 // '512M', '1G'
  maxCpus?: number;                // hotplug ceiling
  maxMemory?: string;

  // Labels (for grouping, e.g. by session/branch)
  labels?: Record<string, string>;
}

interface SandboxMount {
  source: string;                  // host path
  destination: string;             // path inside sandbox
  readonly: boolean;
  kind?: 'bind' | 'volume';       // bind mount vs named volume
}

interface SandboxHandle {
  id: string;                      // provider-assigned sandbox ID
  name: string;                    // our name
  status: 'creating' | 'running' | 'stopped' | 'exited';
  execCommand: { cmd: string; args: string[] };  // the command to run agor-executor inside
}

interface SandboxCapabilities {
  supportsCloneMode: boolean;
  supportsLiveResize: boolean;
  supportsPortForwarding: boolean;
  supportsNetworkRules: boolean;
  supportsSecretInjection: boolean;
  isAgentAware: boolean;           // sbx knows about claude; msb doesn't
  startupTimeMs: 'fast' | 'medium' | 'slow';  // <1s, 1-5s, 5+s
}
```

### How It Plugs Into the Executor Spawn Path

The provider plugs into `spawnExecutor()` as a **third spawn strategy** alongside the existing two:

```
spawnExecutor()
  ├── spawnExecutorLocal()          // today: node child_process, sudo -u
  ├── spawnExecutorWithTemplate()   // today: sh -c operator template (k8s/docker)
  └── spawnExecutorInSandbox()      // NEW: SandboxProvider.createSandbox() + exec()
```

**Flow:**

1. `createExecuteHandler()` resolves the sandbox spec from config + branch + session context
2. Calls `spawnExecutorInSandbox(spec, executorPayload)`
3. Provider creates sandbox with worktree mounted rw, `.git` mounted rw, network policy, secrets
4. Provider execs `agor-executor --stdin` inside the sandbox
5. JSON payload piped to sandbox's stdin (same as today)
6. Executor process inside sandbox connects back to daemon via WebSocket (same as today)
7. On task complete / SIGTERM: provider stops/removes sandbox

**Key insight:** The executor process runs **inside** the sandbox. The sandbox replaces `sudo -u` as the isolation mechanism. Everything inside the executor (SDK calls, git operations, streaming) works unchanged because the executor sees a normal filesystem and network (filtered by the sandbox).

### Config Shape

```yaml
# ~/.agor/config.yaml
execution:
  # Existing: unix_user_mode: simple | insulated | strict
  unix_user_mode: simple

  # NEW: sandbox provider (overrides unix_user_mode when set)
  sandbox:
    provider: none | sbx | msb | openshell | template
    # ^ 'none' = use existing unix_user_mode path (default, backward compat)
    # ^ 'template' = use executor_command_template (existing escape hatch)

    # Provider-specific config
    sbx:
      image: ubuntu
      # sbx manages agent setup; we just provide the box
      clone_mode: false              # opt-in clone mode (high security)
      network: default               # sbx proxy handles policy

    msb:
      image: ubuntu
      cpus: 2
      memory: 2G
      network:
        default_egress: allow        # or 'deny' for allowlist
        rules: []
      secrets:
        - name: ANTHROPIC_API_KEY
          host_env: ANTHROPIC_API_KEY  # inject from host env, never to filesystem

    openshell:
      gateway_url: unix:///tmp/openshell.sock
      provider: anthropic
      policy_preset: default

    # Mount policy (applies to all providers)
    mounts:
      worktree: rw                   # always rw (agent must edit)
      git_dir: rw                    # must be rw for git commit (see section 3)
      # Optional: mount additional read-only paths
      extra_readonly: []
```

### Provider Implementation Shape

Each provider is a thin adapter that translates `SandboxSpec` → CLI invocation:

```typescript
// packages/core/src/sandbox/providers/sbx-provider.ts
class SbxProvider implements SandboxProvider {
  async createSandbox(spec: SandboxSpec): Promise<SandboxHandle> {
    const args = ['run', '--name', spec.name, '--detach'];
    for (const m of spec.mounts) {
      args.push(m.source + (m.readonly ? ':ro' : ''));
    }
    if (spec.cpus) args.push('--cpus', String(spec.cpus));
    // ... network, secrets, etc.
    args.push(spec.image);

    const result = await exec('sbx', args);
    return { id: parseSbxId(result), name: spec.name, status: 'running', ... };
  }

  async exec(id, cmd, args) {
    return exec('sbx', ['exec', id, '--', cmd, ...args]);
  }
  // ...
}
```

```typescript
// packages/core/src/sandbox/providers/msb-provider.ts
class MsbProvider implements SandboxProvider {
  async createSandbox(spec: SandboxSpec): Promise<SandboxHandle> {
    const args = ['run', '-d', '--name', spec.name];
    for (const m of spec.mounts) {
      const flag = m.kind === 'volume' ? '--mount-named' : '-v';
      args.push(flag, `${m.source}:${m.destination}:${m.readonly ? 'ro' : 'rw'}`);
    }
    if (spec.cpus) args.push('-c', String(spec.cpus));
    if (spec.memory) args.push('-m', spec.memory);
    for (const s of spec.secrets) args.push('--secret', `${s.name}@${s.hostEnv}`);
    // ... network rules
    args.push(spec.image);

    const result = await exec('msb', args);
    return { id: spec.name, name: spec.name, status: 'running', ... };
  }
  // ...
}
```

---

## 5. What Changes in Agor

### New Files

| File | Purpose |
|---|---|
| `packages/core/src/sandbox/sandbox-provider.ts` | `SandboxProvider` interface, `SandboxSpec`, types |
| `packages/core/src/sandbox/sandbox-manager.ts` | Provider registry, resolves config → provider, lifecycle orchestration |
| `packages/core/src/sandbox/providers/sbx-provider.ts` | Docker sbx adapter |
| `packages/core/src/sandbox/providers/msb-provider.ts` | microsandbox adapter |
| `packages/core/src/sandbox/providers/local-provider.ts` | Pass-through to existing `buildSpawnArgs()` (backward compat) |
| `packages/core/src/sandbox/providers/template-provider.ts` | Wraps existing `executor_command_template` |
| `apps/agor-docs/pages/guide/sandboxing.mdx` | User-facing guide (canonical reference) |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/config/types.ts` | Add `AgorSandboxSettings` type under `execution.sandbox` |
| `apps/agor-daemon/src/utils/spawn-executor.ts` | Add `spawnExecutorInSandbox()` path; provider selection logic |
| `apps/agor-daemon/src/register-services.ts` | `createExecuteHandler()` resolves sandbox spec when `sandbox.provider != none` |
| `apps/agor-daemon/src/index.ts` | Initialize sandbox manager, register providers based on config |
| `apps/agor-cli/src/commands/` | `agor sandbox ls/stop/rm` commands (delegate to provider) |
| `apps/agor-ui/src/components/` | Sandbox status indicator in session panel |

### What Does NOT Change

- `packages/executor/` — the executor process is unchanged. It runs inside the sandbox exactly as it runs inside a `sudo -u` shell today.
- `packages/core/src/unix/run-as-user.ts` — `buildSpawnArgs()` stays as-is for the `local` provider (backward compat).
- Agent SDK handlers — no changes. Claude/Codex/Gemini/OpenCode all work unchanged inside the sandbox.
- The JSON-over-stdin payload protocol — unchanged.
- The WebSocket/Feathers client in the executor — unchanged (just needs network route to daemon, which sandbox network policy must allow).

---

## 6. Implementation Phases

### Phase 1: Abstraction + Local Provider (1 week)

- Define `SandboxProvider` interface and types
- Implement `LocalProvider` (pass-through to existing `buildSpawnArgs()`)
- Implement `TemplateProvider` (wraps existing `executor_command_template`)
- Add `execution.sandbox.provider` config with `none` default
- Refactor `spawnExecutor()` to dispatch through provider
- **No user-facing change** — `provider: none` uses existing path

### Phase 2: microsandbox Provider (1 week)

- Implement `MsbProvider` adapter
- Worktree + `.git` mount logic
- Secret injection via `--secret`
- Network policy translation
- Integration test: run a Claude session inside an msb sandbox
- Document in `apps/agor-docs/pages/guide/sandboxing.mdx`

### Phase 3: sbx Provider (1 week)

- Implement `SbxProvider` adapter
- Direct mode (default): workspace mount
- Clone mode (opt-in): git-remote fetch-back lifecycle
- Integration test: run a Claude session inside an sbx sandbox
- Handle sbx's worktree limitation (clone mode doesn't work from worktrees — document, fall back to direct mode)

### Phase 4: OpenShell Provider (1 week, blocked on NVIDIA/OpenShell#2039)

- Implement `OpenShellProvider` adapter (gRPC client)
- Depends on OpenShell relaxing model override behavior
- Podman backend for local, k8s backend for cloud

### Phase 5: UI + CLI Polish (3 days)

- `agor sandbox ls/stop/rm` CLI commands
- Session panel: sandbox status badge, network policy viewer
- Config validation: `agor config set execution.sandbox.provider msb` → check `msb` is installed

### Phase 6: Governance (future)

- Centralized network/filesystem policies (org-level)
- Per-branch sandbox presets
- Sandbox resource quotas

---

## 7. Open Questions

1. **Sandbox lifecycle vs session lifecycle**: Should sandboxes be ephemeral (one per task, like today's executor) or persistent (one per session, reused across tasks)? Today's executor is ephemeral. sbx/msb both support persistent sandboxes. **Recommendation: start ephemeral (matches current model), add session-level reuse later.**

2. **Daemon reachability from sandbox**: The executor inside the sandbox must connect to the daemon via WebSocket. The sandbox network policy must allow `host.docker.internal:3030` (sbx) or `host.microsandbox.internal:3030` (msb). This is a critical path — if blocked, the executor can't stream results. **Recommendation: auto-allow the daemon URL in network policy.**

3. **Worktree path stability**: Agor worktrees live at `~/.agor/worktrees/<repo>/<name>`. Inside the sandbox, they should appear at the same absolute path (sbx does this by default). But if the sandbox uses a different home directory, the path may differ. **Recommendation: always mount at the same absolute path; this is what sbx does and it preserves error messages / config files.**

4. **Clone-mode fetch-back integration**: If clone mode is offered, Agor needs a "fetch from sandbox" step in the task completion lifecycle. Where does this plug in? Probably after `captureGitStateForSession('end')` in `executeToolTask()`. **Recommendation: defer to Phase 3, direct mode first.**

5. **GPU passthrough**: OpenShell and msb both mention GPU support. Should the abstraction expose GPU allocation? **Recommendation: add `gpu?: { count: number; type?: string }` to `SandboxSpec` now, implement later.**

6. **MCP server endpoints inside sandbox**: If an agent uses MCP tools, the MCP server may run on the host. The sandbox network policy must allow access to MCP server ports. **Recommendation: auto-allow MCP server URLs registered for the session.**
