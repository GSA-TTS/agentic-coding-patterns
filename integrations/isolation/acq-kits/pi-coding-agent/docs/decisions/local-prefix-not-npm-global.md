# Decision: `$HOME/.local` as the npm install prefix, not `$HOME/.npm-global`

**Status:** accepted

## Context

Every unprivileged Node-CLI kit in this family needs a per-user npm prefix — a
sandbox startup script must not depend on the (often root-owned) system global
prefix. The sibling `openchamber` and `paseo` kits both chose
`$HOME/.npm-global` for this. That choice has a real, load-bearing cost that
both kits pay for in their own `scripts/verify`:

```sh
# openchamber's and paseo's own in_sbx() helper, verbatim comment:
# PATH SCOPING: `acq exec`/`sbx exec` run the probe as a bare non-login `sh -c`
# … A bare `sh -c` sources NOTHING … so its PATH is only whatever
# `/etc/environment` provides, which does NOT include the npm-global bin …
```

Concretely: `$HOME/.npm-global/bin` is **not** on the sandbox base image's
default `PATH` for a fresh, non-login shell. Both sibling kits' startup
scripts can find their own installed binary while they're still running
(they prepend the prefix's `bin/` to their *own* process's `PATH` before
installing), but any **later**, **separate** process — a freshly-attached
`acq exec`, a fresh `acq run` session, or a human just typing the binary's
name at a TUI prompt — does not see it unless something re-injects that PATH
entry every time. `openchamber`/`paseo` solve this by making every
`scripts/verify` probe inject `$HOME/.local/bin:$HOME/.npm-global/bin:$(npm
prefix -g)/bin` ahead of `$PATH` on every single exec — a workaround baked
into the test harness, not a fix to the underlying prefix choice.

This is exactly the failure mode a PR review for this kit flagged directly:
"a verify that probes `command -v pi` through a bare `sh -c` would have
caught [a `pi`-not-found-after-install] finding." A verify script that has to
carry its own PATH-injection workaround to pass is, definitionally, a verify
script that would **not** catch a regression where the real, unmodified guest
PATH stops resolving the binary — because the workaround masks exactly that
class of bug.

By contrast, `$HOME/.local/bin` **is already first on the guest's default
PATH** — verified against the base image directly (the same fact the sibling
`openchamber` kit's own `wrapper-entrypoint-owns-server.md` ADR documents when
explaining why an `opencode` wrapper at `~/.local/bin/opencode` can shadow the
real binary: "the image PATH puts `/home/agent/.local/bin` FIRST"). Anything
installed there resolves for every fresh shell, with no PATH injection needed
anywhere — in the install script, in `scripts/verify`, or for the human at the
terminal.

## Decision

**Install `pi` under the `$HOME/.local` prefix (`npm install -g --prefix
"$HOME/.local" …`), not `$HOME/.npm-global`.**

This is a deliberate divergence from the `openchamber`/`paseo` convention, not
an oversight — see `pi-coding-agent-install.sh`'s own inline comment
contrasting the two mechanisms. The reasoning:

- `$HOME/.local/bin` is on the default guest `PATH` for every process, not
  just the installer's own. No PATH-injection workaround is needed anywhere
  downstream — not in this kit's `scripts/verify`, not for a human attaching
  a fresh session.
- It closes off, by construction, the exact regression class the review
  finding describes: an install that "succeeds" from the installer's own
  point of view but is invisible to every other process.
- It keeps this kit's threat/verification model simpler than its siblings',
  consistent with this being "the SIMPLEST kit in this family" (per
  `spec.yaml`'s own header note) — one less moving part (a PATH-injection
  convention that has to be replicated correctly in every consumer) to get
  wrong.

## Consequences

- **Positive:** `scripts/verify`'s `in_sbx` helper for this kit injects
  **nothing** into `PATH` (contrast openchamber's/paseo's `in_sbx`, which
  both must). Its step 4 — a bare `command -v pi` probe — is therefore a
  genuine regression guard: if a future change reintroduces a
  non-default-PATH prefix, that step fails instead of silently passing
  through an injected workaround. See `scripts/verify`'s own comment on
  `in_sbx` for the explicit rationale.
- **Positive:** no divergence between "works for the script that installed
  it" and "works for the user who wants to run it" — the single most
  confusing class of bug this family of kits has hit so far.
- **Neutral:** the `pi` binary itself is not a plain npm bin-link at
  `~/.local/bin/pi` — it is a thin wrapper (see
  [`ca-bundle-wrapper-not-env-var.md`](ca-bundle-wrapper-not-env-var.md)) that
  execs the real npm-installed binary after rebuilding
  `NODE_EXTRA_CA_CERTS`. The `$HOME/.local` prefix decision and the wrapper
  decision are independent but composed: the wrapper lives at
  `$HOME/.local/bin/pi` specifically because that is the default-PATH
  location this ADR chose.
- **Negative / residual difference from siblings:** this kit's install
  layout is not identical to `openchamber`'s/`paseo`'s convention, so a
  reader moving between kits needs to notice the prefix differs. This is
  documented here, in `TROUBLESHOOTING.md`, and in `scripts/verify`'s own
  comment specifically so it isn't mistaken for an oversight.

## Links

- `../../openchamber/scripts/verify` — `in_sbx`'s own comment explaining why
  it injects `$HOME/.npm-global/bin` (the workaround this decision avoids
  needing).
- `../../paseo/scripts/verify` — the same workaround, independently
  duplicated.
- `../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md` — the
  base-image fact (`~/.local/bin` first on `PATH`) this decision also relies
  on.
- [`ca-bundle-wrapper-not-env-var.md`](ca-bundle-wrapper-not-env-var.md) — the
  companion decision for the wrapper that lives at this prefix.
