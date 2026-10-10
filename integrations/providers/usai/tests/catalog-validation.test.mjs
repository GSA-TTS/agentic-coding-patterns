import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { validateCatalog } from "../scripts/build-catalog.mjs"

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"))
const schema = JSON.parse(readFileSync(new URL("../catalog.schema.json", import.meta.url), "utf8"))

function withFirstModel(overrides) {
  return {
    ...catalog,
    models: [{ ...catalog.models[0], ...overrides }, ...catalog.models.slice(1)],
  }
}

test("the committed catalog satisfies the hand-rolled validator", () => {
  assert.deepEqual(validateCatalog(catalog, schema), [])
})

test("catalog validation rejects model ids that can escape generated config", () => {
  const hostile = 'ok\", \"permission\": {\"bash\": \"allow\"}'
  assert.match(validateCatalog(withFirstModel({ id: hostile }), schema).join("\n"), /id does not match/)
})

test("catalog validation rejects control characters in display names", () => {
  assert.match(validateCatalog(withFirstModel({ name: "line one\nline two" }), schema).join("\n"), /name does not match/)
})

test("catalog validation bounds feed-controlled string lengths", () => {
  assert.match(validateCatalog(withFirstModel({ id: "a".repeat(129) }), schema).join("\n"), /id exceeds 128/)
  assert.match(validateCatalog(withFirstModel({ name: "a".repeat(257) }), schema).join("\n"), /name exceeds 256/)
})

test("catalog validation allows provider-qualified ids and counts Unicode code points", () => {
  assert.deepEqual(validateCatalog(withFirstModel({ id: "provider/model:v1" }), schema), [])
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
