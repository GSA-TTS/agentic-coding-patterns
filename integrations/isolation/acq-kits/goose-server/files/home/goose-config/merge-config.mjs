#!/usr/bin/env node
//
// merge-config.mjs — land the goose USAi primer at goose's GLOBAL config path
// (~/.config/goose/config.yaml) WITHOUT clobbering a global config the base image
// or another kit may already have written.
//
// This mirrors the usai-provider kit's merge-global-config.mjs, but for goose's
// config, which is YAML (goose uses ~/.config/goose/config.yaml) rather than
// OpenCode's JSONC. See the goose-server kit README "Design: merge, don't
// clobber" and docs/decisions/0003-usai-openai-compatible-provider.md.
//
// Behavior:
//   - No existing global config  -> COPY the kit's file verbatim (comments and
//     the ownership marker preserved). No merge needed.
//   - Existing global config      -> parse both as YAML, DEEP-MERGE the kit's keys
//     INTO the existing config (kit wins for its OWN keys; unrelated existing keys
//     preserved), and write normalized YAML. A `warning:` is printed to stderr for
//     every top-level leaf the kit overrides. Comments are lost in this branch
//     (the emitted YAML has none); the annotated source stays at the staged path.
//
// Convergence (same as the usai-provider kit): on an empty global dir the first
// boot COPIES verbatim (comments intact); the next boot re-reads that output as an
// existing config and takes the MERGE branch, normalizing to bare YAML. From then
// on every boot re-writes byte-identical YAML. The effective config is stable at
// every step.
//
// DEPENDENCY NOTE: goose's config is YAML. To avoid adding a YAML library
// dependency to the sandbox (npm install behind the proxy is exactly the failure
// mode the openchamber/paseo kits defer to startup to avoid), this script uses a
// SMALL, DEPENDENCY-FREE parser/emitter that supports the FLAT `KEY: value` shape
// this kit's primer and goose's own `goose configure` output use (goose writes a
// flat map of scalar settings; nested provider blocks are not written to
// config.yaml — connection details come from env). If an existing config uses a
// shape this minimal parser cannot represent (nested maps, lists, block scalars),
// the script DOES NOT guess: it leaves the existing config untouched and appends
// only the kit keys that are absent, logging what it skipped. This is fail-safe:
// it never corrupts a richer config it cannot fully model.
//
// Usage:
//   node merge-config.mjs \
//     --source /home/agent/goose-config/config.yaml \
//     --global-dir /home/agent/.config/goose
//
// Exit codes: 0 on success (copy or merge). Non-zero only on unexpected error
// (e.g. the source is missing). Leaf-conflict warnings do NOT fail.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const GLOBAL_FILENAME = "config.yaml"

/**
 * Parse a FLAT `KEY: value` YAML document (the shape goose's config.yaml uses:
 * a top-level map of scalar settings). Returns { map, flat } where `flat` is true
 * only if every non-blank, non-comment line was a simple `key: scalar` pair. When
 * `flat` is false the caller must NOT treat `map` as a complete representation.
 * Comments (`#`) and blank lines are ignored. Quoted scalars are unquoted.
 * @param {string} text
 * @returns {{ map: Record<string,string>, flat: boolean }}
 */
export function parseFlatYaml(text) {
  const map = {}
  let flat = true
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    // A line that is indented, starts a list, or has no top-level `key:` is a
    // shape this minimal parser does not model.
    if (/^\s/.test(line) || trimmed.startsWith("- ")) {
      flat = false
      continue
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed)
    if (!m) {
      flat = false
      continue
    }
    let value = m[2]
    // Strip a trailing inline comment only when the value is unquoted.
    if (!(value.startsWith('"') || value.startsWith("'"))) {
      const hash = value.indexOf(" #")
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    // Unquote.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value === "") {
      // `key:` with no value is a nested-map/opener — not a flat scalar.
      flat = false
      continue
    }
    map[m[1]] = value
  }
  return { map, flat }
}

/**
 * Emit a flat map as YAML. Scalars that need quoting (contain a colon-space,
 * leading special char, or are ambiguous) are double-quoted.
 * @param {Record<string,string>} map
 * @returns {string}
 */
