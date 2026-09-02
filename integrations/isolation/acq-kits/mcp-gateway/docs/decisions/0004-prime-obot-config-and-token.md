# Decision: Prime obot via `config.json` + `OBOT_TOKEN` (not `obot setup`)

**Status:** accepted

## Context

For `obot mcp search` to reach the gateway, the CLI needs two things. We
determined empirically (obot v0.25.4) exactly what, and what it does *not* need:

- **A stored default URL.** Without it, the CLI falls back to
  `http://localhost:8080` and fails (`connection refused`). The default URL is
  stored in a trivial config file — on Linux, `~/.config/obot/config.json`
  (XDG), containing just:

  ```json
  { "defaultURL": "http://obot-alb-…elb.amazonaws.com" }
  ```

- **An API key.** With `OBOT_TOKEN` set in the environment, the CLI authenticates
  per-invocation. Verified: after `obot logout` (which clears any cached token),
  simply exporting `OBOT_TOKEN` makes `obot mcp search` work again — **no keyring,
  no `obot login`** required.

The obvious "supported" way to set the default URL is `obot setup`, but `setup`
**demands the `llm` scope** and refuses an MCP-scoped token
(`token does not have scope: llm` / `token is not allowed`). We do not want to
force users to mint a broader-scoped key just to set a URL.

The obot token scope model (from `obot login --help`): valid scopes are
`llm, skills, device-scans, all-mcp`. MCP search + connect need the **MCP** scope
(`all-mcp` or per-server) only.

## Decision

**Prime obot directly, bypassing `obot setup`:**

1. **Drop `config.json`** (`{ "defaultURL": "<gateway>" }`) into obot's Linux
   config dir at startup — the same file `setup` would write, minus the
   `llm`-scoped auth dance. Honors `XDG_CONFIG_HOME`, else `~/.config/obot/`.
2. **Inject the API key as `OBOT_TOKEN`** via `acq` (host-bound `set-custom`). The
   CLI reads it from the env; no keyring, no `login`.

`obot setup` and `obot login` are therefore **not** part of the happy path.
(`obot login --non-interactive --scope all-mcp` *does* authenticate headlessly and
could persist a token, but it is unnecessary given env-token auth works — noted as
an optional fallback only.)

The user's key prerequisite is thus **MCP scope (`all-mcp` or per-server), NOT
`llm`** — documented in the README and TROUBLESHOOTING.

## Considered alternatives

- **`obot setup --clients none --non-interactive --yes`** — rejected: requires
  `llm` scope our token lacks (empirically fails). Also installs obot's own
  bootstrap skills, which we vendor a pinned copy of instead (provenance).
- **`obot login --scope all-mcp` at startup** — unnecessary for the happy path
  (env-token auth suffices) and adds a keyring dependency a headless container may
  not satisfy. Kept only as a documented fallback.
- **Rely on a pre-existing stored config** — not viable: a fresh sandbox has none.

## Consequences

- Minimal, declarative priming: one small JSON file + one injected env var.
- No keyring dependency, which suits a headless Linux sandbox.
- The exact Linux config path is confirmed by `scripts/verify` in a real sandbox;
  the startup script targets `${XDG_CONFIG_HOME:-$HOME/.config}/obot/config.json`.
- Open item inherited from ADR-0002: whether `set-custom` injects `OBOT_TOKEN` for
  a plaintext `:80` host is unverified (for the acq maintainers).

## See also

- [`0001-obot-cli-discovery-and-wiring.md`](0001-obot-cli-discovery-and-wiring.md)
- [`0002-allowlist-http-port-80.md`](0002-allowlist-http-port-80.md)
- [`0003-install-obot-cli-from-github-release.md`](0003-install-obot-cli-from-github-release.md)
