// =============================================================================
// refresh.test.mjs — the single refresh entrypoint (scripts/refresh.mjs).
//
// Everything here is offline: fixtures only, a temporary repository root, an
// injected loader in place of the network, and no credential. The suite proves
// deterministic regeneration, drift detection per artifact and per model, that
// a failed generation writes nothing, and that the live-pull guards hold.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { MAX_RESPONSE_BYTES, fetchJsonBounded, loadJsonSource, serialize } from "../scripts/build-catalog.mjs"
import { assertLivePullAllowed, describeArtifactDrift, loadRegistry, pullSources, runRefresh } from "../scripts/refresh.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")
const FIXTURES = path.join(HERE, "fixtures/refresh")
const REFRESH = path.join(USAI_DIR, "scripts/refresh.mjs")
const REGISTRY_REL = "integrations/providers/usai/refresh-registry.json"
const CATALOG_REL = "integrations/providers/usai/catalog.json"
const SNAPSHOT_REL = "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/model-catalog-snapshot.json"
const NORMALIZER_REL = "integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs"
const SCHEMA_REL = "integrations/providers/usai/catalog.schema.json"

const read = (file) => readFileSync(file, "utf8")
const readJson = (file) => JSON.parse(read(file))

/**
 * A throwaway repository root. The tooling (registry, normalizer, schema) is
 * copied from the repository; the "committed" catalog and snapshot are the
 * fixture copies, so these tests do not change when the real catalog is
 * refreshed.
 */
function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "usai-refresh-root-"))
  const place = (rel, from) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    cpSync(from, path.join(root, rel))
  }
  for (const rel of [REGISTRY_REL, NORMALIZER_REL, SCHEMA_REL]) place(rel, path.join(REPO_ROOT, rel))
  place(CATALOG_REL, path.join(FIXTURES, "artifacts/catalog.json"))
  place(SNAPSHOT_REL, path.join(FIXTURES, "artifacts/snapshot.json"))
  return root
}

/** A copy of the fixture feeds that a test may mutate. */
function makeSource() {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-refresh-src-"))
  for (const file of ["usai-models.json", "models-dev.json", "pull.json"]) cpSync(path.join(FIXTURES, file), path.join(dir, file))
  return dir
}

async function withRoot(fn) {
  const root = makeRoot()
  try {
    return await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function withRootAndSource(fn) {
  const source = makeSource()
  try {
    return await withRoot((root) => fn(root, source))
  } finally {
    rmSync(source, { recursive: true, force: true })
  }
}

const options = (root, source, extra = {}) => ({
  root,
  registryPath: path.join(root, REGISTRY_REL),
  from: source,
  ...extra,
})

/** Quiet the build's "excluded ..." notes on stderr. */
async function quietly(fn) {
  const original = process.stderr.write
  process.stderr.write = () => true
  try {
    return await fn()
  } finally {
    process.stderr.write = original
  }
}

const refresh = (root, source, extra) => quietly(() => runRefresh(options(root, source, extra)))

// ---------------------------------------------------------------------------
// Deterministic regeneration and byte identity
// ---------------------------------------------------------------------------

test("regenerating from the fixture feeds reproduces the fixture artifacts byte for byte", async () => {
  await withRootAndSource(async (root, source) => {
    const committedSnapshot = read(path.join(root, SNAPSHOT_REL))
    const committedCatalog = read(path.join(root, CATALOG_REL))

    const { status } = await refresh(root, source)
    assert.equal(status, 0)

    // The neutral snapshot is byte-identical.
    assert.equal(read(path.join(root, SNAPSHOT_REL)), committedSnapshot)

    // catalog.json differs only in `sources` (provenance, not content). Putting
    // the committed `sources` back must reproduce the committed bytes exactly.
    const written = readJson(path.join(root, CATALOG_REL))
    assert.notDeepEqual(written.sources, JSON.parse(committedCatalog).sources)
    assert.equal(serialize({ ...written, sources: JSON.parse(committedCatalog).sources }), committedCatalog)
  })
})

test("two refreshes over the same sources write identical bytes", async () => {
  await withRootAndSource(async (root, source) => {
    await refresh(root, source)
    const first = [read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))]
    await refresh(root, source)
    assert.deepEqual([read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))], first)
  })
})

