// =============================================================================
// capability-carry.test.mjs — verified capability values (reasoning,
// inputModalities) are curated overlay data. A refresh carries them forward
// from the committed catalog exactly as it carries `recommendations`, drops a
// model's values only when the model leaves the feed, never lets the unverified
// models.dev copy overwrite them, and reports every change as drift.
//
// Offline only: fixtures, a temporary repository root, no network, no secrets.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { describeDrift, serialize } from "../scripts/build-catalog.mjs"
import { runRefresh } from "../scripts/refresh.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")
const FIXTURES = path.join(HERE, "fixtures/refresh")
const BUILD = path.join(USAI_DIR, "scripts/build-catalog.mjs")
const REGISTRY_REL = "integrations/providers/usai/refresh-registry.json"
const CATALOG_REL = "integrations/providers/usai/catalog.json"
const SNAPSHOT_REL = "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/model-catalog-snapshot.json"
const NORMALIZER_REL = "integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs"
const SCHEMA_REL = "integrations/providers/usai/catalog.schema.json"
const REMINDER = "2026-11-04; opencode 2.0.30"
const IMAGE = ["text", "image"]

const read = (file) => readFileSync(file, "utf8")
const readJson = (file) => JSON.parse(read(file))

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "usai-carry-root-"))
  const place = (rel, from) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    cpSync(from, path.join(root, rel))
  }
  for (const rel of [REGISTRY_REL, NORMALIZER_REL, SCHEMA_REL]) place(rel, path.join(REPO_ROOT, rel))
  place(CATALOG_REL, path.join(FIXTURES, "artifacts/catalog.json"))
  place(SNAPSHOT_REL, path.join(FIXTURES, "artifacts/snapshot.json"))
  return root
}

function makeSource() {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-carry-src-"))
  for (const file of ["usai-models.json", "models-dev.json", "pull.json"]) cpSync(path.join(FIXTURES, file), path.join(dir, file))
  return dir
}

async function withRootAndSource(fn) {
  const root = makeRoot()
  const source = makeSource()
  try {
    return await fn(root, source)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
}

const options = (root, source, extra = {}) => ({
  root,
  registryPath: path.join(root, REGISTRY_REL),
  from: source,
  ...extra,
})

async function quietly(fn) {
  const original = process.stderr.write
  const notes = []
  process.stderr.write = (chunk) => (notes.push(String(chunk)), true)
  try {
    return { result: await fn(), stderr: notes.join("") }
  } finally {
    process.stderr.write = original
  }
}

const refresh = async (root, source, extra) => (await quietly(() => runRefresh(options(root, source, extra)))).result

/**
 * Put verified values on the "committed" catalog and regenerate the snapshot
 * from it, as a data change would. `values` maps model id to its fields.
 */
function commitVerified(root, values, reminder = REMINDER) {
  const file = path.join(root, CATALOG_REL)
  const catalog = readJson(file)
  for (const model of catalog.models) Object.assign(model, values[model.id] ?? {})
  if (reminder) catalog.sources = { ...catalog.sources, capabilitiesVerified: reminder }
  writeFileSync(file, serialize(catalog))
  const result = spawnSync(
    process.execPath,
    [path.join(root, NORMALIZER_REL), "--source", file, "--out", path.join(root, SNAPSHOT_REL)],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr)
}

const twelve = (ids) => Object.fromEntries(ids.slice(0, 12).map((id) => [id, { inputModalities: IMAGE }]))
const committedIds = (root) => readJson(path.join(root, CATALOG_REL)).models.map((m) => m.id)
const checkText = (outcome) => outcome.report.join("\n")

// ---------------------------------------------------------------------------
// Carry forward
// ---------------------------------------------------------------------------

test("a refresh preserves verified values and the release reminder, in the catalog and the snapshot", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    const values = { ...twelve(ids), [ids[12]]: { reasoning: false, inputModalities: ["text"] } }
    commitVerified(root, values)
    const before = readJson(path.join(root, CATALOG_REL))

    assert.equal((await refresh(root, source)).status, 0)

    const catalog = readJson(path.join(root, CATALOG_REL))
    const snapshot = readJson(path.join(root, SNAPSHOT_REL))
    for (const [id, expected] of Object.entries(values)) {
      const model = catalog.models.find((m) => m.id === id)
      assert.deepEqual({ reasoning: model.reasoning, inputModalities: model.inputModalities }, { reasoning: expected.reasoning, inputModalities: expected.inputModalities })
      const neutral = snapshot.models.find((m) => m.id === id)
      assert.deepEqual(neutral.inputModalities, expected.inputModalities, `${id} must reach the neutral snapshot`)
      assert.equal(neutral.reasoning, expected.reasoning)
    }
    assert.equal(catalog.models.filter((m) => "inputModalities" in m).length, 13, "nothing beyond the verified models gains a value")
    assert.equal(catalog.sources.capabilitiesVerified, REMINDER, "the release reminder is carried, not advanced")
    assert.equal("capabilities" in catalog.sources, false)
    assert.deepEqual(catalog.models.map((m) => m.id), before.models.map((m) => m.id))
  })
})

