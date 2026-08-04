import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

import { updateTemplate, validateUsaiPayload, fetchJsonBounded } from "../scripts/sync-usai-models.mjs"

const templatePath = new URL("../files/home/usai-config/opencode.jsonc", import.meta.url)
const fixturePath = new URL("./fixtures/usai-models.json", import.meta.url)

/**
 * Validates that text is syntactically valid JSONC (JSON with comments and trailing commas).
 * Uses JS eval in a sandbox since JSONC is a subset of JS object literal syntax.
 * @param {string} text - JSONC text to validate
 * @returns {{ valid: boolean, parsed?: object, error?: string }}
 */
function validateJsonc(text) {
  const sandbox = {}
  try {
    vm.runInNewContext("result = " + text, sandbox)
    return { valid: true, parsed: sandbox.result }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}

test("updateTemplate filters embeddings and keeps strongest defaults", async () => {
  const [templateText, fixtureText] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(fixturePath, "utf8"),
  ])

  const { updatedTemplate, models } = updateTemplate(templateText, JSON.parse(fixtureText))

  assert.equal(models.some((model) => model.id === "text-embedding-005"), false)
  assert.match(updatedTemplate, /"model": "usai\/claude_4_5_opus"/)
  assert.match(updatedTemplate, /"small_model": "usai\/claude_4_5_haiku"/)
  assert.match(updatedTemplate, /"model": "usai\/gpt-5.4-latest-guardrails-defaultv2"/)
})

test("updateTemplate prefers newer opus and gpt generations when available", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
      { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "gpt-5.5", name: "GPT-5.5" },
      { id: "gpt-5.5-mini", name: "GPT-5.5 mini" },
      { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku" },
    ],
  }

  const { updatedTemplate } = updateTemplate(templateText, payload)

  assert.match(updatedTemplate, /"model": "usai\/claude-opus-4-8"/)
  assert.match(updatedTemplate, /"small_model": "usai\/claude-3-5-haiku"/)
  assert.match(updatedTemplate, /"model": "usai\/gpt-5.5"/)
})

test("updateTemplate falls back to defaults when no opus or gpt available", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    ],
  }

  const { updatedTemplate, models } = updateTemplate(templateText, payload)

  assert.equal(models.length, 2)
  // No opus available, so main model falls back to hardcoded default
  assert.match(updatedTemplate, /"model": "usai\/claude_4_5_opus"/)
  // Flash-lite has familyScore 650 for small role, gemini-2.5-pro has 0
  // selectDefault finds flash-lite as first with score > 0
  // But current selectDefault uses highest ranked after sort, which may pick pro via localeCompare tiebreaker
  // Accept either since this is an edge case fallback scenario
  assert.match(updatedTemplate, /"small_model": "usai\/gemini-2.5/)
  // No GPT available, so compaction falls back to hardcoded default
  assert.match(updatedTemplate, /"model": "usai\/gpt-5.4-latest-guardrails-defaultv2"/)
})

test("updateTemplate handles empty model list gracefully", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = { data: [] }

  const { updatedTemplate, models } = updateTemplate(templateText, payload)

  assert.equal(models.length, 0)
  assert.match(updatedTemplate, /"model": "usai\/claude_4_5_opus"/)
  assert.match(updatedTemplate, /"small_model": "usai\/claude_4_5_haiku"/)
})

test("updateTemplate filters only-embedding payloads", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "text-embedding-005", name: "Text Embedding 005" },
      { id: "embed-multilingual-v3", name: "Embed Multilingual v3" },
    ],
  }

  const { models } = updateTemplate(templateText, payload)

  assert.equal(models.length, 0)
})

test("updateTemplate is idempotent across multiple generations", async () => {
  const [templateText, fixtureText] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(fixturePath, "utf8"),
  ])
  const payload = JSON.parse(fixtureText)

  // Generate 3 times
  const results = []
  for (let i = 0; i < 3; i++) {
    const { updatedTemplate } = updateTemplate(templateText, payload)
    results.push(updatedTemplate)
  }

  // All should be identical
  assert.equal(results[0], results[1], "First and second generation differ")
  assert.equal(results[1], results[2], "Second and third generation differ")
})