test("the order of models in the feed does not change the output", async () => {
  await withRootAndSource(async (root, source) => {
    await refresh(root, source)
    const first = read(path.join(root, CATALOG_REL))
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.reverse()
    writeFileSync(listFile, JSON.stringify(list))
    await refresh(root, source)
    assert.equal(read(path.join(root, CATALOG_REL)), first)
  })
})

test("the committed model order is kept, and a new model lands after its vendor's existing models", async () => {
  await withRootAndSource(async (root, source) => {
    const before = readJson(path.join(root, CATALOG_REL)).models.map((m) => m.id)
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.push({ id: "claude-zz-new", object: "model", owned_by: "Anthropic" })
    writeFileSync(listFile, JSON.stringify(list))
    await refresh(root, source)
    const after = readJson(path.join(root, CATALOG_REL)).models.map((m) => m.id)
    const lastAnthropic = before.lastIndexOf("claude_4_5_sonnet")
    assert.deepEqual(after.slice(0, lastAnthropic + 1), before.slice(0, lastAnthropic + 1))
    assert.equal(after[lastAnthropic + 1], "claude-zz-new")
    assert.deepEqual(after.filter((id) => id !== "claude-zz-new"), before)
  })
})

test("model count is derived, not hard-coded: the refreshed snapshot matches the refreshed catalog", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data = list.data.filter((m) => m.id !== "llama_4_maverick")
    writeFileSync(listFile, JSON.stringify(list))
    await refresh(root, source)
    const catalog = readJson(path.join(root, CATALOG_REL))
    const snapshot = readJson(path.join(root, SNAPSHOT_REL))
    assert.equal(catalog.models.some((m) => m.id === "llama_4_maverick"), false)
    assert.deepEqual(snapshot.models.map((m) => m.id), catalog.models.map((m) => m.id))
  })
})

test("the role defaults survive a refresh (carried forward, not re-picked)", async () => {
  await withRootAndSource(async (root, source) => {
    const before = readJson(path.join(root, CATALOG_REL)).recommendations
    await refresh(root, source)
    assert.deepEqual(readJson(path.join(root, CATALOG_REL)).recommendations, before)
    assert.deepEqual(readJson(path.join(root, SNAPSHOT_REL)).recommendations, before)
  })
})

// ---------------------------------------------------------------------------
// Check mode: drift per artifact and per model, never writes
// ---------------------------------------------------------------------------

test("--check is clean when the artifacts match the sources", async () => {
  await withRootAndSource(async (root, source) => {
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 0)
    assert.match(report.join("\n"), /catalog: up to date/)
    assert.match(report.join("\n"), /neutral-snapshot: up to date/)
  })
})

test("--check names the model when a source model changed, and exits 1", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.find((m) => m.id === "claude_4_5_haiku").context_window = 12345
    writeFileSync(listFile, JSON.stringify(list))
    const devFile = path.join(source, "models-dev.json")
    const dev = readJson(devFile)
    delete dev["amazon-bedrock"].models.claude_4_5_haiku.limit
    writeFileSync(devFile, JSON.stringify(dev))
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    const text = report.join("\n")
    assert.match(text, /catalog: DRIFT/)
    assert.match(text, /model changed: claude_4_5_haiku/)
    assert.match(text, /neutral-snapshot: DRIFT/)
  })
})

test("--check names added and removed models", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data = list.data.filter((m) => m.id !== "gemini-2.5-flash-lite")
    list.data.push({ id: "gemini-9-flash", object: "model", owned_by: "Google" })
    writeFileSync(listFile, JSON.stringify(list))
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    const text = report.join("\n")
    assert.match(text, /models added: gemini-9-flash/)
    assert.match(text, /models removed: gemini-2\.5-flash-lite/)
  })
})

test("--check fails closed when a recommended model left the feed", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data = list.data.filter((m) => m.id !== "claude-sonnet-5")
    writeFileSync(listFile, JSON.stringify(list))
    await assert.rejects(refresh(root, source, { check: true }), /primary: claude-sonnet-5/)
  })
})

