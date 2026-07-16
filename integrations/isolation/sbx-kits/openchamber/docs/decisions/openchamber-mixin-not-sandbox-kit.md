# Decision: OpenChamber as an opt-in mixin, not a sandbox kit

**Status:** accepted

## Context

We want a browser UI for OpenCode available in the sandbox. OpenChamber provides
one. There were two ways to package it as an sbx kit:

1. **`kind: mixin`** — layer OpenChamber onto the existing built-in `opencode`
   agent. Install the CLI, run a managed `opencode serve`, and run OpenChamber
   against it. The base agent (image + entrypoint) is untouched.
2. **`kind: sandbox`** — define a new agent that owns the entrypoint, e.g.
   `opencode --port 4096` so the auto-started TUI *is* the server OpenChamber
   drives, giving the terminal and browser one shared live session.

The shared-session behavior (option 2) is the only thing a mixin cannot do: the
default `opencode` TUI starts its own in-process server on an ephemeral port and
exposes no attachable server unless a `--port`/`--hostname`/`--mdns` flag is
passed on its command line. There is no environment variable or config path that
makes the TUI expose a fixed server (verified against the opencode source:
`tui.ts` computes the "external server" decision from CLI args only, via
`resolveNetworkOptionsNoConfig(args)` with no config, and `hasArg()` reads
`process.argv`). So a shared session requires owning the entrypoint — a
`kind: sandbox` capability.

## Decision

**Ship OpenChamber as a `kind: mixin` kit, opt-in.**

- **Mixin, not sandbox kit.** A sandbox kit would replace the built-in
  `opencode` agent and inherit none of its spec — every `caps.network` /
  `credentials` / `environment` the built-in agent grants would have to be
  re-declared here and kept in sync as Docker changes the built-in agent. That
  is an ongoing drift risk for a single UX win (live terminal↔browser hand-off).
  The mixin composes cleanly with the existing GSA kits and owns nothing it
  doesn't need to.
- **Opt-in, not a default GSA kit.** Not everyone wants a web server running in
  every sandbox. Users add it via `ACQ_EXTRA_KITS` (or `QSBX_EXTRA_KITS`), so it
  costs nothing for those who don't.
- **Document the shared-session bridge.** The one thing the mixin gives up —
  shared live sessions — is available on demand: attach a terminal to the
  managed server with `opencode attach http://127.0.0.1:4096` instead of
  launching a fresh TUI. This is documented in the kit's `agentContext`,
  `README.md`, and `TROUBLESHOOTING.md`.

## Consequences

- The kit composes with `usai-provider`, `playbook-kit`, `zscaler-ca-certificate`,
  and `git-ssh-sign` via repeated `--kit` flags — no changes to `acq`/`qsbx`.
- The default TUI and the OpenChamber browser do **not** share live session
  state by default. This is surfaced prominently to users (it's the most likely
  source of confusion) with a one-command workaround.
- The managed `opencode serve` is loopback-only; only OpenChamber's port is
  mapped to the host. LAN access to OpenChamber is unauthenticated, safe only
  inside the sandbox boundary.
- If a shared-session experience later proves worth the maintenance, a
  `kind: sandbox` variant can be added without removing this mixin. Tracked as a
  possible follow-up.

## Links

- OpenChamber: <https://github.com/openchamber/openchamber>
- [sbx kits documentation](https://docs.docker.com/ai/sandboxes/customize/kits/)
- OpenCode `opencode attach` — attaches a TUI to a running `opencode serve`.