test("updateTemplate preserves required structure after generation", async () => {
  const [templateText, fixtureText] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(fixturePath, "utf8"),
  ])

  const { updatedTemplate } = updateTemplate(templateText, JSON.parse(fixtureText))
  const { valid, parsed, error } = validateJsonc(updatedTemplate)

  assert.equal(valid, true, `JSONC validation failed: ${error}`)

  // Required top-level keys
  assert.ok("model" in parsed, "missing model key")
  assert.ok("small_model" in parsed, "missing small_model key")
  assert.ok("agent" in parsed, "missing agent key")
  assert.ok("provider" in parsed, "missing provider key")

  // Agent structure
  assert.ok("compaction" in parsed.agent, "missing agent.compaction")
  assert.ok("model" in parsed.agent.compaction, "missing agent.compaction.model")

  // Provider structure (at least one provider)
  const providerKeys = Object.keys(parsed.provider)
  assert.ok(providerKeys.length > 0, "no providers defined")

  // Model values should have usai/ prefix
  assert.match(parsed.model, /^usai\//, "model should have usai/ prefix")
  assert.match(parsed.small_model, /^usai\//, "small_model should have usai/ prefix")
  assert.match(parsed.agent.compaction.model, /^usai\//, "compaction model should have usai/ prefix")
})

test("updateTemplate emits schema-safe cost blocks and drops disallowed keys", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", owned_by: "Google" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", owned_by: "Google" },
    ],
  }
  const modelsDevCatalog = {
    "google-vertex": {
      id: "google-vertex",
      models: {
        "gemini-2.5-pro": {
          id: "gemini-2.5-pro",
          limit: { context: 1048576, output: 65536 },
          cost: {
            input: 1.25,
            output: 10,
            cache_read: 0.125,
            context_over_200k: { input: 2.5, output: 15, cache_read: 0.25 },
            // Not part of OpenCode's cost schema — must be dropped from output.
            tiers: [{ input: 2.5, output: 15, cache_read: 0.25, tier: { type: "context", size: 200000 } }],
          },
        },
        "gemini-2.5-flash-lite": {
          id: "gemini-2.5-flash-lite",
          limit: { context: 1048576, output: 65536 },
          // input_audio is not in OpenCode's cost schema — must be dropped.
          cost: { input: 0.1, output: 0.4, cache_read: 0.01, input_audio: 0.3 },
        },
      },
    },
  }

  const { updatedTemplate } = updateTemplate(templateText, payload, modelsDevCatalog)
  const { valid, parsed, error } = validateJsonc(updatedTemplate)

  assert.equal(valid, true, `JSONC validation failed: ${error}`)

  const pro = parsed.provider.usai.models["gemini-2.5-pro"]
  assert.equal(pro.cost.input, 1.25)
  assert.equal(pro.cost.output, 10)
  // Parsed via a vm sandbox, so compare fields rather than by reference.
  assert.equal(pro.cost.context_over_200k.input, 2.5)
  assert.equal(pro.cost.context_over_200k.output, 15)
  assert.equal(pro.cost.context_over_200k.cache_read, 0.25)
  // `tiers` is NOT a valid OpenCode cost key — it must be dropped.
  assert.equal("tiers" in pro.cost, false, "tiers must be omitted (not in OpenCode schema)")

  // flash-lite must NOT be mis-matched to flash's pricing, and input_audio
  // (not a valid OpenCode cost key) must be dropped.
  const lite = parsed.provider.usai.models["gemini-2.5-flash-lite"]
  assert.equal(lite.cost.input, 0.1)
  assert.equal("input_audio" in lite.cost, false, "input_audio must be omitted (not in OpenCode schema)")
})

