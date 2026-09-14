# Agor + `acq` — run the executor inside a sandbox

> **Status: DRAFT (v1, msb default backend; sbx supported).** Authored via the
> wayfinder map
> ([#247](https://github.com/GSA-TTS/agentic-coding-patterns/issues/247)); the
> wrapper has **not** yet been live-validated end to end (map
> [#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257)). Read
> and dry-run it before adopting.

This integration runs [Agor](https://github.com/preset-io/agor)'s **executor**
inside an [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) sandbox,
so an agent session's tool calls, git operations, and network egress are
isolated by the sandbox instead of running directly on the host. It needs **zero
changes to Agor** for the OpenCode path — it plugs into Agor's existing
`executor_command_template` escape hatch.

It is an **orchestrator** integration: Agor *drives* `acq` from the outside (it
owns the agent + session lifecycle and calls `acq create` / `acq exec`). Contrast
with the [isolation kits](../../isolation/acq-kits/), which are things `acq`
*applies inside* a sandbox. See the
[area README](../README.md) for the boundary rule.

## How it works

1. Agor's daemon spawns an executor per task by running its configured
   `executor_command_template` via `sh -c`, substituting a few variables and
   **piping a JSON payload to the process's stdin**.
2. This integration's wrapper (`sandbox-wrapper-acq.sh`) is that template target.
   It reads the payload, works out what to mount from the branch's own `.git`,
   rewrites a loopback `daemonUrl` to the sandbox-reachable host alias, creates an
   `acq` sandbox (which installs `agor-executor` via the egress kit), and pipes
   the payload into `agor-executor --stdin` **inside** the sandbox.
3. The executor connects back to the daemon over WebSocket using the payload's
   scoped JWT — so the sandbox network policy must allow the daemon URL.

```
Agor daemon ──(executor_command_template: sandbox-wrapper-acq.sh {session_id})──▶ sh -c
   │  writes JSON payload to stdin
   ▼
sandbox-wrapper-acq.sh
   │  parse params.cwd, rewrite daemonUrl, derive mounts from .git,
   │  acq create (+ egress/executor kit + usai secret)
   ▼
acq sandbox (msb) ── acq exec -- agor-executor --stdin ──▶ agent SDK
   │                                                          │
   └────────────────── WebSocket back to daemon ◀────────────┘  (allow-listed egress)
```

## Prerequisites

- **`acq`** installed and configured with a backend (**msb** is the default; see
  [Backend support](#backend-support)).
- A **base sandbox image with `node`/`npm`** — the egress kit installs
  `agor-executor` at create time (`npm install -g agor-live`), so the image must
  be able to run `npm`/`node`. (The default `shell-docker` image does.)
- **`jq`** on the host (the wrapper parses the payload with it).
- A **daemon-egress kit** ref (see [Daemon reachability](#daemon-reachability)).
- A **USAi API key** available to the operator (see [Credentials](#credentials-usai)).

## Setup

1. Copy `sandbox-wrapper-acq.sh` somewhere the daemon can execute it, e.g.
   `~/.agor/sandbox-wrapper-acq.sh`, and `chmod +x` it.

2. Point Agor's `executor_command_template` at it in `~/.agor/config.yaml`:

   ```yaml
   execution:
     executor_command_template: |
       /home/you/.agor/sandbox-wrapper-acq.sh {session_id}
   ```

   Only `{session_id}` is needed — the wrapper reads everything else (the
   worktree path, the daemon URL, the session token) from the JSON payload on
   stdin. (Agor populates only `{session_id}`, `{task_id}`, `{unix_user}` for
   prompt spawns, so the wrapper deliberately does not rely on `{branch_id}`.)

3. **Dry-run it once** against a real payload before going live:

   ```bash
   echo '<a captured executor payload>' \
     | AGOR_SANDBOX_DRY_RUN=1 AGOR_EGRESS_KIT=<kit-ref> \
       ~/.agor/sandbox-wrapper-acq.sh <session-id>
   ```

   It prints the `acq` commands it *would* run (mounts, egress kit, secret, exec,
   cleanup) and exits without creating a sandbox.

4. Provision the USAi secret and remove the dry-run flag (see below), then start
   a session in Agor.

## Configuration (environment)

All are optional and **none are secrets**:

| Env var | Default | Purpose |
|---|---|---|
| `AGOR_ACQ_BIN` | `acq` | `acq` binary on `PATH`. |
| `AGOR_ACQ_AGENT` | `shell` | acq agent mode — a raw box; Agor owns the agent SDK. |
| `AGOR_SANDBOX_PREFIX` | `agor-` | Sandbox name prefix (`+ first 8 of session id`). |
| `AGOR_SANDBOX_DRY_RUN` | `0` | `1` = print the planned acq commands and exit. |
| `AGOR_DATA_HOME` | (Agor default) | Agor's git-data root (`repos/` + `worktrees/`); used to tell an Agor-managed repo from a user's local repo. Falls back to `AGOR_HOME`, then `~/.agor`. **Export it if your deploy sets `paths.data_home` only in `config.yaml`** (this wrapper can't read the config file). |
| `AGOR_MANAGED_ROOTS` | (unset) | Extra colon-separated managed roots to allow (e.g. an EFS/NFS mount), in addition to `AGOR_DATA_HOME`. |
| `AGOR_EGRESS_KIT` | (unset) | acq kit ref that allow-lists the daemon and installs the executor (local dir or `git+https…#ref=&dir=`). |
| `AGOR_DAEMON_HOST` | `host.microsandbox.internal` | Host alias the executor uses to reach the daemon (msb default); set `host.docker.internal` for sbx. |
| `AGOR_USAI_SECRET` | `1` | `1` = set the per-sandbox `usai` acq secret. |
| `AGOR_USAI_KEY_FILE` | (unset) | File holding the USAi key; piped to `acq secret set` (never argv). |

## Mount strategy

The wrapper derives what to mount from the branch's **own `.git`**, with **zero
daemon calls**:

- **Worktree branches** — `.git` is a *file* containing
  `gitdir: <main>/.git/worktrees/<name>`. The wrapper reads it, derives
  `<main>/.git`, and mounts **the worktree + the main repo's `.git`** so git
  commit/push and `gitdir:` resolution work.
- **Clone branches** — `.git` is a *directory* (self-contained). The wrapper
  mounts **only the clone dir**.

On sbx, positional workspaces are mounted at their **absolute host path**, so the
worktree appears at the same path inside the sandbox (preserving `gitdir:`
resolution and error messages).

### v1 safety gate — local repos are refused

sbx mounts **whole directories** at their host path; it cannot bind *only*
`<repo>/.git` without its parent. So for a **worktree off a local repo**
(`agor repo add-local`), mounting the main repo dir would drag the user's working
tree — including a `.env` with real secrets — into the sandbox. **The wrapper
refuses this** (exit 5). v1 supports:

- **Agor-managed remote repos** — the main checkout is a clean clone under
  Agor's git-data root (`$AGOR_DATA_HOME/repos/…`, default `~/.agor/`) with no
  user secrets; safe to mount. (This is the default path.)
- **Clone-mode branches** — self-contained; only the clone dir is mounted.

> The wrapper detects "Agor-managed" by whether the main repo lives under
> **`AGOR_DATA_HOME`** (falling back to `AGOR_HOME`, then `~/.agor`) — matching
> Agor's own path model (`AGOR_DATA_HOME` env > `paths.data_home` in config >
> `AGOR_HOME` > `~/.agor`), so it works for k8s/EFS deployments that relocate the
> git data. **This wrapper cannot read `config.yaml`**, so if your deploy sets
> `paths.data_home` only in the config file, export `AGOR_DATA_HOME` (or add the
> root to `AGOR_MANAGED_ROOTS`) for the wrapper too.
>
> **Alternative not taken in v1:** a host-side "`.git`-only staging dir" (bind or
> copy just `.git` into a throwaway dir and mount *that*) would let local-repo
> worktrees work while still hiding the checkout, at the cost of more host-side
> machinery. Tracked as a possible enhancement.

### Residual risks

- **Committed-history secrets** remain reachable via `git log --all` / `git show`
  regardless of mount strategy — this is orthogonal to sandboxing (purge with
  `git filter-repo`/BFG).
- The worktree `.git` file's `gitdir:` reveals the **main-repo path**; on sbx the
  parent dir is mounted (remote) or absent (clone).

## Daemon reachability

The executor inside the sandbox must reach the daemon over WebSocket. `acq` has
**no per-invocation network flag** — outbound egress can only be allow-listed by
an **acq kit's `caps.network.allow`**, and backends are default-deny for
arbitrary hosts. The egress kit also **installs the executor** (its `install`
phase runs `npm install -g agor-live` and shims `agor-executor`), since
`agor-live` ships no `agor-executor` bin. Its allow-list carries **both** backend
host aliases on the Agor default port:

```yaml
# integrations/isolation/acq-kits/agor-daemon-egress/spec.yaml (see map #259)
caps:
  network:
    allow:
      - host.docker.internal:3030          # sbx
      - host.microsandbox.internal:3030    # msb (default backend)
      - registry.npmjs.org:443             # install-time executor fetch
```

Point `AGOR_EGRESS_KIT` at it — a **local dir** (bypasses the source allowlist)
or the **git form**
`git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<40-char-sha>&dir=integrations/isolation/acq-kits/agor-daemon-egress`
(`GSA-TTS/` is on acq's default kit-source allowlist).

> The daemon advertises `http://localhost:3030` by default, but inside the sandbox
> `localhost` is the **guest's** loopback, not the host. The wrapper rewrites a
> loopback `daemonUrl` in the payload to `AGOR_DAEMON_HOST`
> (`host.microsandbox.internal` on msb, `host.docker.internal` on sbx), preserving
> the port. If your daemon uses a non-default port, the egress kit's allow entry
> must match.

## Credentials (USAi)

For the **OpenCode** path, Agor does **not** vend a USAi key to the sandbox
today — provider credentials are scrubbed from the executor payload, and Agor's
credential endpoint has no OpenCode entry. So v1 provisions the USAi key **to
`acq` out-of-band**, and `acq`'s MITM proxy injects it on outbound requests (the
agent never sees it):

- Per-sandbox: put the key in a file and set `AGOR_USAI_KEY_FILE`; the wrapper
  runs `acq secret set <sandbox> usai` with the key on **stdin**.
- Or once, globally: `acq secret set -g usai` (then set `AGOR_USAI_SECRET=0`).

> Agor-vended **per-user / per-project** USAi keys (the original design) require
> an upstream Agor change and are **out of scope** for this worked example —
> tracked at map [#261](https://github.com/GSA-TTS/agentic-coding-patterns/issues/261).

## Who owns what

| Concern | Agor | This wrapper | `acq` + kits |
|---|---|---|---|
| Agent model selection | ✅ `model_config` | | |
| Agent credentials (OpenCode) | ❌ not handled | | ✅ MITM (key set out-of-band) |
| Worktree + `.git` mount | | ✅ derive from `.git`, pass to acq | ✅ performs the mount (host path, both backends) |
| Daemon egress | | ✅ apply egress kit via `--kit`; rewrite loopback `daemonUrl` → host alias | ✅ `caps.network.allow` |
| Executor install | | (references the kit) | ✅ install-phase `npm install -g agor-live` + shim |
| USAi key storage/rotation | (not for OpenCode today) | ✅ read operator key → `acq secret set` | ✅ injection mechanism |
| USAi endpoint config | | | ✅ `usai-provider` kit |
| Zscaler CA / playbook / git-sign | | | ✅ the respective kits |
| Sandbox lifecycle | | ✅ create + `trap` cleanup | ✅ `acq create` / `acq rm` |
| Executor process | ✅ `agor-executor --stdin` | ✅ pipe payload into `acq exec` | |

## Backend support

| Backend | v1 | Notes |
|---|---|---|
| **msb** (default) | ✅ code-ready, live-pending | `acq`'s msb adapter mounts each workspace at its **host path** (sbx-parity) and supports multiple positional mounts ([quickstart#230](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/230), #233), so the `.git` pointer resolves the same way as on sbx. Daemon egress uses the `host.microsandbox.internal` alias; the live end-to-end run is tracked at [#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257). |
| **sbx** | ✅ code-ready | Positional workspaces mount at their absolute host path — required for `gitdir:` resolution and Agor's same-path assumption. Daemon egress uses the `host.docker.internal` alias. The live end-to-end run is tracked at map [#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257). |
| **ppp** | ❌ | Future, with msb. |

## Scope and authority

This is a **reusable, community-shareable** integration. It carries **no
compliance authority** and is **not** federal policy — behavioral/policy
authority lives in the
[playbook](https://github.com/GSA-TTS/agentic-coding-playbook) and is referenced,
not restated. No secrets, PII, CUI, or internal URLs live in this integration.

## Background / design

- [`docs/explorations/sandbox-abstraction.md`](docs/explorations/sandbox-abstraction.md)
  — the Agor executor-hook sandbox abstraction design.
- [`docs/explorations/sandbox-acq-analysis.md`](docs/explorations/sandbox-acq-analysis.md)
  — using `acq` as the backend: the four kits, who-owns-what, credential flow.
- [Area ADR 0001](../docs/decisions/0001-orchestrators-area-and-agor-acq.md) —
  why `integrations/orchestrators/` exists and the drives-vs-applied boundary.

## Layout

```
integrations/orchestrators/agor/
├── README.md                 # this guide
├── sandbox-wrapper-acq.sh    # the executor_command_template wrapper
└── docs/explorations/        # source design docs
```
