// =============================================================================
// emitters.test.mjs — byte-exact round-trip test for the OpenCode emitter.
//
// This is the load-bearing guarantee that catalog.json satisfies the durable
// OpenCode renderer contract: emitting the OpenCode GENERATED
// USAI MODELS block from catalog.json must reproduce the shipped block
// BYTE-FOR-BYTE (including the two marker comment lines, indentation, vendor
// group comments, snake_case cost keys, the compact one-line context_over_200k,
// and the last-entry trailing-comma formatting).
//
// Provider kits no longer own an OpenCode config. The production fixture is the
// prior shipped config, retained as the durable rendering contract.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { emitOpenCodeBlockFromCatalog } from "../emitters/opencode.mjs"
import { renderProviderConfig } from "../../../isolation/acq-kits/opencode/files/home/opencode-config/render-provider-config.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")

const RENDERER_CONTRACTS = [
  {
    label: "OpenCode renderer contract",
    file: path.join(
      REPO_ROOT,
      "integrations/providers/usai/tests/fixtures/opencode-production.jsonc",
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

for (const { label, file } of RENDERER_CONTRACTS) {
  test(`emitOpenCodeBlockFromCatalog reproduces the ${label} byte-for-byte`, () => {
    const jsoncText = readFileSync(file, "utf8")
    const expected = extractShippedBlock(jsoncText, label)
    const actual = emitOpenCodeBlockFromCatalog(JSON.parse(readFileSync(CATALOG_JSON, "utf8")))

    if (expected !== actual) {
      // Print a targeted diff before the assertion fails.
      // eslint-disable-next-line no-console
      console.error(`[${label}]\n${firstMismatchReport(expected, actual)}`)
    }
    assert.strictEqual(
      actual,
      expected,
      `emitted OpenCode block does not match the ${label} byte-for-byte`,
    )
  })
}

test("the committed catalog remains renderable under the OpenCode contract", () => {
  const models = parseEmittedModels(JSON.parse(readFileSync(CATALOG_JSON, "utf8")))
  assert.ok(Object.keys(models).length > 0)
})

test("the OpenCode renderer preserves the prior shipped model block and role defaults", () => {
  const shipped = readFileSync(RENDERER_CONTRACTS[0].file, "utf8")
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const facts = {
    schemaVersion: "acq-provider-facts/v1",
    providerId: "usai",
    apiProtocol: "openai-compatible",
    host: "api.gsa.usai.gov",
    baseUrl: "https://api.gsa.usai.gov/api/v1",
    modelsUrl: "https://api.gsa.usai.gov/api/v1/models",
    keyEnv: "USAI_API_KEY",
  }
  const neutral = {
    schemaVersion: "acq-neutral-model-catalog/v1",
    providerId: "usai",
    models: catalog.models.map(({ id, name, contextWindow, maxOutputTokens, cost, costAbove200kContext }) => ({ id, name, contextWindow, maxOutputTokens, cost, costAbove200kContext })),
    recommendations: {
      primary: "claude-sonnet-5",
      small: "claude_4_5_haiku",
      compaction: "gpt-5.6-terra",
    },
  }
  const rendered = renderProviderConfig([{ facts, catalog: neutral }])
  const expected = JSON.parse(shipped.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"))
  assert.deepEqual(JSON.parse(JSON.stringify(rendered.provider.usai.models)), expected.provider.usai.models)
  assert.equal(rendered.model, expected.model)
  assert.equal(rendered.small_model, expected.small_model)
  assert.equal(rendered.agent.compaction.model, expected.agent.compaction.model)
  assert.equal(expected.agent.summary.model, "usai/gpt_5_2_default_v2")
  assert.equal(expected.agent.title.model, "usai/gpt_5_2_default_v2")
})

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
  const limitCases = [
    { contextWindow: injected },
    { maxOutputTokens: injected },
    { contextWindow: Number.NaN },
  ]
  const costCases = [
    { cost: { input: injected } },
    { costAbove200kContext: { input: injected } },
    { cost: { output: Number.POSITIVE_INFINITY } },
  ]

  for (const override of limitCases) {
    assert.throws(
      () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", ...override })),
      /must be a positive integer/,
    )
  }
  for (const override of costCases) {
    assert.throws(
      () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", ...override })),
      /must be a finite number/,
    )
  }
  assert.throws(
    () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", cost: { input: -1 } })),
    /must be non-negative/,
  )
  assert.throws(
    () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", costAbove200kContext: { input: -1 } })),
    /must be non-negative/,
  )
  for (const value of [0, -1, 1.5]) {
    assert.throws(
      () => emitOpenCodeBlockFromCatalog(minimalCatalog({ id: "benign", name: "Benign", contextWindow: value })),
      /must be a positive integer/,
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