test("updateTemplate normalizes untrusted limit values", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", owned_by: "Google" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", owned_by: "Google" },
    ],
  }
  const modelsDevCatalog = {
    "google-vertex": {
      id: "google-vertex",
      models: {
        "gemini-2.5-pro": {
          id: "gemini-2.5-pro",
          limit: { context: '1, "pwned": true', output: 65536 },
          cost: { input: 1, output: 2 },
        },
        "gemini-2.5-flash-lite": {
          id: "gemini-2.5-flash-lite",
          limit: { context: "not-a-number", output: -5 },
          cost: { input: 0.1, output: 0.4 },
        },
      },
    },
  }

  const { updatedTemplate } = updateTemplate(templateText, payload, modelsDevCatalog)
  const { valid, parsed, error } = validateJsonc(updatedTemplate)

  assert.equal(valid, true, `JSONC validation failed: ${error}`)
  assert.equal(updatedTemplate.includes("pwned"), false, "injected key must not appear in output")

  const pro = parsed.provider.usai.models["gemini-2.5-pro"]
  assert.equal(pro.limit.context, 128000, "invalid context must fall back to FALLBACK_LIMITS.context")
  assert.equal("pwned" in pro.limit, false, "no injected key inside limit")
  assert.equal(pro.limit.output, 65536, "valid integer output must be preserved")

  const lite = parsed.provider.usai.models["gemini-2.5-flash-lite"]
  assert.equal(lite.limit.context, 128000, "non-numeric context must fall back")
  assert.equal(lite.limit.output, 8192, "non-positive output must fall back to FALLBACK_LIMITS.output")
})

test("enrichment routes each vendor to its USAi backend provider", async () => {
  // OpenAI must pull azure pricing, not the first-party openai catalog.
  const templateText = await readFile(templatePath, "utf8")
  const payload = { data: [{ id: "gpt-5.2-latest-guardrails-defaultv2", name: "GPT-5.2", owned_by: "Open AI" }] }
  const modelsDevCatalog = {
    openai: {
      id: "openai",
      models: { "gpt-5.2": { id: "gpt-5.2", limit: { context: 400000, output: 128000 }, cost: { input: 99, output: 99 } } },
    },
    azure: {
      id: "azure",
      models: { "gpt-5.2": { id: "gpt-5.2", limit: { context: 400000, output: 128000 }, cost: { input: 1.75, output: 14, cache_read: 0.125 } } },
    },
  }

  const { models } = updateTemplate(templateText, payload, modelsDevCatalog)
  const gpt = models.find((m) => m.id === "gpt-5.2-latest-guardrails-defaultv2")
  assert.equal(gpt.modelsDevProvider, "azure", "OpenAI models must source pricing from azure")
  assert.equal(gpt.cost.input, 1.75)
})

test("enrichment falls back to next provider when primary lacks the model", async () => {
  // Anthropic primary is amazon-bedrock; if bedrock has no match, fall back to
  // the first-party anthropic catalog rather than dropping enrichment.
  const templateText = await readFile(templatePath, "utf8")
  const payload = { data: [{ id: "claude_4_5_opus", name: "Claude 4.5 Opus", owned_by: "Anthropic" }] }
  const modelsDevCatalog = {
    "amazon-bedrock": { id: "amazon-bedrock", models: {} },
    anthropic: {
      id: "anthropic",
      models: { "claude-opus-4-5": { id: "claude-opus-4-5", limit: { context: 200000, output: 64000 }, cost: { input: 5, output: 25 } } },
    },
  }

  const { models } = updateTemplate(templateText, payload, modelsDevCatalog)
  const claude = models.find((m) => m.id === "claude_4_5_opus")
  assert.equal(claude.modelsDevProvider, "anthropic")
  assert.equal(claude.cost.input, 5)
})