test("mimicking a committed data change: --check is clean when the feed matches and the overlay is carried", async () => {
  await withRootAndSource(async (root, source) => {
    commitVerified(root, twelve(committedIds(root)))
    const outcome = await refresh(root, source, { check: true })
    assert.equal(outcome.status, 0, checkText(outcome))
    assert.match(checkText(outcome), /catalog: up to date/)
    assert.match(checkText(outcome), /neutral-snapshot: up to date/)
  })
})

test("regenerating twice is byte-identical, and a verified tree is a fixed point", async () => {
  await withRootAndSource(async (root, source) => {
    commitVerified(root, twelve(committedIds(root)))
    await refresh(root, source)
    const first = [read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))]
    await refresh(root, source)
    assert.deepEqual([read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))], first)
  })
})

test("a capability-free catalog stays capability-free (nothing is invented)", async () => {
  await withRootAndSource(async (root, source) => {
    await refresh(root, source)
    const catalog = readJson(path.join(root, CATALOG_REL))
    assert.equal(catalog.models.some((m) => "reasoning" in m || "inputModalities" in m), false)
    assert.equal("capabilitiesVerified" in catalog.sources, false)
  })
})

// ---------------------------------------------------------------------------
// Models that leave the feed
// ---------------------------------------------------------------------------

function removeFromFeed(source, id) {
  const file = path.join(source, "usai-models.json")
  const list = readJson(file)
  list.data = list.data.filter((m) => m.id !== id)
  writeFileSync(file, JSON.stringify(list))
}

test("a model that leaves the feed takes its values with it, named on stderr; the others keep theirs", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    commitVerified(root, twelve(ids))
    const gone = ids[0]
    removeFromFeed(source, gone)
    const { result, stderr } = await quietly(() => runRefresh(options(root, source)))
    assert.equal(result.status, 0)
    assert.match(stderr, new RegExp(`${gone}: inputModalities`))
    const catalog = readJson(path.join(root, CATALOG_REL))
    assert.equal(catalog.models.some((m) => m.id === gone), false)
    assert.equal(catalog.models.filter((m) => "inputModalities" in m).length, 11)
    assert.equal(catalog.sources.capabilitiesVerified, REMINDER)
  })
})

test("--check names the dropped model and fields as drift for the catalog and the snapshot", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    commitVerified(root, { [ids[0]]: { reasoning: true, inputModalities: IMAGE } })
    removeFromFeed(source, ids[0])
    const outcome = await refresh(root, source, { check: true })
    assert.equal(outcome.status, 1)
    const text = checkText(outcome)
    assert.match(text, /catalog: DRIFT/)
    assert.match(text, /neutral-snapshot: DRIFT/)
    const dropLine = new RegExp(`capability values dropped with removed model: ${ids[0]} \\(reasoning, inputModalities\\)`)
    assert.equal((text.match(new RegExp(dropLine, "g")) ?? []).length, 2, "reported for both artifacts")
  })
})

