import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { shapeFromFeeds } from "../scripts/build-catalog.mjs"
import { classifyVendor, enrichModelMetadata, findModelsDevMatch } from "../scripts/model-catalog-core.mjs"

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))
const fixture = load("./fixtures/models-dev.json")
const feed = load("./fixtures/models-list.json").data
const schema = load("../../../isolation/schemas/acq-neutral-model-catalog.schema.json")
const options = { includeReleaseMetadata: true, asOf: "2026-11-17" }
const model = { id: "gpt_5_2_default_v2", vendor: "openai" }
const source = (release_date, extra = {}) => ({
  azure: { models: { "gpt-5.2": { release_date, limit: { context: 1000 }, ...extra } } },
})
const provenance = (providerId = "azure", modelId = "gpt-5.2") => ({ source: "models.dev", providerId, modelId })
const validDates = ["0001-01-01", "1900-02-28", "2000-02-29", "2024-02-29", "2026-04-30", "2026-11-17"]
const invalidDates = [
  undefined, null, 20260101, {}, [], true, "", "2026", "2026-01", "20260101",
  "2026-1-01", "2026-01-1", "2026-01-01T00:00:00Z", "2026-01-01\n", " 2026-01-01",
  "2026-01-01 ", "0000-01-01", "1900-02-29", "2100-02-29", "2025-02-29", "2026-02-30",
  "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "10000-01-01",
]

test("actual models.dev fixture dates use precise gateway matches and upstream map identity", () => {
  for (const [id, vendor, providerId, modelId, releaseDate] of [
    ["gpt_5_2_default_v2", "openai", "azure", "gpt-5.2", "2025-12-11"],
    ["gpt-5.2-latest-guardrails-defaultv2", "openai", "azure", "gpt-5.2", "2025-12-11"],
    ["claude-opus-5", "anthropic", "amazon-bedrock", "anthropic.claude-opus-5", "2026-07-24"],
    ["gemini-2.5-flash", "google", "google-vertex", "gemini-2.5-flash", "2025-06-17"],
  ]) {
    const result = enrichModelMetadata({ id, vendor }, fixture, options)
    assert.equal(result.matchId, modelId)
    assert.equal(result.metadata.releaseDate, releaseDate)
    assert.deepEqual(result.metadata.releaseDateSource, provenance(providerId, modelId))
  }
})

test("default output and builder diagnostics are unchanged across the actual fixtures", (t) => {
  const withoutDates = structuredClone(fixture)
  for (const provider of Object.values(withoutDates)) {
    for (const data of Object.values(provider.models)) delete data.release_date
  }
  const writes = []
  t.mock.method(process.stderr, "write", (text) => { writes.push(text); return true })
  for (const includeCapabilities of [false, true]) {
    const baseline = shapeFromFeeds(feed, withoutDates, { includeCapabilities })
    const baselineWrites = writes.splice(0)
    assert.deepEqual(shapeFromFeeds(feed, fixture, { includeCapabilities }), baseline)
    assert.deepEqual(writes.splice(0), baselineWrites)
    for (const raw of feed) {
      const input = { id: raw.id, vendor: classifyVendor(raw.id, raw.owned_by) }
      const result = enrichModelMetadata(input, fixture, { includeCapabilities })
      assert.deepEqual(result, enrichModelMetadata(input, withoutDates, { includeCapabilities }))
      assert.deepEqual(result, enrichModelMetadata(input, fixture, {
        includeCapabilities, includeReleaseMetadata: false, asOf: "invalid ignored clock",
      }))
      const enriched = enrichModelMetadata(input, fixture, { ...options, includeCapabilities })
      delete enriched.metadata.releaseDate
      delete enriched.metadata.releaseDateSource
      assert.deepEqual(enriched, result)
    }
  }
})

