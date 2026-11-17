import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { boundedJson, RUNTIME_LIMITS, validatedFacts, validateMetadata, upstreamModelId } from "../scripts/runtime-model-bounds.mjs"
import { discoverRuntimeModels, METADATA_URL, requestJson } from "../scripts/runtime-model-discovery.mjs"
import { artifactPath, buildRuntimeArtifact } from "../scripts/build-runtime-artifact.mjs"

const facts = { schemaVersion: "acq-provider-facts/v1", providerId: "usai", apiProtocol: "openai-compatible", host: "gateway.example.test", baseUrl: "https://gateway.example.test/v1", modelsUrl: "https://gateway.example.test/v1/models", keyEnv: "USAI_API_KEY" }
const snapshot = { schemaVersion: "acq-neutral-model-catalog/v1", providerId: "usai", models: [{ id: "removed", contextWindow: 9999, reasoning: true }], recommendations: { primary: "removed", small: "gpt-5.2" } }
const descriptor = { schemaVersion: "acq-runtime-discovery/v1", providerId: "usai", adapter: "usai-openai-list/v1" }
const json = (body, options) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...options })

async function fixture(t, catalog = snapshot) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bounded-discovery-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "models/providers/usai")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "facts.json"), JSON.stringify(facts))
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify(catalog))
  await writeFile(path.join(directory, "discovery.json"), JSON.stringify(descriptor))
  return root
}

test("standalone artifact is byte-identical to the closed canonical source build", async () => {
  assert.equal(await readFile(artifactPath, "utf8"), await buildRuntimeArtifact())
})

test("committed models.dev fixture including Vertex @default IDs enriches known live membership", async (t) => {
  const root = await fixture(t)
  const metadata = await readFile(new URL("./fixtures/models-dev.json", import.meta.url), "utf8")
  assert.ok(metadata.includes('"claude-opus-5@default"'))
  assert.equal(upstreamModelId("claude-opus-5@default"), "claude-opus-5@default")
  for (const id of ["__proto__", "constructor", "prototype", "bad id", "x\n", "x".repeat(513)]) assert.throws(() => upstreamModelId(id))
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async (url) => url === facts.modelsUrl
    ? json({ data: [{ id: "gpt-5.2", owned_by: "openai" }] })
    : new Response(metadata, { headers: { "content-type": "application/json" } }) })
  assert.equal(result.metadataOutcome, "available-unverified")
  assert.equal(result.inputs[0].catalog.models[0].contextWindow, 400000)
  assert.equal(result.inputs[0].catalog.models[0].maxOutputTokens, 128000)
})

test("unsafe integer upstream limits are individually omitted without losing membership or valid sibling limits", async (t) => {
  const root = await fixture(t)
  for (const limit of [{ context: 1e20, output: 1e20 }, { context: 1e20, output: 64 }, { context: 128, output: 1e20 }]) {
    const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async (url) => url === facts.modelsUrl
      ? json({ data: [{ id: "gpt-5.2" }] }) : json({ azure: { models: { "gpt-5.2": { limit } } } }) })
    const model = result.inputs[0].catalog.models[0]
    assert.equal(model.id, "gpt-5.2")
    assert.equal(model.contextWindow, Number.isSafeInteger(limit.context) ? limit.context : undefined)
    assert.equal(model.maxOutputTokens, Number.isSafeInteger(limit.output) ? limit.output : undefined)
  }
})

test("lexical bounds refuse deep, wide, long, duplicate and prototype-shaped JSON before matching", () => {
  for (const text of ["[".repeat(34) + "0" + "]".repeat(34), JSON.stringify("x".repeat(17000)), '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"constructor":{}}', "[1,]", "1e9999x"]) {
    assert.throws(() => boundedJson(text, 1000000))
  }
  assert.throws(() => boundedJson(JSON.stringify(Array(20001).fill(0)), 1000000), /cardinality/)
  assert.throws(() => boundedJson('"abc"', 4), /byte/)
  assert.deepEqual(boundedJson('{"data":[]}', 100), { data: [] })
  for (const token of ["1e999", "-1e999", "9.99e999"]) {
    assert.throws(() => boundedJson(`{"number":${token}}`, 100), /non-finite/)
  }
  assert.equal(boundedJson("1e308", 100), 1e308)
  assert.throws(() => validateMetadata({ azure: { models: { "bad id": {} } } }), /identity/)
})

