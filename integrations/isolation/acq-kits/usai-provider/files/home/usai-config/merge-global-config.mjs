#!/usr/bin/env node
//
// merge-global-config.mjs — land the USAi provider config at OpenCode's GLOBAL
// config path (~/.config/opencode/opencode.jsonc) WITHOUT clobbering a global
// config that another kit or the base template may already have written.
//
// Invoked by the kit's `commands.startup` step (see spec.yaml). It ships in the
// kit's `files/` tree (so it is mapped into the sandbox alongside the staged
// config, unlike host-only `scripts/`) and replaces the old approach of
// pointing OPENCODE_CONFIG at a namespaced file. See
// docs/decisions/0004-global-config-merge-instead-of-opencode-config.md.
//
// Behavior:
//   - No existing global config  -> COPY the kit's file verbatim (comments and
//     the ownership marker preserved). No merge needed.
//   - Existing global config(s)  -> DEEP-MERGE the kit's keys INTO the existing
//     config and write JSON to opencode.jsonc. The USAi kit wins for its OWN
//     keys (provider.usai, model, small_model, agent, permission, ...); all
//     unrelated existing keys are preserved. A `warning:` is printed to stderr
//     for every top-level leaf the kit overwrites (e.g. a pre-existing `model`).
//     Comments are lost in this branch (JSON has none); the annotated source
//     remains at the kit's staged path and in the repo.
//
// The step converges to a stable fixed point rather than being byte-idempotent
// from the first run. On an empty global dir the first boot COPIES verbatim
// (comments + marker intact); the next boot re-reads that output as an existing
// config and takes the MERGE branch, normalizing it to bare JSON (comments +
// marker dropped). From that point on every boot re-writes byte-identical JSON.
// The effective config is stable at every step; only the on-disk form settles
// after the first merge.
//
// Usage:
//   node merge-global-config.mjs \
//     --source /home/agent/usai-config/opencode.jsonc \
//     --global-dir /home/agent/.config/opencode
//
// Exit codes: 0 on success (copy or merge), non-zero only on unexpected error
// (e.g. the source is missing/unparseable). Leaf-conflict warnings do NOT fail.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

// OpenCode reads these filenames from the global dir, in this precedence order
// (later overrides earlier when more than one is present). We merge any that
// exist so nothing a base template wrote is silently dropped.
const GLOBAL_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"]
// Canonical file we (re)write. .jsonc so the copy branch can keep comments.
const CANONICAL_FILENAME = "opencode.jsonc"

/**
 * Strip `//` line comments and block comments from JSONC, plus trailing
 * commas, WITHOUT corrupting comment-like sequences inside string literals
 * (the config contains `https://` URLs). Returns plain JSON text.
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
        // Copy the escaped character verbatim.
        out += text[i + 1] ?? ""
        i++
      } else if (ch === stringQuote) {
        inString = false
      }
      continue
    }
    // Not in a string or comment.
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

  // Remove trailing commas before } or ] without touching comma-like text in a
  // string. A global regex rewrites values such as "model,}" and makes the
  // parser validate different bytes from the artifact OpenCode will consume.
  let plain = ""
  inString = false
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]
    if (inString) {
      plain += ch
      if (ch === "\\") {
        plain += out[i + 1] ?? ""
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      plain += ch
      continue
    }
    if (ch === ",") {
      let nextIndex = i + 1
      while (/\s/.test(out[nextIndex] ?? "")) nextIndex++
      if (out[nextIndex] === "}" || out[nextIndex] === "]") {
        let previousIndex = plain.length - 1
        while (/\s/.test(plain[previousIndex] ?? "")) previousIndex--
        // A trailing comma is valid only after a completed value. Keep commas
        // after an opener, separator, or colon so malformed `{,}`, `[1,,]`,
        // and `{"a":,}` remain malformed and JSON.parse rejects them.
        if (previousIndex >= 0 && !"{[,:".includes(plain[previousIndex])) continue
      }
    }
    plain += ch
  }
  return plain
}

/**
 * Parse JSONC text into an object.
 * @param {string} text
 * @returns {object}
 */