test("calendar, leap years, precision and explicit nonfuture bound", () => {
  for (const date of validDates) {
    assert.equal(enrichModelMetadata(model, source(date), options).metadata.releaseDate, date)
  }
  for (const date of [...invalidDates, "2026-11-18", "9999-12-31"]) {
    const result = enrichModelMetadata(model, source(date), options)
    assert.deepEqual(result.metadata, { contextWindow: 1000 }, JSON.stringify(date))
    assert.equal(result.matched, true)
    assert.equal(result.matchId, "gpt-5.2")
  }
  for (const asOf of invalidDates) {
    assert.throws(() => enrichModelMetadata(model, fixture, { ...options, asOf }), /valid YYYY-MM-DD asOf/)
  }
  assert.equal(enrichModelMetadata(model, source("2026-11-18"), {
    ...options, asOf: "2026-11-18",
  }).metadata.releaseDate, "2026-11-18")
})

test("missing date never comes from ID, last_updated, knowledge, created or the clock", () => {
  const id = "gpt-5.2-2025-12-11"
  const catalog = { azure: { models: { [id]: { last_updated: "2026-01-01", knowledge: "2025-12-11", created: 123 } } } }
  assert.deepEqual(enrichModelMetadata({ ...model, id }, catalog, options).metadata, {})
  assert.deepEqual(enrichModelMetadata(model, source(undefined, { last_updated: "2026-01-01" }), options).metadata,
    { contextWindow: 1000 })
})

test("first precise backend wins even with absent, malformed or future release metadata", () => {
  for (const date of [undefined, "invalid", "2026-11-18", "2025-01-01"]) {
    const catalog = source(date, { id: "spoofed-inner-id" })
    catalog.azure.id = "spoofed-provider-id"
    catalog.openai = { models: { "gpt-5.2": { release_date: "2026-01-01" } } }
    const result = enrichModelMetadata(model, catalog, options)
    assert.equal(result.metadata.releaseDate, date === "2025-01-01" ? date : undefined)
    assert.deepEqual(result.metadata.releaseDateSource, date === "2025-01-01" ? provenance() : undefined)
    catalog.azure.models = { "gpt-5.2-codex": { release_date: "2026-01-01" } }
    const fallback = enrichModelMetadata(model, catalog, options)
    assert.deepEqual(fallback.metadata.releaseDateSource, provenance("openai"))
    assert.equal(fallback.metadata.releaseDate, "2026-01-01")
  }
})

test("aliases retain the canonical matcher's ordering, not newest release_date ordering", () => {
  const models = {
    "gpt-5.2-2026-01-01": { release_date: "2025-06-01" },
    "gpt-5.2-2025-12-11": { release_date: "2026-01-01" },
  }
  const catalog = { azure: { models } }
  const check = (id, expected) => {
    const result = enrichModelMetadata({ ...model, id }, catalog, options)
    assert.equal(findModelsDevMatch(id, models).id, expected)
    assert.deepEqual(result.metadata.releaseDateSource, provenance("azure", expected))
    assert.equal(result.metadata.releaseDate, models[expected].release_date)
  }
  check(model.id, "gpt-5.2-2026-01-01")
  check("gpt-5.2-2025-12-11", "gpt-5.2-2025-12-11")
  models["gpt-5.2"] = { release_date: "2025-01-01" }
  check(model.id, "gpt-5.2")
  delete models["gpt-5.2"].release_date
  assert.deepEqual(enrichModelMetadata(model, catalog, options).metadata, {})
})

test("unknown and near matches never inherit a sibling date or lose provider limits", () => {
  for (const [id, vendor] of [
    ["gpt-5.2-luna", "openai"], ["claude-opus-5-thinking", "anthropic"],
    ["gemini-2.5-flash-preview", "google"], ["unknown-model", "other"],
  ]) {
    const result = enrichModelMetadata({ id, vendor, contextWindow: 123 }, fixture, options)
    assert.deepEqual(result.metadata, { contextWindow: 123 })
    assert.equal(result.matched, false)
  }
  for (const catalog of [null, {}, { azure: { models: {} } }]) {
    assert.deepEqual(enrichModelMetadata(model, catalog, options).metadata, {})
  }
  const onlyFlash = { "google-vertex": { models: { "gemini-2.5-flash": { release_date: "2025-01-01" } } } }
  assert.equal(enrichModelMetadata({ id: "gemini-2.5-flash-lite", vendor: "google" }, onlyFlash, options).matched, false)
})

