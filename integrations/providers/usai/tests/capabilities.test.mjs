// =============================================================================
// capabilities.test.mjs — source -> catalog -> neutral snapshot -> OpenCode
// render regressions for model capability metadata (reasoning, input
// modalities).
//
// The failure mode guarded here: a vision-capable model silently rendered as
// "unknown" (so the harness treats it as text-only) because a stage dropped the
// field, AND the opposite — a text-only or unknown model rendered as
// image-capable because a stage inferred or defaulted a value. Both directions
// are asserted at every stage. Offline only: no network, no gateway.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { INPUT_MODALITIES, bootstrapModelsFromBlock, describeDrift, parseBootstrapModels, shapeFromFeeds, validateCatalog } from "../scripts/build-catalog.mjs"
import { INPUT_MODALITIES as NORMALIZER_MODALITIES, normalizeCatalog } from "../../../isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs"
import { INPUT_MODALITIES as RENDERER_MODALITIES, renderProviderConfig } from "../../../isolation/acq-kits/opencode/files/home/opencode-config/render-provider-config.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ISOLATION = path.join(HERE, "../../../isolation")
const BUILD_SCRIPT = path.join(HERE, "../scripts/build-catalog.mjs")
const load = (file) => JSON.parse(readFileSync(path.join(HERE, "fixtures", file), "utf8"))
const schema = JSON.parse(readFileSync(path.join(HERE, "../catalog.schema.json"), "utf8"))

const FACTS = {
  schemaVersion: "acq-provider-facts/v1",
  providerId: "usai",
  apiProtocol: "openai-compatible",
  host: "api.gsa.usai.gov",
  baseUrl: "https://api.gsa.usai.gov/api/v1",
  modelsUrl: "https://api.gsa.usai.gov/api/v1/models",
  keyEnv: "USAI_API_KEY",
}

const feed = (...ids) => ids.map((id) => ({ id, object: "model", owned_by: id.startsWith("claude") ? "Anthropic" : "Other" }))

// Clone of the committed models.dev fixture with a chosen model's capabilities
// overwritten, so each case controls exactly one variable.
function modelsDevWith(modelName, patch) {
  const copy = structuredClone(load("models-dev.json"))
  for (const provider of Object.values(copy)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (id.includes(modelName)) Object.assign(model, structuredClone(patch))
    }
  }
  return copy
}

function renderedUsaiModels(catalogModels) {
  const source = {
    schemaVersion: "usai-model-catalog/v1",
    models: catalogModels,
  }
  const neutral = normalizeCatalog(source)
  return renderProviderConfig([{ facts: FACTS, catalog: neutral }]).provider.usai.models
}

function pipeline(feedList, modelsDev) {
  const { models, vendorOrder } = shapeFromFeeds(feedList, modelsDev, { includeCapabilities: true })
  const catalog = {
    schemaVersion: "usai-model-catalog/v1",
    gateway: { host: "api.gsa.usai.gov", baseUrl: "https://api.gsa.usai.gov/api/v1", api: "openai-completions", apiKeyEnv: "USAI_API_KEY" },
    vendors: vendorOrder.map((key, i) => ({ key, label: key, order: i + 1, usaiBackend: "" })),
    models,
  }
  assert.deepEqual(validateCatalog(catalog, schema), [])
  return renderedUsaiModels(models)
}

test("positive: an image-capable source model reaches the rendered OpenCode config", () => {
  const rendered = pipeline(feed("claude-sonnet-5"), load("models-dev.json"))
  assert.deepEqual(rendered["claude-sonnet-5"].modalities, { input: ["text", "image", "pdf"] })
  assert.equal(rendered["claude-sonnet-5"].reasoning, true)
})

test("negative: a known text-only source model renders as text-only, not as unknown or image-capable", () => {
  const rendered = pipeline(feed("claude-sonnet-5"), modelsDevWith("claude-sonnet-5", { modalities: { input: ["text"], output: ["text"] } }))
  assert.deepEqual(rendered["claude-sonnet-5"].modalities, { input: ["text"] })
})

test("known false is preserved: reasoning=false is rendered, not dropped", () => {
  const rendered = pipeline(feed("llama_4_maverick"), load("models-dev.json"))
  assert.equal(rendered.llama_4_maverick.reasoning, false)
  assert.deepEqual(rendered.llama_4_maverick.modalities, { input: ["text", "image"] })
})

