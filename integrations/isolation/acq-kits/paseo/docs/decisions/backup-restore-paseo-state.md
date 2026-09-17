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
(already the kit's universal in-guest mechanism); no new `acq` capability, no
persistent-storage primitive, no coupling of Paseo state to a project repo, and
no extra mount argument.

- **`paseo-backup [--apply] <sandbox> [dest-dir]`** tars
  `${PASEO_HOME:-$HOME/.paseo}` (minus the exclusions below) inside the guest and
  emits it base64-encoded over `acq exec` stdout; the host decodes it into
  `<dest>/paseo-state-<sandbox>-<UTC>.tar` (default dest `~/.acq-paseo-backups`).
  It writes to a temp file and atomically renames on success, and verifies the
  decoded result is a valid tar before promoting it — an interrupted capture
  never leaves a truncated archive.
- **`paseo-restore [--apply] <sandbox> [backup-tar]`** base64-encodes the backup
  tar on the host, pipes the text into the guest which decodes and extracts it
  into `${PASEO_HOME:-$HOME/.paseo}`, then bounces the daemon so it re-reads the
  restored config/projects. With no `backup-tar` it auto-selects the most recent
  backup for that sandbox.
- Both **default to dry-run**; `--apply` is required to write or mutate anything.

## Transport is base64 text, not raw binary

`acq` must work over **both** isolation backends (msb and sbx). Streaming a raw
binary tar over `acq exec` stdin/stdout was observed to **hang** on msb: a guest
`cat | wc -c` fed the tar bytes never saw EOF, so `tar -xf -` blocked forever.
Plain multi-line **text** stdin, by contrast, reaches EOF normally (verified).
`msb exec` exposes a `--stream` flag for byte-faithful binary I/O, but relying on
it would be backend-specific.

So the archive is transported as **base64 text** in both directions — the guest
encodes on backup, the host encodes on restore — keeping the payload in the safe
text channel that behaves identically on every backend. `base64` is required on
both the host and in the guest image (present on the opencode base image). The
cost is ~33% transport inflation, which is immaterial once the snapshot is kept
small (see exclusions). This is why excluding the model cache matters: base64 of
a ~460MB model cache is ~640MB of text piped through `acq exec`, which crawled to
an apparent hang — trimming the snapshot to real state keeps the text channel
fast.

## Capture is race-tolerant: snapshot-in-guest, then classify the tar exit code

`acq exec` **faithfully propagates the guest command's exit code** (verified:
`exit 7` in the guest surfaces as host exit 7). That is a feature — it lets the
scripts detect real failures — but it means a naive `tar -cf - .` fails
on an *expected, non-fatal* condition: the daemon writes under `$PASEO_HOME`
while tar reads it, and GNU tar exits **1** ("file changed as we read it"), or
**2** when a whole entry is affected, *while still producing a valid archive of
everything else*. The first live `--apply` failed with exactly this (`rc=2`).

The capture therefore does two things in the guest:

1. **Snapshots to a guest temp file first**, then `cat`s that settled file to
   stdout — so the bytes streamed to the host can't race the daemon.
2. **Classifies tar's exit code**: `0` = clean; `1`/`2` = files
   changed/vanished mid-read (expected here — the archive is usable); `>= 3` =
   a genuine failure (missing dir, write error), which aborts. `daemon.log` (the
   busiest file) is excluded outright, and `--warning=no-file-changed
   --ignore-failed-read` quiet the remaining churn.

Because the guest capture now exits non-zero **only** on a real failure, the host
side *can* trust the propagated exit code, and additionally verifies the result
is a non-empty, valid tar (`tar -tf`) before atomically renaming it into place.
`paseo-restore` likewise checks both the propagated exit code and a completion
marker the guest prints, so a partial extract is never mistaken for success.

## What the snapshot includes and excludes

- **Included:** the `$PASEO_HOME` tree (`config.json`, `projects/`, `agents/`,
  session records, anything else Paseo persists there) minus the specific
  exclusions below. Capturing the tree broadly — rather than an allowlist of
  known files — means a future Paseo state file is preserved automatically.
- **Excluded — `paseo.pid`:** a supervisor PID lock. Replaying a stale PID into a
  fresh container is misleading; the daemon recreates it on boot. (Paseo's lock is
  stale-tolerant, so a leftover would be reclaimed anyway, but there is no reason
  to carry it.)
- **Excluded — `daemon.log`:** the daemon's live log, observed at ~1.8 MB and
  growing on a real sandbox. Because it is appended *while the tar reads it*, GNU
  tar reports "file changed as we read it" and exits non-zero (rc 1, or rc 2 when
  a whole entry is affected) — the observed cause of the first live backup
  failing. It is pure runtime noise, not restorable state, so it is excluded.
- **Excluded — `daemon-keypair.json`, `cli-client-id`, `server-id`:**
  per-daemon/-install identity that the daemon regenerates on first boot.
  Carrying it into a *different* sandbox is pointless at best and confusing at
  worst.
- **Excluded — `models/`:** downloaded model caches (e.g. a ~460 MB sherpa-onnx
  speech model observed on a live sandbox). Large, re-downloadable, and not
  state; including it both bloats the archive and makes the base64 transport
  crawl. The daemon re-fetches on demand.
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

## The restore daemon bounce must clear the stale PID lock

After extracting the snapshot, `paseo-restore` restarts the daemon so it re-reads
the restored `config.json` and projects. The kit runs the daemon under a
`supervisor:paseo-daemon` respawn loop, so the bounce **kills the daemon child**
(never the supervisor) and lets the supervisor relaunch it.

But killing the daemon leaves its `$PASEO_HOME/paseo.pid` lock behind, and
Paseo only treats that lock as stale after **five minutes**. The supervisor
respawns every ~5 s, so without intervention every relaunch loses the race —
`Failed to acquire PID lock due to race condition` on repeat, and the daemon
never comes back (observed live). The bounce therefore **kills the daemon, waits
for it to actually exit, then removes `paseo.pid`** so the next respawn acquires
the lock cleanly. The lock is meaningless once its owner is dead, so removing it
is safe. (This is also why `paseo.pid` is excluded from the snapshot — a restored
stale lock would reintroduce the same stall.)

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
