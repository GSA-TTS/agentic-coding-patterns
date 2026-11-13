import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import * as builder from "../scripts/build-catalog.mjs"
import {
  INPUT_MODALITIES,
  NON_CHAT_MODELS,
  capabilitiesFromModelsDev,
  classifyVendor,
  enrichModelMetadata,
  extractModelTokens,
  findModelsDevMatch,
  isPreciseMatch,
  nonChatReason,
  normalizeCostFromModelsDev,
  normalizeLimit,
  normalizeModelId,
  providerModelMaps,
} from "../scripts/model-catalog-core.mjs"

const model = { id: "gpt_5_2_default_v2", vendor: "openai" }
const upstream = {
  limit: { context: 200000, output: 16000 },
  cost: { input: 2, output: 8, cache_read: 0, context_over_200k: { input: 4, output: 16, cache_write: 5 } },
  reasoning: false,
  modalities: { input: ["image", "text"] },
}
const catalog = { azure: { models: { "gpt-5.2": upstream } } }
const expectedMetadata = {
  contextWindow: 200000,
  maxOutputTokens: 16000,
  cost: { input: 2, output: 8, cacheRead: 0 },
  costAbove200kContext: { input: 4, output: 16, cacheWrite: 5 },
}

test("builder exports are the same shared matcher and policy, not copies", () => {
  assert.equal(builder.findModelsDevMatch, findModelsDevMatch)
  assert.equal(builder.classifyVendor, classifyVendor)
  assert.equal(builder.nonChatReason, nonChatReason)
  assert.equal(builder.NON_CHAT_MODELS, NON_CHAT_MODELS)
  assert.equal(builder.INPUT_MODALITIES, INPUT_MODALITIES)
})

test("pure identity helpers retain deployment normalization and precision", () => {
  assert.equal(normalizeModelId(model.id), "gpt-5-2")
  const tokens = extractModelTokens(model.id)
  assert.equal(tokens.family, "gpt")
  assert.deepEqual(tokens.version, ["5", "2"])
  assert.equal(isPreciseMatch(tokens, extractModelTokens("azure/gpt-5.2")), true)
  assert.equal(isPreciseMatch(tokens, extractModelTokens("gpt-5.2-luna")), false)
  assert.equal(findModelsDevMatch(model.id, {}), null)
})

test("metadata has expected costs and limits without copying upstream capabilities by default", () => {
  const result = enrichModelMetadata(model, catalog)
  assert.deepEqual(result.metadata, expectedMetadata)
  assert.equal(result.matched, true)
  assert.equal(result.matchId, "gpt-5.2")
  assert.deepEqual(result.missingLimits, [])
  assert.deepEqual(result.capabilityWarnings, [])
})

test("provider limits win independently over upstream metadata", () => {
  for (const supplied of [
    { contextWindow: 12345 },
    { maxOutputTokens: 345 },
    { contextWindow: 12345, maxOutputTokens: 345 },
  ]) {
    assert.deepEqual(enrichModelMetadata({ ...model, ...supplied }, catalog).metadata, {
      ...expectedMetadata, ...supplied,
    })
  }
  assert.deepEqual(enrichModelMetadata({ ...model, contextWindow: -1, maxOutputTokens: 1.5 }, catalog).metadata, expectedMetadata)
})

test("backend preference stops at first precise match, not a richer fallback", () => {
  const providers = {
    azure: { models: { "gpt-5.2": { limit: { context: 1000 } } } },
    openai: { models: { "gpt-5.2": upstream } },
  }
  assert.deepEqual(providerModelMaps("openai", providers).map((p) => p.providerId), ["azure", "openai"])
  assert.deepEqual(enrichModelMetadata(model, providers).metadata, { contextWindow: 1000 })
  assert.deepEqual(enrichModelMetadata(model, { openai: providers.openai }).metadata, expectedMetadata)
  providers.azure.models = { "gpt-5.2-luna": upstream }
  assert.deepEqual(enrichModelMetadata(model, providers).metadata, expectedMetadata)
  assert.deepEqual(providerModelMaps("unknown-vendor", providers), [])
})

test("empty, missing, unknown and near-match enrichment never fabricate limits", () => {
  for (const [input, source] of [
    [model, null],
    [model, {}],
    [model, { azure: { models: {} } }],
    [model, { azure: { models: { "gpt-5.2-luna": upstream } } }],
    [{ id: "unknown-model", vendor: "other" }, catalog],
  ]) {
    const result = enrichModelMetadata(input, source, { includeCapabilities: true })
    assert.deepEqual(result.metadata, {})
    assert.equal(result.matched, false)
    assert.equal(result.matchId, null)
    assert.deepEqual(result.missingLimits, ["context", "output"])
  }
  assert.equal(findModelsDevMatch(model.id, {}), null)
  assert.equal(normalizeLimit(undefined), undefined)
  assert.deepEqual(enrichModelMetadata({ ...model, contextWindow: 12345 }, null).metadata, { contextWindow: 12345 })
})

