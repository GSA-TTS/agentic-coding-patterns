# Decision: register the router as a local stdio MCP server, merged into OpenCode's global config

**Status:** accepted
**Date:** 2026-10-05

## Context

The router must be reachable by the agent as a callable tool. OpenCode supports
**local MCP servers** declared under a top-level `mcp` key in its config:

```json
"mcp": {
  "model-router": { "type": "local", "command": ["python3", ".../mcp_server.py"], "enabled": true }
}
```

The reference `jev-skill-router` is also a stdio MCP server, registered in its
host's config. We follow the same delivery mechanism.

Two wiring choices had to be made: (1) how the server is run, and (2) how it is
registered without clobbering other kits' config.

## Decision

**Run as stdio, stdlib-only, in place.** The three `.py` files are dropped
verbatim by the kit's `files[]` block and run directly with the guest's
`python3`. No pip install, no venv, no compiled extension, no server port —
the MCP host (OpenCode) spawns and speaks to the process over stdio on demand.

**Register by MERGING, not clobbering.** A startup step
(`model-router-install.sh`) deep-merges a single `mcp.model-router` entry into
OpenCode's global config using stdlib `json`, preserving every other key and
every other MCP server. This mirrors the `usai-provider` kit's "merge, don't
clobber" rule so the two kits compose: `usai-provider` writes the provider +
model catalog, `model-router` adds its one MCP entry, neither overwrites the
other.

**Refuse to merge a config we cannot safely parse.** OpenCode's config is JSONC
(comments allowed). Stdlib `json` cannot round-trip comments. If the existing
global config is not pure JSON, the merge step **leaves it untouched** and tells
the user to add the one `mcp.model-router` block by hand (documented in the
README), rather than silently dropping their comments or corrupting the file.

## Consequences

- **Positive:** trivial, offline install; composes cleanly with `usai-provider`;
  idempotent (re-running converges); fail-soft (any wiring failure logs and exits
  0 — an optional tool never kills the sandbox).
- **Negative:** the JSONC-safety guard means a user whose global config carries
  comments must add one block manually. This is the honest, non-destructive
  trade-off; the `usai-provider` merge script accepts the same comment-loss
  limitation on its own merge branch.
- **Startup, not install phase:** nothing is fetched or compiled, so there is no
  create-vs-startup safety tension; running at startup also self-heals the wiring
  if a later boot reset the config.
