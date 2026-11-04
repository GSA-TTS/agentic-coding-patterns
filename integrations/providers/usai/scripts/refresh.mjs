#!/usr/bin/env node

// =============================================================================
// refresh.mjs — the one documented command that refreshes the USAi catalog and
// every registered provider-neutral artifact from a single source pull.
//
//   make refresh-usai-catalog                      # pull once, write artifacts
//   make refresh-usai-catalog-check                # report drift, write nothing
//   node scripts/refresh.mjs --from <dir> [--check]  # fully offline
//
// Flow:
//   source pull (USAi model list + models.dev), once
//     -> build-catalog.mjs logic -> catalog.json
//     -> each registered derived artifact, by running its file-to-file generator
//
// Scope: provider-neutral artifacts only. This script never produces or reads a
// harness-native configuration, and it is a repository authoring tool, not a
// runtime component. See docs/decisions/0003-repo-time-provider-catalog-refresh.md.
//
// Source directory (`--from`, or the pull directory) holds:
//   usai-models.json   the USAi model list
//   models-dev.json    models.dev enrichment (not needed with --no-enrichment)
//   pull.json          optional: the URLs recorded under catalog `sources`
//
// Live pull:
//   - needs USAI_API_KEY in the process environment (never a flag, never logged);
//   - is refused when CI is set unless --allow-ci is passed, because no key is
//     stored for CI and this must not be wired into a workflow by accident;
//   - fetches only through build-catalog.mjs's bounded https loader.
//
// Nothing is committed automatically. Write mode changes files in the working
// tree for a person to review; check mode changes none.
//
// Exit status: 0 up to date / written; 1 drift found (check mode); 2 error.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  MODELS_DEV_URL,
  USAI_MODELS_URL,
  buildCatalog,
  describeDrift,
  loadJsonSource,
  serialize,
  substantive,
} from "./build-catalog.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const DEFAULT_ROOT = path.resolve(USAI_DIR, "../../..")
const DEFAULT_REGISTRY = path.join(USAI_DIR, "refresh-registry.json")

const REGISTRY_SCHEMA = "usai-refresh-registry/v1"
const USAI_API_KEY_ENV = "USAI_API_KEY"
const MODELS_FILE = "usai-models.json"
const MODELS_DEV_FILE = "models-dev.json"
const PULL_FILE = "pull.json"
const GENERATOR_TIMEOUT_MS = 60_000
const GENERATOR_MAX_BUFFER = 1024 * 1024

class RefreshError extends Error {}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function insideRoot(root, relative, where) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative)) {
    throw new RefreshError(`registry: ${where} must be a non-empty relative path`)
  }
  const resolved = path.resolve(root, relative)
  const rel = path.relative(root, resolved)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new RefreshError(`registry: ${where} escapes the repository root: ${relative}`)
  }
  return resolved
}

/**
 * Validate the registry and resolve its paths against `root`.
 * Exactly one `catalog` artifact; every other artifact is `derived` and names a
 * file-to-file generator script plus its argv template.
 */
