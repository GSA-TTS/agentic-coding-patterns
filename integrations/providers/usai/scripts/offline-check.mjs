#!/usr/bin/env node

// =============================================================================
// offline-check.mjs — the offline drift check the scheduled workflow runs.
//
// It needs no network and no credential. It runs two checks:
//
//   1. Determinism. In a throwaway repository root that holds the committed
//      tooling (registry, schema, generators) and the committed FIXTURE
//      artifacts, run
//        refresh.mjs --root <temp> --from tests/fixtures/refresh --check
//      The fixture artifacts are used, not the shipped catalog, because the
//      shipped catalog comes from the live feed and would differ from the fixture
//      feeds after any real refresh. This proves the builder, the registry and
//      the generators still reproduce known data byte for byte.
//
//   2. Consistency. Every derived artifact in the registry is regenerated from
//      the SHIPPED catalog.json and compared with the committed file, so a
//      catalog change without a matching snapshot change is reported.
//
// Exit status: 0 both pass; 1 drift; 2 the check could not run.
//   node offline-check.mjs [--root <repo root>]
// =============================================================================

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

// Loaded lazily so that a syntax error in refresh.mjs or build-catalog.mjs is
// reported as "could not run" (exit 2), never as drift (exit 1, which is what
// Node uses for an uncaught load error).
let loadRegistry
let loadError
try {
  ;({ loadRegistry } = await import("./refresh.mjs"))
} catch (error) {
  loadError = error
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(HERE, "../../../..")
const REGISTRY_REL = "integrations/providers/usai/refresh-registry.json"
const SCHEMA_REL = "integrations/providers/usai/catalog.schema.json"
const FIXTURES_REL = "integrations/providers/usai/tests/fixtures/refresh"
// Fixture copy of each registered artifact, by registry id.
const FIXTURE_ARTIFACTS = { catalog: "artifacts/catalog.json", "neutral-snapshot": "artifacts/snapshot.json" }

const read = (file) => readFileSync(file, "utf8")

function place(root, tempRoot, rel) {
  const target = path.join(tempRoot, rel)
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(path.join(root, rel), target)
}

function generate(artifact, root, catalogFile, outFile) {
  const args = artifact.args.map((arg) => (arg === "{catalog}" ? catalogFile : arg === "{out}" ? outFile : arg))
  return spawnSync(process.execPath, [artifact.script, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  })
}

/** Run both checks. Returns { status, lines }. Never throws for a failed check. */
export function runOfflineCheck({ root = DEFAULT_ROOT } = {}) {
  if (loadError) throw new Error(`cannot load the refresh tooling: ${loadError.message}`)
  const lines = []
  let status = 0
  const bump = (to) => {
    status = Math.max(status, to)
  }
  const registry = loadRegistry(JSON.parse(read(path.join(root, REGISTRY_REL))), root)
  const temp = mkdtempSync(path.join(os.tmpdir(), "usai-offline-check-"))
  try {
    // 1. Determinism over the fixtures.
    place(root, temp, REGISTRY_REL)
    place(root, temp, SCHEMA_REL)
    for (const artifact of registry.derived) place(root, temp, path.relative(root, artifact.script))
    for (const artifact of [registry.catalog, ...registry.derived]) {
      const fixture = FIXTURE_ARTIFACTS[artifact.id]
      if (!fixture) {
        lines.push(`fixtures: no fixture copy is registered for artifact "${artifact.id}"; add one`)
        return { status: 2, lines }
      }
      const target = path.join(temp, path.relative(root, artifact.file))
      mkdirSync(path.dirname(target), { recursive: true })
      cpSync(path.join(root, FIXTURES_REL, fixture), target)
    }
    const refresh = spawnSync(
      process.execPath,
      [path.join(HERE, "refresh.mjs"), "--root", temp, "--from", path.join(root, FIXTURES_REL), "--check"],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: 120_000, maxBuffer: 1024 * 1024 },
    )
    lines.push("== determinism: refresh.mjs --from <fixtures> --check")
    lines.push(...(refresh.stdout + refresh.stderr).split("\n").filter((line) => line && !line.startsWith("  excluded ")))
    if (refresh.error || refresh.status === null) {
      lines.push(`determinism: could not run (${refresh.error?.message ?? "no exit status"})`)
      bump(2)
    } else if (refresh.status === 1) bump(1)
    else if (refresh.status !== 0) bump(2)

    // 2. Consistency of the shipped artifacts.
    lines.push("== consistency: shipped derived artifacts vs shipped catalog.json")
    for (const artifact of registry.derived) {
      const out = path.join(temp, `shipped-${artifact.id}.json`)
      const result = generate(artifact, root, registry.catalog.file, out)
      if (result.error || result.status !== 0 || !existsSync(out)) {
        lines.push(`${artifact.id}: generator failed (${(result.error?.message ?? result.stderr ?? "").trim() || `exit ${result.status}`})`)
        bump(2)
      } else if (!existsSync(artifact.file)) {
        lines.push(`${artifact.id}: DRIFT (committed file is missing)`)
        bump(1)
      } else if (read(out) !== read(artifact.file)) {
        lines.push(`${artifact.id}: DRIFT (committed file differs from the shipped catalog.json)`)
        bump(1)
      } else lines.push(`${artifact.id}: up to date`)
    }
    return { status, lines }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const rootIndex = process.argv.indexOf("--root")
    const root = rootIndex > -1 ? path.resolve(process.argv[rootIndex + 1] ?? "") : DEFAULT_ROOT
    const { status, lines } = runOfflineCheck({ root })
    process.stdout.write(lines.join("\n") + "\n")
    process.exitCode = status
  } catch (error) {
    console.error(`offline check failed: ${error.message}`)
    process.exitCode = 2
  }
}
