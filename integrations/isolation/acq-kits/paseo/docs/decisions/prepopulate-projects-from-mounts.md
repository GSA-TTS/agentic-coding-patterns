# Decision: pre-populate Paseo projects from the mounted host directories

**Status:** accepted

## Context

The kit should make every host project directory mounted into the sandbox show
up in Paseo's web UI on its own, so a user connecting to the UI sees their repos
already listed instead of adding each one by hand.

Two facts shape the solution:

1. **Paseo only learns about a project when something registers it.** The `acq
   run` entrypoint opens the *primary* (first) mount via the shim; every other
   mounted directory is invisible to the daemon until it is explicitly added.
2. **The two acq isolation backends mount host directories differently at the
   source level.** Inside the guest, `mount` shows (verified live):
   - **sbx** — one `virtiofs` mount per host dir with the literal source `host`
     (e.g. `host on /Users/.../repo type virtiofs (rw,...)`), plus read-only
     `virtiofs` bind *files* for `/etc/resolv.conf` and `/etc/hosts`.
   - **msb** — one `virtiofs` mount per host dir whose source is a **per-path
     hash** (e.g. `Users_breta_754e1f1f`), plus the backend runtime mount
     `msb_runtime on /.msb`.

   The msb source token (`Users_breta_<hex>`) is a hash derived from the leading
   path elements; it is **not stable across users or paths**, and sbx uses the
   unrelated literal `host`. So the mount **source name cannot be used as a key**.

## Decision

Ship `paseo-register-mounts.mjs`, run from the startup supervisor after the
daemon answers `/api/health`, which inspects each qualifying host directory and
registers the resulting project directories with the daemon.

### How it registers a project

There is **no `paseo project add` CLI verb.** The only side-effect-free
registration path is the daemon message `project.add.request`, exposed by the
bundled client as `client.addProject(cwd)`. Verified live: it is **idempotent**
(same root ⇒ same `projectId`, no duplicate), works for **non-git** dirs
(`kind: "non_git"`), and returns `{ project: null, errorCode: "directory_not_found" }`
for a bad path instead of throwing.

The helper imports the CLI's **own** connector
(`<cli-pkg>/dist/utils/client.js` → `connectToDaemon`), resolving the CLI package
dir portably from the `paseo` bin symlink (`readlink`/`realpath` of
`command -v paseo`, then two levels up). This works under both the sudo-global
npm prefix and the no-sudo `~/.npm-global` fallback the install path uses, and
reuses the same socket/localhost daemon resolution the CLI itself uses (no
host/port needed here).

### Which mounts qualify (backend-agnostic, no source-name reliance)

Read from `/proc/mounts`; a mount qualifies when **all** hold:

1. fstype is `virtiofs` (the host-share fstype both backends use);
2. it is mounted **read-write** — **read-only mounts are skipped** (requirement);
3. its target is an existing **directory** (excludes sbx's `/etc/resolv.conf`,
   `/etc/hosts` bind *files*);
4. its target is **not** under a system prefix — `/etc`, `/run`, `/proc`, `/sys`,
   `/dev`, or `/` itself;
5. its target **basename does not start with `.`** — skips the backend runtime
   dir (`/.msb` today, and any future `/.<backend>` by convention) without
   hard-coding a name.

This keys entirely on portable mount properties, so it captures the three repos
on both sbx and msb and needs no per-backend tokens. A future backend that
bind-mounts host dirs as read-write `virtiofs` is covered automatically.

### How qualifying mounts become projects

After mount discovery, each qualifying mount is expanded to the project
directories to register:

1. If the mount itself has a `.git` entry, register the mount itself. This
   preserves the existing behavior for the normal case where the mount is one
   repository, and avoids unexpectedly registering submodules or nested repos.
2. Otherwise, inspect only the mount's direct child directories. If any child has
   a `.git` entry, register each such child as its own project and do not register
   the parent directory.
3. If no direct child Git repositories are found, register the mount itself. This
   preserves support for intentionally-mounted non-git working directories.

The `.git` entry may be either a directory or a file, covering normal clones,
worktrees, and submodules. The child scan is intentionally shallow, not
recursive.

### Timing and cadence

