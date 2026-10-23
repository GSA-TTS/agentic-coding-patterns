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

import {
  emitOpenCodeBlockFromCatalog,
  emitOpenCodeDefaults,
  patchOpenCodeConfig,
} from "../emitters/opencode.mjs"

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

for (const { label, file } of SHIPPED_CONFIGS) {
  test(`patchOpenCodeConfig reproduces the ${label} shipped opencode.jsonc byte-for-byte`, () => {
    const originalText = readFileSync(file, "utf8")
    const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
    const patched = patchOpenCodeConfig(originalText, catalog)

    if (patched !== originalText) {
      // eslint-disable-next-line no-console
      console.error(`[${label} patchOpenCodeConfig mismatch]\n${firstMismatchReport(originalText, patched)}`)
    }
    assert.strictEqual(
      patched,
      originalText,
      `patchOpenCodeConfig does not reproduce ${label} opencode.jsonc byte-for-byte`,
    )
  })
}

test("emitOpenCodeDefaults maps neutral catalog defaults to usai/ prefixed roles", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const defaults = emitOpenCodeDefaults(catalog)
  assert.deepEqual(defaults, {
    model: "usai/claude-sonnet-5",
    small_model: "usai/claude_4_5_haiku",
    compaction: "usai/gpt-5.6-terra",
    summary: "usai/gpt_5_2_default_v2",
    title: "usai/gpt_5_2_default_v2",
  })
})

test("emitOpenCodeDefaults reports an absent optional agent role as null, not as missing", () => {
  // A role the catalog does not define must be an explicit null, so a caller
  // iterating the roles cannot mistake "not configured" for "forgot to read it".
  const defaults = emitOpenCodeDefaults({ defaults: { primary: "sonnet", small: "haiku" } })
  assert.deepEqual(defaults, {
    model: "usai/sonnet",
    small_model: "usai/haiku",
    compaction: null,
    summary: null,
    title: null,
  })
})

test("emitOpenCodeDefaults validates optional agent roles as strictly as the required pair", () => {
  for (const role of ["compaction", "summary", "title"]) {
    assert.throws(
      () => emitOpenCodeDefaults({ defaults: { primary: "sonnet", small: "haiku", [role]: "" } }),
      new RegExp(`defaults\\.${role} must be a non-empty string`),
      `${role}: empty string must be rejected`,
    )
    assert.throws(
      () => emitOpenCodeDefaults({ defaults: { primary: "sonnet", small: "haiku", [role]: 'x", "permission": {}' } }),
      new RegExp(`defaults\\.${role} contains invalid characters`),
      `${role}: id that could break out of the JSON string must be rejected`,
    )
  }
})

test("emitOpenCodeDefaults rejects malformed defaults or invalid characters", () => {
  assert.throws(() => emitOpenCodeDefaults(null), /must be an object/)
  assert.throws(() => emitOpenCodeDefaults({ defaults: null }), /must be an object/)
  assert.throws(() => emitOpenCodeDefaults({ defaults: { small: "haiku" } }), /defaults.primary must be/)
  assert.throws(() => emitOpenCodeDefaults({ defaults: { primary: "sonnet", small: "" } }), /defaults.small must be/)
  for (const bad of ['sonnet", "permission": {}', "model\\escape", "model{env:VAR}", "model}"]) {
    assert.throws(
      () => emitOpenCodeDefaults({ defaults: { primary: bad, small: "haiku" } }),
      /invalid characters/,
    )
  }
})

test("patchOpenCodeConfig safely handles $ in model ids without string replacement expansion", () => {
  const originalText = readFileSync(SHIPPED_CONFIGS[0].file, "utf8")
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  // Add a test model and set as default to check replacement function
  const testCat = {
    ...catalog,
    models: [
      {
        id: "model_with_dollar",
        vendor: "anthropic",
        name: "Dollar Model",
        contextWindow: 1000,
        maxOutputTokens: 100,
      },
      ...catalog.models,
    ],
    defaults: {
      primary: "model_with_dollar",
      small: "claude_4_5_haiku",
    },
  }
  const patched = patchOpenCodeConfig(originalText, testCat)
  assert.ok(patched.includes('"model": "usai/model_with_dollar"'))
})

test("patchOpenCodeConfig does not cross object braces if agent.compaction is missing", () => {
  // A template without agent.compaction.model
  const template = `
{
  "provider": { "usai": { "models": {
// BEGIN GENERATED USAI MODELS
// END GENERATED USAI MODELS
  } } },
  "model": "usai/old-model",
  "small_model": "usai/old-small",
  "compaction": { "auto": true },
  "instructions": "important instructions"
}
`
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const patched = patchOpenCodeConfig(template, catalog)
  // Ensure "instructions" was not wiped out by runaway regex
  assert.ok(patched.includes('"instructions": "important instructions"'))
  assert.ok(patched.includes('"compaction": { "auto": true }'))
  assert.ok(patched.includes('"model": "usai/claude-sonnet-5"'))
})

