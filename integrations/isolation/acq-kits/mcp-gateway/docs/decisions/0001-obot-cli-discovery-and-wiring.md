# Decision: Use the obot CLI to discover and wire MCP servers

**Status:** accepted

## Context

The GSA-TTS obot MCP gateway (the "MCP Server Hub") fronts *many* MCP servers.
A client reaches each one at its own proxy URL,
`<gateway>/mcp-connect/<server-id>/mcp`. Two facts make a hardcoded, kit-shipped
server list unworkable:

1. **`<server-id>` is assigned at registration and changes on re-register.** Any
   URL the kit shipped would silently go stale (a server re-registered under a new
   id would 404).
2. **The roster churns.** The catalog grows and changes; a static list is
   stale-by-construction for a moving pilot.

The obot project ships an **`obot` CLI** whose `obot mcp search` command lists the
gateway's servers and their **current** connection URLs live. This is the natural
source of truth for discovery.

## Decision

Build the kit around the **obot CLI**:

- **Install the obot CLI** into the sandbox (see ADR-0003).
- **Prime it** so `obot mcp search` resolves the gateway (see ADR-0004): drop
  obot's `config.json` (`defaultURL`) and inject the API key as `OBOT_TOKEN`.
- **Ship a vendored discovery skill** (`obot-search-mcp-servers`) that teaches the
  agent to run `obot mcp search` and offer to wire a result.
- **Ship a turnkey wiring helper** (`obot-add-server.sh`) that searches, appends
  the `/mcp` suffix the search URL omits, and deep-merges an OpenCode remote MCP
  entry (`Authorization: Bearer {env:OBOT_TOKEN}`) into the global config via a
  JSONC-safe Node merge (`obot-merge-mcp.mjs`), modeled on the usai-provider kit's
  `merge-global-config.mjs`.

The kit is **agent-agnostic at the network/token layer** (any MCP-capable agent
can use the primed CLI + injected key), with **turnkey OpenCode wiring** on top
because OpenCode is this repo's primary agent.

## Why not the earlier static-URL design

An earlier iteration allow-listed the gateway and *documented* per-server URLs for
the user to paste. That required the user to copy volatile `mcp-connect/<id>` URLs
from the obot UI and re-copy them whenever an id changed. The CLI eliminates that
friction: URLs are fetched live, and the helper writes the config. The static
design is superseded by this one.

## Why not `obot mcp add` (a native wiring command)

`obot mcp` exposes only `search` (verified on obot v0.25.4) — there is no native
"write this into my client config" command. So the OpenCode entry must be written
by our own helper. If obot later adds a native wiring command, `obot-add-server.sh`
can wrap it instead of merging JSONC directly.

## Consequences

- Discovery and wiring always use **current** URLs; nothing the kit ships goes
  stale when a `<server-id>` changes. Re-running `obot-add-server.sh` updates the
  entry's URL in place.
- The kit carries three small scripts + one config file + a vendored skill, and a
  pinned CLI binary — more surface than a pure allow-list kit, justified by the
  removal of manual, error-prone URL wiring.

## See also

- [`0002-allowlist-http-port-80.md`](0002-allowlist-http-port-80.md)
- [`0003-install-obot-cli-from-github-release.md`](0003-install-obot-cli-from-github-release.md)
- [`0004-prime-obot-config-and-token.md`](0004-prime-obot-config-and-token.md)
- [`../../usai-provider/docs/decisions/0004-global-config-merge-instead-of-opencode-config.md`](../../usai-provider/docs/decisions/0004-global-config-merge-instead-of-opencode-config.md)
  — the JSONC-merge pattern the wiring helper reuses.