test("runtime empty membership stays empty; the authoring builder still rejects an empty feed", () => {
  const advertised = []
  assert.deepEqual(advertised.map((entry) => enrichModelMetadata(entry, catalog)), [])
  assert.throws(() => builder.shapeFromFeeds([], catalog), /model list is empty/)
})

test("builder retains generic authoring limits and unchanged unenriched diagnostics", (t) => {
  const writes = []
  t.mock.method(process.stderr, "write", (text) => { writes.push(text); return true })
  const { models } = builder.shapeFromFeeds([{ id: model.id, context_window: 12345 }], {})
  assert.deepEqual(models, [{
    id: model.id, vendor: "openai", name: "GPT 5.2 Default V2",
    contextWindow: 12345, maxOutputTokens: 8192,
  }])
  assert.equal(writes.join(""),
    "  UNENRICHED (1): no precise models.dev match; cost is ABSENT:\n" +
    `    ${model.id}; fallback output limit(s) used\n`)
})

test("capability opt-in preserves false and canonical modalities without mutating inputs", () => {
  const before = structuredClone(catalog)
  const input = Object.freeze({ ...model })
  const result = enrichModelMetadata(input, catalog, { includeCapabilities: true })
  assert.deepEqual(result.metadata, { ...expectedMetadata, reasoning: false, inputModalities: ["text", "image"] })
  result.metadata.inputModalities.push("audio")
  result.metadata.cost.input = 999
  assert.deepEqual(catalog, before)
  assert.deepEqual(input, model)
})

test("malformed capabilities return diagnostics as data; builder owns identical warning output", (t) => {
  const malformed = { reasoning: "yes", modalities: [] }
  const warnings = ["reasoning is not a boolean", "modalities is not an object"]
  assert.deepEqual(capabilitiesFromModelsDev(malformed), { capabilities: {}, malformed: true, warnings })
  const source = { azure: { models: { "gpt-5.2": malformed } } }
  const writes = []
  t.mock.method(process.stderr, "write", (text) => { writes.push(text); return true })
  const pure = enrichModelMetadata(model, source, { includeCapabilities: true })
  assert.deepEqual(writes, [])
  assert.deepEqual(pure.capabilityWarnings, warnings)
  assert.deepEqual(pure.metadata, {})
  builder.shapeFromFeeds([{ id: model.id }], source, { includeCapabilities: true })
  assert.equal(writes.join(""), warnings.map((why) =>
    `  WARNING models.dev gpt-5.2: ${why}; capability treated as unknown\n`).join("") +
    "1 of 1 matched models had malformed capability data\n")
})

test("cost normalization retains zero, rejects invalid prices and omits incomplete tiers", () => {
  assert.deepEqual(normalizeCostFromModelsDev({ input: 0, context_over_200k: { input: 1 } }), {
    cost: { input: 0 }, costAbove200kContext: null,
  })
  for (const input of [-1, Infinity, NaN, "2"]) {
    assert.throws(() => normalizeCostFromModelsDev({ input }), /finite non-negative number/)
  }
})

test("shared filter retains exact exclusions and conservative name filtering", () => {
  for (const [id, reason] of Object.entries(NON_CHAT_MODELS)) assert.equal(nonChatReason(id), reason)
  assert.equal(nonChatReason("future-model", "Text Embedding"), "id or name indicates an embedding model")
  assert.equal(nonChatReason("future-chat-model"), null)
})

test("existing feed fixtures agree between pure metadata and builder, including authoring-only defaults", (t) => {
  t.mock.method(process.stderr, "write", () => true)
  const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"))
  const feed = load("models-list.json").data
  const source = load("models-dev.json")
  for (const includeCapabilities of [false, true]) {
    const { models } = builder.shapeFromFeeds(feed, source, { includeCapabilities })
    assert.deepEqual(models.map((m) => m.id).sort(), feed.filter((m) => !nonChatReason(m.id, m.name)).map((m) => m.id).sort())
    for (const built of models) {
      const raw = feed.find((m) => m.id === built.id)
      const { metadata } = enrichModelMetadata({
        id: raw.id, vendor: classifyVendor(raw.id, raw.owned_by),
        contextWindow: raw.context_window, maxOutputTokens: raw.max_output_tokens,
      }, source, { includeCapabilities })
      const { id, vendor, name, ...builtMetadata } = built
      assert.deepEqual(builtMetadata, { contextWindow: 128000, maxOutputTokens: 8192, ...metadata }, id)
    }
  }
})