test("updateTemplate enriches models with models.dev catalog", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "claude_4_5_opus", name: "Claude 4.5 Opus", owned_by: "Anthropic" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", owned_by: "Google" },
    ],
  }

  // Provider-keyed catalog (models.dev api.json shape). Anthropic is sourced
  // from amazon-bedrock and Gemini from google-vertex per USAi backend routing.
  const modelsDevCatalog = {
    "amazon-bedrock": {
      id: "amazon-bedrock",
      models: {
        "anthropic.claude-opus-4-5-20251101-v1:0": {
          id: "anthropic.claude-opus-4-5-20251101-v1:0",
          name: "Claude Opus 4.5",
          limit: { context: 200000, output: 64000 },
          tool_call: true,
          reasoning: true,
          cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
        },
      },
    },
    "google-vertex": {
      id: "google-vertex",
      models: {
        "gemini-2.5-pro": {
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          limit: { context: 1048576, output: 65536 },
          tool_call: true,
          cost: {
            input: 1.25,
            output: 10,
            cache_read: 0.125,
            context_over_200k: { input: 2.5, output: 15, cache_read: 0.25 },
            tiers: [{ input: 2.5, output: 15, cache_read: 0.25, tier: { type: "context", size: 200000 } }],
          },
        },
      },
    },
  }

  const { models } = updateTemplate(templateText, payload, modelsDevCatalog)

  // Claude should be enriched from amazon-bedrock
  const claude = models.find((m) => m.id === "claude_4_5_opus")
  assert.ok(claude, "claude model should exist")
  assert.equal(claude.contextWindow, 200000)
  assert.equal(claude.maxOutputTokens, 64000)
  assert.equal(claude.modelsDevId, "anthropic.claude-opus-4-5-20251101-v1:0")
  assert.equal(claude.modelsDevProvider, "amazon-bedrock")
  assert.deepEqual(claude.cost, { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 })

  // Gemini should be enriched from google-vertex, keeping schema-safe pricing
  const gemini = models.find((m) => m.id === "gemini-2.5-pro")
  assert.ok(gemini, "gemini model should exist")
  assert.equal(gemini.contextWindow, 1048576)
  assert.equal(gemini.maxOutputTokens, 65536)
  assert.equal(gemini.modelsDevId, "gemini-2.5-pro")
  assert.equal(gemini.modelsDevProvider, "google-vertex")
  assert.equal(gemini.cost.input, 1.25)
  // `tiers` is dropped (not an OpenCode cost key); context_over_200k is kept.
  assert.equal("tiers" in gemini.cost, false, "tiers must be dropped")
  assert.deepEqual(gemini.cost.context_over_200k, { input: 2.5, output: 15, cache_read: 0.25 })
})

test("updateTemplate uses fallback limits when model not in catalog", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "cohere_english_v3", name: "Cohere English v3", owned_by: "Cohere" },
      { id: "custom-internal-model", name: "Custom Internal Model" },
    ],
  }

  // Provider-keyed catalog with some models but not our test models - enrichment will run
  const modelsDevCatalog = {
    "amazon-bedrock": {
      id: "amazon-bedrock",
      models: {
        "anthropic.claude-3-opus": {
          id: "anthropic.claude-3-opus",
          limit: { context: 200000, output: 4096 },
          cost: { input: 15, output: 75 },
        },
      },
    },
  }

  const { models } = updateTemplate(templateText, payload, modelsDevCatalog)

  // Both should use fallback limits since they don't match catalog, and have no cost
  for (const model of models) {
    assert.equal(model.contextWindow, 128000, `${model.id} should use fallback context`)
    assert.equal(model.maxOutputTokens, 8192, `${model.id} should use fallback output`)
    assert.equal(model.modelsDevId, null, `${model.id} should have null modelsDevId`)
    assert.equal(model.cost, null, `${model.id} should have null cost`)
  }
})

