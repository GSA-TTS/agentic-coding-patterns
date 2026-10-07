import test from "node:test"
import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { normalizeCatalog } from "../scripts/normalize-catalog.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(__dirname, "fixtures/normalize-catalog-source.json")

test("normalizeCatalog emits the acq-neutral-model-catalog/v1 envelope", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const neutral = normalizeCatalog(source)

  assert.equal(neutral.schemaVersion, "acq-neutral-model-catalog/v1")
  assert.equal(neutral.providerId, "usai")
  assert.equal(neutral.models.length, 4)
})

test("normalizeCatalog reuses the source field names verbatim (contextWindow, maxOutputTokens, cost.*)", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const { models } = normalizeCatalog(source)

  const alpha = models.find((m) => m.id === "fake-model-alpha")
  assert.ok(alpha, "fake-model-alpha should be present")
  assert.equal(alpha.contextWindow, 200000)
  assert.equal(alpha.maxOutputTokens, 64000)
  assert.deepEqual(alpha.cost, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 })
})

test("normalizeCatalog passes cost through UNCHANGED (per-million-token, no /1e6 transform)", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const { models } = normalizeCatalog(source)

  const beta = models.find((m) => m.id === "fake-model-beta")
  // Source values are per-million-token (see catalog.schema.json's cost
  // $def description); this asserts the normalizer does not scale them.
  assert.equal(beta.cost.input, 1.75)
  assert.equal(beta.cost.output, 14)
  assert.equal(beta.cost.cacheRead, 0.125)
})

test("normalizeCatalog drops fields not modeled by the neutral v1 shape (vendor, name, costAbove200kContext)", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const { models } = normalizeCatalog(source)

  const beta = models.find((m) => m.id === "fake-model-beta")
  assert.equal("vendor" in beta, false, "vendor must be dropped")
  assert.equal("name" in beta, false, "name must be dropped")
  assert.equal("costAbove200kContext" in beta, false, "costAbove200kContext must be dropped (not in neutral v1 shape)")
})

test("normalizeCatalog omits cost entirely for a model with no cost data", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const { models } = normalizeCatalog(source)

  const gamma = models.find((m) => m.id === "fake-model-gamma")
  assert.ok(gamma, "fake-model-gamma should be present")
  assert.equal("cost" in gamma, false, "cost must be omitted when the source has none")
  assert.equal(gamma.contextWindow, 1000000)
  assert.equal(gamma.maxOutputTokens, 128000)
})

test("normalizeCatalog only copies the four known cost scalar keys, no cacheWrite when absent", async () => {
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  const { models } = normalizeCatalog(source)

  const delta = models.find((m) => m.id === "fake-model-delta")
  assert.deepEqual(delta.cost, { input: 0.0375, output: 0.15 })
  assert.equal("cacheRead" in delta.cost, false)
  assert.equal("cacheWrite" in delta.cost, false)
})

test("normalizeCatalog throws a clear error when the source has no models[] array", () => {
  assert.throws(() => normalizeCatalog({ schemaVersion: "usai-model-catalog/v1" }), /models\[\]/)
  assert.throws(() => normalizeCatalog(null), /models\[\]/)
})

test("normalizeCatalog rejects malformed model records with actionable errors", () => {
  const cases = [
    [[null], /models\[0\] must be an object \(got null\)/],
    [["gpt"], /models\[0\] must be an object \(got "gpt"\)/],
    [[{}], /models\[0\]\.id must be a non-empty string \(got undefined\)/],
    [[{ id: "" }], /models\[0\]\.id must be a non-empty string \(got ""\)/],
    [[{ id: 123 }], /models\[0\]\.id must be a non-empty string \(got 123\)/],
    [[{ id: "model", contextWindow: -5 }], /models\[0\]\.contextWindow must be a positive integer/],
    [[{ id: "model", contextWindow: 1.5 }], /models\[0\]\.contextWindow must be a positive integer/],
    [[{ id: "model", contextWindow: Infinity }], /models\[0\]\.contextWindow must be a positive integer/],
    [[{ id: "model", contextWindow: null }], /models\[0\]\.contextWindow must be a positive integer/],
    [[{ id: "model", maxOutputTokens: 0 }], /models\[0\]\.maxOutputTokens must be a positive integer/],
    [[{ id: "model", maxOutputTokens: 2.5 }], /models\[0\]\.maxOutputTokens must be a positive integer/],
    [[{ id: "model", maxOutputTokens: "64000" }], /models\[0\]\.maxOutputTokens must be a positive integer/],
    [[{ id: "model", cost: null }], /models\[0\]\.cost must be an object \(got null\)/],
    [[{ id: "model", cost: "free" }], /models\[0\]\.cost must be an object \(got "free"\)/],
    [[{ id: "model", cost: [] }], /models\[0\]\.cost must be an object \(got \[\]\)/],
    [[{ id: "model", cost: { input: -1 } }], /models\[0\]\.cost\.input must be a non-negative finite number/],
    [[{ id: "model", cost: { output: Infinity } }], /models\[0\]\.cost\.output must be a non-negative finite number/],
  ]

  for (const [models, expected] of cases) {
    assert.throws(() => normalizeCatalog({ models }), expected)
  }
})

