# Decision: one Paseo daemon serves everything on a single port; no shared session

**Status:** accepted

## Context

The sibling `openchamber` kit runs a browser UI (OpenChamber) against a
**separate** shared `opencode serve`, so it publishes **two** container ports
(3000 for the UI, 4096 for the raw OpenCode server) and gives the terminal TUI
and the browser one shared live session by attaching both to `:4096`.

Paseo is architected differently:

- A **single daemon process** (`@getpaseo/server`, launched by `@getpaseo/cli`)
  serves the daemon API, the WebSocket, **and** the bundled browser web UI, all
  on **one** port (default `6767`). Verified against the Paseo Docker image and
  the published npm tarball: `PASEO_WEB_UI_ENABLED=true` (or `--web-ui`) serves
  the UI from `dist/server/web-ui/` inside the `@getpaseo/server` package on the
  same origin as the API.
- Paseo is **not** an OpenCode server. It orchestrates agent CLIs (Claude Code,
  Codex, Copilot, OpenCode, Pi) by **launching them as child processes**. There
  is no attachable "raw agent server" that a terminal TUI could join.

## Decision

**Publish exactly one container port (6767) and accept that there is no shared
terminal↔browser session.**

- The kit declares a single neutral `publishedPorts` entry (`guest: 6767`).
- The kit does **not** attempt to bridge a terminal OpenCode TUI to Paseo — there
  is nothing to attach to, and the user explicitly accepted losing shared
  sessions for Paseo.
- Running `opencode <args…>` in the sandbox still passes through to the real
  opencode (so opencode works as one of Paseo's provider CLIs), but that is a
  separate process from anything Paseo drives.

## Consequences

- Simpler than openchamber: one port, one supervised process, no password file,
  no `opencode attach` bridge.
- The terminal and the browser do not share live session state. This is surfaced
  in `agentContext`, `README.md`, and `TROUBLESHOOTING.md` so it is not a
  surprise.
- If Paseo ever exposes an attachable agent server, a shared-session variant
  could be added later; nothing here precludes it.

## Links

- Paseo: <https://github.com/getpaseo/paseo>
- Paseo Docker docs — one container serves the daemon API + web UI on 6767.
- `../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md` — the
  contrasting shared-server design this kit deliberately does not follow.