Runs on **every** sandbox start, in the background, after a bounded wait for
`/api/health`. It is not gated on a marker file: because `addProject` dedups,
re-running is free, and a mount added on a later start is still picked up. It
neither blocks the daemon supervisor loop nor races the daemon's first listen.

### Fail-open

Project pre-population is a convenience, never a reason to break the sandbox.
Every per-directory add is isolated in `try/catch`, the daemon connection is
always closed, and the process **always exits 0** — even if the daemon is
unreachable or the CLI client module cannot be loaded. A transient failure just
means the UI shows fewer projects until the next start.

## Alternatives considered

- **`paseo workspace create --isolation local --path X`.** Rejected: it mints a
  **new workspace record every call** (the `workspace.create.request` explicitly
  never dedups by directory), so it would spam workspaces across restarts.
- **`paseo terminal create --cwd X`.** It *does* register + dedup the project
  (via `open_project`), but as a side effect leaves a **stray terminal** behind
  per directory. Rejected in favor of the clean `project.add`.
- **Raw WebSocket to `ws://localhost:6767/ws`.** Rejected: we would hand-roll the
  protocol framing/handshake; importing the shipped client is simpler and stays
  in sync with the pinned CLI version.
- **Keying on the mount source name / `MSB_DIR_MOUNTS` env.** Rejected: the source
  token is a non-portable per-path hash on msb and the literal `host` on sbx, and
  `MSB_DIR_MOUNTS` is msb-only — none survive a different backend or user.
- **Requiring a project marker (`.git`, `package.json`, …) in the dir.** Rejected
  as unnecessary: it would skip intentionally-mounted non-standard working dirs,
  and Paseo already records non-git dirs cleanly as `kind: "non_git"`.
- **Recursive scanning under parent mounts.** Rejected as surprising and
  potentially expensive: it could register vendored repos, caches, test fixtures,
  or deeply nested submodules the user did not intend to expose as top-level
  Paseo projects. Direct children cover the common "one parent directory with
  many sibling repos" workflow.

## Consequences

- Every read-write host project mount is listed in the Paseo UI after any start
  (detached `acq create` or interactive `acq run`), unless it is a plain parent
  directory containing direct child Git repos. In that case, each direct child
  repo is listed instead, with no manual "Add project".
- Read-only mounts and the backend runtime dir are excluded.
- The behavior is orthogonal to the worktrees-root pin (which still targets only
  the primary/first mount via the shim); this helper touches projects only, never
  `config.json`/`worktrees.root`.
- Depends on the CLI internal path `dist/utils/client.js` (`connectToDaemon`);
  the kit pins `@getpaseo/cli` to a specific version, and verify's `node --check`
  plus the live registration assertion catch a break if a future bump moves it.
- The live verify (`scripts/verify` step 10) checks registration through the
  daemon's **API** (`client.listProjects()`, the supported surface — the same
  connector the registrar uses), not by scraping the daemon's on-disk
  `projects/projects.json`. Reading the file would couple the test to Paseo's
  internal storage layout (path, key name, JSON serialization), so that a compact
  reserialization or a renamed key would flip step 10 to a false FAIL that looks
  like a real regression. The API query shares the same CLI-internal-path
  dependency already noted above (nothing new), and reuses the portable
  `paseo`-bin resolution.
- **Footgun:** the dotdir-skip rule (item 5) also excludes any *workspace* whose
  own directory name begins with `.`. A user who mounts, say, `~/.config/foo` as
  a project would find it silently un-registered. This is an accepted trade-off
  to keep backend runtime dirs out without a name allowlist; it surfaced in
  `scripts/verify`, whose throwaway workspace was originally named
  `.verify-workspace.*` and was therefore skipped — the fixtures are now named
  `verify-workspace.*` / `verify-rw-mount.*` / `verify-ro-mount.*` (no leading
  dot). Documented here so the behavior is not mistaken for a bug.

## Links

- `../../../paseo/files/home/paseo-register-mounts.mjs` — the registrar.
- `../../../paseo/files/home/paseo-start.sh` — invokes it after `/api/health`.
- `supervisor-owns-daemon-wrapper-pins-worktrees.md` — the daemon lifecycle it
  attaches to.
- `worktrees-root-global-only.md` — the separate worktrees-root pin (primary
  mount only), which this does not touch.
