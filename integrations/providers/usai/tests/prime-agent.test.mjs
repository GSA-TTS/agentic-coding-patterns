// =============================================================================
// prime-agent.test.mjs — shape + no-secret + no-leakage tests for the
// prime-agent emitter.
//
// The prime-agent kit consumes a models.json where providers.usai.models is an
// ARRAY of objects (each with an `id`), with flat contextWindow/maxTokens and
// camelCase cost keys. These tests assert the emitter produces THAT shape and
// specifically does NOT leak the OpenCode shape (limit object, snake_case cost
// keys, context_over_200k), does NOT embed any real key material, and drops the
// tiered costAbove200kContext field that prime-agent cannot represent.
//
// Reads the REAL shipped catalog.json via a relative path so catalog drift is
// exercised by these assertions too.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { emitPrimeAgentModelsFromCatalog } from "../emitters/prime-agent.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const CATALOG_JSON = path.join(USAI_DIR, "catalog.json")

const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))

// Emitter returns a serialized string; tests parse it back for structural
// assertions AND scan the raw string for leakage / secrets.
const serialized = emitPrimeAgentModelsFromCatalog(catalog)
const doc = JSON.parse(serialized)
const provider = doc.providers.usai

test("emits a ready-to-write JSON string (2-space indent, trailing newline)", () => {
  assert.equal(typeof serialized, "string")
  assert.ok(serialized.endsWith("\n"), "output must end with a trailing newline")
  // 2-space indent: the first nested key is indented by exactly 2 spaces.
  assert.match(serialized, /\n {2}"providers": \{/)
  // Round-trips as valid JSON with no trailing garbage.
  assert.deepEqual(JSON.parse(serialized), doc)
})

test("prime-agent ARRAY shape: providers.usai.models is an array; each has an id", () => {
  assert.ok(Array.isArray(provider.models), "providers.usai.models must be an array")
  for (const m of provider.models) {
    assert.equal(typeof m.id, "string")
    assert.ok(m.id.length > 0, "every model must carry a non-empty id")
    assert.equal(typeof m.name, "string")
    assert.equal(typeof m.contextWindow, "number")
    assert.equal(typeof m.maxTokens, "number")
    assert.equal(typeof m.cost, "object")
  }
})

test("provider-level fields map from catalog.gateway + authHeader constant", () => {
  assert.equal(provider.baseUrl, catalog.gateway.baseUrl)
  assert.equal(provider.api, catalog.gateway.api)
  assert.equal(provider.authHeader, true)
})

test("model count matches the catalog (14)", () => {
  assert.equal(provider.models.length, 14)
  assert.equal(provider.models.length, catalog.models.length)
})

test("preserves catalog (vendor-grouped) model order", () => {
  assert.deepEqual(
    provider.models.map((m) => m.id),
    catalog.models.map((m) => m.id),
  )
})

test("maxTokens maps from catalog.maxOutputTokens", () => {
  for (let i = 0; i < provider.models.length; i++) {
    assert.equal(provider.models[i].maxTokens, catalog.models[i].maxOutputTokens)
  }
})

test("NO OpenCode-shaped leakage (no limit object, no snake_case cost, no context_over_200k)", () => {
  // Structural: no model carries a `limit` object; cost uses camelCase only.
  for (const m of provider.models) {
    assert.equal(m.limit, undefined, "prime-agent has flat contextWindow, not a limit object")
    assert.equal(m.cost.cache_read, undefined, "cost must use camelCase cacheRead, not snake_case")
    assert.equal(m.cost.cache_write, undefined, "cost must use camelCase cacheWrite, not snake_case")
    assert.equal(m.cost.context_over_200k, undefined, "no OpenCode context_over_200k nesting")
  }
  // Textual: none of the OpenCode-shaped tokens appear anywhere in the output.
  assert.doesNotMatch(serialized, /"limit"/)
  assert.doesNotMatch(serialized, /cache_read/)
  assert.doesNotMatch(serialized, /cache_write/)
  assert.doesNotMatch(serialized, /context_over_200k/)
})

test("costAbove200kContext is dropped (tiered models carry no such field)", () => {
  // Sanity: these three DO carry the tiered field in the source catalog.
  const tieredIds = [
    "gpt-5.5-latest-guardrails-defaultv2",
    "gpt-5.4-latest-guardrails-defaultv2",
    "gemini-2.5-pro",
  ]
  for (const id of tieredIds) {
    const src = catalog.models.find((m) => m.id === id)
    assert.ok(src && src.costAbove200kContext, `catalog fixture must have tiered pricing for ${id}`)
    const out = provider.models.find((m) => m.id === id)
    assert.ok(out, `emitted output must still contain ${id}`)
    assert.equal(out.costAbove200kContext, undefined, `costAbove200kContext must be dropped for ${id}`)
  }
  // And no model anywhere retains the field.
  for (const m of provider.models) {
    assert.equal(m.costAbove200kContext, undefined)
  }
  assert.doesNotMatch(serialized, /costAbove200kContext/)
})

test("cacheWrite preserved where the catalog has it (claude models + gemini-flash)", () => {
  const withCacheWrite = catalog.models.filter((m) => m.cost && "cacheWrite" in m.cost)
  // Guard the fixture assumption: claude models + gemini-2.5-flash carry it.
  assert.ok(withCacheWrite.length >= 7, "fixture should have cacheWrite on 6 claude + gemini-flash")
  for (const src of withCacheWrite) {
    const out = provider.models.find((m) => m.id === src.id)
    assert.equal(out.cost.cacheWrite, src.cost.cacheWrite, `cacheWrite preserved for ${src.id}`)
  }
  // Spot-check gemini-2.5-flash specifically (the non-claude cacheWrite carrier).
  const flash = provider.models.find((m) => m.id === "gemini-2.5-flash")
  assert.equal(flash.cost.cacheWrite, 0.383)
})

test("apiKey is the env-var NAME, and NO real key material appears anywhere", () => {
  // apiKey must be the NAME of an env var, exactly as declared in the catalog.
  assert.equal(provider.apiKey, "USAI_API_KEY")
  assert.equal(provider.apiKey, catalog.gateway.apiKeyEnv)

  // No value that looks like a real secret leaked into the serialized output:
  //  - no `api-key-`/`sk-`/`Bearer ` prefixed strings,
  //  - no long base64-ish/hex blob that would look like a token.
  assert.doesNotMatch(serialized, /api-key-/i)
  assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]/)
  assert.doesNotMatch(serialized, /Bearer\s+\S/i)
  assert.doesNotMatch(serialized, /[A-Za-z0-9+/]{32,}={0,2}/, "no long base64-ish secret blob")
  assert.doesNotMatch(serialized, /\b[0-9a-f]{32,}\b/i, "no long hex secret blob")
})
