# Decision: launch Paseo 0.9 with persisted config and `daemon run`

**Status:** accepted

## Context

Paseo 0.9 removed the launch flags this kit used with `paseo daemon start`:
`--listen`, `--web-ui`, and `--foreground`. Passing any of those flags now fails
before the daemon starts.

Paseo 0.9 also separates two local launch modes:

- `paseo daemon start` is managed mode. It launches a detached supervisor and
  strips daemon-setting environment variables such as `PASEO_LISTEN`,
  `PASEO_WEB_UI_ENABLED`, and `PASEO_RELAY_ENABLED` before the worker starts.
  Managed mode therefore depends on persisted `config.json` for those settings.
- `paseo daemon run` is foreground deployment mode. It keeps daemon-setting
  environment overrides and still runs Paseo's own supervisor-entrypoint, which
  manages the daemon worker with IPC restart and crash restart.

The acq kit needs a foreground process so its outer startup loop can observe an
exit and relaunch it, and it needs a `0.0.0.0:6767` in-guest bind so msb
create-time publishing can reach the daemon from the host.

## Decision

Use `paseo daemon run` inside the kit's existing `supervisor:paseo-daemon` loop.
Before launching it, persist the settings the sandbox depends on into
`$PASEO_HOME/config.json`:

- `daemon.listen = 0.0.0.0:6767`
- `features.webUi.enabled = true`
- `daemon.relay.enabled = false`

Keep the matching environment variables on the `daemon run` invocation as a
belt-and-suspenders deployment override, but treat persisted config as the
source of truth for Paseo 0.9 managed/config tooling. Startup takes the shared
`$PASEO_HOME/.config-json.lock`, writes the settings, and reads them back before
launching the daemon; if the required settings cannot be verified, it does not
start an unauthenticated daemon with unknown relay/listen defaults.

When the entrypoint shim changes `worktrees.root`, prefer the supported
`paseo daemon restart` command so Paseo restarts the worker and re-reads
`config.json`. Keep the old marker-scoped kill path only as a fallback if the
CLI restart cannot run.

## Consequences

- The kit no longer passes removed Paseo 0.9 flags.
- The daemon still comes up automatically on sandbox start and remains supervised.
- `paseo daemon status` and config tooling report the same listen/web UI/relay
  settings that the sandbox uses at runtime. On a restored or migrated sandbox,
  the lock can retain a `startedAt` timestamp from before the current kernel
  boot even while the daemon process tree remains healthy. During startup only,
  the kit detects that condition, verifies the lock PID is Paseo's own supervisor,
  and performs a bounded graceful stop so the outer supervisor can write a fresh
  lock. Ambiguous, malformed, post-boot, or unreconciled locks are left intact;
  the startup script logs the reason and does not start a second daemon.
- The `0.0.0.0:6767` bind remains explicit, preserving msb create-time port
  reachability.
- Future Paseo version bumps must verify both the version pin and daemon command
  surface, not only the package version.

## Links

- `paseo-single-port-daemon.md`
- `supervisor-owns-daemon-wrapper-pins-worktrees.md`
- `worktrees-root-global-only.md`
