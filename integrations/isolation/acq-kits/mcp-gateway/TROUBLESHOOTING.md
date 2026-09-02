# Troubleshooting — mcp-gateway kit

These are failure modes specific to the obot-CLI-driven MCP gateway kit. They
assume you have applied the kit to a sandbox (`acq run --kit mcp-gateway opencode
<project>`).

## `obot` is not installed / `obot: command not found`

**Cause:** the create-time install step failed (offline, bad pin, or sha
mismatch). It is non-fatal, so the sandbox still starts without `obot`.

**Fixes:**

- Confirm egress allowed the download hosts: `api.github.com:443`,
  `github.com:443`, `objects.githubusercontent.com:443` (`acq`/`sbx policy log
  <sandbox>`).
- Check the install log for a **sha256 mismatch** — a mismatch means the pinned
  hash and the downloaded asset disagree (wrong version pinned, or a tampered
  download); the kit refuses to install a mismatched binary by design.
- Recreate the sandbox to re-run the install step.

## `obot mcp search` fails with `localhost:8080: connection refused`

**Cause:** the obot **default URL is not primed**, so the CLI fell back to the
local-Docker default (`http://localhost:8080`).

**Fixes:**

- Confirm the config landed: `cat "${XDG_CONFIG_HOME:-$HOME/.config}/obot/config.json"`
  should show `{ "defaultURL": "http://obot-alb-…" }`.
- If missing, the startup step didn't run or couldn't write it — check the startup
  logs for `mcp-gateway(startup):` lines and recreate the sandbox.

## `obot mcp search` prompts for browser authentication

**Symptom:** output like *"Authentication is needed … GitHub is used for
authentication … This can be bypassed by setting the env var OBOT_TOKEN."*

**Cause:** `OBOT_TOKEN` is not set in the guest, so the CLI wants an interactive
login (which cannot complete in a headless sandbox).

**Fixes:**

- Store the key so `acq` injects it: `acq secret set-custom -g --host
  obot-alb-469455713.us-east-1.elb.amazonaws.com --env OBOT_TOKEN`.
- Confirm it reached the guest:
  `acq`/`sbx exec <sandbox> -- sh -c 'test -n "$OBOT_TOKEN" && echo set || echo MISSING'`.
- If it says `MISSING` despite a stored secret, see the `:80` injection caveat
  below.

## Requests rejected: `token is not allowed` / `does not have scope: llm` / `401`

**Cause:** the token's **scope** is wrong.

- `does not have scope: llm` / `token is not allowed` typically come from `obot
  setup` (which needs `llm`). This kit does **not** use `setup`; you do not need
  an `llm`-scoped key. If you hit this, you likely ran `obot setup` manually — use
  `obot mcp search` (and the kit's config prime) instead.
- A `401` from the **gateway** means the key is missing, expired, or **not scoped
  to that server**. The key must carry MCP scope (`all-mcp` or per-server). Widen
  the scope or rotate the key in the obot UI (Account settings → API Keys) and
  re-run `acq secret set-custom … --env OBOT_TOKEN`.

## `obot-add-server.sh` reports "multiple servers matched"

**Cause:** your query matched more than one server title.

**Fix:** narrow the query to a unique title (e.g. `"CDC PLACES"` not `"CDC"`), or
pass an explicit entry name and a precise query:
`~/obot-add-server.sh --name cdc-places "CDC PLACES"`.

## The wired server 404s after working before

**Cause:** the server's `<server-id>` changed (it was re-registered), so the URL
in your OpenCode config is stale.

**Fix:** re-run `~/obot-add-server.sh "<title>"` — it fetches the current URL from
`obot mcp search` and updates the entry in place.

## The MCP entry is missing the `/mcp` suffix / OpenCode can't connect

**Cause:** `obot mcp search` returns URLs **without** the trailing `/mcp` (e.g.
`…/mcp-connect/ms1frnfd`), but the MCP endpoint is `…/mcp-connect/ms1frnfd/mcp`.
The helper appends `/mcp` automatically; a hand-written entry must include it.

**Fix:** ensure the `url` ends in `/mcp`.

## OPEN CAVEAT — plaintext `:80` secret injection (verify with the acq team)

The gateway is plain **HTTP on `:80`**. Whether `acq/sbx secret set-custom` binds
and injects an env secret for a **plaintext `:80` host** (as opposed to the
HTTPS/`:443` USAi precedent) is **UNVERIFIED**. If it does not:

- `OBOT_TOKEN` will be absent in the guest, and `obot mcp search` prompts for
  browser auth / gateway requests `401`.
- A different secret-delivery mechanism would be needed.

Ask the acq maintainers before relying on this in production. Separately, a Bearer
token over HTTP is **plaintext on the wire** — acceptable only inside the
sandbox's controlled egress, and to be revisited when the gateway moves to HTTPS.
See [`docs/decisions/0002-allowlist-http-port-80.md`](docs/decisions/0002-allowlist-http-port-80.md).
