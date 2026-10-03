// =============================================================================
// catalog-check.test.mjs — the --check drift detector must fire on real drift
// and stay silent on provenance-only differences.
//
// Why this test exists: --check once compared the whole serialized catalog,
// including the `sources` block. `sources` records WHICH feed or file a given
// run read, so a live-feed regeneration and an offline bootstrap of byte-identical
// models disagree there by design. The result was a detector that failed on every
// offline run no matter what — and a drift check that always fires is one everyone
// learns to ignore, which is strictly worse than having none, because genuine
// model drift then looks exactly like the standing noise.
//
// Both directions are asserted here. A detector that never fires and a detector
// that always fires are equally useless, so neither half is optional.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { describeDrift, substantive } from "../scripts/build-catalog.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const CATALOG = path.join(USAI_DIR, "catalog.json")

/** Fresh parse per test so no case can mutate another's fixture. */
function loadCatalog() {
  return JSON.parse(readFileSync(CATALOG, "utf8"))
}

test("substantive() strips provenance and keeps rendered content", () => {
  const catalog = loadCatalog()
  const stripped = substantive(catalog)
  assert.equal("sources" in stripped, false, "sources must be excluded")
  for (const key of ["schemaVersion", "generatedBy", "gateway", "vendors", "models"]) {
    assert.ok(key in stripped, `${key} must be retained`)
  }
})

test("identical catalogs report no drift", () => {
  const drift = describeDrift(substantive(loadCatalog()), substantive(loadCatalog()))
  assert.deepEqual(drift, [])
})

test("a sources-only difference is NOT drift", () => {
  // The exact false positive this test guards: same models, different provenance.
  const live = loadCatalog()
  live.sources = { modelsList: "https://api.gsa.usai.gov/api/v1/models", enrichment: "(none)" }
  const bootstrapped = loadCatalog()
  bootstrapped.sources = { bootstrappedFrom: "integrations/.../opencode.jsonc" }

  const drift = describeDrift(substantive(live), substantive(bootstrapped))
  assert.deepEqual(drift, [], "provenance metadata must not count as drift")
})

test("a removed model IS drift, and is named", () => {
  const before = loadCatalog()
  const after = loadCatalog()
  const dropped = after.models.pop().id

  const drift = describeDrift(substantive(before), substantive(after))
  assert.equal(drift.length, 1)
  assert.match(drift[0], /^models removed: /)
  assert.ok(drift[0].includes(dropped), "the dropped id must be named, not just counted")
})

test("an added model IS drift, and is named", () => {
  const before = loadCatalog()
  const after = loadCatalog()
  after.models.push({
    id: "zz-probe-model",
    vendor: "other",
    name: "ZZ Probe",
    contextWindow: 1000,
    maxOutputTokens: 100,
    cost: { input: 0, output: 0 },
  })

  const drift = describeDrift(substantive(before), substantive(after))
  assert.equal(drift.length, 1)
  assert.match(drift[0], /^models added: zz-probe-model$/)
})

test("a changed model field IS drift, and names the model", () => {
  const before = loadCatalog()
  const after = loadCatalog()
  const target = after.models[0]
  target.contextWindow = (target.contextWindow || 0) + 1

  const drift = describeDrift(substantive(before), substantive(after))
  assert.deepEqual(drift, [`model changed: ${target.id}`])
})

test("gateway and vendor changes ARE drift", () => {
  const before = loadCatalog()

  const gatewayChanged = loadCatalog()
  gatewayChanged.gateway = { ...gatewayChanged.gateway, baseUrl: "https://example.invalid/v1" }
  assert.deepEqual(describeDrift(substantive(before), substantive(gatewayChanged)), [
    "gateway block changed",
  ])

  const vendorsChanged = loadCatalog()
  vendorsChanged.vendors = vendorsChanged.vendors.slice(0, -1)
  assert.deepEqual(describeDrift(substantive(before), substantive(vendorsChanged)), [
    "vendors block changed",
  ])
})

test("schemaVersion drift is reported with both values", () => {
  const before = loadCatalog()
  const after = loadCatalog()
  after.schemaVersion = "usai-model-catalog/v2"

  const drift = describeDrift(substantive(before), substantive(after))
  assert.equal(drift.length, 1)
  assert.match(drift[0], /schemaVersion: .*v1.* -> .*v2/)
})

test("multiple simultaneous drifts are all reported", () => {
  const before = loadCatalog()
  const after = loadCatalog()
  const dropped = after.models.pop().id
  after.models[0] = { ...after.models[0], contextWindow: 123 }

  const drift = describeDrift(substantive(before), substantive(after))
  assert.equal(drift.length, 2, "a caller fixing drift needs every cause, not the first")
  assert.ok(drift.some((l) => l.includes(dropped)))
  assert.ok(drift.some((l) => l.startsWith("model changed: ")))
})