test("when every model with a value leaves the feed, no value remains and the release reminder is dropped", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    commitVerified(root, { [ids[0]]: { inputModalities: IMAGE } })
    removeFromFeed(source, ids[0])
    const { result, stderr } = await quietly(() => runRefresh(options(root, source)))
    assert.equal(result.status, 0)
    assert.match(stderr, /no verified capability values remain/)
    const catalog = readJson(path.join(root, CATALOG_REL))
    assert.equal("capabilitiesVerified" in catalog.sources, false)
    assert.equal(catalog.models.some((m) => "inputModalities" in m), false)
    assert.equal((await refresh(root, source, { check: true })).status, 0)
  })
})

test("values without a valid release reminder are not treated as verified: warned, not carried", async () => {
  await withRootAndSource(async (root, source) => {
    commitVerified(root, twelve(committedIds(root)), null)
    const { result, stderr } = await quietly(() => runRefresh(options(root, source)))
    assert.equal(result.status, 0)
    assert.match(stderr, /not treated as verified/)
    assert.equal(readJson(path.join(root, CATALOG_REL)).models.some((m) => "inputModalities" in m), false)
  })
})

// ---------------------------------------------------------------------------
// Drift reporting (added / changed / dropped), per model and field
// ---------------------------------------------------------------------------

test("describeDrift reports added, changed and dropped capability values per model and field", () => {
  const base = { id: "m", name: "M" }
  const wrap = (model) => ({ models: [model] })
  assert.deepEqual(describeDrift(wrap(base), wrap({ ...base, reasoning: true })), ["capability added: m.reasoning = true"])
  assert.deepEqual(describeDrift(wrap({ ...base, reasoning: true }), wrap({ ...base, reasoning: false })), ["capability changed: m.reasoning: true -> false"])
  assert.deepEqual(describeDrift(wrap({ ...base, reasoning: true }), wrap(base)), ["capability dropped: m.reasoning (was true)"])
  assert.deepEqual(
    describeDrift(wrap({ ...base, reasoning: true, contextWindow: 1 }), wrap({ ...base, reasoning: false, contextWindow: 2 })),
    ["model changed: m", "capability changed: m.reasoning: true -> false"],
    "a non-capability change is still reported as before",
  )
})

test("--check reports a hand-edited capability value in the committed artifacts as changed drift", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    commitVerified(root, twelve(ids))
    // Commit a value the (overlay-carrying) refresh will not reproduce: tamper
    // with the snapshot only, so catalog and snapshot disagree.
    const snapshotFile = path.join(root, SNAPSHOT_REL)
    const snapshot = readJson(snapshotFile)
    snapshot.models.find((m) => m.id === ids[0]).inputModalities = ["text"]
    writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2) + "\n")
    const outcome = await refresh(root, source, { check: true })
    assert.equal(outcome.status, 1)
    assert.match(checkText(outcome), new RegExp(`capability changed: ${ids[0]}\\.inputModalities: \\["text"\\] -> \\["text","image"\\]`))
    assert.match(checkText(outcome), /neutral-snapshot: DRIFT/)
  })
})

test("--check reports a verified value removed from the committed catalog as a drift of the committed tree", async () => {
  await withRootAndSource(async (root, source) => {
    const ids = committedIds(root)
    commitVerified(root, twelve(ids))
    // The snapshot still carries the value; the overlay source (catalog) lost it.
    const file = path.join(root, CATALOG_REL)
    const catalog = readJson(file)
    delete catalog.models.find((m) => m.id === ids[0]).inputModalities
    writeFileSync(file, serialize(catalog))
    const outcome = await refresh(root, source, { check: true })
    assert.equal(outcome.status, 1)
    assert.match(checkText(outcome), new RegExp(`capability dropped: ${ids[0]}\\.inputModalities`))
  })
})

