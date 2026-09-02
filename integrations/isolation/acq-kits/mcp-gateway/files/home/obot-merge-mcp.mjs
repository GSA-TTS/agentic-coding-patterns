#!/usr/bin/env node
//
// obot-merge-mcp.mjs — deep-merge a single OpenCode `mcp.<name>` remote entry
// into OpenCode's global config (~/.config/opencode/opencode.jsonc) WITHOUT
// clobbering any existing config. Invoked by obot-add-server.sh once it has
// resolved a server name + URL from `obot mcp search`.
//
// JSONC handling and the copy-vs-merge shape are modeled on the usai-provider
// kit's merge-global-config.mjs (same base image node v22; same
// comment-preserving-copy / merge-into-existing behavior).
//
// Usage:
//   node obot-merge-mcp.mjs \
//     --global-dir /home/agent/.config/opencode \
//     --name cdc-places \
//     --url  http://<gateway>/mcp-connect/<id>/mcp \
//     --token-env OBOT_TOKEN
//
// Behavior:
//   - No existing global config -> write a fresh opencode.jsonc containing just
//     the mcp.<name> entry (as JSON).
//   - Existing global config(s)  -> deep-merge the mcp.<name> entry into the
//     existing config and write opencode.jsonc. Idempotent: re-running with the
//     same name/url produces the same result (updates the url on re-register).
//
// Exit codes: 0 on success; non-zero on unexpected error (bad args / unparseable
// existing config).

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const GLOBAL_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"]
const CANONICAL_FILENAME = "opencode.jsonc"

/**
 * Strip `//` line comments and block comments from JSONC, plus trailing commas,
 * WITHOUT corrupting comment-like sequences inside string literals (configs
 * contain `https://` URLs). Returns plain JSON text.
 * @param {string} text
 * @returns {string}
 */
export function stripJsonc(text) {
  let out = ""
  let inString = false
  let stringQuote = ""
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false
        out += ch
      }
      continue
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += text[i + 1] ?? ""
        i++
      } else if (ch === stringQuote) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLineComment = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true
      i++
      continue
    }
    out += ch
  }

  return out.replace(/,(\s*[}\]])/g, "$1")
}

/**
 * Parse JSONC text into an object.
 * @param {string} text
 * @returns {object}
 */
export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text))
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Deep-merge `source` INTO `base`, returning a new object. `source` wins on
 * conflicts; objects merge recursively; arrays/scalars from `source` replace.
 * @param {object} base
 * @param {object} source
 * @returns {object}
 */
export function deepMerge(base, source) {
  const result = { ...base }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const bv = base[key]
    result[key] = isPlainObject(sv) && isPlainObject(bv) ? deepMerge(bv, sv) : sv
  }
  return result
}

/**
 * Build the mcp fragment to merge in.
 * @param {string} name
 * @param {string} url
 * @param {string} tokenEnv - env var NAME to reference via {env:NAME}
 * @returns {object}
 */
export function mcpFragment(name, url, tokenEnv) {
  return {
    mcp: {
      [name]: {
        type: "remote",
        url,
        enabled: true,
        headers: { Authorization: `Bearer {env:${tokenEnv}}` },
      },
    },
  }
}

async function findExistingGlobalConfigs(globalDir) {
  let entries
  try {
    entries = await readdir(globalDir)
  } catch {
    return []
  }
  const present = new Set(entries)
  return GLOBAL_FILENAMES.filter((n) => present.has(n)).map((n) => path.join(globalDir, n))
}

function parseArgs(argv) {
  const args = { globalDir: "", name: "", url: "", tokenEnv: "OBOT_TOKEN" }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--global-dir") args.globalDir = argv[++i]
    else if (argv[i] === "--name") args.name = argv[++i]
    else if (argv[i] === "--url") args.url = argv[++i]
    else if (argv[i] === "--token-env") args.tokenEnv = argv[++i]
  }
  return args
}

/**
 * Compute the merged output text from the fragment and existing configs.
 * @param {object} fragment
 * @param {{path: string, text: string}[]} existing - in precedence order
 * @returns {{ output: string, merged: boolean }}
 */
export function computeOutput(fragment, existing) {
  let base = {}
  for (const cfg of existing) {
    base = deepMerge(base, parseJsonc(cfg.text))
  }
  const output = deepMerge(base, fragment)
  return { output: JSON.stringify(output, null, 2) + "\n", merged: existing.length > 0 }
}

async function main() {
  const { globalDir, name, url, tokenEnv } = parseArgs(process.argv.slice(2))
  if (!globalDir || !name || !url) {
    throw new Error("usage: obot-merge-mcp.mjs --global-dir <dir> --name <name> --url <url> [--token-env NAME]")
  }

  const fragment = mcpFragment(name, url, tokenEnv)
  const existingPaths = await findExistingGlobalConfigs(globalDir)
  const existing = await Promise.all(
    existingPaths.map(async (p) => ({ path: p, text: await readFile(p, "utf8") })),
  )

  const { output, merged } = computeOutput(fragment, existing)

  await mkdir(globalDir, { recursive: true })
  const target = path.join(globalDir, CANONICAL_FILENAME)
  await writeFile(target, output)

  process.stdout.write(
    `mcp-gateway: ${merged ? "merged" : "wrote"} OpenCode mcp entry '${name}' -> ${target}\n`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`mcp-gateway: merge failed: ${error.message}`)
    process.exit(1)
  })
}
