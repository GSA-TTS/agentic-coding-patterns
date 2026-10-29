// =============================================================================
// recommendations.test.mjs — the catalog's role defaults (`recommendations`) are
// curated by a human, not derived from the feeds. A regeneration must keep them,
// validate them, and fail closed rather than drop or re-pick one.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  carryForwardRecommendations,
  describeDrift,
  serialize,
  substantive,
  validateCatalog,
} from "../scripts/build-catalog.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const BUILD = path.join(USAI_DIR, "scripts/build-catalog.mjs")
const CATALOG = path.join(USAI_DIR, "catalog.json")
const MODELS_LIST = path.join(HERE, "fixtures/models-list.json")
const MODELS_DEV = path.join(HERE, "fixtures/models-dev.json")
const schema = JSON.parse(readFileSync(path.join(USAI_DIR, "catalog.schema.json"), "utf8"))

const loadCatalog = () => JSON.parse(readFileSync(CATALOG, "utf8"))

function withRecommendations(recommendations) {
  return { ...loadCatalog(), recommendations }
}

function refresh(outPath, ...extra) {
  return spawnSync(
    process.execPath,
    [BUILD, "--models-url", MODELS_LIST, "--models-dev", MODELS_DEV, "--out", outPath, ...extra],
    { encoding: "utf8" },
  )
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-rec-"))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Role ids that exist in the offline fixture feed, so a fixture refresh can
// keep them.
const FIXTURE_ROLES = {
  primary: "claude-sonnet-5",
  small: "claude_4_5_haiku",
  compaction: "gpt_5_4_default_v2",
  summary: "gpt_5_2_default_v2",
  title: "gpt_5_2_default_v2",
}

test("re-serializing the committed catalog is byte-identical", () => {
  const raw = readFileSync(CATALOG, "utf8")
  assert.equal(serialize(JSON.parse(raw)), raw)
})

test("recommendations serialize in the fixed role order", () => {
  const shuffled = withRecommendations({ title: "a", summary: "b", compaction: "c", small: "d", primary: "e" })
  const keys = Object.keys(JSON.parse(serialize(shuffled)).recommendations)
  assert.deepEqual(keys, ["primary", "small", "compaction", "summary", "title"])
})

test("recommendations serialize between sources and gateway", () => {
  const keys = Object.keys(JSON.parse(serialize(loadCatalog())))
  assert.deepEqual(keys.slice(0, 5), ["schemaVersion", "generatedBy", "sources", "recommendations", "gateway"])
})

test("the committed catalog satisfies the validator, recommendations included", () => {
  assert.ok(Object.keys(loadCatalog().recommendations).length > 0)
  assert.deepEqual(validateCatalog(loadCatalog(), schema), [])
})

test("validateCatalog rejects an unknown recommendation role", () => {
  const errors = validateCatalog(withRecommendations({ primary: "claude-sonnet-5", bogus: "claude-sonnet-5" }), schema)
  assert.match(errors.join("\n"), /disallowed role "bogus"/)
})

test("validateCatalog rejects a recommendation that is not in models[]", () => {
  const errors = validateCatalog(withRecommendations({ primary: "no-such-model" }), schema)
  assert.match(errors.join("\n"), /recommendations\.primary references "no-such-model"/)
})

test("validateCatalog rejects empty and non-string recommendation values", () => {
  for (const value of ["", 5, null, ["claude-sonnet-5"]]) {
    const errors = validateCatalog(withRecommendations({ primary: value }), schema)
    assert.match(errors.join("\n"), /recommendations\.primary must be a non-empty string/, JSON.stringify(value))
  }
})

test("validateCatalog rejects a non-object recommendations block", () => {
  for (const value of ["primary", [], null]) {
    const errors = validateCatalog(withRecommendations(value), schema)
    assert.match(errors.join("\n"), /recommendations must be an object/, JSON.stringify(value))
  }
})

test("validateCatalog accepts a catalog with no recommendations", () => {
  const { recommendations: _omitted, ...rest } = loadCatalog()
  assert.deepEqual(validateCatalog(rest, schema), [])
})

test("carryForwardRecommendations keeps roles whose models remain", () => {
  const carried = carryForwardRecommendations({ primary: "a", small: "b" }, [{ id: "a" }, { id: "b" }])
  assert.deepEqual(carried, { primary: "a", small: "b" })
})

test("carryForwardRecommendations passes through when there are none", () => {
  assert.equal(carryForwardRecommendations(undefined, [{ id: "a" }]), undefined)
})

test("carryForwardRecommendations fails closed and names every missing model", () => {
  assert.throws(
    () => carryForwardRecommendations({ primary: "a", small: "gone", title: "also-gone" }, [{ id: "a" }]),
    (error) => {
      assert.match(error.message, /small: gone/)
      assert.match(error.message, /title: also-gone/)
      assert.doesNotMatch(error.message, /primary: a/)
      assert.match(error.message, /Choose a replacement/)
      return true
    },
  )
})

test("carryForwardRecommendations rejects a malformed block instead of dropping it", () => {
  for (const value of [null, "x", ["a"]]) {
    assert.throws(() => carryForwardRecommendations(value, [{ id: "a" }]), /must be an object/)
  }
})

test("describeDrift reports a changed, added, and removed role", () => {
  const before = { models: [], recommendations: { primary: "a", small: "b" } }
  const after = { models: [], recommendations: { primary: "c", title: "d" } }
  assert.deepEqual(describeDrift(before, after), [
    'recommendations.primary: "a" -> "c"',
    'recommendations.small: "b" -> "(none)"',
    'recommendations.title: "(none)" -> "d"',
  ])
})

test("describeDrift is silent when roles match, and substantive() keeps them", () => {
  const catalog = loadCatalog()
  assert.deepEqual(describeDrift(substantive(catalog), substantive(loadCatalog())), [])
  assert.ok("recommendations" in substantive(catalog))
})

test("CLI: a fixture refresh carries the existing role defaults forward", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    writeFileSync(out, JSON.stringify({ recommendations: FIXTURE_ROLES }))
    const result = refresh(out)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).recommendations, FIXTURE_ROLES)
  })
})