test("normalizeCatalog accepts omitted optional metadata, zero prices, and unknown cost keys", () => {
  assert.deepEqual(normalizeCatalog({ models: [{ id: "bare" }] }).models, [{ id: "bare" }])
  assert.deepEqual(normalizeCatalog({ models: [] }).models, [])
  assert.deepEqual(
    normalizeCatalog({ models: [{ id: "free", cost: { input: 0, unknown: "ignored" } }] }).models,
    [{ id: "free", cost: { input: 0 } }],
  )
})

test("CLI: reads --source and writes --out, producing valid JSON matching normalizeCatalog", async () => {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const execFileAsync = promisify(execFile)

  const scriptPath = path.join(__dirname, "../scripts/normalize-catalog.mjs")
  const outPath = path.join(__dirname, "output/normalize-catalog-cli-test.json")

  await execFileAsync("node", [scriptPath, "--source", fixturePath, "--out", outPath])

  const written = JSON.parse(await readFile(outPath, "utf8"))
  const source = JSON.parse(await readFile(fixturePath, "utf8"))
  assert.deepEqual(written, normalizeCatalog(source))

  await rm(path.dirname(outPath), { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Drift gate for the SHIPPED snapshot.
//
// The snapshot at files/home/usai-config/model-catalog-snapshot.json is a
// hand-trimmed SUBSET of the full USAi catalog (a handful of models, so the
// payload stays small), but every entry it keeps must be byte-equal to what
// this normalizer produces from integrations/providers/usai/catalog.json.
// Without this, the snapshot is a second hand-maintained copy that can silently
// drift from its stated source -- exactly the drift this repo has been bitten by
// before. A subset is allowed; a DIVERGENT subset is not.
// ---------------------------------------------------------------------------

const snapshotPath = path.join(
  __dirname,
  "../files/home/usai-config/model-catalog-snapshot.json",
)
const upstreamCatalogPath = path.join(
  __dirname,
  "../../../../providers/usai/catalog.json",
)

test("shipped snapshot: every model matches normalizeCatalog(upstream catalog) exactly", async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"))
  const upstream = JSON.parse(await readFile(upstreamCatalogPath, "utf8"))
  const regenerated = normalizeCatalog(upstream)

  // Guard the gate itself: if either side is empty the comparison below would
  // pass vacuously, which is the "no evidence read as a pass" defect. Assert
  // there is something to compare BEFORE comparing.
  assert.ok(
    Array.isArray(snapshot.models) && snapshot.models.length > 0,
    "snapshot has no models[] -- nothing to compare, so this gate cannot pass",
  )
  assert.ok(
    Array.isArray(regenerated.models) && regenerated.models.length > 0,
    "normalizer produced no models[] from the upstream catalog -- gate cannot pass",
  )

  const byId = new Map(regenerated.models.map((m) => [m.id, m]))
  for (const model of snapshot.models) {
    const fresh = byId.get(model.id)
    assert.ok(
      fresh,
      `snapshot model '${model.id}' is absent from the upstream catalog -- ` +
        `regenerate the snapshot with scripts/normalize-catalog.mjs`,
    )
    assert.deepEqual(
      model,
      fresh,
      `snapshot model '${model.id}' has drifted from the normalizer output -- ` +
        `regenerate rather than hand-editing`,
    )
  }
})

test("shipped snapshot: envelope matches the normalizer and carries no credential or routing fields", async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"))

  assert.equal(snapshot.schemaVersion, "acq-neutral-model-catalog/v1")
  assert.equal(snapshot.providerId, "usai")

  // The snapshot ships to an AGENT-OWNED path (/home/agent/...), so it must
  // carry model metadata only. A routing or credential field here would let a
  // rewritten snapshot redirect a consumer -- the trust defect this kit's
  // removed facts file had. Assert the shape stays metadata-only.
  const forbidden = ["host", "baseUrl", "modelsUrl", "keyEnv", "apiKey"]
  for (const key of forbidden) {
    assert.ok(
      !(key in snapshot),
      `snapshot must not carry the routing/credential field '${key}'`,
    )
    for (const model of snapshot.models) {
      assert.ok(
        !(key in model),
        `snapshot model '${model.id}' must not carry '${key}'`,
      )
    }
  }
})
