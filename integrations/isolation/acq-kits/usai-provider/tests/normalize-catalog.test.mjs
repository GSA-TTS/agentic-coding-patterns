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