export function loadRegistry(raw, root) {
  if (!isPlainObject(raw) || raw.schemaVersion !== REGISTRY_SCHEMA || !Array.isArray(raw.artifacts)) {
    throw new RefreshError(`registry: expected schemaVersion "${REGISTRY_SCHEMA}" with an artifacts[] array`)
  }
  const seenIds = new Set()
  const seenPaths = new Set()
  const artifacts = raw.artifacts.map((entry, index) => {
    const where = `artifacts[${index}]`
    if (!isPlainObject(entry)) throw new RefreshError(`registry: ${where} must be an object`)
    if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw new RefreshError(`registry: ${where}.id must be a lowercase kebab-case string`)
    }
    if (seenIds.has(entry.id)) throw new RefreshError(`registry: duplicate artifact id "${entry.id}"`)
    seenIds.add(entry.id)
    const file = insideRoot(root, entry.path, `${where}.path`)
    if (seenPaths.has(file)) throw new RefreshError(`registry: two artifacts write ${entry.path}`)
    seenPaths.add(file)
    if (entry.kind === "catalog") {
      return { id: entry.id, kind: "catalog", file }
    }
    if (entry.kind !== "derived") {
      throw new RefreshError(`registry: ${where}.kind must be "catalog" or "derived"`)
    }
    const generator = entry.generator
    if (!isPlainObject(generator)) throw new RefreshError(`registry: ${where}.generator is required`)
    const script = insideRoot(root, generator.script, `${where}.generator.script`)
    if (!Array.isArray(generator.args) || !generator.args.every((arg) => typeof arg === "string")) {
      throw new RefreshError(`registry: ${where}.generator.args must be an array of strings`)
    }
    if (!generator.args.includes("{catalog}") || !generator.args.includes("{out}")) {
      throw new RefreshError(`registry: ${where}.generator.args must use both {catalog} and {out}`)
    }
    return { id: entry.id, kind: "derived", file, script, args: generator.args }
  })
  const catalogs = artifacts.filter((artifact) => artifact.kind === "catalog")
  if (catalogs.length !== 1) throw new RefreshError("registry: exactly one artifact must have kind \"catalog\"")
  return { catalog: catalogs[0], derived: artifacts.filter((artifact) => artifact.kind === "derived") }
}

// -----------------------------------------------------------------------------
// Source pull
// -----------------------------------------------------------------------------

/**
 * Pull both feeds once into `dir`. `load` is injectable so tests never touch the
 * network. Both feeds are fetched before anything is written, so a failure
 * leaves any previous pull intact.
 */
export async function pullSources(dir, { load = loadJsonSource, now = () => new Date() } = {}) {
  const models = await load(USAI_MODELS_URL)
  const modelsDev = await load(MODELS_DEV_URL)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, MODELS_FILE), JSON.stringify(models, null, 2) + "\n")
  await writeFile(path.join(dir, MODELS_DEV_FILE), JSON.stringify(modelsDev, null, 2) + "\n")
  await writeFile(
    path.join(dir, PULL_FILE),
    JSON.stringify({ modelsList: USAI_MODELS_URL, enrichment: MODELS_DEV_URL, pulledAt: now().toISOString() }, null, 2) + "\n",
  )
}

/** Refuse a live pull unless the environment allows it. Never reads a key value. */
export function assertLivePullAllowed(env, { allowCi = false } = {}) {
  const inCi = Boolean(env.CI && env.CI !== "false" && env.CI !== "0") || Boolean(env.GITHUB_ACTIONS)
  if (inCi && !allowCi) {
    throw new RefreshError(
      "refusing a live pull in CI: no credential is stored for CI by design.\n" +
        "  Run the live pull on a maintainer host, or pass --from <dir> to work offline.",
    )
  }
  if (typeof env[USAI_API_KEY_ENV] !== "string" || env[USAI_API_KEY_ENV].trim() === "") {
    throw new RefreshError(
      `a live pull needs ${USAI_API_KEY_ENV} in the environment (it is never taken from a flag).\n` +
        "  Set it and re-run, or pass --from <dir> to regenerate offline from a saved pull.",
    )
  }
}

