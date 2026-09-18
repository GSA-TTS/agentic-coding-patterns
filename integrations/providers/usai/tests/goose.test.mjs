// =============================================================================
// goose.test.mjs — shape + no-secret + no-leakage tests for the goose emitter.
//
// The goose-server kit consumes a custom-provider file (custom_usai.json) where
// `models` is an ARRAY of goose CustomProviderModel objects (each with a `name`
// that is the catalog model ID goose selects by), plus provider-level fields
// (name, engine, api_key_env, base_url). These tests assert the emitter produces
// THAT shape and specifically does NOT leak the OpenCode shape (limit object,
// snake_case cost keys, context_over_200k) or the prime-agent shape
// (contextWindow/maxTokens/cost object), does NOT embed any real key material,
// and drops the tiered costAbove200kContext field goose cannot represent.
//
// Reads the REAL shipped catalog.json via a relative path so catalog drift is
// exercised by these assertions too. Mirrors prime-agent.test.mjs.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { emitGooseProviderFromCatalog } from "../emitters/goose.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const CATALOG_JSON = path.join(USAI_DIR, "catalog.json")

const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"))

// Emitter returns a serialized string; tests parse it back for structural
// assertions AND scan the raw string for leakage / secrets.
const serialized = emitGooseProviderFromCatalog(catalog)
const doc = JSON.parse(serialized)

test("emits a ready-to-write JSON string (2-space indent, trailing newline)", () => {
  assert.equal(typeof serialized, "string")
  assert.ok(serialized.endsWith("\n"), "output must end with a trailing newline")
  // 2-space indent: the first nested key is indented by exactly 2 spaces.
  assert.match(serialized, /\n {2}"engine": "openai"/)
  assert.deepEqual(JSON.parse(serialized), doc)
})

test("goose provider-level fields: name/engine/display_name/api_key_env/base_url", () => {
  assert.equal(doc.name, "custom_usai", "provider name Desktop selects")
  assert.equal(doc.engine, "openai", "goose OpenAI-compatible engine")
  assert.equal(doc.display_name, "USAi")
  // api_key_env is the goose guest's injected env-var NAME, NOT the catalog's
  // gateway.apiKeyEnv (USAI_API_KEY). It is a name, never a secret value.
  assert.equal(doc.api_key_env, "CUSTOM_USAI_API_KEY")
  assert.notEqual(
    doc.api_key_env,
    catalog.gateway.apiKeyEnv,
    "goose uses its own injected env-var name, not the catalog gateway's",
  )
  // base_url is the catalog gateway root + the chat-completions path goose posts to.
  assert.equal(doc.base_url, `${catalog.gateway.baseUrl}/chat/completions`)
})

test("goose ARRAY shape: models is an array; each has a name = catalog model id", () => {
  assert.ok(Array.isArray(doc.models), "models must be an array")
  for (const m of doc.models) {
    assert.equal(typeof m.name, "string")
    assert.ok(m.name.length > 0, "every model must carry a non-empty name")
    assert.equal(typeof m.context_limit, "number")
    // cost fields are number|null; currency string|null; reasoning boolean.
    assert.ok(m.input_token_cost === null || typeof m.input_token_cost === "number")
    assert.ok(m.output_token_cost === null || typeof m.output_token_cost === "number")
    assert.ok(m.currency === null || typeof m.currency === "string")
    assert.ok(m.supports_cache_control === null || typeof m.supports_cache_control === "boolean")
    assert.equal(typeof m.reasoning, "boolean")
  }
})

// The count is DERIVED from the catalog on purpose: the gateway's model list
// changes over time, so a literal here would go stale and fail for the wrong
// reason. The emitter's contract is "emit every catalog model, drop none".
test("model count matches the catalog", () => {
  assert.equal(doc.models.length, catalog.models.length)
  assert.ok(doc.models.length > 0, "catalog must not be empty")
})

test("goose model `name` is the catalog model ID (what goose selects by), in catalog order", () => {
  assert.deepEqual(
    doc.models.map((m) => m.name),
    catalog.models.map((m) => m.id),
  )
})

test("context_limit maps from catalog.contextWindow", () => {
  for (let i = 0; i < doc.models.length; i++) {
    assert.equal(doc.models[i].context_limit, catalog.models[i].contextWindow)
  }
})

