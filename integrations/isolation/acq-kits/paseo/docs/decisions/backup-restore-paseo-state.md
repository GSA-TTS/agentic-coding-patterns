# Decision: back up and restore Paseo state across sandbox recreation

**Status:** accepted

## Context

An `acq` sandbox is an ephemeral container. Only the host bind mounts survive its
destruction; the entire guest filesystem — including `$PASEO_HOME` (default
`~/.paseo`: `config.json`, the `projects/projects.json` registry, and Paseo's
session/agent records) and `~/.local/state/paseo` (logs) — is lost on
`acq rm` + a fresh create. So every unplanned sandbox recreation drops the user's
Paseo state, and the on-disk git worktrees that DO persist (see below) show up
"orphaned" in the UI because Paseo no longer holds their records.

We evaluated three durable-storage approaches before this one:

1. **Relocate `$PASEO_HOME` onto the first project mount.** Survives recreate
   today, but couples Paseo's home to a repo directory (needs `.gitignore`
   hygiene) and scopes state to one project.
2. **A dedicated host state mount** (`PASEO_HOME` on an extra mounted dir).
   Clean, but forces an extra mount argument on every `acq run`/`acq create`.
3. **A kit-declared persistent volume.** The `hybrid/v1` schema already has a
   `volumes` block, but its documented semantics are the opposite of what is
   needed here: it is **creation-time only, mounts UNSEEDED, and is per-sandbox
   scratch storage** — it does not outlive the sandbox, and the translate layer
   that maps it lives in the separate `acq`/quickstart repo, not this one. It
   therefore cannot provide cross-recreate persistence without an upstream
   `acq`-side change (see the `volumes` amendment in
   `../../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`).

## Decision

**Ship two host-side helper scripts — `scripts/paseo-backup` and
`scripts/paseo-restore` — that snapshot `$PASEO_HOME` to a host tar before
teardown and replay it into a new sandbox afterward.** They use only `acq exec`
stdin/stdout streaming (already the kit's universal in-guest mechanism); no new
`acq` capability, no persistent-storage primitive, no coupling of Paseo state to
a project repo, and no extra mount argument.

- **`paseo-backup [--apply] <sandbox> [dest-dir]`** streams
  `tar -C "${PASEO_HOME:-$HOME/.paseo}" --exclude ./paseo.pid -cf - .` over
  `acq exec` stdout into `<dest>/paseo-state-<sandbox>-<UTC>.tar`
  (default dest `~/.acq-paseo-backups`). It writes to a temp file and atomically
  renames on success, and verifies the captured stream is a non-empty, valid tar
  before promoting it — an interrupted capture never leaves a truncated archive.
- **`paseo-restore [--apply] <sandbox> [backup-tar]`** streams a backup tar into
  `${PASEO_HOME:-$HOME/.paseo}` in the target sandbox, then bounces the daemon so
  it re-reads the restored config/projects. With no `backup-tar` it auto-selects
  the most recent backup for that sandbox.
- Both **default to dry-run**; `--apply` is required to write or mutate anything.

## What the snapshot includes and excludes

- **Included:** the full `$PASEO_HOME` tree (`config.json`, `projects/`,
  session/agent records, anything else Paseo persists there). Capturing the whole
  tree — rather than an allowlist of known files — means a future Paseo state file
  is preserved automatically.
- **Excluded — `paseo.pid`:** a supervisor PID lock. Replaying a stale PID into a
  fresh container is misleading; the daemon recreates it on boot. (Paseo's lock is
  stale-tolerant, so a leftover would be reclaimed anyway, but there is no reason
  to carry it.)
- **Not captured — `~/.local/state/paseo`:** logs, install log, CA bundle. All
  regenerated every boot.
- **Not captured — git worktree contents.** See below.

## Why worktrees are left on the project mount, not moved into the backup

The kit pins Paseo's `worktrees.root` to `<primary-project>/.paseo-worktrees`,
i.e. **inside a host bind mount** (see `worktrees-root-global-only.md`). A git
worktree stores absolute paths in both link halves (the worktree's `.git` file
points at `<mainrepo>/.git/worktrees/<name>`, which points back at the worktree's
absolute path). Because both the worktrees and their main repos live on the same
host mount, and `acq` re-mounts a project at the **same guest path** on recreate,
the worktree files and their git linkage **already survive recreation on their
own**. Moving worktrees into `$PASEO_HOME` so they would ride the backup tar would
break that linkage (the main repo would not move with them) and would make them
inaccessible from the host while active.

So the real gap on recreate is not the worktree files — it is Paseo's *knowledge*
of them (its session/worktree records under `$PASEO_HOME`). Restoring the
`$PASEO_HOME` snapshot is exactly what makes Paseo re-recognize the intact on-disk
worktrees. This keeps the design simple and avoids leaving either the host or
Paseo in an inconsistent state.

## `worktrees.root` reconciliation on restore

A restored `config.json` carries the **old** sandbox's absolute `worktrees.root`.
On the new sandbox the kit's `opencode` wrapper re-pins `worktrees.root` to
`<primary-project>/.paseo-worktrees` on the next `acq run` and bounces the daemon
(see `supervisor-owns-daemon-wrapper-pins-worktrees.md`), so a stale value
self-corrects. When restoring into a detached `acq create`, the user runs
`acq run <agent> <project>` once (documented in the script output, README, and
TROUBLESHOOTING) to trigger the re-pin.

## The filename contract

`paseo-backup` writes `paseo-state-<sandbox>-<UTC>.tar` where `<UTC>` is a
colon-free ISO-8601 basic timestamp (`YYYYMMDDTHHMMSSZ`) so the name is valid on
every filesystem **and** sorts lexicographically by time. `paseo-restore`'s
"most recent backup" default relies on that ordering (lexical sort, last entry,
filtered to the sandbox prefix). The two scripts must change this format in
lockstep; both headers state the coupling.

## Consequences

- Recreation becomes a documented three-step ritual: `paseo-backup --apply` →
  recreate → `paseo-restore --apply` (then one `acq run` to re-pin worktrees).
- No dependency on unshipped `acq` volume semantics; entirely inside this kit.
- Backups are plain tars on the host, inspectable with `tar -tf` and portable
  between sandboxes if desired.
- Manual by design (per the current scope): there is no automatic
  backup-on-teardown and no one-shot recreate wrapper. Those were considered and
  deliberately not built now.
- Sandbox names flow into a filename glob and an `acq exec` target, so both
  scripts constrain the name to `[A-Za-z0-9._-]` (SI-10).

## Links

- `worktrees-root-global-only.md` — why worktrees live on the project mount and
  why `worktrees.root` is re-pinned per run.
- `supervisor-owns-daemon-wrapper-pins-worktrees.md` — the marker-scoped daemon
  bounce that `paseo-restore` reuses.
- `../../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md` — the `volumes`
  amendment whose creation-time/unseeded/per-sandbox semantics ruled it out here.
- `../../files/home/paseo-set-worktrees-root.mjs`,
  `../../files/home/paseo-agent-shim` — the `${PASEO_HOME:-$HOME/.paseo}`
  resolution the scripts mirror.
- `../../scripts/paseo-backup`, `../../scripts/paseo-restore`.