test("--check detects a hand-edited snapshot even when the catalog is current", async () => {
  await withRootAndSource(async (root, source) => {
    const file = path.join(root, SNAPSHOT_REL)
    const snapshot = readJson(file)
    snapshot.models[0].contextWindow += 1
    writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n")
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    const text = report.join("\n")
    assert.match(text, /catalog: up to date/)
    assert.match(text, /neutral-snapshot: DRIFT/)
    assert.match(text, new RegExp(`model changed: ${snapshot.models[0].id}`))
  })
})

test("--check reports a missing artifact", async () => {
  await withRootAndSource(async (root, source) => {
    rmSync(path.join(root, SNAPSHOT_REL))
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    assert.match(report.join("\n"), /neutral-snapshot: DRIFT[\s\S]*file is missing/)
  })
})

test("--check does not write anything, even when it finds drift", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.push({ id: "gemini-9-flash", object: "model", owned_by: "Google" })
    writeFileSync(listFile, JSON.stringify(list))
    const snapshotBefore = read(path.join(root, SNAPSHOT_REL))
    const catalogBefore = read(path.join(root, CATALOG_REL))
    const mtimes = [CATALOG_REL, SNAPSHOT_REL].map((rel) => statSync(path.join(root, rel)).mtimeMs)
    const { status } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    assert.equal(read(path.join(root, CATALOG_REL)), catalogBefore)
    assert.equal(read(path.join(root, SNAPSHOT_REL)), snapshotBefore)
    assert.deepEqual([CATALOG_REL, SNAPSHOT_REL].map((rel) => statSync(path.join(root, rel)).mtimeMs), mtimes)
  })
})

test("a write run followed by --check over the same sources is clean", async () => {
  await withRootAndSource(async (root, source) => {
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.push({ id: "gemini-9-flash", object: "model", owned_by: "Google" })
    writeFileSync(listFile, JSON.stringify(list))
    assert.equal((await refresh(root, source)).status, 0)
    assert.equal((await refresh(root, source, { check: true })).status, 0)
  })
})

// ---------------------------------------------------------------------------
// The committed catalog is validated, and every substantive field is compared
// ---------------------------------------------------------------------------

function editCommittedCatalog(root, mutate) {
  const file = path.join(root, CATALOG_REL)
  const catalog = readJson(file)
  mutate(catalog)
  writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n")
}

test("--check rejects a committed catalog with a schema-disallowed top-level field", async () => {
  await withRootAndSource(async (root, source) => {
    editCommittedCatalog(root, (c) => (c.unexpectedField = "x"))
    await assert.rejects(refresh(root, source, { check: true }), /not a valid catalog[\s\S]*disallowed key "unexpectedField"/)
  })
})

test("a write run refuses the same invalid catalog and leaves every artifact untouched", async () => {
  await withRootAndSource(async (root, source) => {
    editCommittedCatalog(root, (c) => (c.unexpectedField = "x"))
    const before = [read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))]
    await assert.rejects(refresh(root, source), /disallowed key "unexpectedField"/)
    assert.deepEqual([read(path.join(root, CATALOG_REL)), read(path.join(root, SNAPSHOT_REL))], before)
  })
})

test("an invalid committed catalog is rejected for other schema violations too", async () => {
  const cases = [
    [(c) => (c.gateway.api = "other"), /gateway\.api/],
    [(c) => (c.models[0].vendor = "nobody"), /not in vendors/],
    [(c) => (c.recommendations.primary = "no-such-model"), /not in models\[\]/],
    [(c) => (c.recommendations.bogus = c.models[0].id), /disallowed role "bogus"/],
    [(c) => (c.models[0].contextWindow = -1), /contextWindow/],
  ]
  for (const [mutate, pattern] of cases) {
    await withRootAndSource(async (root, source) => {
      editCommittedCatalog(root, mutate)
      await assert.rejects(refresh(root, source, { check: true }), pattern)
    })
  }
})

test("a committed catalog with a malformed `sources` is rejected, not reported up to date", async () => {
  for (const sources of [123, [1], { a: 5 }, null]) {
    await withRootAndSource(async (root, source) => {
      editCommittedCatalog(root, (c) => (c.sources = sources))
      await assert.rejects(refresh(root, source, { check: true }), /sources/, JSON.stringify(sources))
    })
  }
})

