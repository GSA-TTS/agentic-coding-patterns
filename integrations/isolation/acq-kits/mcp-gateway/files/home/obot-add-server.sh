#!/bin/sh
# obot-add-server.sh — search the obot gateway for an MCP server and wire the
# matched server into OpenCode's global config.
#
# Usage:
#   ~/obot-add-server.sh "CDC PLACES"        # query by title/keyword
#   ~/obot-add-server.sh --name cdc-places "CDC PLACES"   # override the mcp entry name
#
# Flow (verified against obot v0.25.4):
#   1. `obot mcp search --non-interactive --json "<query>"` returns the catalog
#      rows (title + connection URL). The URL is of the form
#      <gateway>/mcp-connect/<server-id> and OMITS the trailing /mcp.
#   2. Resolve to exactly one match. If zero or many match, print candidates and
#      exit non-zero (the user narrows the query).
#   3. Append `/mcp` to the URL and deep-merge an OpenCode remote MCP entry into
#      ~/.config/opencode/opencode.jsonc via obot-merge-mcp.mjs, using
#      Authorization: Bearer {env:OBOT_TOKEN}.
#
# Requires: obot on PATH, OBOT_TOKEN set (the CLI reads it), node on PATH.
# Idempotent: re-running updates the URL for the same entry name (handles a
# server re-registering under a new <server-id>).

set -u

HOME="${HOME:-/home/agent}"
MERGE="$HOME/obot-merge-mcp.mjs"
TOKEN_ENV="OBOT_TOKEN"
NAME_OVERRIDE=""

err() { echo "obot-add-server: $*" >&2; }

# Parse args: optional --name <slug>, then the query (remaining args joined).
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME_OVERRIDE="${2:-}"; shift 2 ;;
    --name=*) NAME_OVERRIDE="${1#--name=}"; shift ;;
    --) shift; break ;;
    -*) err "unknown flag: $1"; exit 2 ;;
    *) break ;;
  esac
done
QUERY="$*"

if [ -z "$QUERY" ]; then
  err "usage: obot-add-server.sh [--name <slug>] \"<search query>\""
  exit 2
fi

command -v obot >/dev/null 2>&1 || { err "obot CLI not on PATH (install step may have failed)."; exit 1; }
command -v node >/dev/null 2>&1 || { err "node not on PATH (needed to merge OpenCode config)."; exit 1; }
[ -f "$MERGE" ] || { err "merge helper not found at $MERGE."; exit 1; }
if [ -z "${OBOT_TOKEN:-}" ]; then
  err "OBOT_TOKEN is not set. The obot CLI needs it to reach the gateway."
  err "  Store it: acq secret set-custom -g --host <gateway-host> --env OBOT_TOKEN"
  exit 1
fi

# 1) Search (JSON). Capture output + stderr for diagnostics.
search_out="$(obot mcp search --non-interactive --json "$QUERY" 2>/tmp/obot-search-err.$$)"
rc=$?
if [ $rc -ne 0 ]; then
  err "obot mcp search failed (rc=$rc)."
  [ -s "/tmp/obot-search-err.$$" ] && err "  $(tr '\n' ' ' < "/tmp/obot-search-err.$$")"
  rm -f "/tmp/obot-search-err.$$"
  exit 1
fi
rm -f "/tmp/obot-search-err.$$"

# 2) Resolve to one match and 3) merge, using node to parse the JSON robustly.
# The exact JSON shape from `obot mcp search --json` is an array of objects; we
# defensively read common field names (title/name, url/connectURL/URL). If the
# shape differs, node prints a clear diagnostic and exits non-zero.
printf '%s' "$search_out" | MCP_QUERY="$QUERY" MCP_NAME_OVERRIDE="$NAME_OVERRIDE" \
  MCP_TOKEN_ENV="$TOKEN_ENV" MCP_HOME="$HOME" node --input-type=module -e '
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const raw = readFileSync(0, "utf8").trim()
if (!raw) { console.error("obot-add-server: empty search output"); process.exit(1) }

let data
try { data = JSON.parse(raw) } catch (e) {
  console.error("obot-add-server: could not parse search JSON: " + e.message)
  process.exit(1)
}
const rows = Array.isArray(data) ? data : (Array.isArray(data.servers) ? data.servers : (Array.isArray(data.results) ? data.results : []))
if (rows.length === 0) { console.error("obot-add-server: no servers matched the query."); process.exit(1) }

const titleOf = (r) => r.title ?? r.name ?? r.displayName ?? ""
const urlOf = (r) => r.url ?? r.connectURL ?? r.connectUrl ?? r.URL ?? r.connect ?? ""

const query = (process.env.MCP_QUERY || "").trim().toLowerCase()
// Prefer an exact (case-insensitive) title match; else rows whose title contains
// the query; else, if the CLI already filtered server-side, take the sole row.
let matches = rows.filter((r) => titleOf(r).toLowerCase() === query)
if (matches.length === 0) matches = rows.filter((r) => titleOf(r).toLowerCase().includes(query))
if (matches.length === 0 && rows.length === 1) matches = rows

if (matches.length === 0) {
  console.error("obot-add-server: no server title matched \"" + process.env.MCP_QUERY + "\". Candidates:")
  for (const r of rows) console.error("  - " + titleOf(r))
  process.exit(1)
}
if (matches.length > 1) {
  console.error("obot-add-server: multiple servers matched \"" + process.env.MCP_QUERY + "\"; narrow the query. Candidates:")
  for (const r of matches) console.error("  - " + titleOf(r))
  process.exit(1)
}

const row = matches[0]
const title = titleOf(row)
let url = urlOf(row)
if (!url) { console.error("obot-add-server: matched \"" + title + "\" but found no connection URL in the result."); process.exit(1) }

// The search URL omits the trailing /mcp — append it (idempotently).
if (!/\/mcp\/?$/.test(url)) url = url.replace(/\/+$/, "") + "/mcp"

// Derive a stable mcp entry name: override, else slugify the title.
const slug = (process.env.MCP_NAME_OVERRIDE && process.env.MCP_NAME_OVERRIDE.trim())
  || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
if (!slug) { console.error("obot-add-server: could not derive a config name from \"" + title + "\"; pass --name."); process.exit(1) }

const home = process.env.MCP_HOME
const globalDir = home + "/.config/opencode"
const r = spawnSync(process.execPath, [
  home + "/obot-merge-mcp.mjs",
  "--global-dir", globalDir,
  "--name", slug,
  "--url", url,
  "--token-env", process.env.MCP_TOKEN_ENV || "OBOT_TOKEN",
], { stdio: "inherit" })
if (r.status !== 0) process.exit(r.status || 1)
console.error("obot-add-server: wired \"" + title + "\" as mcp." + slug + " -> " + url)
'
exit $?