test("unsafe or oversized matched source IDs omit the pair without changing the match", () => {
  for (const id of ["https://example.org/gpt-5.2", `${"a".repeat(128)}/gpt-5.2`, "x\n/gpt-5.2"]) {
    const catalog = { azure: { models: { [id]: { release_date: "2025-01-01" } } } }
    const result = enrichModelMetadata(model, catalog, options)
    assert.equal(result.matched, true)
    assert.equal(result.matchId, id)
    assert.deepEqual(result.metadata, {})
  }
})

test("opt-in is pure, preserves capabilities and existing invalid-cost failures", () => {
  const before = structuredClone(fixture)
  const input = Object.freeze({ ...model })
  const result = enrichModelMetadata(input, fixture, { ...options, includeCapabilities: true })
  assert.equal(result.metadata.reasoning, true)
  result.metadata.releaseDateSource.modelId = "changed"
  assert.deepEqual(fixture, before)
  assert.deepEqual(input, model)
  assert.throws(() => enrichModelMetadata(model, source("2025-01-01", { cost: { input: -1 } }), options),
    /finite non-negative number/)
})

test("closed neutral schema validates the pair, strict calendar and bounded data-only provenance", () => {
  const pair = { releaseDate: "2025-01-01", releaseDateSource: provenance() }
  const cases = [
    [{}, true], [pair, true],
    ...feed.map((raw) => [enrichModelMetadata({
      id: raw.id, vendor: classifyVendor(raw.id, raw.owned_by),
    }, fixture, options).metadata, true]),
    ...validDates.map((releaseDate) => [{ ...pair, releaseDate }, true]),
    // Future bounds are caller-owned; this is a valid calendar date in the schema.
    [{ ...pair, releaseDate: "9999-12-31" }, true],
    ...invalidDates.filter((d) => d !== undefined).map((releaseDate) => [{ ...pair, releaseDate }, false]),
    [{ releaseDate: pair.releaseDate }, false], [{ releaseDateSource: provenance() }, false],
    [{ ...pair, url: "https://example.org" }, false],
    ...[
      null, {}, { ...provenance(), source: "other" }, { ...provenance(), url: "https://example.org" },
      { ...provenance(), providerId: "a".repeat(33) }, { ...provenance(), providerId: "azure\n" },
      { ...provenance(), modelId: "a".repeat(129) }, { ...provenance(), modelId: "gpt-5.2\n" },
      { ...provenance(), modelId: "https://example.org/gpt-5.2" }, { ...provenance(), modelId: "" },
    ].map((releaseDateSource) => [{ ...pair, releaseDateSource }, false]),
    [{ ...pair, releaseDateSource: provenance("amazon-bedrock", "us.anthropic.claude-sonnet-4-20250514-v1:0") }, true],
    [{ ...pair, releaseDateSource: provenance("azure", "a".repeat(128)) }, true],
  ]
  // Use the repository's existing Python JSON Schema dependency, not a second validator.
  const run = spawnSync("python3", ["-c", `
import json, sys
from jsonschema import Draft202012Validator
payload = json.load(sys.stdin)
Draft202012Validator.check_schema(payload["schema"])
validator = Draft202012Validator(payload["schema"])
for fields, expected in payload["cases"]:
    catalog = {"schemaVersion": "acq-neutral-model-catalog/v1", "providerId": "usai", "models": [{"id": "gpt_5_2_default_v2", **fields}]}
    errors = list(validator.iter_errors(catalog))
    assert (not errors) == expected, (fields, [e.message for e in errors])
`], { input: JSON.stringify({ schema, cases }), encoding: "utf8" })
  assert.equal(run.status, 0, `${run.error ?? ""}${run.stderr}`)
})