test("live discovery requires a closed host descriptor; descriptorless v2 snapshot stays explicit", async (t) => {
  const root = await fixture(t)
  const filename = path.join(root, "models/providers/usai/discovery.json")
  let calls = 0
  const options = { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () => { calls++; return json({ data: [] }) } }
  await rm(filename)
  await assert.rejects(discoverRuntimeModels(root, options), (error) => error.outcome?.reason === "invalid-input")
  assert.equal((await discoverRuntimeModels(root, { ...options, mode: "snapshot" })).sourceOutcome, "snapshot-nonlive")
  for (const value of [
    { ...descriptor, providerId: "other" }, { ...descriptor, adapter: "other/v1" },
    { ...descriptor, schemaVersion: "acq-provider-input-bundle/v2" },
    { ...descriptor, command: "provider-script" }, { adapter: descriptor.adapter }, null,
  ]) {
    await writeFile(filename, JSON.stringify(value))
    await assert.rejects(discoverRuntimeModels(root, options))
  }
  assert.equal(calls, 0, "binding must fail before any request")
  await writeFile(filename, JSON.stringify(descriptor))
  assert.equal((await discoverRuntimeModels(root, options)).sourceOutcome, "live")
  assert.equal(calls, 1)
})

test("partial or ambiguous pagination fails, including empty partial lists; terminal markers succeed", async (t) => {
  const root = await fixture(t)
  for (const continuation of [
    { has_more: true }, { has_more: "false" }, { hasMore: true }, { next: "/page/2" },
    { cursor: "opaque" }, { next_cursor: "opaque" }, { nextPageToken: "opaque" },
    { links: { next: "https://gateway.example.test/page/2" } },
    { pagination: { has_more: true } }, { meta: { next_cursor: "opaque" } },
  ]) {
    let calls = 0
    await assert.rejects(discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () => {
      calls++; return json({ data: [], ...continuation })
    } }), (error) => error.outcome?.reason === "invalid-response")
    assert.equal(calls, 1, "no metadata or pagination follow-up")
  }
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () =>
    json({ data: [], has_more: false, next: null, cursor: "", links: { next: null }, pagination: { hasMore: false } }) })
  assert.deepEqual(result.inputs[0].catalog.models, [])
})

test("live exact-ID capabilities retain provenance, but snapshot defaults and sibling capabilities do not", async (t) => {
  const root = await fixture(t, { ...snapshot, models: [
    { id: "gpt-5.2", reasoning: false, inputModalities: ["text", "image"], contextWindow: 999999, maxOutputTokens: 99999, cost: { input: 999 } },
    { id: "gpt-5.2-latest", reasoning: true, inputModalities: ["audio"] },
  ] })
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async (url) => url === facts.modelsUrl
    ? json({ data: [{ id: "gpt-5.2" }, { id: "gpt-5.2-guardrails" }] })
    : json({ azure: { models: { "gpt-5.2": { limit: { context: 1234, output: 123 }, reasoning: true, modalities: { input: ["audio"] } } } } }) })
  const [exact, sibling] = result.inputs[0].catalog.models
  assert.equal(exact.reasoning, false)
  assert.deepEqual(exact.inputModalities, ["text", "image"])
  assert.equal(exact.contextWindow, 1234)
  assert.equal(exact.maxOutputTokens, 123)
  assert.equal(exact.cost, undefined)
  assert.deepEqual(exact.metadataProvenance, {
    reasoning: "snapshot-exact-id", inputModalities: "snapshot-exact-id",
    contextWindow: "models.dev-unverified", maxOutputTokens: "models.dev-unverified",
  })
  assert.equal(sibling.reasoning, undefined)
  assert.equal(sibling.inputModalities, undefined)
  const unavailable = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async (url) => {
    if (url === facts.modelsUrl) return json({ data: [{ id: "gpt-5.2" }] })
    throw new Error("metadata unavailable")
  } })
  const model = unavailable.inputs[0].catalog.models[0]
  assert.equal(model.reasoning, false)
  assert.equal(model.contextWindow, undefined)
  assert.equal(model.maxOutputTokens, undefined)
  assert.equal(model.cost, undefined)
})

test("invalid exact-ID curated capabilities fail rather than being promoted to runtime facts", async (t) => {
  for (const invalid of [{ reasoning: "true" }, { inputModalities: ["unknown"] }]) {
    const root = await fixture(t, { ...snapshot, models: [{ id: "example", ...invalid }] })
    await assert.rejects(discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () => json({ data: [{ id: "example" }] }) }))
  }
})

test("500 models per provider succeeds, while the provider inventory remains capped at eight", async (t) => {
  const root = await fixture(t)
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async (url) => {
    if (url === facts.modelsUrl) return json({ data: Array.from({ length: 500 }, (_, n) => ({ id: `model-${n}` })) })
    throw new Error("optional metadata unavailable")
  } })
  assert.equal(result.inputs[0].catalog.models.length, 500)
  for (let n = 0; n < 8; n++) await mkdir(path.join(root, "models/providers", `extra-${n}`))
  await assert.rejects(discoverRuntimeModels(root, { fetchImpl: () => assert.fail("inventory must fail before requests") }), (error) => error.outcome?.reason === "invalid-input")
})