test("token costs are per-TOKEN (catalog per-1M / 1e6); currency USD when present", () => {
  for (let i = 0; i < doc.models.length; i++) {
    const src = catalog.models[i].cost || {}
    const out = doc.models[i]
    // goose input_token_cost/output_token_cost are USD per single token, while the
    // catalog stores USD per 1,000,000 tokens — the emitter divides by 1e6.
    assert.equal(out.input_token_cost, "input" in src ? src.input / 1_000_000 : null)
    assert.equal(out.output_token_cost, "output" in src ? src.output / 1_000_000 : null)
    const hasAnyCost = "input" in src || "output" in src
    assert.equal(out.currency, hasAnyCost ? "USD" : null)
  }
})

test("per-token cost magnitude is sane (a per-1M value would be ~1e6 too large)", () => {
  // Guard the exact bug this conversion fixes: a model priced a few dollars per
  // 1M tokens must emit a per-token cost well under $0.01, not a few-dollars value.
  for (const m of doc.models) {
    if (typeof m.input_token_cost === "number") {
      assert.ok(
        m.input_token_cost < 0.01,
        `${m.name} input_token_cost ${m.input_token_cost} looks like a per-1M value, not per-token`,
      )
    }
    if (typeof m.output_token_cost === "number") {
      assert.ok(
        m.output_token_cost < 0.01,
        `${m.name} output_token_cost ${m.output_token_cost} looks like a per-1M value, not per-token`,
      )
    }
  }
})

test("supports_cache_control is true only when the catalog declares cacheRead/cacheWrite", () => {
  for (let i = 0; i < doc.models.length; i++) {
    const src = catalog.models[i].cost || {}
    const expected = "cacheRead" in src || "cacheWrite" in src ? true : null
    assert.equal(doc.models[i].supports_cache_control, expected)
  }
  // Sanity floor: several catalog models declare cache pricing.
  const withCache = catalog.models.filter(
    (m) => m.cost && (m.cost.cacheRead !== undefined || m.cost.cacheWrite !== undefined),
  )
  assert.ok(withCache.length >= 5, `expected cache pricing on several models (found ${withCache.length})`)
})

test("NO OpenCode- or prime-agent-shaped leakage", () => {
  for (const m of doc.models) {
    assert.equal(m.limit, undefined, "no OpenCode limit object")
    assert.equal(m.contextWindow, undefined, "goose uses context_limit, not contextWindow")
    assert.equal(m.maxTokens, undefined, "no prime-agent maxTokens")
    assert.equal(m.cost, undefined, "goose has no nested cost object")
  }
  assert.doesNotMatch(serialized, /"limit"/)
  assert.doesNotMatch(serialized, /cache_read/)
  assert.doesNotMatch(serialized, /cache_write/)
  assert.doesNotMatch(serialized, /context_over_200k/)
  assert.doesNotMatch(serialized, /"maxTokens"/)
  assert.doesNotMatch(serialized, /"contextWindow"/)
})

test("costAbove200kContext is dropped (goose has no tiered-pricing field)", () => {
  const tiered = catalog.models.filter((m) => m.costAbove200kContext)
  assert.ok(tiered.length > 0, "catalog must carry at least one tiered-pricing model")
  for (const src of tiered) {
    const out = doc.models.find((m) => m.name === src.id)
    assert.ok(out, `emitted output must still contain ${src.id}`)
    assert.equal(out.costAbove200kContext, undefined, `costAbove200kContext dropped for ${src.id}`)
  }
  assert.doesNotMatch(serialized, /costAbove200kContext/)
})

test("api_key_env is an env-var NAME, and NO real key material appears anywhere", () => {
  assert.equal(doc.api_key_env, "CUSTOM_USAI_API_KEY")
  // No value that looks like a real secret leaked into the serialized output.
  assert.doesNotMatch(serialized, /api-key-/i)
  assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]/)
  assert.doesNotMatch(serialized, /Bearer\s+\S/i)
  assert.doesNotMatch(serialized, /[A-Za-z0-9+/]{32,}={0,2}/, "no long base64-ish secret blob")
  assert.doesNotMatch(serialized, /\b[0-9a-f]{32,}\b/i, "no long hex secret blob")
})