export function emitFlatYaml(map) {
  const needsQuote = (v) =>
    v === "" ||
    /^[\s>|&*!%@`"'#-]/.test(v) ||
    /:\s/.test(v) ||
    /[:#]$/.test(v) ||
    /^(true|false|null|yes|no|~)$/i.test(v) ||
    /^[0-9.]+$/.test(v) === false && /[:{}\[\],]/.test(v)
  const lines = []
  for (const key of Object.keys(map)) {
    const v = String(map[key])
    lines.push(`${key}: ${needsQuote(v) ? JSON.stringify(v) : v}`)
  }
  return lines.join("\n") + "\n"
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
 * Compute the merge result. Pure, for unit-testing.
 * @param {string} sourceText - the kit's config.yaml
 * @param {string|null} existingText - the existing global config, or null
 * @returns {{ output: string, merged: boolean, conflicts: string[], skipped: boolean }}
 */
export function computeOutput(sourceText, existingText) {
  if (existingText == null) {
    // Copy verbatim — preserves comments and the ownership marker.
    return { output: sourceText, merged: false, conflicts: [], skipped: false }
  }
  const src = parseFlatYaml(sourceText)
  const existing = parseFlatYaml(existingText)

  // If the EXISTING config uses a shape we cannot fully model, do not rewrite it
  // wholesale. Append only the kit keys that are absent, by concatenation, so we
  // never corrupt a richer config. This is the fail-safe branch.
  if (!existing.flat) {
    const missing = Object.keys(src.map).filter(
      (k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(existingText),
    )
    if (missing.length === 0) {
      return { output: existingText, merged: true, conflicts: [], skipped: true }
    }
    const appended =
      existingText.replace(/\n*$/, "\n") +
      "\n# --- appended by goose-server kit (existing config uses an unmodeled shape) ---\n" +
      emitFlatYaml(Object.fromEntries(missing.map((k) => [k, src.map[k]])))
    return { output: appended, merged: true, conflicts: [], skipped: true }
  }

  // Flat merge: kit wins for its own keys; unrelated existing keys preserved.
  const conflicts = []
  const out = { ...existing.map }
  for (const key of Object.keys(src.map)) {
    if (
      Object.prototype.hasOwnProperty.call(existing.map, key) &&
      existing.map[key] !== src.map[key]
    ) {
      conflicts.push(key)
    }
    out[key] = src.map[key]
  }
  return { output: emitFlatYaml(out), merged: true, conflicts, skipped: false }
}

async function main() {
  const { source, globalDir } = parseArgs(process.argv.slice(2))
  if (!source || !globalDir) {
    throw new Error("usage: merge-config.mjs --source <file> --global-dir <dir>")
  }

  const sourceText = await readFile(source, "utf8")

  let existingText = null
  try {
    const entries = await readdir(globalDir)
    if (entries.includes(GLOBAL_FILENAME)) {
      existingText = await readFile(path.join(globalDir, GLOBAL_FILENAME), "utf8")
    }
  } catch {
    // globalDir does not exist yet -> treated as no existing config.
  }

  const { output, merged, conflicts, skipped } = computeOutput(sourceText, existingText)

  await mkdir(globalDir, { recursive: true })
  const target = path.join(globalDir, GLOBAL_FILENAME)
  await writeFile(target, output)

  if (!merged) {
    process.stdout.write(
      `goose-server: no existing goose config; copied USAi primer to ${target}\n`,
    )
    return
  }
  if (skipped) {
    process.stdout.write(
      `goose-server: existing goose config uses an unmodeled shape; appended only missing kit keys to ${target}\n`,
    )
    return
  }
  process.stdout.write(
    `goose-server: merged USAi primer into existing goose config at ${target}\n`,
  )
  for (const c of conflicts) {
    process.stderr.write(
      `goose-server: warning: overrode existing goose key '${c}' with the USAi primer value\n`,
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`goose-server: merge failed: ${error.message}`)
    process.exit(1)
  })
}