async function readSourceLabels(dir, noEnrichment) {
  try {
    const pull = JSON.parse(await readFile(path.join(dir, PULL_FILE), "utf8"))
    if (isPlainObject(pull) && typeof pull.modelsList === "string" && typeof pull.enrichment === "string") {
      return { modelsList: pull.modelsList, enrichment: pull.enrichment }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw new RefreshError(`${PULL_FILE} in ${dir} is not readable JSON`)
  }
  return { modelsList: `offline:${MODELS_FILE}`, enrichment: noEnrichment ? "(none)" : `offline:${MODELS_DEV_FILE}` }
}

// -----------------------------------------------------------------------------
// Generation into a staging directory
// -----------------------------------------------------------------------------

function runGenerator(artifact, root, stageCatalog, stageOut) {
  const args = artifact.args.map((arg) => (arg === "{catalog}" ? stageCatalog : arg === "{out}" ? stageOut : arg))
  // The generator is a file-to-file transform: a minimal environment (no
  // credentials), no shell, bounded time and output.
  const result = spawnSync(process.execPath, [artifact.script, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: GENERATOR_TIMEOUT_MS,
    maxBuffer: GENERATOR_MAX_BUFFER,
  })
  if (result.error || result.status !== 0) {
    const why = result.error ? result.error.message : (result.stderr || result.stdout || `exit ${result.status}`).trim()
    throw new RefreshError(`generator for "${artifact.id}" failed: ${why}`)
  }
}

/** Build every registered artifact into `stage`. Nothing under `root` is touched. */
async function generate({ registry, root, sourceDir, noEnrichment, stage }) {
  const modelsFile = path.join(sourceDir, MODELS_FILE)
  const modelsDevFile = path.join(sourceDir, MODELS_DEV_FILE)
  const opts = { "--models-url": modelsFile, "--out": registry.catalog.file }
  const flags = new Set()
  if (noEnrichment) flags.add("--no-enrichment")
  else opts["--models-dev"] = modelsDevFile

  const catalog = await buildCatalog({ flags, opts, sourceLabels: await readSourceLabels(sourceDir, noEnrichment) })
  const generated = new Map()
  const stageCatalog = path.join(stage, "catalog.json")
  await writeFile(stageCatalog, serialize(catalog))
  generated.set(registry.catalog.id, await readFile(stageCatalog, "utf8"))

  for (const artifact of registry.derived) {
    const stageOut = path.join(stage, `${artifact.id}.json`)
    runGenerator(artifact, root, stageCatalog, stageOut)
    generated.set(artifact.id, await readFile(stageOut, "utf8"))
  }
  return { catalog, generated }
}

// -----------------------------------------------------------------------------
// Comparing against the committed artifacts
// -----------------------------------------------------------------------------

async function readIfPresent(file) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Substantive top-level fields that describeDrift reports on its own. */
const REPORTED_BY_DESCRIBE_DRIFT = new Set(["schemaVersion", "generatedBy", "recommendations", "gateway", "vendors", "models"])

/**
 * Every top-level field that differs, other than the ones describeDrift names and
 * `sources` (provenance, not content). Catches added, removed and changed fields.
 */
function describeOtherFieldDrift(committed, fresh, ignore) {
  const lines = []
  for (const key of [...new Set([...Object.keys(committed), ...Object.keys(fresh)])].sort()) {
    if (ignore.has(key)) continue
    if (JSON.stringify(committed[key]) !== JSON.stringify(fresh[key])) lines.push(`field changed: ${key}`)
  }
  return lines
}

/** Describe how a committed artifact differs from what the sources produce. */
export function describeArtifactDrift(artifact, committedText, freshText, committedCatalog, freshCatalog) {
  if (committedText === undefined) return ["file is missing"]
  if (artifact.kind === "catalog") {
    // `sources` is provenance, not content: it is deliberately not compared.
    // Everything else is, so a field describeDrift does not know about still counts.
    const committed = isPlainObject(committedCatalog) ? committedCatalog : {}
    return [
      ...describeDrift(substantive(committed), substantive(freshCatalog)),
      ...describeOtherFieldDrift(committed, freshCatalog, new Set([...REPORTED_BY_DESCRIBE_DRIFT, "sources"])),
    ]
  }
  if (committedText === freshText) return []
  const committed = parseJson(committedText)
  const fresh = parseJson(freshText)
  if (!isPlainObject(committed) || !isPlainObject(fresh)) return ["content differs"]
  const lines = [
    ...describeDrift(committed, fresh),
    ...describeOtherFieldDrift(committed, fresh, REPORTED_BY_DESCRIBE_DRIFT),
  ]
  return lines.length > 0 ? lines : ["bytes differ (formatting only)"]
}

async function writeAtomically(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, text)
  await rename(temp, file)
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Run a refresh. Returns { status, report } where status is 0 (clean/written) or
 * 1 (drift in check mode). Throws RefreshError for operational failures.
 */
export async function runRefresh(options) {
  const {
    root = DEFAULT_ROOT,
    registryPath = DEFAULT_REGISTRY,
    from,
    pullDir = path.join(root, "tmp", "usai-source"),
    check = false,
    noEnrichment = false,
    allowCi = false,
    env = process.env,
    load,
  } = options

  const registry = loadRegistry(parseJson(await readFile(registryPath, "utf8")), root)

  let sourceDir = from ? path.resolve(from) : pullDir
  if (!from) {
    assertLivePullAllowed(env, { allowCi })
    await pullSources(pullDir, load ? { load } : {})
    sourceDir = pullDir
  }
  for (const needed of noEnrichment ? [MODELS_FILE] : [MODELS_FILE, MODELS_DEV_FILE]) {
    if ((await readIfPresent(path.join(sourceDir, needed))) === undefined) {
      throw new RefreshError(`${needed} not found in ${sourceDir}`)
    }
  }

  const stage = await mkdtemp(path.join(os.tmpdir(), "usai-refresh-"))
  try {
    const { catalog, generated } = await generate({ registry, root, sourceDir, noEnrichment, stage })
    const everything = [registry.catalog, ...registry.derived]
    const report = []
    let drifted = false
    const committedCatalogText = await readIfPresent(registry.catalog.file)
    const committedCatalog = committedCatalogText === undefined ? undefined : parseJson(committedCatalogText)

    for (const artifact of everything) {
      const committedText = await readIfPresent(artifact.file)
      const freshText = generated.get(artifact.id)
      const label = path.relative(root, artifact.file)
      if (check) {
        const lines = describeArtifactDrift(artifact, committedText, freshText, committedCatalog, catalog)
        if (lines.length === 0) report.push(`${artifact.id}: up to date (${label})`)
        else {
          drifted = true
          report.push(`${artifact.id}: DRIFT (${label})`, ...lines.map((line) => `  - ${line}`))
        }
      } else if (committedText === freshText) {
        report.push(`${artifact.id}: unchanged (${label})`)
      } else {
        report.push(`${artifact.id}: changed (${label})`)
      }
    }

    if (!check) {
      // Everything generated without error; only now touch the working tree.
      for (const artifact of everything) {
        if ((await readIfPresent(artifact.file)) !== generated.get(artifact.id)) {
          await writeAtomically(artifact.file, generated.get(artifact.id))
        }
      }
      report.push("Review the diff; nothing was committed.")
    }
    return { status: drifted ? 1 : 0, report }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--")) throw new RefreshError(`${arg} requires a value`)
      return next
    }
    if (arg === "--check") options.check = true
    else if (arg === "--no-enrichment") options.noEnrichment = true
    else if (arg === "--allow-ci") options.allowCi = true
    else if (arg === "--from") options.from = value()
    else if (arg === "--pull-dir") options.pullDir = path.resolve(value())
    else if (arg === "--root") options.root = path.resolve(value())
    else if (arg === "--registry") options.registryPath = path.resolve(value())
    else throw new RefreshError(`unknown argument: ${arg}`)
  }
  if (options.root && !options.registryPath) {
    options.registryPath = path.join(options.root, "integrations/providers/usai/refresh-registry.json")
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { status, report } = await runRefresh(options)
  process.stdout.write(report.join("\n") + "\n")
  process.exitCode = status
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof RefreshError ? error.message : `refresh failed: ${error.message}`)
    process.exitCode = 2
  })
}
