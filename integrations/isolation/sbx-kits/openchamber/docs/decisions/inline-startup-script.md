# Decision: inline the startup script, avoid static files and initFiles

**Status:** accepted

## Context

The kit needs to run a startup script that (1) generates/loads a per-sandbox
password, (2) starts a managed `opencode serve`, and (3) starts OpenChamber
pointed at it. The script uses ordinary shell parameter expansion
(`${OPENCHAMBER_PORT:-3000}`, `${OPENCODE_SERVER_PASSWORD}`), command
substitution, and line continuations.

Three ways to get that script into the sandbox were tried, in order:

1. **`commands.initFiles`** — rejected by `sbx kit validate`: `initFiles.content`
   permits no placeholder except `${WORKDIR}`, and the script legitimately needs
   literal `${VAR}` expansions.
2. **Static file under `files/home/.local/bin/`** — passed `sbx kit validate`,
   but `sbx create` failed at container start with a generic
   `500 ... failed to run sandbox container`. sbx's create-time static-file
   write hook mishandles shell-metacharacter-heavy content (quotes, `$(...)`,
   backslash continuations) — see docker/sbx-releases #118
   ("[Kits] Crash on startup with some static files").
3. **Inline the script into `commands.startup`** — the script body is passed as
   the third element of an `sh -c` argv.

## Decision

**Inline the whole startup script into `commands.startup` as an `sh -c` argv.**

Startup commands run through a normal exec, not the static-file write hook, so
they sidestep #118 entirely; and unlike `initFiles.content` they carry no
placeholder restrictions, so shell expansions survive verbatim. No `files/` tree
is needed.

## Consequences

- No static file on disk to maintain or inspect; the script lives in `spec.yaml`.
  Debugging reproduces it from the documented commands in `TROUBLESHOOTING.md`.
- The script must stay idempotent (startup runs on every container start) — it
  guards the password file and the `opencode serve` health check accordingly.
- If sbx fixes #118 and a standalone wrapper becomes preferable (e.g. for reuse
  by `sbx exec`), the inline body can move back to `files/home/` unchanged.

## Links

- docker/sbx-releases #118 — [Kits] Crash on startup with some static files
- [sbx kit spec reference](https://docs.docker.com/ai/sandboxes/customize/kit-reference/)
