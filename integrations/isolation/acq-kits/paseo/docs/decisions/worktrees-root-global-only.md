# Decision: worktrees can only be pinned to the first project dir, and that needs a daemon restart

**Status:** accepted

## Context

The user asked for Paseo's git worktrees to live in a subdirectory of *each*
respective project directory, with a fallback: if per-project is impossible, put
them under a subdirectory of the **first mounted project directory** (the working
directory when the entrypoint runs).

Reading the Paseo source (`packages/server/src/utils/worktree.ts`,
`server/config.ts`, `server/persisted-config.ts`):

- Worktree placement is governed by a **single global** `worktrees.root` in
  `$PASEO_HOME/config.json`. Layout is `<root>/<projectHash>/<slug>` — the
  project is encoded as a **hash segment under the one global root**, not as a
  per-project root path (`getPaseoWorktreesRoot`, `computeWorktreePath`,
  `deriveWorktreeProjectHash`).
- There is **no per-project `worktrees.root`** setting anywhere in the schema.
- A **relative** `worktrees.root` is resolved against **`PASEO_HOME`**, not the
  project cwd (`resolvePaseoWorktreesBaseRoot`, worktree.ts). So to place
  worktrees under a project directory, the configured value MUST be an
  **absolute** path.
- **The daemon reads `worktrees.root` once, at boot.** `loadConfig()` runs in
  `daemon-worker.ts` at startup and passes `worktreesRoot` as an **immutable**
  `daemonRuntimeConfig` value into the websocket server; it is never re-read. The
  runtime-patchable config surface (`DaemonConfigStore` /
  `MutableDaemonConfigSchema`, patched over the WebSocket) does **not** include
  `worktrees`. And there is **no `SIGHUP`/`SIGUSR*` handler** in the daemon
  (only `SIGTERM`/`SIGINT` → graceful shutdown). *(Checked directly: `grep -rn
  SIGHUP` across server + cli is empty.)*

**Conclusion:** per-project roots are impossible; the best achievable behavior is
the fallback — one global root pointed at a subdirectory of the first mounted
project. And changing that root at runtime requires a **full daemon restart** — a
HUP would do nothing.

## Decision

**Pin the single global `worktrees.root` to `<primary-project>/.paseo-worktrees`
(absolute), and apply changes by restarting the daemon.**

- The kit's `opencode` wrapper runs as the sandbox entrypoint on `acq run`, whose
  working directory is the primary (first mounted) workspace. It computes
  `$(pwd -P)/.paseo-worktrees` and writes it via
  `paseo-set-worktrees-root.mjs` (idempotent read-modify-write of `config.json`,
  preserving all other keys; refuses a non-absolute root).
- When the value **changes**, the wrapper bounces the daemon so it re-reads the
  config (see `supervisor-owns-daemon-wrapper-pins-worktrees.md` for the exact
  kill mechanism). When it is already correct, no restart.

## Why not each project dir

`worktrees.root` is a single global path shared by all projects the daemon serves;
the project identity is only a hash segment beneath it. There is no configuration
axis for "root per project," so the literal request cannot be honored. The
first-project fallback is the closest faithful approximation and is exactly what
the user pre-authorized.

## Why an absolute path

A relative `worktrees.root` resolves against `PASEO_HOME`, which would place
worktrees under the daemon's home, not the project. The helper refuses a
non-absolute `--root` to avoid silently mis-placing them.

## Consequences

- Worktrees land under `<primary-project>/.paseo-worktrees/<projectHash>/<slug>`
  once the wrapper has run once on `acq run`. Before that first run, they default
  to `$PASEO_HOME/worktrees`.
- Applying a new root costs one daemon bounce (a few seconds of downtime while
  the supervisor respawns the daemon). Idempotent: unchanged root ⇒ no bounce.
- A user who sets a custom absolute `worktrees.root` by hand will have it
  overwritten on the next wrapper run (the wrapper always targets
  `<primary-project>/.paseo-worktrees`). Documented in the README.

## Links

- Paseo `worktree.ts`, `config.ts`, `persisted-config.ts` — global-root model,
  relative-resolves-vs-PASEO_HOME, boot-time-only read.
- `supervisor-owns-daemon-wrapper-pins-worktrees.md` — the restart mechanism.
- `../../../paseo/files/home/paseo-set-worktrees-root.mjs` — the merge helper.
