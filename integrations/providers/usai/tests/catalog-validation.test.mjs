import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { validateCatalog } from "../scripts/build-catalog.mjs"

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"))
const schema = JSON.parse(readFileSync(new URL("../catalog.schema.json", import.meta.url), "utf8"))

function withFirstModel(overrides) {
  // Use models[1] (claude_4_5_sonnet) when modifying the first model,
  // or update defaults so defaults don't point to an overridden ID.
  const m0 = catalog.models[0]
  return {
    ...catalog,
    models: [{ ...m0, ...overrides }, ...catalog.models.slice(1)],
  }
}

function withNonDefaultModel(overrides) {
  // models[1] is claude_4_5_sonnet which is not currently defaults.primary, small, or compaction
  const m1 = catalog.models[1]
  return {
    ...catalog,
    models: [catalog.models[0], { ...m1, ...overrides }, ...catalog.models.slice(2)],
  }
}

test("the committed catalog satisfies the hand-rolled validator", () => {
  assert.deepEqual(validateCatalog(catalog, schema), [])
})

test("catalog validation rejects model ids that can escape generated config", () => {
  assert.deepEqual(validateCatalog(withNonDefaultModel({ id: 'provider/"quoted"\\model:v1' }), schema), [])
})

test("catalog validation rejects control characters in display names", () => {
  assert.match(validateCatalog(withFirstModel({ name: "line one\nline two" }), schema).join("\n"), /name does not match/)
})

test("catalog validation rejects control characters in ids", () => {
  for (const id of ["line\nbreak", "carriage\rreturn", "nul\u0000byte", "delete\u007fbyte"]) {
    assert.match(validateCatalog(withNonDefaultModel({ id }), schema).join("\n"), /id does not match/)
  }
})

test("catalog validation bounds feed-controlled string lengths", () => {
  assert.match(validateCatalog(withNonDefaultModel({ id: "a".repeat(129) }), schema).join("\n"), /id exceeds 128/)
  assert.match(validateCatalog(withFirstModel({ name: "a".repeat(257) }), schema).join("\n"), /name exceeds 256/)
})

test("catalog validation allows provider-qualified ids and counts Unicode code points", () => {
  assert.deepEqual(validateCatalog(withNonDefaultModel({ id: "provider/model:v1" }), schema), [])
  assert.deepEqual(validateCatalog(withFirstModel({ name: "😀".repeat(128) }), schema), [])
})

test("catalog validation rejects duplicate model ids", () => {
  const duplicate = {
    ...catalog,
    models: [{ ...catalog.models[0] }, { ...catalog.models[0] }, ...catalog.models.slice(1)],
  }
  assert.match(validateCatalog(duplicate, schema).join("\n"), /duplicates/)
})

test("catalog validation rejects duplicate vendor keys", () => {
  const duplicate = {
    ...catalog,
    vendors: [{ ...catalog.vendors[0] }, { ...catalog.vendors[0] }, ...catalog.vendors.slice(1)],
  }
  assert.match(validateCatalog(duplicate, schema).join("\n"), /vendors\[1\]\.key duplicates/)
})

test("catalog validation rejects non-finite and negative costs", () => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -0.01]) {
    assert.match(
      validateCatalog(withFirstModel({ cost: { input: value } }), schema).join("\n"),
      /finite non-negative number/,
    )
  }
})

test("catalog validation rejects non-positive and fractional limits", () => {
  for (const value of [0, -1, 1.5]) {
    assert.match(validateCatalog(withFirstModel({ contextWindow: value }), schema).join("\n"), /positive integer/)
    assert.match(validateCatalog(withFirstModel({ maxOutputTokens: value }), schema).join("\n"), /positive integer/)
  }
})

test("catalog validation enforces defaults structure and referential integrity", () => {
  assert.match(
    validateCatalog({ ...catalog, defaults: null }, schema).join("\n"),
    /defaults must be an object/,
  )
  assert.match(
    validateCatalog({ ...catalog, defaults: { ...catalog.defaults, extraRole: "claude-sonnet-5" } }, schema).join("\n"),
    /disallowed key "extraRole"/,
  )
  assert.match(
    validateCatalog({ ...catalog, defaults: { small: "claude_4_5_haiku" } }, schema).join("\n"),
    /missing required key "primary"/,
  )
  assert.match(
    validateCatalog({ ...catalog, defaults: { ...catalog.defaults, primary: "usai/claude-sonnet-5" } }, schema).join("\n"),
    /must not include a provider prefix/,
  )
  assert.match(
    validateCatalog({ ...catalog, defaults: { ...catalog.defaults, primary: "nonexistent-model" } }, schema).join("\n"),
    /references unknown model "nonexistent-model"/,
  )
})
