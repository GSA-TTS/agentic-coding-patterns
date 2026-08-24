// =============================================================================
// emitters.test.mjs — byte-exact round-trip test for the OpenCode emitter.
//
// This is the load-bearing guarantee that catalog.json losslessly represents
// the shipped usai-provider opencode.jsonc: emitting the OpenCode GENERATED
// USAI MODELS block from catalog.json must reproduce the shipped block
// BYTE-FOR-BYTE (including the two marker comment lines, indentation, vendor
// group comments, snake_case cost keys, the compact one-line context_over_200k,
// and the last-entry trailing-comma formatting).
//
// The test reads the REAL shipped opencode.jsonc via a relative path (NOT a
// copied fixture) so drift between catalog.json and the shipped config fails CI.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { emitOpenCodeBlockFromCatalog } from "../emitters/opencode.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")

const OPENCODE_JSONC = path.join(
  REPO_ROOT,
  "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc",
)
const CATALOG_JSON = path.join(USAI_DIR, "catalog.json")

const BEGIN_MARKER = "// BEGIN GENERATED USAI MODELS"
const END_MARKER = "// END GENERATED USAI MODELS"

// Extract the region between the BEGIN/END markers INCLUSIVE, preserving the
// exact source lines (including the markers' own leading indentation).
function extractShippedBlock(jsoncText) {
  const lines = jsoncText.split("\n")
  const beginIdx = lines.findIndex((l) => l.includes(BEGIN_MARKER))
  const endIdx = lines.findIndex((l) => l.includes(END_MARKER))
  assert.ok(beginIdx !== -1, "shipped opencode.jsonc: BEGIN marker not found")
  assert.ok(endIdx !== -1, "shipped opencode.jsonc: END marker not found")
  assert.ok(endIdx > beginIdx, "shipped opencode.jsonc: END marker before BEGIN")
  return lines.slice(beginIdx, endIdx + 1).join("\n")
}

// On mismatch, find the first differing character offset and print a small
// window around it (expected vs actual) to make debugging fast.
function firstMismatchReport(expected, actual) {
  const len = Math.min(expected.length, actual.length)
  let i = 0
  for (; i < len; i++) {
    if (expected[i] !== actual[i]) break
  }
  const ctx = 40
  const from = Math.max(0, i - ctx)
  const to = i + ctx
  return [
    `first mismatch at offset ${i}`,
    `  expected len=${expected.length} actual len=${actual.length}`,
    `  expected: ${JSON.stringify(expected.slice(from, to))}`,
    `  actual:   ${JSON.stringify(actual.slice(from, to))}`,
  ].join("\n")
}

test("emitOpenCodeBlockFromCatalog reproduces the shipped block byte-for-byte", () => {
  const jsoncText = readFileSync(OPENCODE_JSONC, "utf8")
  const expected = extractShippedBlock(jsoncText)

  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const actual = emitOpenCodeBlockFromCatalog(catalog)

  if (expected !== actual) {
    // Print a targeted diff before the assertion fails.
    // eslint-disable-next-line no-console
    console.error(firstMismatchReport(expected, actual))
  }
  assert.strictEqual(
    actual,
    expected,
    "emitted OpenCode block does not match the shipped opencode.jsonc byte-for-byte",
  )
})