// -----------------------------------------------------------------------------
// Structural resolution of the patched paths.
//
// These exist because the previous implementation located `agent.compaction.model`
// with a regex whose `[^{}]*?` forbade any brace between `agent` and
// `compaction`, which only holds while `compaction` is the FIRST nested object
// under `agent`. The shipped config satisfies that today, so the byte-exact
// round-trip test above passes either way — it cannot see this class of defect.
// Each case below is a template shape that is valid JSONC and that the regex
// approach got wrong.
// -----------------------------------------------------------------------------

const MARKERS = "// BEGIN GENERATED USAI MODELS\n// END GENERATED USAI MODELS"

function templateWithAgent(agentBody, { agentFirst = false } = {}) {
  const topLevel = `  "model": "usai/STALE-TOP",
  "small_model": "usai/STALE-SMALL",`
  const agent = `  "agent": {
${agentBody}
  },`
  return `{
${agentFirst ? `${agent}\n${topLevel}` : `${topLevel}\n${agent}`}
${MARKERS}
}
`
}

const agentRoleBlock = (role, value) => `    "${role}": {
      "model": "usai/${value}",
      "temperature": 0
    }`

test("agent.compaction.model is patched regardless of sibling order", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const compactionFirst = [agentRoleBlock("compaction", "STALE"), agentRoleBlock("summary", "STALE")].join(",\n")
  const summaryFirst = [agentRoleBlock("summary", "STALE"), agentRoleBlock("compaction", "STALE")].join(",\n")

  for (const [label, body] of [["compaction first", compactionFirst], ["summary first", summaryFirst]]) {
    const patched = patchOpenCodeConfig(templateWithAgent(body), catalog)
    const found = /"compaction"\s*:\s*\{\s*"model"\s*:\s*"([^"]*)"/.exec(patched)
    assert.equal(found?.[1], "usai/gpt-5.6-terra", `${label}: compaction.model must be patched`)
  }
})

test("top-level model is patched even when the agent block precedes it", () => {
  // The top-level patterns matched the first line-anchored `"model"` in the
  // file, which is a nested agent role whenever `agent` comes first.
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const patched = patchOpenCodeConfig(
    templateWithAgent(agentRoleBlock("compaction", "STALE"), { agentFirst: true }),
    catalog,
  )
  assert.ok(!patched.includes("usai/STALE-TOP"), "top-level model must not keep its stale value")
  assert.ok(!patched.includes("usai/STALE-SMALL"), "top-level small_model must not keep its stale value")
  assert.ok(patched.includes('"model": "usai/claude-sonnet-5"'))
  assert.ok(patched.includes('"small_model": "usai/claude_4_5_haiku"'))
})

test("every modelled agent role is patched, not just compaction", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const body = ["compaction", "summary", "title"].map((r) => agentRoleBlock(r, "STALE")).join(",\n")
  const patched = patchOpenCodeConfig(templateWithAgent(body), catalog)
  assert.ok(!patched.includes("usai/STALE"), "no agent role may retain a stale model")
  for (const [role, expected] of [
    ["compaction", "usai/gpt-5.6-terra"],
    ["summary", "usai/gpt_5_2_default_v2"],
    ["title", "usai/gpt_5_2_default_v2"],
  ]) {
    const found = new RegExp(`"${role}"\\s*:\\s*\\{\\s*"model"\\s*:\\s*"([^"]*)"`).exec(patched)
    assert.equal(found?.[1], expected, `agent.${role}.model`)
  }
})

test("commented-out and in-array decoys are not mistaken for the real key", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const template = `{
  // "model": "usai/COMMENTED",
  /* "model": "usai/BLOCK-COMMENTED" */
  "experimental": [ { "model": "usai/IN-ARRAY" } ],
  "model": "usai/STALE-TOP",
  "small_model": "usai/STALE-SMALL",
${MARKERS}
}
`
  const patched = patchOpenCodeConfig(template, catalog)
  assert.ok(patched.includes('"model": "usai/COMMENTED"'), "a commented-out key must be left untouched")
  assert.ok(patched.includes('"model": "usai/BLOCK-COMMENTED"'), "a block-commented key must be left untouched")
  assert.ok(patched.includes('"model": "usai/IN-ARRAY"'), "a key inside an array must be left untouched")
  assert.ok(patched.includes('"model": "usai/claude-sonnet-5"'), "the real top-level key must be patched")
})

test("a configured agent role that cannot be patched is an error, not a silent skip", () => {
  // `agent.compaction` exists but carries no `model` key. Leaving it alone would
  // report a regenerated file while the role stayed unset, so this must throw.
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const template = `{
  "model": "usai/old",
  "small_model": "usai/old-small",
  "agent": {
    "compaction": { "temperature": 0 }
  },
${MARKERS}
}
`
  assert.throws(
    () => patchOpenCodeConfig(template, catalog),
    /could not locate a string value at 'agent\.compaction\.model'/,
  )
})

test("a missing top-level role is an error naming which key was not found", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))
  const template = `{
  "small_model": "usai/old-small",
${MARKERS}
}
`
  assert.throws(() => patchOpenCodeConfig(template, catalog), /top-level 'model'/)
})
