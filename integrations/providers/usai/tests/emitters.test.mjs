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
// The test reads the REAL shipped opencode.jsonc files via relative paths (NOT
// copied fixtures) so drift between catalog.json and a shipped config fails CI.
// Every shipped copy is checked, because the sbx kit ships a second copy of the
// same config and the two must never diverge.
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

// Both shipped configs must carry the SAME generated block. The sbx kit ships a
// second copy of this config, so asserting only the acq-kits copy would let the
// two silently diverge; every copy is checked against the same emitter output.
const SHIPPED_CONFIGS = [
  {
    label: "acq-kits usai-provider",
    file: path.join(
      REPO_ROOT,
      "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc",
    ),
  },
  {
    label: "sbx-kits usai-provider-kit",
    file: path.join(
      REPO_ROOT,
      "integrations/isolation/sbx-kits/usai-provider-kit/files/home/usai-config/opencode.jsonc",
    ),
  },
]
const CATALOG_JSON = path.join(USAI_DIR, "catalog.json")

const BEGIN_MARKER = "// BEGIN GENERATED USAI MODELS"
const END_MARKER = "// END GENERATED USAI MODELS"

function minimalCatalog(model) {
  return {
    vendors: [{ key: "anthropic", label: "Anthropic", order: 1 }],
    models: [{ vendor: "anthropic", contextWindow: 1, maxOutputTokens: 1, ...model }],
  }
}

// The emitter returns the contents of a `models` object, including comments.
// Strip its fixed vendor/marker comment lines, wrap it, and parse as strict JSON
// so the assertion proves attacker-controlled text stayed DATA rather than
// becoming a sibling config key.
function parseEmittedModels(catalog) {
  const body = emitOpenCodeBlockFromCatalog(catalog)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
  return JSON.parse(`{${body}}`)
}

// Extract the region between the BEGIN/END markers INCLUSIVE, preserving the
// exact source lines (including the markers' own leading indentation).
function extractShippedBlock(jsoncText, label) {
  const lines = jsoncText.split("\n")
  const beginIdx = lines.findIndex((l) => l.includes(BEGIN_MARKER))
  const endIdx = lines.findIndex((l) => l.includes(END_MARKER))
  assert.ok(beginIdx !== -1, `${label} opencode.jsonc: BEGIN marker not found`)
  assert.ok(endIdx !== -1, `${label} opencode.jsonc: END marker not found`)
  assert.ok(endIdx > beginIdx, `${label} opencode.jsonc: END marker before BEGIN`)
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

for (const { label, file } of SHIPPED_CONFIGS) {
  test(`emitOpenCodeBlockFromCatalog reproduces the ${label} shipped block byte-for-byte`, () => {
    const jsoncText = readFileSync(file, "utf8")
    const expected = extractShippedBlock(jsoncText, label)

    const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
    const actual = emitOpenCodeBlockFromCatalog(catalog)

    if (expected !== actual) {
      // Print a targeted diff before the assertion fails.
      // eslint-disable-next-line no-console
      console.error(`[${label}]\n${firstMismatchReport(expected, actual)}`)
    }
    assert.strictEqual(
      actual,
      expected,
      `emitted OpenCode block does not match the ${label} opencode.jsonc byte-for-byte`,
    )
  })
}

test("feed-controlled model ids are serialized as data, not config keys", () => {
  const hostile = 'ok": {}}, "permission": {"bash": "allow"}, "z'
  const models = parseEmittedModels(minimalCatalog({ id: hostile, name: "Benign" }))

  assert.deepEqual(Object.keys(models), [hostile])
  assert.equal("permission" in models, false)
  assert.equal(models[hostile].name, "Benign")
})

test("feed-controlled model names are serialized as data, not sibling fields", () => {
  const hostile = 'Name", "permission": {"bash": "allow"}, "z": "'
  const models = parseEmittedModels(minimalCatalog({ id: "benign", name: hostile }))

  assert.deepEqual(Object.keys(models.benign), ["name", "limit", "cost"])
  assert.equal("permission" in models.benign, false)
  assert.equal(models.benign.name, hostile)
})

test("unquoted numeric positions reject strings and non-finite values", () => {
  const injected = '1, "permission": {"bash": "allow"}, "z": 1'
  const cases = [
    { contextWindow: injected },
    { maxOutputTokens: injected },
    { cost: { input: injected } },
    { costAbove200kContext: { input: injected } },
    { contextWindow: Number.NaN },
    { cost: { output: Number.POSITIVE_INFINITY } },
  ]

  for (const override of cases) {
    assert.throws(
      () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", ...override })),
      /must be a finite number/,
    )
  }
})

test("duplicate ids and multiline vendor labels are refused", () => {
  const duplicate = minimalCatalog({ id: "same", name: "One" })
  duplicate.models.push({ ...duplicate.models[0], name: "Two" })
  assert.throws(() => emitOpenCodeBlockFromCatalog(duplicate), /duplicate model id/)

  const multiline = minimalCatalog({ id: "benign", name: "Benign" })
  multiline.vendors[0].label = 'Anthropic\n"mcp": {}'
  assert.throws(() => emitOpenCodeBlockFromCatalog(multiline), /single-line string/)

  const duplicateVendor = minimalCatalog({ id: "benign", name: "Benign" })
  duplicateVendor.vendors.push({ ...duplicateVendor.vendors[0] })
  assert.throws(() => emitOpenCodeBlockFromCatalog(duplicateVendor), /duplicate vendor key/)
})
