#!/usr/bin/env node
//
// normalize-catalog.mjs — convert the USAi-specific harness-neutral catalog
// (integrations/providers/usai/catalog.schema.json, "usai-model-catalog/v1")
// into the acq-neutral, cross-provider model-catalog shape
// ("acq-neutral-model-catalog/v1") this kit vendors and ships to consumers
// that discover providers via the facts self-registration mechanism (see
// spec.yaml's header comment and its startup command that writes
// /var/lib/acq/models/providers/usai.json). See
// integrations/isolation/docs/decisions/0003-neutral-model-provider-discovery.md
// (this ADR is pending merge in a separate PR; the path will resolve once it
// lands) for why a provider-neutral shape exists at all: a future consumer
// (e.g. a models orchestrator) should be able to read pricing/limits for
// EVERY configured provider without knowing each provider's own catalog
// schema.
//
// This is a HOST-SIDE authoring tool, like sync-usai-models.mjs — it does NOT
// ship into the guest (it lives under scripts/, not files/). It is a pure
// function in spirit: reads exactly one file, writes exactly one file, makes
// no network calls, and has no other side effects. Unlike sync-usai-models.mjs
// it does not fetch anything live; it only re-shapes an already-fetched
// catalog.json that some other process (build-catalog.mjs, upstream in
// integrations/providers/usai/) produced.
//
// UNIT-CONVENTION DECISION: integrations/providers/usai/catalog.schema.json's
// `cost` $def documents "Per-million-token pricing." This script passes cost
// values through UNCHANGED (no /1e6 or *1e6 transform) — the neutral output
// is ALSO per-million-token. This is the simplest option (no transform, no
// rounding/precision loss, matches the source verbatim) and there is no
// current consumer that needs per-single-token values. The vendored fallback
// snapshot (files/home/usai-config/model-catalog-snapshot.json) uses the SAME
// convention for internal consistency — both this script's output and that
// snapshot are per-million-token. If a future consumer needs per-token
// pricing, convert at the READ site, not here, so this file stays a faithful,
// lossless re-shape of its source.
//
// Usage:
//   node normalize-catalog.mjs [--source <path>] [--out <path>]
//     --source  default: integrations/providers/usai/catalog.json (resolved
//               relative to this script's own directory, so the default works
//               regardless of the caller's cwd)
//     --out     default: <kit>/tests/output/usai-normalized-catalog.json.
//               tests/output/ (not tests/fixtures/) matches the existing
//               convention this kit already established in
//               sync-usai-models.mjs's --write-snapshot flag: fixtures/ is
//               for hand-authored test INPUTS (see
//               tests/fixtures/normalize-catalog-source.json, a fake input),
//               output/ is for GENERATED artifacts, so a generated file is
//               never mistaken for one meant to be hand-edited. Not
//               gitignored — an explicit `--out` run is a deliberate,
//               reviewable action, same as sync-usai-models.mjs's snapshot.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

// This file lives at <kit>/scripts/normalize-catalog.mjs. The USAi catalog
// lives at <repo>/integrations/providers/usai/catalog.json, i.e.
// <kit>/../../../../providers/usai/catalog.json (kit is
// integrations/isolation/acq-kits/usai-provider/, so climbing out of
// scripts/ -> kit root -> acq-kits/ -> isolation/ -> integrations/ lands at
// integrations/, then down into providers/usai/).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const KIT_ROOT = path.resolve(SCRIPT_DIR, "..")
const DEFAULT_SOURCE_PATH = path.resolve(SCRIPT_DIR, "../../../../providers/usai/catalog.json")
const DEFAULT_OUT_PATH = path.join(KIT_ROOT, "tests/output/usai-normalized-catalog.json")

const NEUTRAL_SCHEMA_VERSION = "acq-neutral-model-catalog/v1"
const PROVIDER_ID = "usai"

/**
 * Re-shape one usai-model-catalog/v1 model entry into the neutral
 * per-model shape. Field NAMES are reused verbatim from
 * integrations/providers/usai/catalog.schema.json (contextWindow,
 * maxOutputTokens, cost.{input,output,cacheRead,cacheWrite}) — this function
 * does not invent new names, only narrows the shape to the fields the neutral
 * schema models today (drops vendor/name/costAbove200kContext/reasoning/
 * inputModalities, which the neutral v1 shape does not carry).
 * @param {object} model - one entry from the source catalog's `models[]`
 * @returns {{id: string, contextWindow?: number, maxOutputTokens?: number, cost?: object}}
 */
function normalizeModel(model) {
  const out = { id: model.id }
  if (typeof model.contextWindow === "number") {
    out.contextWindow = model.contextWindow
  }
  if (typeof model.maxOutputTokens === "number") {
    out.maxOutputTokens = model.maxOutputTokens
  }
  if (model.cost && typeof model.cost === "object") {
    // Pass through unchanged — see the per-million-token decision above.
    // Only copy the scalar keys the source schema defines, so an unexpected
    // extra key on the source can't leak into the neutral output unnoticed.
    const cost = {}
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      if (typeof model.cost[key] === "number") {
        cost[key] = model.cost[key]
      }
    }
    if (Object.keys(cost).length > 0) {
      out.cost = cost
    }
  }
  return out
}

/**
 * Convert a full usai-model-catalog/v1 document into the neutral
 * acq-neutral-model-catalog/v1 shape.
 * @param {object} sourceCatalog - parsed catalog.json (usai-model-catalog/v1)
 * @returns {object} the neutral catalog document
 */
export function normalizeCatalog(sourceCatalog) {
  if (!sourceCatalog || typeof sourceCatalog !== "object" || !Array.isArray(sourceCatalog.models)) {
    throw new Error("normalizeCatalog: source catalog is missing a models[] array")
  }
  return {
    schemaVersion: NEUTRAL_SCHEMA_VERSION,
    providerId: PROVIDER_ID,
    models: sourceCatalog.models.map(normalizeModel),
  }
}

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE_PATH, out: DEFAULT_OUT_PATH }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") args.source = path.resolve(argv[++i])
    else if (argv[i] === "--out") args.out = path.resolve(argv[++i])
  }
  return args
}

async function main() {
  const { source, out } = parseArgs(process.argv.slice(2))

  const sourceText = await readFile(source, "utf8")
  const sourceCatalog = JSON.parse(sourceText)
  const neutralCatalog = normalizeCatalog(sourceCatalog)

  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(neutralCatalog, null, 2) + "\n")

  process.stdout.write(`Wrote ${neutralCatalog.models.length} normalized models to ${out}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`normalize-catalog: failed: ${error.message}`)
    process.exit(1)
  })
}