test("--check reports a changed gateway block and a changed role default as drift", async () => {
  await withRootAndSource(async (root, source) => {
    editCommittedCatalog(root, (c) => {
      c.gateway.host = "elsewhere.example"
      c.recommendations.small = c.recommendations.primary
    })
    const { status, report } = await refresh(root, source, { check: true })
    assert.equal(status, 1)
    assert.match(report.join("\n"), /gateway block changed/)
  })
})

test("drift compares every field except `sources`: extra, removed and changed fields all count", () => {
  const artifact = { kind: "catalog" }
  const fresh = { schemaVersion: "v", generatedBy: "g", sources: { a: "1" }, gateway: {}, vendors: [], models: [] }
  const same = (c) => describeArtifactDrift(artifact, "{}", "", c, fresh)
  assert.deepEqual(same({ ...fresh, sources: { a: "different" } }), [], "sources is provenance, not content")
  assert.deepEqual(same({ ...fresh, unexpectedField: "x" }), ["field changed: unexpectedField"])
  assert.deepEqual(same({ ...fresh, generatedBy: "other" }), ['generatedBy: "other" -> "g"'])
  const { generatedBy: _gone, ...withoutGenerator } = fresh
  assert.ok(same(withoutGenerator).length > 0)
  const derived = { kind: "derived" }
  const one = JSON.stringify({ schemaVersion: "v", models: [], extra: 1 })
  const two = JSON.stringify({ schemaVersion: "v", models: [], extra: 2 })
  assert.deepEqual(describeArtifactDrift(derived, one, two, null, fresh), ["field changed: extra"])
})

// ---------------------------------------------------------------------------
// A failed generation writes nothing
// ---------------------------------------------------------------------------

test("when a generator fails, no artifact is written, including catalog.json", async () => {
  await withRootAndSource(async (root, source) => {
    writeFileSync(path.join(root, NORMALIZER_REL), "process.stderr.write('boom'); process.exit(3)\n")
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.push({ id: "gemini-9-flash", object: "model", owned_by: "Google" })
    writeFileSync(listFile, JSON.stringify(list))
    const before = read(path.join(root, CATALOG_REL))
    await assert.rejects(refresh(root, source), /generator for "neutral-snapshot" failed: boom/)
    assert.equal(read(path.join(root, CATALOG_REL)), before)
  })
})

test("a generator runs with no credential in its environment", async () => {
  await withRootAndSource(async (root, source) => {
    writeFileSync(
      path.join(root, NORMALIZER_REL),
      `import { writeFileSync } from "node:fs"
const out = process.argv[process.argv.indexOf("--out") + 1]
writeFileSync(out, JSON.stringify({ envKeys: Object.keys(process.env).sort() }) + "\\n")
`,
    )
    const previous = process.env.USAI_API_KEY
    process.env.USAI_API_KEY = "sentinel-not-a-real-key"
    try {
      await refresh(root, source)
    } finally {
      if (previous === undefined) delete process.env.USAI_API_KEY
      else process.env.USAI_API_KEY = previous
    }
    const { envKeys } = readJson(path.join(root, SNAPSHOT_REL))
    assert.equal(envKeys.includes("USAI_API_KEY"), false)
    assert.deepEqual(envKeys.filter((key) => key !== "PATH"), [])
  })
})

test("missing source files are reported before anything is generated", async () => {
  await withRootAndSource(async (root, source) => {
    rmSync(path.join(source, "models-dev.json"))
    await assert.rejects(refresh(root, source), /models-dev\.json not found/)
  })
})

// ---------------------------------------------------------------------------
// A checkout path containing a space
// ---------------------------------------------------------------------------

