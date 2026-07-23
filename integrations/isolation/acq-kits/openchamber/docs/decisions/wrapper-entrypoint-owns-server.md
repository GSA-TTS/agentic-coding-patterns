# Decision: an `opencode` wrapper owns the shared server (from a mixin)

**Status:** accepted (supersedes the core premise of
[`openchamber-mixin-not-sandbox-kit.md`](openchamber-mixin-not-sandbox-kit.md))

## Context

The earlier design (see `openchamber-mixin-not-sandbox-kit.md`) concluded that a
**mixin** kit could *not* give the terminal and the browser a shared live
session, because doing so requires owning the sandbox entrypoint — and only a
`kind: sandbox` kit owns the entrypoint. The mixin therefore ran its own managed
`opencode serve` on loopback `:4096` for OpenChamber, while `acq run opencode`
started a *separate* in-process TUI server; the two did not share a live session
unless the user manually `opencode attach`ed.

New information invalidates that premise. Inspecting the actual base image
(`docker/sandbox-templates:opencode-docker`) shows:

- The image `PATH` puts **`/home/agent/.local/bin` FIRST**, ahead of
  `/usr/local/share/npm-global/bin` where the real `opencode` binary lives.
- The image `CMD` is the **bare, unqualified** `["opencode"]` (under
  `tini`) — not an absolute path.

So a file dropped at `~/.local/bin/opencode` **shadows** the real binary and
becomes what the entrypoint runs. A mixin *can* own the entrypoint after all —
by PATH precedence, without redefining the base agent.

We also reconsidered where the server should live. Having the *startup script*
run `opencode serve` for the whole sandbox lifetime meant an always-on server
even when nobody was using OpenCode. Making the server **on-demand**, owned by
the thing the user actually runs (`opencode`), is a cleaner UX and a smaller
attack surface.

## Decision

**Ship an `opencode` wrapper (`files/home/.local/bin/opencode`, mode 0755) that
owns a single shared `opencode serve`, and reduce the startup script to managing
OpenChamber only.**

The wrapper, run by the sandbox entrypoint (bare `opencode`):

- **No arguments** — idempotently starts
  `opencode serve --hostname 0.0.0.0 --port 4096` (no-op if already answering
  `/global/health`); prints host-connect instructions for both published ports;
  then, only if attached to a TTY, offers to
  `opencode attach http://127.0.0.1:4096` in that same terminal. On "no" or when
  non-interactive (e.g. `acq exec` with no TTY), it **hands the entrypoint off to
  a foreground `opencode serve`** (via `exec`, or by `wait`ing on the server it
  just backgrounded) so PID 1 stays alive — see "Keeping the entrypoint alive"
  below.
- **Any arguments** — resolves the real `opencode` on PATH (skipping itself) and
  `exec`s it with the args unchanged, so `opencode run …`, `opencode auth login`,
  etc. behave normally.

### Keeping the entrypoint alive (the running→stopped fix)

A Docker sandbox is reported "running" only while its **entrypoint / PID 1** is
alive. Because this wrapper *is* the entrypoint (via PATH-shadowing), the no-arg
path must never simply background the server and **return** — doing so lets PID 1
exit, so the sandbox flips running→stopped moments after `acq run` even though
the backgrounded server was briefly up.

The initial implementation of this ADR did exactly that (`nohup … serve & ; exit
0`), which surfaced as: `acq run <A>` then `acq run <B>` shows A "stopped" — A had
in fact stopped itself. The corrected wrapper ends every no-TUI path on a
long-lived **foreground** process: it `wait`s on the server it just backgrounded,
or `exec`s a fresh foreground `opencode serve` if one was already up. The
interactive `opencode attach` path already `exec`s (the TUI holds the entrypoint
open), so it was never affected.

The startup script (`openchamber-start.sh`) installs OpenChamber on first boot
and supervises OpenChamber in skip-start mode (`OPENCODE_SKIP_START=true` +
`OPENCODE_PORT=4096`), attaching to whatever server the wrapper has brought up.
It no longer starts or supervises `opencode serve`.

Two related choices:

- **Publish both container ports 3000 (OpenChamber) and 4096 (the shared
  server)** to the host, so a host TUI can attach to the raw server directly and
  the browser UI is reachable.
- **Run the shared server unsecured** (no `OPENCODE_SERVER_PASSWORD`). The
  sandbox is the security boundary; the published ports are host loopback only.
  This removes the per-sandbox password file the old design generated.

## Consequences

- **Shared session is the default.** The wrapper's `:4096` server backs both the
  browser and any attached TUI, so they share one live, in-flight session with no
  manual attach step. The old "different sessions" confusion goes away.
- **The server is on-demand.** OpenChamber shows no live server until `opencode`
  is run once. This is documented in `agentContext`, `README.md`, and
  `TROUBLESHOOTING.md`. Because the wrapper is also the entrypoint, the no-arg
  run additionally keeps the sandbox alive by foregrounding the server (see
  "Keeping the entrypoint alive"); the unauthenticated server is live for as long
  as the sandbox is.
- **Unsecured + host-published `:4096`.** Anyone with access to the host's
  loopback can drive OpenCode without a credential. Safe only on a trusted,
  single-tenant host; the Security note in the README states this and warns
  against forwarding the mapped ports to a wider interface.
- **PATH-shadowing dependency.** The design assumes `~/.local/bin` stays first on
  PATH and `CMD` stays the bare `opencode`. A base-image change to either would
  break shadowing; a TROUBLESHOOTING entry shows how to detect it
  (`command -v opencode`).
- **Ports need a manual publish step under acq (transitional).** acq's
  neutral→sbx translator (`kit_translate_to_sbx`) did not carry
  `backend_extras.sbx.publishedPorts`, so applying via `acq` did not auto-map
  3000/4096 to the host. Fixed upstream in
  [quickstart#221](https://github.com/GSA-TTS/agentic-coding-quickstart/pull/221)
  (closes quickstart#219/#220); until that reaches the pinned patterns kit ref
  the workaround is a one-time `acq ports <sandbox> --publish 3000:3000` /
  `--publish 4096:4096`. The verify script does this automatically on the
  `RUN_ACQ=1` path, and the README / TROUBLESHOOTING document it. Adopting the
  fix here is tracked as #233.
- The `kind: sandbox` variant contemplated by the older ADR is no longer needed
  for shared sessions — the mixin achieves it via the wrapper.

## Links

- OpenChamber: <https://github.com/openchamber/openchamber>
- OpenCode `opencode serve` / `opencode attach` — headless server + TUI attach.
- `openchamber-mixin-not-sandbox-kit.md` — the earlier ADR whose "a mixin can't
  own the entrypoint" premise this record corrects.
- `install-at-startup.md`, `pin-and-verify-installer.md` — unchanged; still apply
  to the OpenChamber install the startup script performs.