test("unknown stays unknown: no models.dev match yields no capability fields at any stage", () => {
  // A name that sounds vision-capable must not influence the result.
  const rendered = pipeline(feed("claude_4_5_sonnet", "vision-pro-vl"), load("models-dev.json"))
  for (const id of ["claude_4_5_sonnet", "vision-pro-vl"]) {
    assert.equal("reasoning" in rendered[id], false, `${id} must not carry reasoning`)
    assert.equal("modalities" in rendered[id], false, `${id} must not carry modalities`)
  }
})

test("a matched model whose source omits capability fields stays unknown", () => {
  const stripped = structuredClone(load("models-dev.json"))
  for (const provider of Object.values(stripped)) {
    for (const model of Object.values(provider.models)) {
      delete model.modalities
      delete model.reasoning
    }
  }
  const rendered = pipeline(feed("claude-sonnet-5"), stripped)
  assert.equal("reasoning" in rendered["claude-sonnet-5"], false)
  assert.equal("modalities" in rendered["claude-sonnet-5"], false)
})

test("rendering emits no reasoning settings (effort, variants, thinking options); a harness may still derive variants from reasoning:true", () => {
  const rendered = pipeline(feed("claude-sonnet-5"), load("models-dev.json"))
  assert.deepEqual(
    Object.keys(rendered["claude-sonnet-5"]).sort(),
    ["cost", "limit", "modalities", "name", "reasoning"],
  )
})

// Capture stderr writes made while fn runs.
function captureStderr(fn) {
  const original = process.stderr.write
  const lines = []
  process.stderr.write = (chunk) => (lines.push(String(chunk)), true)
  try {
    return { result: fn(), stderr: lines.join("") }
  } finally {
    process.stderr.write = original
  }
}

test("capabilities are OPT-IN: by default a matched models.dev entry yields no capability fields", () => {
  const { models } = shapeFromFeeds(feed("claude-sonnet-5"), load("models-dev.json"))
  assert.equal("reasoning" in models[0], false)
  assert.equal("inputModalities" in models[0], false)
  assert.ok(models[0].cost, "cost enrichment is unaffected by the capability opt-in")
  const opted = shapeFromFeeds(feed("claude-sonnet-5"), load("models-dev.json"), { includeCapabilities: true }).models[0]
  assert.equal(opted.reasoning, true)
  assert.deepEqual(opted.inputModalities, ["text", "image", "pdf"])
})