test("CLI: refresh --from <fixtures> --check works when the checkout path contains a space", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "usai-space-"))
  const root = path.join(parent, "space root")
  try {
    // Copy the scripts too, so the entrypoint guards run from the spaced path.
    for (const rel of [
      REGISTRY_REL,
      NORMALIZER_REL,
      SCHEMA_REL,
      "integrations/providers/usai/scripts/refresh.mjs",
      "integrations/providers/usai/scripts/build-catalog.mjs",
    ]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      cpSync(path.join(REPO_ROOT, rel), path.join(root, rel))
    }
    for (const [rel, from] of [[CATALOG_REL, "artifacts/catalog.json"], [SNAPSHOT_REL, "artifacts/snapshot.json"]]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      cpSync(path.join(FIXTURES, from), path.join(root, rel))
    }
    const script = path.join(root, "integrations/providers/usai/scripts/refresh.mjs")
    const env = { PATH: process.env.PATH }
    const check = spawnSync(process.execPath, [script, "--root", root, "--from", FIXTURES, "--check"], { encoding: "utf8", env })
    assert.equal(check.status, 0, check.stderr)
    assert.match(check.stdout, /neutral-snapshot: up to date/)

    // A write run must actually produce the snapshot (the normalizer must run).
    rmSync(path.join(root, SNAPSHOT_REL))
    const write = spawnSync(process.execPath, [script, "--root", root, "--from", FIXTURES], { encoding: "utf8", env })
    assert.equal(write.status, 0, write.stderr)
    assert.equal(read(path.join(root, SNAPSHOT_REL)), read(path.join(FIXTURES, "artifacts/snapshot.json")))

    // The standalone builder also runs from the spaced path (guards the same pattern).
    const builder = path.join(root, "integrations/providers/usai/scripts/build-catalog.mjs")
    const refused = spawnSync(process.execPath, [builder], { encoding: "utf8", env })
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /make refresh-usai-catalog/)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("guard: no script under integrations/ builds its entrypoint check from a file:// template", () => {
  const offenders = walk(path.join(REPO_ROOT, "integrations"))
    .filter((file) => /\.(mjs|js|cjs)$/.test(file) && !file.split(path.sep).includes("node_modules"))
    .filter((file) => /import\.meta\.url\s*===?\s*`file:\/\//.test(read(file)))
    .map((file) => path.relative(REPO_ROOT, file))
  assert.deepEqual(offenders, [])
})

// ---------------------------------------------------------------------------
// Registry validation
// ---------------------------------------------------------------------------

const REGISTRY = () => readJson(path.join(REPO_ROOT, REGISTRY_REL))

test("the shipped registry loads: one catalog and the neutral snapshot", () => {
  const registry = loadRegistry(REGISTRY(), REPO_ROOT)
  assert.equal(registry.catalog.id, "catalog")
  assert.deepEqual(registry.derived.map((a) => a.id), ["neutral-snapshot"])
})

test("registry validation rejects malformed registries", () => {
  const mutate = (fn) => {
    const registry = REGISTRY()
    fn(registry)
    return registry
  }
  const cases = [
    [mutate((r) => (r.schemaVersion = "other/v1")), /expected schemaVersion/],
    [mutate((r) => r.artifacts.push({ ...r.artifacts[1] })), /duplicate artifact id/],
    [mutate((r) => r.artifacts.push({ ...r.artifacts[1], id: "again" })), /two artifacts write/],
    [mutate((r) => (r.artifacts[1].path = "../outside.json")), /escapes the repository root/],
    [mutate((r) => (r.artifacts[1].path = "/etc/passwd")), /relative path/],
    [mutate((r) => (r.artifacts[1].generator.args = ["--source", "{catalog}"])), /both \{catalog\} and \{out\}/],
    [mutate((r) => (r.artifacts[1].generator.script = "../../x.mjs")), /escapes the repository root/],
    [mutate((r) => (r.artifacts[1].kind = "other")), /kind must be/],
    [mutate((r) => r.artifacts.shift()), /exactly one artifact/],
    [mutate((r) => (r.artifacts[1].id = "Bad Id")), /kebab-case/],
  ]
  for (const [registry, pattern] of cases) assert.throws(() => loadRegistry(registry, REPO_ROOT), pattern)
})

// ---------------------------------------------------------------------------
// One pull, and the live-pull guards
// ---------------------------------------------------------------------------

test("a live refresh pulls each feed exactly once and then behaves like --from", async () => {
  await withRootAndSource(async (root, source) => {
    const calls = []
    const load = async (ref) => {
      calls.push(ref)
      return readJson(path.join(source, ref.includes("models.dev") ? "models-dev.json" : "usai-models.json"))
    }
    const pullDir = path.join(root, "tmp", "usai-source")
    const result = await quietly(() =>
      runRefresh({
        root,
        registryPath: path.join(root, REGISTRY_REL),
        pullDir,
        check: true,
        env: { USAI_API_KEY: "sentinel-not-a-real-key" },
        load,
      }),
    )
    assert.equal(result.status, 0)
    assert.deepEqual(calls, ["https://api.gsa.usai.gov/api/v1/models", "https://models.dev/api.json"])
    assert.deepEqual(readdirSync(pullDir).sort(), ["models-dev.json", "pull.json", "usai-models.json"])
    assert.equal(JSON.stringify(result).includes("sentinel-not-a-real-key"), false)
  })
})

test("a failed pull leaves the previous pull in place", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-pull-"))
  try {
    await pullSources(dir, { load: async () => ({ data: [] }) })
    const before = read(path.join(dir, "usai-models.json"))
    let n = 0
    const failing = async () => {
      if (++n === 2) throw new Error("second feed down")
      return { data: [{ id: "x" }] }
    }
    await assert.rejects(pullSources(dir, { load: failing }), /second feed down/)
    assert.equal(read(path.join(dir, "usai-models.json")), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a live pull is refused in CI and without a key; the message never contains a key", () => {
  assert.throws(() => assertLivePullAllowed({ CI: "true", USAI_API_KEY: "k" }), /refusing a live pull in CI/)
  assert.throws(() => assertLivePullAllowed({ GITHUB_ACTIONS: "true", USAI_API_KEY: "k" }), /refusing a live pull in CI/)
  assert.throws(() => assertLivePullAllowed({}), /needs USAI_API_KEY/)
  assert.throws(() => assertLivePullAllowed({ USAI_API_KEY: "   " }), /needs USAI_API_KEY/)
  assert.doesNotThrow(() => assertLivePullAllowed({ USAI_API_KEY: "k" }))
  assert.doesNotThrow(() => assertLivePullAllowed({ CI: "true", USAI_API_KEY: "k" }, { allowCi: true }))
  try {
    assertLivePullAllowed({ CI: "true", USAI_API_KEY: "super-secret-value" })
  } catch (error) {
    assert.equal(error.message.includes("super-secret-value"), false)
  }
})

test("CLI: with no --from and no key the command exits 2, names the variable, and writes nothing", () => {
  const env = { PATH: process.env.PATH }
  const result = spawnSync(process.execPath, [REFRESH, "--check"], { encoding: "utf8", env })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /USAI_API_KEY/)
  assert.equal(result.stdout, "")
})

test("CLI: a live pull in CI is refused before any request", () => {
  const env = { PATH: process.env.PATH, CI: "true", USAI_API_KEY: "sentinel-not-a-real-key" }
  const result = spawnSync(process.execPath, [REFRESH, "--check"], { encoding: "utf8", env })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /refusing a live pull in CI/)
  assert.equal(result.stderr.includes("sentinel-not-a-real-key"), false)
  assert.equal(result.stdout.includes("sentinel-not-a-real-key"), false)
})

test("CLI: --from --check exits 0 on a matching root, 1 on drift, and rejects unknown flags", async () => {
  const env = { PATH: process.env.PATH }
  await withRootAndSource((root, source) => {
    const args = [REFRESH, "--root", root, "--from", source, "--check"]
    const ok = spawnSync(process.execPath, args, { encoding: "utf8", env })
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /catalog: up to date/)
    const listFile = path.join(source, "usai-models.json")
    const list = readJson(listFile)
    list.data.push({ id: "gemini-9-flash", object: "model", owned_by: "Google" })
    writeFileSync(listFile, JSON.stringify(list))
    const drift = spawnSync(process.execPath, args, { encoding: "utf8", env })
    assert.equal(drift.status, 1)
    assert.match(drift.stdout, /models added: gemini-9-flash/)
  })
  const bad = spawnSync(process.execPath, [REFRESH, "--bogus"], { encoding: "utf8", env: { PATH: process.env.PATH } })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /unknown argument/)
})

// ---------------------------------------------------------------------------
// The bounded https loader
// ---------------------------------------------------------------------------

async function withFetch(stub, fn) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

test("the loader rejects non-https URLs without making a request", async () => {
  let called = false
  await withFetch(async () => {
    called = true
    return new Response("{}")
  }, async () => {
    await assert.rejects(fetchJsonBounded("http://api.gsa.usai.gov/api/v1/models"), /only https/)
    await assert.rejects(loadJsonSource("http://example.test/models.json"), /only https/)
    await assert.rejects(fetchJsonBounded("ftp://example.test/x"), /only https/)
  })
  assert.equal(called, false)
})

test("the loader rejects an oversize body, declared or streamed", async () => {
  await withFetch(
    async () => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
    async () => {
      await assert.rejects(fetchJsonBounded("https://example.test/declared"), /too large/)
    },
  )
  await withFetch(
    async () => new Response("a".repeat(MAX_RESPONSE_BYTES + 1)),
    async () => {
      await assert.rejects(fetchJsonBounded("https://example.test/streamed"), /exceeded/)
    },
  )
})

test("the loader rejects a non-JSON body and a failing status", async () => {
  await withFetch(async () => new Response("<html>"), async () => {
    await assert.rejects(fetchJsonBounded("https://example.test/html"), /not valid JSON/)
  })
  await withFetch(async () => new Response("nope", { status: 500, statusText: "Server Error" }), async () => {
    await assert.rejects(fetchJsonBounded("https://example.test/err"), /500/)
  })
})

test("the gateway key is sent only to the USAi host, over https, and is never in an error", async () => {
  const previous = process.env.USAI_API_KEY
  process.env.USAI_API_KEY = "sentinel-not-a-real-key"
  const seen = []
  try {
    await withFetch(async (url, init) => {
      seen.push({ url, auth: init?.headers?.Authorization })
      return new Response("{}")
    }, async () => {
      await loadJsonSource("https://api.gsa.usai.gov/api/v1/models")
      await loadJsonSource("https://models.dev/api.json")
      await loadJsonSource("https://api.gsa.usai.gov.evil.example/api")
    })
  } finally {
    if (previous === undefined) delete process.env.USAI_API_KEY
    else process.env.USAI_API_KEY = previous
  }
  assert.equal(seen[0].auth, "Bearer sentinel-not-a-real-key")
  assert.equal(seen[1].auth, undefined)
  assert.equal(seen[2].auth, undefined)
})

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

test("guard: only build-catalog.mjs fetches from the network, anywhere under integrations/", () => {
  const offenders = walk(path.join(REPO_ROOT, "integrations"))
    .filter((file) => /\.(mjs|js|cjs)$/.test(file) && !file.split(path.sep).includes("tests"))
    .filter((file) => /\bfetch\s*\(|node:https?|XMLHttpRequest/.test(read(file)))
    .map((file) => path.relative(REPO_ROOT, file))
  assert.deepEqual(offenders, [path.join("integrations", "providers", "usai", "scripts", "build-catalog.mjs")])
})

test("guard: refresh.mjs makes no request of its own and renders nothing harness-specific", () => {
  const source = read(REFRESH)
  assert.doesNotMatch(source, /\bfetch\s*\(|node:https?/)
  assert.doesNotMatch(source, /from\s+["'][^"']*emitters/)
  assert.doesNotMatch(source, /import\([^)]*emitters/)
})

test("guard: no registered artifact or generator names a harness or an emitter", () => {
  const registry = REGISTRY()
  const text = JSON.stringify(registry)
  assert.doesNotMatch(text, /opencode|codex|claude|copilot|goose|prime|emitters/i)
  for (const artifact of registry.artifacts) {
    assert.doesNotMatch(artifact.path, /\.jsonc$/, "a harness-native config is not a registered artifact")
  }
})

test("guard: the registry paths all exist in the repository", () => {
  const registry = loadRegistry(REGISTRY(), REPO_ROOT)
  for (const artifact of [registry.catalog, ...registry.derived]) assert.ok(existsSync(artifact.file), artifact.file)
  for (const artifact of registry.derived) assert.ok(existsSync(artifact.script), artifact.script)
})

test("guard: no workflow runs the refresh (this slice adds none; the key is not a repository secret)", () => {
  const workflows = path.join(REPO_ROOT, ".github", "workflows")
  for (const file of readdirSync(workflows)) {
    const text = read(path.join(workflows, file))
    assert.doesNotMatch(text, /refresh-usai-catalog|providers\/usai\/scripts\/refresh/, file)
    assert.doesNotMatch(text, /USAI_API_KEY/, file)
  }
})