test("facts permit only exact declared HTTPS 443 destinations and owned credentials", () => {
  for (const change of [
    { modelsUrl: "http://gateway.example.test/v1/models" },
    { modelsUrl: "https://gateway.example.test:444/v1/models" },
    { modelsUrl: "https://other.example.test/v1/models" },
    { modelsUrl: "https://user@gateway.example.test/v1/models" },
    { modelsUrl: "https://gateway.example.test/v1/models?key=x" },
    { providerId: "other" }, { keyEnv: "OTHER_SECRET" },
  ]) assert.throws(() => validatedFacts({ ...facts, ...change }))
  assert.deepEqual(validatedFacts(facts), facts)
})

test("live membership is authoritative; metadata follows once without auth, recommendations survive by ID", async (t) => {
  const root = await fixture(t)
  const calls = []
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "synthetic-fixture" }, fetchImpl: async (url, options) => {
    calls.push(url)
    assert.equal(options.redirect, "error")
    assert.equal(options.credentials, "omit")
    if (url === facts.modelsUrl) {
      assert.equal(options.headers.Authorization, "Bearer synthetic-fixture")
      return json({ data: [{ id: "gpt-5.2", owned_by: "openai", reasoning: true }, { id: "text-embedding-005" }, { id: "unknown-chat" }] })
    }
    assert.equal(url, METADATA_URL)
    assert.deepEqual(options.headers, {})
    return json({ azure: { models: { "gpt-5.2": { limit: { context: 1000, output: 200 }, reasoning: true }, "not-advertised": {} } } })
  } })
  assert.deepEqual(calls, [facts.modelsUrl, METADATA_URL])
  const catalog = result.inputs[0].catalog
  assert.deepEqual(catalog.models.map((model) => model.id), ["gpt-5.2", "unknown-chat"])
  assert.deepEqual(catalog.recommendations, { small: "gpt-5.2" })
  assert.equal(catalog.models[0].contextWindow, 1000)
  assert.equal(catalog.models[0].reasoning, undefined)
  assert.equal(catalog.models[1].contextWindow, undefined)
  assert.equal(result.sourceOutcome, "live")
  assert.ok(!JSON.stringify(result).includes("synthetic-fixture"))
})

test("membership failure never falls back; optional metadata failure retains membership", async (t) => {
  const root = await fixture(t)
  for (const body of [{}, { data: null }, { data: [{ id: "a" }, { id: "a" }] }, { data: [{ id: "bad id" }] }, { data: Array.from({ length: 501 }, (_, n) => ({ id: `m${n}` })) }]) {
    let calls = 0
    await assert.rejects(discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () => { calls++; return json(body) } }))
    assert.equal(calls, 1)
  }
  let calls = 0
  const result = await discoverRuntimeModels(root, { credentials: { USAI_API_KEY: "fixture" }, fetchImpl: async () => {
    if (++calls === 1) return json({ data: [{ id: "unknown" }] })
    throw new Error("synthetic unavailable metadata")
  } })
  assert.equal(result.metadataOutcome, "unavailable")
  assert.equal(result.inputs[0].catalog.models[0].id, "unknown")
})

test("HTTP failure, redirect, oversized streams, wrong media and remaining-time abort are failures", async () => {
  const request = (fetchImpl, extra = {}) => requestJson(facts.modelsUrl, { fetchImpl, limit: 128, deadline: performance.now() + 1000, ...extra })
  for (const response of [json({}, { status: 401 }), json({}, { status: 302 }), new Response("{}"), json({}, { headers: { "content-type": "application/json", "content-length": "129" } }), json({ text: "x".repeat(200) })]) {
    await assert.rejects(request(async () => response), /bounded discovery/)
  }
  await assert.rejects(request(async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
  }), { deadline: performance.now() + 20 }), /bounded discovery/)
})

test("missing root fails, existing empty inventory succeeds; explicit snapshot is nonlive", async (t) => {
  const root = await fixture(t)
  await assert.rejects(discoverRuntimeModels(path.join(root, "missing")))
  const nonlive = await discoverRuntimeModels(root, { mode: "snapshot", fetchImpl: () => { throw new Error("must not fetch") } })
  assert.equal(nonlive.sourceOutcome, "snapshot-nonlive")
  assert.equal(nonlive.inputs[0].catalog.models[0].contextWindow, 9999)
  await rm(path.join(root, "models/providers/usai"), { recursive: true })
  const empty = await discoverRuntimeModels(root, { fetchImpl: () => { throw new Error("must not fetch") } })
  assert.deepEqual(empty.inputs, [])
  assert.equal(empty.sourceOutcome, "live")
  assert.equal(RUNTIME_LIMITS.totalMs, 45000)
})