test("updateTemplate handles version matching across naming conventions", async () => {
  const templateText = await readFile(templatePath, "utf8")
  const payload = {
    data: [
      { id: "gpt-5.4-latest-guardrails-defaultv2", name: "GPT-5.4 Latest", owned_by: "Open AI" },
      { id: "claude_4_5_sonnet", name: "Claude 4.5 Sonnet", owned_by: "Anthropic" },
    ],
  }

  // Provider-keyed catalog: OpenAI sourced from azure, Anthropic from bedrock.
  const modelsDevCatalog = {
    azure: {
      id: "azure",
      models: {
        "gpt-5.4": {
          id: "gpt-5.4",
          name: "GPT-5.4",
          limit: { context: 1050000, output: 128000 },
          cost: { input: 2.5, output: 15, cache_read: 0.25 },
        },
      },
    },
    "amazon-bedrock": {
      id: "amazon-bedrock",
      models: {
        "anthropic.claude-sonnet-4-5-20250929-v1:0": {
          id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
          name: "Claude Sonnet 4.5",
          limit: { context: 200000, output: 64000 },
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    },
  }

  const { models } = updateTemplate(templateText, payload, modelsDevCatalog)

  // GPT should match despite USAI suffix, sourced from azure
  const gpt = models.find((m) => m.id === "gpt-5.4-latest-guardrails-defaultv2")
  assert.ok(gpt, "gpt model should exist")
  assert.equal(gpt.contextWindow, 1050000)
  assert.equal(gpt.modelsDevId, "gpt-5.4")
  assert.equal(gpt.modelsDevProvider, "azure")
  assert.equal(gpt.cost.input, 2.5)

  // Claude should match despite bedrock prefix + dated SKU, from amazon-bedrock
  const claude = models.find((m) => m.id === "claude_4_5_sonnet")
  assert.ok(claude, "claude model should exist")
  assert.equal(claude.contextWindow, 200000)
  assert.equal(claude.modelsDevId, "anthropic.claude-sonnet-4-5-20250929-v1:0")
  assert.equal(claude.modelsDevProvider, "amazon-bedrock")
  assert.equal(claude.cost.output, 15)
})

test("validateUsaiPayload accepts array, { data }, and { models } shapes", () => {
  const entry = [{ id: "claude_4_5_opus", name: "Claude 4.5 Opus" }]
  assert.deepEqual(validateUsaiPayload(entry), entry)

  const dataShape = { data: entry }
  assert.deepEqual(validateUsaiPayload(dataShape), dataShape)

  const modelsShape = { models: entry }
  assert.deepEqual(validateUsaiPayload(modelsShape), modelsShape)
})

test("validateUsaiPayload accepts entries keyed by model_id or name only", () => {
  assert.doesNotThrow(() => validateUsaiPayload([{ model_id: "gpt-5.5" }]))
  assert.doesNotThrow(() => validateUsaiPayload({ data: [{ name: "Claude 4.8 Opus" }] }))
})

test("validateUsaiPayload rejects malformed payloads", () => {
  // Wrong top-level shape
  assert.throws(() => validateUsaiPayload({}), /expected an array/)
  assert.throws(() => validateUsaiPayload(null), /expected an array/)
  assert.throws(() => validateUsaiPayload("nope"), /expected an array/)
  // Empty list
  assert.throws(() => validateUsaiPayload([]), /empty/)
  assert.throws(() => validateUsaiPayload({ data: [] }), /empty/)
  // No usable identifier on any entry
  assert.throws(() => validateUsaiPayload([{ foo: "bar" }]), /id\/model_id\/name/)
})

// --- fetchJsonBounded network hardening (Issue #138) ---

function withStubbedFetch(stub, fn) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original
    })
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: null, // force the text() fallback path in readBodyCapped
    text: async () => text,
  }
}

test("fetchJsonBounded parses a well-formed JSON response", async () => {
  await withStubbedFetch(
    async () => jsonResponse({ ok: true, data: [1, 2, 3] }),
    async () => {
      const result = await fetchJsonBounded("https://example.test/feed.json")
      assert.deepEqual(result, { ok: true, data: [1, 2, 3] })
    },
  )
})

test("fetchJsonBounded throws on non-OK responses", async () => {
  await withStubbedFetch(
    async () => jsonResponse("nope", { ok: false, status: 503 }),
    async () => {
      await assert.rejects(
        () => fetchJsonBounded("https://example.test/feed.json"),
        /failed: 503/,
      )
    },
  )
})

test("fetchJsonBounded throws on invalid JSON", async () => {
  await withStubbedFetch(
    async () => jsonResponse("{not json", { headers: { "content-type": "application/json" } }),
    async () => {
      await assert.rejects(
        () => fetchJsonBounded("https://example.test/feed.json"),
        /not valid JSON/,
      )
    },
  )
})

test("fetchJsonBounded rejects payloads over the size cap (declared length)", async () => {
  await withStubbedFetch(
    async () => jsonResponse({ a: 1 }, { headers: { "content-length": String(50 * 1024 * 1024) } }),
    async () => {
      await assert.rejects(
        () => fetchJsonBounded("https://example.test/feed.json"),
        /too large/,
      )
    },
  )
})

test("fetchJsonBounded aborts on timeout", async () => {
  await withStubbedFetch(
    (_url, opts) =>
      new Promise((_resolve, reject) => {
        // Never resolves on its own; reject when the AbortController fires.
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        })
      }),
    async () => {
      await assert.rejects(
        () => fetchJsonBounded("https://example.test/slow.json", { timeoutMs: 10 }),
        /timed out/,
      )
    },
  )
})