test("CLI: a refresh is deterministic and --check against its own output is clean", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    writeFileSync(out, JSON.stringify({ recommendations: FIXTURE_ROLES }))
    assert.equal(refresh(out).status, 0)
    const first = readFileSync(out, "utf8")
    assert.equal(refresh(out).status, 0)
    assert.equal(readFileSync(out, "utf8"), first)
    assert.equal(refresh(out, "--check").status, 0)
  })
})

test("CLI: a refresh with no existing catalog writes no recommendations", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    assert.equal(refresh(out).status, 0)
    assert.equal("recommendations" in JSON.parse(readFileSync(out, "utf8")), false)
  })
})

test("CLI: a recommended model that left the feed fails the refresh and leaves the file untouched", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    const before = JSON.stringify({ recommendations: { ...FIXTURE_ROLES, primary: "model-that-left-the-feed" } })
    writeFileSync(out, before)
    const result = refresh(out)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /primary: model-that-left-the-feed/)
    assert.match(result.stderr, /Choose a replacement/)
    assert.equal(readFileSync(out, "utf8"), before)
  })
})

test("CLI: --check also fails closed when a recommended model left the feed", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    writeFileSync(out, JSON.stringify({ recommendations: { primary: "model-that-left-the-feed" } }))
    const result = refresh(out, "--check")
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /model-that-left-the-feed/)
  })
})

test("CLI: an unreadable existing catalog fails instead of dropping the roles", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    writeFileSync(out, "{ not json")
    const result = refresh(out)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cannot carry recommendations forward/)
    assert.equal(readFileSync(out, "utf8"), "{ not json")
  })
})

test("CLI: the default offline bootstrap no longer deletes the committed role defaults", () => {
  withTempDir((dir) => {
    const out = path.join(dir, "catalog.json")
    writeFileSync(out, readFileSync(CATALOG, "utf8"))
    const result = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).recommendations, loadCatalog().recommendations)
  })
})
