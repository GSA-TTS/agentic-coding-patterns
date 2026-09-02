# mcp-gateway (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that gives a coding agent in the sandbox reach to MCP servers hosted behind
the GSA-TTS **obot MCP gateway** (the "MCP Server Hub"), **driven by the obot
CLI**: it installs a pinned `obot` binary, primes the gateway URL, injects the
obot API key, and ships a skill + helper to **discover** servers and **wire** a
chosen one into the agent's config.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which abstracts the isolation backend (`sbx`, `msb`).
> See the [backend parity](#backend-parity) note.

## Why the obot CLI (not static server URLs)

The gateway fronts *many* MCP servers, each reachable at its own proxy URL of the
form `<gateway>/mcp-connect/<server-id>/mcp`. The `<server-id>` is assigned by the
gateway at registration and **changes** if a server is re-registered — so a
hardcoded list would go stale. Instead, this kit installs the `obot` CLI and uses
`obot mcp search` to discover servers and their **current** URLs at use-time. See
[`docs/decisions/0001-obot-cli-discovery-and-wiring.md`](docs/decisions/0001-obot-cli-discovery-and-wiring.md).

## What it does

- **Installs the obot CLI** — fetches a pinned `obot` release binary from GitHub
  Releases at create time (verified by sha256), on PATH.
- **Primes the gateway URL** — drops obot's `config.json`
  (`{ "defaultURL": "<gateway>" }`) so `obot mcp search` resolves the gateway. No
  `obot setup` is used (it demands an `llm` scope our MCP token does not carry).
- **Injects the API key** — the obot API key reaches the CLI as the `OBOT_TOKEN`
  env var (see [Prerequisites](#prerequisites)); the CLI reads it per-invocation,
  with **no keyring** and **no `obot login`** required.
- **Ships a search skill + wiring helper** — a vendored `obot-search-mcp-servers`
  skill (linked into the agent skill paths) and `obot-add-server.sh`, which
  searches and writes an OpenCode remote MCP entry for you.

## Discovering and wiring a server (worked example: CDC PLACES)

**1. Search the gateway:**

```sh
obot mcp search --non-interactive "CDC PLACES"
# TITLE       …  URL
# CDC PLACES  …  http://obot-alb-469455713.us-east-1.elb.amazonaws.com/mcp-connect/ms1frnfd
```

(Run with no query to list every available server.)

**2a. Wire it automatically** with the bundled helper — it searches, appends the
`/mcp` suffix the search result omits, and merges an OpenCode entry using
`Authorization: Bearer {env:OBOT_TOKEN}`:

```sh
~/obot-add-server.sh "CDC PLACES"
# -> writes mcp.cdc-places into ~/.config/opencode/opencode.jsonc
```

**2b. Or wire it by hand** in `~/.config/opencode/opencode.jsonc` (note the
appended `/mcp`):

```jsonc
"mcp": {
  "cdc-places": {
    "type": "remote",
    "url": "http://obot-alb-469455713.us-east-1.elb.amazonaws.com/mcp-connect/ms1frnfd/mcp",
    "enabled": true,
    "headers": { "Authorization": "Bearer {env:OBOT_TOKEN}" }
  }
}
```

OpenCode substitutes `{env:OBOT_TOKEN}` at load time — the key is never written
into the config file. Other agents use their own remote-MCP config shape with the
same URL + `Authorization: Bearer` header.

## Prerequisites

The obot API key is **not** stored in the kit. Store it once via `acq`, bound to
the gateway host, so the active backend injects it as `OBOT_TOKEN`:

```bash
acq secret set-custom -g \
  --host obot-alb-469455713.us-east-1.elb.amazonaws.com \
  --env OBOT_TOKEN
```

The `--host` MUST match the allow-listed gateway host. **The key must carry MCP
scope (`all-mcp` or per-server) — NOT `llm`.** (`obot login`'s valid scopes are
`llm, skills, device-scans, all-mcp`; MCP search + connect need the MCP scope
only. A key without it fails with `token is not allowed` / `does not have scope`.)

If requests start returning `401`, create/rotate the key in the obot UI and re-run
the command. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

> **OPEN CAVEAT — plaintext `:80` secret injection (verify with the acq team).**
> The gateway is plain **HTTP on `:80`**. It is **not yet confirmed** that
> `acq/sbx secret set-custom` binds and injects an env secret for a plaintext
> `:80` host (the USAi precedent is an HTTPS/`:443` host). If injection does not
> apply to `:80` hosts, the token path above needs a different mechanism — ask
> the acq maintainers before relying on this in production. Separately, a Bearer
> token over HTTP is **plaintext on the wire**; that is acceptable only within the
> sandbox's controlled egress and should be revisited at the HTTPS cutover. See
> [`docs/decisions/0002-allowlist-http-port-80.md`](docs/decisions/0002-allowlist-http-port-80.md).

## Backend parity

Both backends (`sbx`, `msb`) install the same pinned `obot` binary, allow-list the
same hosts, drop the same `config.json`, and read the injected `OBOT_TOKEN`. There
is no backend shortcut. The only per-backend difference is **how `acq` injects
`OBOT_TOKEN`** at runtime, which `acq` owns (not this kit). Behavioral parity: the
agent can `obot mcp search` and reach the gateway on every backend.

## Usage

```bash
acq run opencode /path/to/project        # acq applies the pinned kits, incl. this one
```

The kit is a `mixin`, so it composes with the other acq-kits (e.g. add it
alongside `usai-provider`). `acq` translates the neutral spec to the active
backend's primitives via its kit-translate layer.

## The gateway URL is movable

The shipped host is a raw AWS ALB DNS name. It **changes** on ALB
replacement/redeploy, and the HTTPS cutover will change **both** the host (to a
custom domain) **and** the port (drop `:80` for `:443`). When the gateway URL
changes, update the five places that name it:

1. `spec.yaml` → `caps.network.allow`
2. `spec.yaml` → `environment.OBOT_GATEWAY_URL`
3. `files/home/obot-config/config.json` → `defaultURL`
4. this README's worked example
5. `scripts/verify` (`GATEWAY_HOST` / `PROBE_URL`)

## Verifying

Run the bundled check on a host with a backend CLI (e.g. `sbx`) installed and
logged in:

```bash
./scripts/verify
```

It validates the spec, creates a throwaway sandbox with the kit, and confirms:
`obot` is installed at the pinned version; obot's `defaultURL` is primed; (if
`OBOT_TOKEN` is set) `obot mcp search --non-interactive --json` returns the CDC
PLACES server and `obot-add-server.sh "CDC PLACES"` writes a valid
`mcp.cdc-places` entry (with the `/mcp` suffix + Bearer header); and the gateway
is reachable on `:80` (an unauthenticated MCP probe returns HTTP `401` rather than
a connection failure — no key needed for this reachability check). Set `KEEP=1` to
keep the sandbox for inspection.

The merge helper has offline unit tests:

```bash
npm test        # node --test tests/**/*.test.mjs
```

## Design decisions

See [`docs/decisions/`](docs/decisions/):

- [`0001-obot-cli-discovery-and-wiring.md`](docs/decisions/0001-obot-cli-discovery-and-wiring.md)
  — use the obot CLI to discover + wire servers (not static URLs).
- [`0002-allowlist-http-port-80.md`](docs/decisions/0002-allowlist-http-port-80.md)
  — why `:80` is allow-listed and the open `set-custom`-on-`:80` question.
- [`0003-install-obot-cli-from-github-release.md`](docs/decisions/0003-install-obot-cli-from-github-release.md)
  — install a pinned release binary (not brew).
- [`0004-prime-obot-config-and-token.md`](docs/decisions/0004-prime-obot-config-and-token.md)
  — prime `defaultURL` via `config.json` + `OBOT_TOKEN` (avoid `obot setup`'s
  `llm` scope), and the scope model.

## Layout

```text
mcp-gateway/
├── spec.yaml                     # the kit (hybrid/v1)
├── files/home/
│   ├── obot-install.sh           # install the pinned obot binary (root, create-time)
│   ├── obot-startup.sh           # prime defaultURL + link the skill (agent, every start)
│   ├── obot-add-server.sh        # turnkey: search -> wire an OpenCode mcp entry
│   ├── obot-merge-mcp.mjs        # JSONC-safe merge of the mcp entry
│   ├── obot-config/config.json   # obot defaultURL primer
│   └── obot-skills/obot-search-mcp-servers/SKILL.md   # vendored search skill
├── scripts/verify                # host-side end-to-end check
├── tests/                        # unit tests for the merge helper
├── package.json
├── README.md
└── TROUBLESHOOTING.md
```