// ---------------------------------------------------------------------------
// --include-capabilities (build-catalog.mjs only): never overwrites a verified
// value, never shares a catalog with them
// ---------------------------------------------------------------------------

function buildCli(root, source, out, ...extra) {
  return spawnSync(
    process.execPath,
    [BUILD, "--models-url", path.join(source, "usai-models.json"), "--models-dev", path.join(HERE, "fixtures/models-dev.json"), "--out", out, ...extra],
    { encoding: "utf8" },
  )
}

function upstreamCatalog(root, source) {
  const scratch = path.join(root, "scratch-upstream.json")
  const run = buildCli(root, source, scratch, "--include-capabilities")
  assert.equal(run.status, 0, run.stderr)
  return readJson(scratch)
}

test("--include-capabilities that would conflict with a verified value refuses, writes nothing, and names model, field and both values", async () => {
  await withRootAndSource(async (root, source) => {
    const upstream = upstreamCatalog(root, source)
    const target = upstream.models.find((m) => Array.isArray(m.inputModalities) && m.inputModalities.includes("pdf"))
    assert.ok(target, "fixture needs a model whose upstream modalities differ from the verified list")
    const out = path.join(root, CATALOG_REL)
    commitVerified(root, { [target.id]: { inputModalities: IMAGE } })
    const before = read(out)
    const run = buildCli(root, source, out, "--include-capabilities")
    assert.equal(run.status, 1)
    assert.equal(read(out), before, "the catalog is byte-for-byte unchanged")
    assert.match(run.stderr, new RegExp(`${target.id} inputModalities: verified \\["text","image"\\], upstream ${JSON.stringify(target.inputModalities).replace(/[[\]]/g, "\\$&")} \\(CONFLICT\\)`))
    assert.match(run.stderr, /The catalog was NOT written/)
  })
})

test("--include-capabilities is refused while any verified value is carried, even for a model with no verified value", async () => {
  await withRootAndSource(async (root, source) => {
    const upstream = upstreamCatalog(root, source)
    const withUpstream = upstream.models.filter((m) => "inputModalities" in m).map((m) => m.id)
    assert.ok(withUpstream.length >= 2)
    const out = path.join(root, CATALOG_REL)
    commitVerified(root, { [withUpstream[0]]: { inputModalities: upstream.models.find((m) => m.id === withUpstream[0]).inputModalities } })
    const before = read(out)
    const run = buildCli(root, source, out, "--include-capabilities")
    assert.equal(run.status, 1)
    assert.equal(read(out), before)
    assert.match(run.stderr, /no verified value, upstream .* \(would be unverified\)/)
    assert.doesNotMatch(run.stderr, new RegExp(`${withUpstream[0]} inputModalities`), "an identical value is not a conflict")
  })
})

test("--include-capabilities still works when no verified value exists (today's behaviour, labelled unverified)", async () => {
  await withRootAndSource(async (root, source) => {
    const upstream = upstreamCatalog(root, source)
    assert.ok(upstream.models.some((m) => "inputModalities" in m))
    assert.match(upstream.sources.capabilities, /not verified/)
    assert.equal("capabilitiesVerified" in upstream.sources, false)
  })
})

test("--include-capabilities with only identical upstream values writes, and carries the reminder", async () => {
  await withRootAndSource(async (root, source) => {
    const upstream = upstreamCatalog(root, source)
    const all = upstream.models.filter((m) => "reasoning" in m || "inputModalities" in m)
    const verified = Object.fromEntries(all.map((m) => [m.id, { reasoning: m.reasoning, inputModalities: m.inputModalities }]))
    for (const value of Object.values(verified)) for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
    const out = path.join(root, CATALOG_REL)
    commitVerified(root, verified)
    const run = buildCli(root, source, out, "--include-capabilities")
    assert.equal(run.status, 0, run.stderr)
    const catalog = readJson(out)
    assert.equal(catalog.sources.capabilitiesVerified, REMINDER)
    assert.equal("capabilities" in catalog.sources, false, "verified values must not be relabelled unverified")
  })
})