test("CLI: live-feed output has no capabilities or provenance label by default, and a live --check passes against the committed catalog shape", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-cap-"))
  try {
    const run = (...extra) => spawnSync(process.execPath, [BUILD_SCRIPT, "--models-url", path.join(HERE, "fixtures/models-list.json"), "--models-dev", path.join(HERE, "fixtures/models-dev.json"), "--out", path.join(dir, "catalog.json"), ...extra], { encoding: "utf8" })
    assert.equal(run().status, 0)
    const plain = JSON.parse(readFileSync(path.join(dir, "catalog.json"), "utf8"))
    assert.equal(plain.models.some((m) => "reasoning" in m || "inputModalities" in m), false)
    assert.equal("capabilities" in plain.sources, false)
    // Same inputs, same output file: --check must be clean (no standing capability drift).
    assert.equal(run("--check").status, 0)
    // Opt-in changes the substantive content, so --check against the plain file reports drift by design.
    const optedCheck = run("--include-capabilities", "--check")
    assert.notEqual(optedCheck.status, 0)
    assert.match(optedCheck.stderr, /drifted/)
    assert.equal(run("--include-capabilities").status, 0)
    const opted = JSON.parse(readFileSync(path.join(dir, "catalog.json"), "utf8"))
    assert.ok(opted.models.some((m) => "inputModalities" in m))
    assert.match(opted.sources.capabilities, /not verified/)
    assert.notEqual(run("--include-capabilities", "--no-enrichment").status, 0, "opt-in without enrichment must fail, not silently emit nothing")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("malformed upstream capability data is treated as unknown with a warning, not a build abort", () => {
  const cases = [
    [{ reasoning: "yes" }, /reasoning is not a boolean/],
    [{ modalities: { input: ["text", "hologram"] } }, /unsupported modality/],
    [{ modalities: { input: [] } }, /non-empty/],
    [{ modalities: { input: ["text", "text"] } }, /duplicates/],
    [{ modalities: "image" }, /modalities is not an object/],
  ]
  for (const [patch, warning] of cases) {
    const { result, stderr } = captureStderr(() => shapeFromFeeds(feed("claude-sonnet-5"), modelsDevWith("claude-sonnet-5", patch), { includeCapabilities: true }))
    const model = result.models[0]
    assert.ok(model.cost, "the rest of the entry is still built")
    assert.match(stderr, warning)
    assert.match(stderr, /treated as unknown/)
    const field = "reasoning" in patch ? "reasoning" : "inputModalities"
    assert.equal(field in model, false, `${field} must be absent (unknown) after a malformed upstream value`)
  }
})

test("a summary line counts matched models with malformed capability data; none when clean", () => {
  const bad = captureStderr(() => shapeFromFeeds(feed("claude-sonnet-5"), modelsDevWith("claude-sonnet-5", { reasoning: "yes", modalities: "image" }), { includeCapabilities: true }))
  assert.match(bad.stderr, /^1 of 1 matched models had malformed capability data$/m)
  const clean = captureStderr(() => shapeFromFeeds(feed("claude-sonnet-5"), load("models-dev.json"), { includeCapabilities: true }))
  assert.doesNotMatch(clean.stderr, /malformed capability data/)
  assert.doesNotMatch(captureStderr(() => shapeFromFeeds(feed("claude-sonnet-5"), modelsDevWith("claude-sonnet-5", { reasoning: "yes" }))).stderr, /malformed capability data/)
})

test("CLI: --include-capabilities without a models URL, or with --bootstrap, exits non-zero with a clear error", () => {
  const run = (...args) => spawnSync(process.execPath, [BUILD_SCRIPT, "--check", ...args], { encoding: "utf8" })
  for (const args of [["--include-capabilities"], ["--include-capabilities", "--bootstrap"], ["--include-capabilities", "--bootstrap", "--models-url", path.join(HERE, "fixtures/models-list.json")]]) {
    const result = run(...args)
    assert.notEqual(result.status, 0, args.join(" "))
    assert.match(result.stderr, /--include-capabilities requires --models-url/)
  }
})

test("catalog validation rejects malformed capability fields", () => {
  const base = {
    schemaVersion: "usai-model-catalog/v1",
    gateway: { host: "h", baseUrl: "https://h/v1", api: "openai-completions", apiKeyEnv: "K" },
    vendors: [{ key: "anthropic", label: "A", order: 1, usaiBackend: "" }],
  }
  const withModel = (extra) => ({ ...base, models: [{ id: "m", vendor: "anthropic", name: "M", ...extra }] })
  assert.deepEqual(validateCatalog(withModel({ reasoning: false, inputModalities: ["text"] }), schema), [])
  assert.match(validateCatalog(withModel({ reasoning: "true" }), schema).join("\n"), /reasoning must be a boolean/)
  assert.match(validateCatalog(withModel({ inputModalities: ["image", "hologram"] }), schema).join("\n"), /inputModalities/)
  assert.match(validateCatalog(withModel({ inputModalities: [] }), schema).join("\n"), /inputModalities/)
})

test("bootstrap carries reasoning and modalities from an OpenCode-shaped block", () => {
  const block = `"gpt-x": {"name": "GPT X", "reasoning": true, "modalities": {"input": ["image", "text"]}, "limit": {"context": 10, "output": 5}},
    "plain": {"name": "Plain", "limit": {"context": 10, "output": 5}}`
  const { models } = bootstrapModelsFromBlock(parseBootstrapModels(block))
  const byId = Object.fromEntries(models.map((m) => [m.id, m]))
  assert.equal(byId["gpt-x"].reasoning, true)
  assert.deepEqual(byId["gpt-x"].inputModalities, ["text", "image"], "canonical order")
  assert.equal("reasoning" in byId.plain, false)
  assert.equal("inputModalities" in byId.plain, false)
})

test("bootstrap rejects malformed capability data in our own committed block", () => {
  const parse = (extra) => bootstrapModelsFromBlock(parseBootstrapModels(`"m": {"name": "M", "limit": {"context": 10, "output": 5}, ${extra}}`))
  assert.throws(() => parse('"modalities": "image"'), /modalities must be an object/)
  assert.throws(() => parse('"modalities": ["text"]'), /modalities must be an object/)
  assert.throws(() => parse('"modalities": null'), /modalities must be an object/)
  assert.throws(() => parse('"modalities": {"input": "image"}'), /non-empty array/)
  assert.throws(() => parse('"modalities": {"input": ["hologram"]}'), /unsupported modality/)
  assert.throws(() => parse('"reasoning": "true"'), /reasoning must be a boolean/)
})

test("capability changes are reported as drift", () => {
  const before = { models: [{ id: "m", name: "M" }] }
  const known = { models: [{ id: "m", name: "M", inputModalities: ["text", "image"] }] }
  assert.deepEqual(describeDrift(before, known), ["model changed: m"])
  assert.deepEqual(describeDrift(known, { models: [{ id: "m", name: "M", inputModalities: ["text"] }] }), ["model changed: m"])
})

test("the modality allowlist is identical in both schemas and the builder", () => {
  const neutral = JSON.parse(readFileSync(path.join(HERE, "../../../isolation/schemas/acq-neutral-model-catalog.schema.json"), "utf8"))
  const usai = schema.properties.models.items.properties.inputModalities.items.enum
  const shared = neutral.$defs.model.properties.inputModalities.items.enum
  assert.deepEqual(usai, INPUT_MODALITIES)
  assert.deepEqual(shared, INPUT_MODALITIES)
})

test("the three code copies of the modality allowlist (builder, normalizer, renderer) are equal", () => {
  assert.deepEqual([...NORMALIZER_MODALITIES], [...INPUT_MODALITIES])
  assert.deepEqual([...RENDERER_MODALITIES], [...INPUT_MODALITIES])
})

// A release reminder shaped "<YYYY-MM-DD>; opencode <version>", not any truthy
// string. It is catalog-wide, so it does NOT prove that any model, field, or
// modality was verified: that evidence lives in the data PR description and a
// committed evidence file (ADR 0006, "Evidence record"), checked by a reviewer.
// sources values are strings in the catalog schema, so the shape is a
// documented format (see the opencode kit's synthetic-image-validation.md).
const RELEASE_REMINDER = /^\d{4}-\d{2}-\d{2}; opencode v?\d+\.\d+\.\d+\S*$/

test("capabilitiesVerified release reminder must have the shape date; opencode version", () => {
  assert.match("2026-10-25; opencode 2.0.30", RELEASE_REMINDER)
  for (const bad of ["true", "yes", "verified", "2026-10-25", "opencode 2.0.30", ""]) {
    assert.doesNotMatch(bad, RELEASE_REMINDER)
  }
})

test("no committed catalog or snapshot carries capability claims without the release reminder", () => {
  // Capability data is only committed with per-model, per-field evidence (ADR
  // 0006). Until then every model is UNKNOWN. This guard is a tripwire only: it
  // fails loudly if values appear in ANY committed artifact while catalog.json
  // lacks the release-reminder string. It cannot verify the evidence itself;
  // the data-change review must.
  const artifacts = {
    "providers/usai/catalog.json": path.join(HERE, "../catalog.json"),
    "usai-provider shipped snapshot": path.join(ISOLATION, "acq-kits/usai-provider/files/home/usai-config/model-catalog-snapshot.json"),
    "schema fixture usai/snapshot.json": path.join(ISOLATION, "schemas/fixtures/usai/snapshot.json"),
    "schema fixture acme-ai/snapshot.json": path.join(ISOLATION, "schemas/fixtures/acme-ai/snapshot.json"),
  }
  const catalog = JSON.parse(readFileSync(artifacts["providers/usai/catalog.json"], "utf8"))
  const verified = catalog.sources?.capabilitiesVerified
  const hasReminder = typeof verified === "string" && RELEASE_REMINDER.test(verified)
  for (const [label, file] of Object.entries(artifacts)) {
    const data = JSON.parse(readFileSync(file, "utf8"))
    const populated = data.models.filter((m) => "reasoning" in m || "inputModalities" in m)
    if (populated.length > 0) {
      assert.ok(
        hasReminder,
        `${label}: ${populated.length} model(s) carry capability fields but catalog.json sources.capabilitiesVerified is not a "<date>; opencode <version>" release reminder`,
      )
    }
  }
})
