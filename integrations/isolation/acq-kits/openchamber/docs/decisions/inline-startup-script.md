# Decision: inline the startup script, avoid static files and initFiles

**Status:** superseded (see "Update" below) — the script is now a `files/`
payload in the neutral `hybrid/v1` kit.

> **Update (acq-kits conversion, #223).** When this kit was converted from the
> sbx `schemaVersion: "2"` spec to the neutral `hybrid/v1` spec, the startup
> body was **extracted to `files/home/openchamber-start.sh`** and dropped via
> `files[].source` — the opposite of the decision below. Why the reversal is
> safe now:
>
> - The #118 crash was specific to sbx's create-time static-file **`content`**
>   write hook. The neutral `files[].source` mechanism references a payload file
>   in the kit tree (like `agentic-coding-playbook`'s `playbook-clone.sh` and
>   `git-ssh-sign`'s key command), which each backend materializes with its
>   native file-drop — not the metacharacter-fragile inline-content path.
> - A `source:` payload has no `initFiles.content` placeholder restriction
>   either, so `${VAR}` expansions survive verbatim.
> - Extracting the script makes it lintable (`sh -n`, unsafe-shell scan) and
>   testable on its own, matching the design doc §6 rationale the other acq-kits
>   followed.
>
> The original context/decision is retained below for history.

---

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
   write hook (inline **`content`**) mishandles shell-metacharacter-heavy content
   (quotes, `$(...)`, backslash continuations) — see docker/sbx-releases #118
   ("[Kits] Crash on startup with some static files"). *(The neutral
   `files[].source` payload mechanism used after the #223 conversion is a
   different, working path — see the Update above.)*
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