export function parseJsonc(text) {
  const plain = stripJsonc(text)
  // JSON.parse silently applies last-key-wins to duplicate properties. Reject
  // them before parsing so validation cannot inspect one value while OpenCode
  // or another consumer obeys another. A tiny recursive scanner is sufficient
  // here because comments/trailing commas are already removed above.
  const parseValue = (state) => {
    const skip = () => { while (/\s/.test(plain[state.i] ?? "")) state.i++ }
    const parseString = () => {
      const start = state.i++
      while (state.i < plain.length) {
        if (plain[state.i] === "\\") state.i += 2
        else if (plain[state.i++] === '"') return JSON.parse(plain.slice(start, state.i))
      }
      throw new SyntaxError("Unterminated JSON string")
    }
    skip()
    if (plain[state.i] === "{") {
      state.i++
      const keys = new Set()
      skip()
      while (plain[state.i] !== "}") {
        const key = parseString()
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON property ${JSON.stringify(key)}`)
        keys.add(key)
        skip()
        if (plain[state.i++] !== ":") throw new SyntaxError("Expected ':' after JSON property")
        parseValue(state)
        skip()
        if (plain[state.i] === ",") { state.i++; skip() }
        else if (plain[state.i] !== "}") throw new SyntaxError("Expected ',' or '}' in JSON object")
      }
      state.i++
      return
    }
    if (plain[state.i] === "[") {
      state.i++
      skip()
      while (plain[state.i] !== "]") {
        parseValue(state)
        skip()
        if (plain[state.i] === ",") { state.i++; skip() }
        else if (plain[state.i] !== "]") throw new SyntaxError("Expected ',' or ']' in JSON array")
      }
      state.i++
      return
    }
    if (plain[state.i] === '"') { parseString(); return }
    const token = plain.slice(state.i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0]
    if (!token) throw new SyntaxError(`Invalid JSON value at offset ${state.i}`)
    state.i += token.length
  }
  const state = { i: 0 }
  parseValue(state)
  while (/\s/.test(plain[state.i] ?? "")) state.i++
  if (state.i !== plain.length) throw new SyntaxError(`Unexpected JSON content at offset ${state.i}`)
  return JSON.parse(plain)
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Deep-merge `source` INTO `base`, returning a new object. `source` wins on
 * conflicts. Objects merge recursively; arrays and scalars from `source`
 * replace `base`. Records every top-level leaf that `source` overwrites (an
 * existing value replaced by a differing one) into `conflicts`.
 * @param {object} base
 * @param {object} source
 * @param {string[]} conflicts - accumulator of dotted paths overwritten
 * @param {string} [prefix]
 * @returns {object}
 */
export function deepMerge(base, source, conflicts, prefix = "") {
  const result = { ...base }
  for (const key of Object.keys(source)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    const sourceVal = source[key]
    const baseVal = base[key]
    if (isPlainObject(sourceVal) && isPlainObject(baseVal)) {
      result[key] = deepMerge(baseVal, sourceVal, conflicts, dotted)
    } else {
      if (
        Object.prototype.hasOwnProperty.call(base, key) &&
        JSON.stringify(baseVal) !== JSON.stringify(sourceVal)
      ) {
        conflicts.push(dotted)
      }
      result[key] = sourceVal
    }
  }
  return result
}

/**
 * Find existing global config files in `globalDir`, in precedence order.
 * @param {string} globalDir
 * @returns {Promise<string[]>} absolute paths that exist
 */
async function findExistingGlobalConfigs(globalDir) {
  let entries
  try {
    entries = await readdir(globalDir)
  } catch {
    return []
  }
  const present = new Set(entries)
  return GLOBAL_FILENAMES.filter((name) => present.has(name)).map((name) =>
    path.join(globalDir, name),
  )
}

function parseArgs(argv) {
  const args = { source: "", globalDir: "" }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") args.source = argv[++i]
    else if (argv[i] === "--global-dir") args.globalDir = argv[++i]
  }
  return args
}

/**
 * Perform the copy-or-merge. Pure enough to unit-test: takes the source text
 * and the list of existing {path, text} global configs, returns
 * { output, merged, conflicts }.
 * @param {string} sourceText - the kit's opencode.jsonc (JSONC)
 * @param {{path: string, text: string}[]} existing - existing global configs,
 *   in precedence order (earliest first)
 * @returns {{ output: string, merged: boolean, conflicts: string[] }}
 */
export function computeOutput(sourceText, existing) {
  if (existing.length === 0) {
    // Copy verbatim — preserves comments and the ownership marker.
    return { output: sourceText, merged: false, conflicts: [] }
  }
  const sourceConfig = parseJsonc(sourceText)
  const conflicts = []
  // Start from the existing configs merged in OpenCode precedence order (later
  // file wins over earlier), THEN merge the kit's config on top so USAi wins
  // for its own keys.
  let base = {}
  for (const cfg of existing) {
    base = deepMerge(base, parseJsonc(cfg.text), [])
  }
  const output = deepMerge(base, sourceConfig, conflicts)
  return {
    output: JSON.stringify(output, null, 2) + "\n",
    merged: true,
    conflicts,
  }
}

async function main() {
  const { source, globalDir } = parseArgs(process.argv.slice(2))
  if (!source || !globalDir) {
    throw new Error("usage: merge-global-config.mjs --source <file> --global-dir <dir>")
  }

  const sourceText = await readFile(source, "utf8")
  const existingPaths = await findExistingGlobalConfigs(globalDir)
  const existing = await Promise.all(
    existingPaths.map(async (p) => ({ path: p, text: await readFile(p, "utf8") })),
  )

  const { output, merged, conflicts } = computeOutput(sourceText, existing)

  await mkdir(globalDir, { recursive: true })
  const target = path.join(globalDir, CANONICAL_FILENAME)
  await writeFile(target, output)

  if (!merged) {
    process.stdout.write(
      `usai-provider: no existing global config; copied USAi config to ${target}\n`,
    )
    return
  }

  process.stdout.write(
    `usai-provider: merged USAi config into existing global config at ${target} ` +
      `(sources: ${existing.map((e) => path.basename(e.path)).join(", ")})\n`,
  )
  for (const c of conflicts) {
    process.stderr.write(
      `usai-provider: warning: overrode existing global key '${c}' with the USAi value\n`,
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`usai-provider: merge failed: ${error.message}`)
    process.exit(1)
  })
}
