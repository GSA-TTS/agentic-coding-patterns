#!/usr/bin/env node

// =============================================================================
// build-catalog.mjs — the FETCH + SHAPE half of the USAi catalog pipeline.
//
// Data flow:
//   live feeds -> build-catalog.mjs -> catalog.json -> per-harness emitters
//
// This script derives `integrations/providers/usai/catalog.json` (schema
// `usai-model-catalog/v1`). It DOES NOT render any harness config — the RENDER
// half (the opencode.jsonc emitter) lives in a later issue and consumes this
// catalog. The byte-exact round-trip test against the renderer contract fixture is
// the safety gate; therefore the FIRST committed catalog.json is BOOTSTRAPPED
// from that shipped file's `// BEGIN GENERATED USAI MODELS` block so it exactly
// represents today's models. Live-feed mode (fetch USAi + models.dev) is
// provided for future regeneration.
//
// Modes:
//   (default, no flags)     bootstrap catalog.json from the prior shipped production config
//                           GENERATED block (offline, deterministic).
//   --models-url <path|url> read the USAi model list from a local path or URL.
//   --no-enrichment         do not fetch/read models.dev; use only the models
//                           list (limits/costs come from the fixture/list only).
//   --models-dev <path|url> read models.dev enrichment from a local path or URL.
//   --bootstrap             force bootstrap-from-opencode.jsonc mode (default
//                           when neither --models-url nor live fetch is used).
//   --opencode-jsonc <path> override the bootstrap source path.
//   --out <path>            override the output catalog.json path.
//   --check                 do not write; fail if catalog.json has drifted.
//   --include-capabilities  OPT-IN: copy reasoning/input-modality values from the
//                           matched models.dev entry into live-feed output. Off by
//                           default because models.dev describes the upstream
//                           provider, not what the USAi gateway forwards; output
//                           produced with this flag must not be committed until each
//                           value has per-model, per-field evidence (the synthetic-
//                           image procedure covers image input only; see ADR 0006
//                           and the opencode kit's synthetic-image-validation.md).
//                           sources.capabilitiesVerified is a catalog-wide release
//                           reminder, not that evidence. With the
//                           flag, --check against a capability-free catalog.json
//                           reports drift by design.
//
// What --check compares: the SUBSTANTIVE catalog — schemaVersion, gateway,
// vendors, and models. It deliberately IGNORES the `sources` block, which
// records provenance (which feed or file this run read) and legitimately
// differs between a live-feed regeneration and an offline bootstrap of the
// same models. Comparing it would make --check fail on every offline run
// regardless of real drift, and a drift detector that always fires is one
// everybody learns to ignore — at which point genuine model drift is
// indistinguishable from the noise. On a real difference, --check reports
// WHICH ids were added, removed, or changed, because a diff is actionable
// where a boolean is not.
//
// CI / round-trip callers use the offline paths (--bootstrap, or --models-url
// against committed fixtures with --no-enrichment) so no network is required.
//
// Live invocation (regenerating from the real USAi gateway) requires a USAi API
// key, because the gateway rejects unauthenticated /models requests:
//
//   USAI_API_KEY=… node scripts/build-catalog.mjs \
//     --models-url https://api.gsa.usai.gov/api/v1/models
//
// The key is read from the ENVIRONMENT ONLY. There is deliberately NO CLI flag
// for it (flags land in shell history and process listings), it is never logged,
// and it is never written into catalog.json — `sources.modelsList` records the
// URL, not the credential. If the key is missing, or the gateway answers 401/403,
// the build FAILS LOUDLY rather than falling back to bootstrap or emitting a
// partial catalog: a silently-degraded catalog is worse than no catalog.
// =============================================================================

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")

const DEFAULT_OUT = path.join(USAI_DIR, "catalog.json")
const DEFAULT_SCHEMA = path.join(USAI_DIR, "catalog.schema.json")
const DEFAULT_OPENCODE_JSONC = path.join(
  REPO_ROOT,
  "integrations/providers/usai/tests/fixtures/opencode-production.jsonc",
)
// Path recorded in catalog.sources.bootstrappedFrom — repo-relative, stable.
const OPENCODE_JSONC_REL =
  "integrations/providers/usai/tests/fixtures/opencode-production.jsonc"

const GENERATED_START = "// BEGIN GENERATED USAI MODELS"
const GENERATED_END = "// END GENERATED USAI MODELS"

const SCHEMA_VERSION = "usai-model-catalog/v1"
const GENERATED_MARKER = "build-catalog.mjs (generated — do not hand-edit)"

const USAI_MODELS_URL = "https://api.gsa.usai.gov/api/v1/models"
const MODELS_DEV_URL = "https://models.dev/api.json"

// Network hardening (mirrors the monolith sync-usai-models.mjs): bound time and
// size, and shape-validate before trusting third-party content.
const FETCH_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB
const MAX_MODELS = 1000

const FALLBACK_LIMITS = { context: 128000, output: 8192 }

// Vendor grouping + USAi backend routing. Order here is the canonical vendor
// display order for the catalog (Anthropic, OpenAI, Google, Meta, Cohere).
// usaiBackend records the backend USAi routes each vendor through — the same
// backend the monolith sources pricing from (Anthropic->Bedrock, OpenAI->Azure,
// Gemini->Vertex, Meta->Bedrock, Cohere->Cohere).
const VENDOR_CONFIG = {
  anthropic: { label: "Anthropic", order: 1, usaiBackend: "amazon-bedrock" },
  openai: { label: "OpenAI", order: 2, usaiBackend: "azure" },
  google: { label: "Google", order: 3, usaiBackend: "google-vertex" },
  meta: { label: "Meta", order: 4, usaiBackend: "amazon-bedrock" },
  cohere: { label: "Cohere", order: 5, usaiBackend: "cohere" },
  other: { label: "Other", order: 99, usaiBackend: "" },
}

// models.dev provider search order per vendor (primary backend, then fallbacks)
// — same routing the monolith uses so enrichment reads the backend USAi serves.
const VENDOR_PROVIDER_MAP = {
  anthropic: { primary: "amazon-bedrock", fallback: ["anthropic"] },
  openai: { primary: "azure", fallback: ["openai"] },
  google: { primary: "google-vertex", fallback: ["google"] },
  meta: { primary: "amazon-bedrock", fallback: ["meta", "llama"] },
  cohere: { primary: "cohere", fallback: [] },
  other: { primary: null, fallback: [] },
}

// Display-name overrides carried over from the monolith for complex IDs.
const DISPLAY_NAME_OVERRIDES = {
  "gpt-5.4-latest-guardrails-defaultv2": "GPT-5.4 Latest — Guardrails Default v2",
  "gpt-5.2-latest-guardrails-defaultv2": "GPT-5.2 Latest — Guardrails Default v2",
}

// -----------------------------------------------------------------------------
// Vendor classification (owned_by + id prefix), from the monolith.
// -----------------------------------------------------------------------------
function normalizeText(value) {
  return String(value ?? "").toLowerCase()
}

function classifyVendor(id, ownedBy) {
  const owned = normalizeText(ownedBy)
  if (owned.includes("anthropic") || /^claude/i.test(id)) return "anthropic"
  if (owned.includes("open ai") || owned.includes("openai") || /^gpt/i.test(id)) return "openai"
  if (owned.includes("google") || /^gemini/i.test(id)) return "google"
  if (owned.includes("meta") || /^llama/i.test(id)) return "meta"
  if (owned.includes("cohere") || /^cohere/i.test(id)) return "cohere"
  return "other"
}

function generateDisplayName(id) {
  if (DISPLAY_NAME_OVERRIDES[id]) return DISPLAY_NAME_OVERRIDES[id]
  return id
    .replace(/[_-]+/g, " ")
    .replace(/(\d)\s+(\d)/g, "$1.$2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bLlama\b/g, "Llama")
}

// -----------------------------------------------------------------------------
// Fuzzy models.dev matching (structural re-implementation of the monolith).
// -----------------------------------------------------------------------------

// Gateway deployment suffixes that carry no model identity. USAi appends these
// to distinguish a deployment (guardrail profile, "latest" alias, default
// deployment revision) of the SAME underlying model, so they must be stripped
// before comparing against models.dev, which names only the model. `default_v2`
// / `default-v2` is the same class of noise as `guardrails` and `latest`.
const GATEWAY_SUFFIXES = [/guardrails.*$/i, /latest.*$/i, /-default-?v\d+$/i]

// Some upstream catalogs glue a family's major version onto the family name
// ("meta.llama4-maverick-…" on Bedrock) while the gateway separates it
// ("llama_4_maverick"). Splitting the glued digit lets the shared family/version
// scorer align the two forms instead of settling for a variant-only near-miss.
// Keyed by family so unrelated ids that merely end in a digit are untouched.
const GLUED_FAMILY_VERSION = /\b(llama)(\d)/g

function normalizeModelId(id) {
  const withoutProvider = id.includes("/") ? id.split("/").pop() : id
  let out = withoutProvider
    .toLowerCase()
    .replace(GLUED_FAMILY_VERSION, "$1-$2")
    .replace(/[_-]+/g, "-")
    .replace(/(\d)\.(\d)/g, "$1-$2")
  for (const suffix of GATEWAY_SUFFIXES) out = out.replace(suffix, "")
  return out.replace(/-+$/, "")
}

// Token classes shared by the tokenizer and the precision guard. They are
// defined once so the guard's identity residue cannot drift out of agreement
// with what the tokenizer consumed — a token recognized here as a family or
// variant must not also count as identity-bearing remainder.
const FAMILY_TOKEN = /^(claude|gpt|gemini|llama\d*|command)$/i
const VARIANT_TOKEN = /^(opus|sonnet|haiku|pro|flash|mini|nano|maverick)$/i
const LEADING_PROVIDER_TOKEN = /^(anthropic|openai|google|meta|amazon|aws|bedrock|azure|vertex|mistral|ai21|deepseek|microsoft|xai|cohere)$/
const LEADING_REGION_TOKEN = /^(us|eu|au|uk|ca|jp|ap|sa|global|gov|govcloud)$/
const MARKETPLACE_REVISION_TOKEN = /^v\d+(?::\d+)?$/

// A terminal ISO date is deployment metadata, not part of the model version.
// Accept the extended and basic ISO forms used by models.dev, but only after a
// calendar check. A date-shaped but invalid suffix stays on the identity below
// so it cannot collapse onto an undated model or a different invalid suffix.
function terminalDateMetadata(normalized) {
  // Marketplace revisions can follow the date (`...-20251101-v1:0`). Peel the
  // recognized packaging token only for date parsing, then restore it to the
  // identity so the ordinary noise filter consumes it.
  const revision = normalized.match(/(-v\d+(?::\d+)?)$/)?.[1] ?? ""
  const dateInput = revision ? normalized.slice(0, -revision.length) : normalized
  const match = dateInput.match(/-(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2}))$/)
  if (!match) return { identity: normalized, date: null, invalidDate: null }

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2] ?? match[4], 10)
  const day = Number.parseInt(match[3] ?? match[5], 10)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
  if (!valid) return { identity: normalized, date: null, invalidDate: match[0].slice(1) }

  return {
    identity: `${dateInput.slice(0, match.index)}${revision}`,
    date: `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    invalidDate: null,
  }
}

function extractModelTokens(id) {
  const normalized = normalizeModelId(id)
  const dateMetadata = terminalDateMetadata(normalized)
  // Dots delimit provider/region prefixes (`eu.anthropic.claude`), while
  // colons stay inside marketplace revision tokens (`v1:0`). Numeric version
  // dots were already normalized to hyphens by normalizeModelId().
  const parts = dateMetadata.identity.split("-").flatMap((part) => part.split(/[./]/))
  let family = ""
  let variant = ""
  const versionParts = []
  const identityParts = []
  for (const [index, part] of parts.entries()) {
    if (!family && (LEADING_PROVIDER_TOKEN.test(part) || LEADING_REGION_TOKEN.test(part))) {
      continue
    }
    if (FAMILY_TOKEN.test(part)) {
      const candidate = /^llama/i.test(part) ? "llama" : /^command$/i.test(part) ? "cohere" : part
      if (!family) family = candidate
      else identityParts.push(part)
    } else if (VARIANT_TOKEN.test(part)) {
      if (!variant) variant = part
      else identityParts.push(part)
    } else if (/^\d+$/.test(part) && versionParts.length < 2) {
      // Compare version tokens as canonical strings: converting an arbitrary
      // decimal id to Number loses precision above MAX_SAFE_INTEGER.
      versionParts.push(part.replace(/^0+(?=\d)/, ""))
    } else if (index === parts.length - 1 && MARKETPLACE_REVISION_TOKEN.test(part)) {
      continue
    } else {
      identityParts.push(part)
    }
  }
  if (!family) {
    if (/claude/i.test(normalized)) family = "claude"
    else if (/gpt/i.test(normalized)) family = "gpt"
    else if (/gemini/i.test(normalized)) family = "gemini"
    else if (/llama/i.test(normalized)) family = "llama"
    else if (/cohere|command/i.test(normalized)) family = "cohere"
  }
  return { family, version: versionParts, variant, identityParts, ...dateMetadata }
}

// Tokens that carry no model identity, only packaging. Each is a FULL token
// (the id is split on separators first), so no substring can match by accident.
// Anything NOT listed here and not a family/variant/version token is treated as
// identity-bearing — see identityResidue below for why that direction matters.
const IDENTITY_NOISE = [
  // Parameter counts and tuning descriptors name packaging, not identity.
  /^\d+(\.\d+)?x?\d*[bmk]$/,
  /^(instruct|instructed|it|chat|text)$/,
]

// Does an id carry the `lite` qualifier as its own token? Substring testing is
// wrong here: it would see "lite" inside an unrelated word. `flash-lite` is a
// DIFFERENT model from `flash`, with different limits and pricing.
function hasLiteToken(normalizedId) {
  return /(^|[.\-/])lite([.\-]|$)/.test(normalizedId)
}

// Every token an id carries that is NOT its family, variant, version, or known
// packaging noise. This is the identity-bearing remainder.
//
// WHY A RESIDUE AND NOT A LIST OF QUALIFIERS. The earlier guard compared a
// hard-coded set (`codex`, `mini`, `nano`, `max`). That fails OPEN for any
// qualifier not on the list, which is the whole class of tokens a future
// gateway id might add: `gpt-5.2-luna` collapsed onto `gpt-5.2`,
// `claude-opus-5-thinking` onto `claude-opus-5`, and
// `gemini-2.5-flash-preview` onto `gemini-2.5-flash` — each inheriting a
// sibling's limits and pricing, the exact defect this guard exists to prevent.
// Enumerating qualifiers cannot work, because the set is open and owned by the
// vendors. Enumerating NOISE can, because that set is small, observable in the
// catalogs we actually read, and safe to be wrong about in the closed
// direction: an unrecognized noise token only costs a missed enrichment, which
// is reported as unenriched rather than silently wrong.
function identityResidue(tokens) {
  const residue = []
  for (const part of tokens.identityParts) {
    if (!part) continue
    if (IDENTITY_NOISE.some((re) => re.test(part))) continue
    residue.push(/^\d+$/.test(part) ? part.replace(/^0+(?=\d)/, "") : part)
  }
  if (tokens.invalidDate) residue.push(tokens.invalidDate)
  return residue
}

function sameIdentityResidue(usaiTokens, catalogTokens) {
  const a = identityResidue(usaiTokens)
  const b = identityResidue(catalogTokens)
  return a.length === b.length && a.every((token, index) => token === b[index])
}

// PRECISION GUARD. Scoring alone cannot be trusted to reject a wrong candidate:
// it ranks whatever it is given and the best of a bad field still wins. These
// are the agreements a candidate MUST satisfy to be considered at all, because
// disagreeing on any of them means it is a DIFFERENT model:
//
//   family       claude is not gpt
//   tier/variant haiku is not opus is not sonnet; flash is not pro
//   major.minor  4.5 is not 5 and is not 4.8
//   lite         flash-lite is not flash
//   residue      every other identity-bearing token must agree, so an
//                unrecognized qualifier fails CLOSED instead of being ignored
//
// Rationale for failing closed: enriching a model with a different model's
// numbers is worse than having none, because the fields come out populated and
// plausible, so a completeness check ("every model has a price") passes while
// the values are wrong. A gateway model absent from the enrichment source must
// end up visibly unenriched, never silently mis-enriched.
function isPreciseMatch(usaiTokens, catalogTokens) {
  if (usaiTokens.family !== catalogTokens.family) return false
  if ((usaiTokens.variant || "") !== (catalogTokens.variant || "")) return false
  if (hasLiteToken(usaiTokens.identity) !== hasLiteToken(catalogTokens.identity)) return false
  if (!sameIdentityResidue(usaiTokens, catalogTokens)) return false
  // A dated gateway deployment names one exact snapshot. An undated deployment
  // is an alias and may use either an undated entry or a dated snapshot.
  if (usaiTokens.date && usaiTokens.date !== catalogTokens.date) return false
  // Compare major and minor positionally. Both absent is agreement (a bare
  // family id on both sides); one absent is not.
  if (usaiTokens.version[0] !== catalogTokens.version[0]) return false
  if (usaiTokens.version[1] !== catalogTokens.version[1]) return false
  return true
}

function findModelsDevMatch(usaiId, catalog) {
  const usaiTokens = extractModelTokens(usaiId)
  const usaiNorm = normalizeModelId(usaiId)
  let bestMatch = null
  let bestRank = null
  for (const [catalogId, data] of Object.entries(catalog)) {
    const catalogTokens = extractModelTokens(catalogId)
    const catalogNorm = normalizeModelId(catalogId)
    // The guard decides ELIGIBILITY; ranking below only orders candidates that
    // already agree on identity (dated aliases and regional duplicates).
    if (!isPreciseMatch(usaiTokens, catalogTokens)) continue
    // Date rank comes before packaging score. Thus an undated identity always
    // beats its dated aliases; when only dated aliases exist, the latest valid
    // date wins. The catalog has no explicit alias mapping, so latest-date is
    // the only deterministic freshness signal available.
    const undatedRank = catalogTokens.date ? 0 : 1
    const dateRank = catalogTokens.date ?? ""
    let score = 10
    // Regional duplicates of one model: prefer the unprefixed or us/global
    // listing, since USAi serves from a US deployment.
    if (/^(eu|au)\./.test(catalogId)) score -= 15
    else if (/^(us|global)\./.test(catalogId)) score += 2
    else if (/^[a-z]{2}\./.test(catalogId)) score += 1
    else score += 3
    if (catalogNorm.startsWith(usaiNorm.slice(0, 10))) score += 5
    const rank = [undatedRank, dateRank, score]
    const isBetter =
      !bestRank ||
      rank[0] > bestRank[0] ||
      (rank[0] === bestRank[0] && rank[1] > bestRank[1]) ||
      (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] > bestRank[2]) ||
      (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] === bestRank[2] && catalogId < bestMatch.id)
    if (isBetter) {
      bestRank = rank
      bestMatch = { id: catalogId, data }
    }
  }
  return bestMatch
}

function providerModelMaps(vendor, catalog) {
  const mapping = VENDOR_PROVIDER_MAP[vendor] || VENDOR_PROVIDER_MAP.other
  const providerIds = [mapping.primary, ...mapping.fallback].filter(Boolean)
  const maps = []
  for (const id of providerIds) {
    const models = catalog[id]?.models
    if (models && typeof models === "object") maps.push({ providerId: id, models })
  }
  return maps
}

// -----------------------------------------------------------------------------
// Cost normalization. The CATALOG schema uses camelCase cost keys
// (input/output/cacheRead/cacheWrite) and a `costAbove200kContext` object with
// the same keys. models.dev uses snake_case (cache_read/cache_write) and nests
// tiered pricing under `context_over_200k`. We translate to the catalog shape.
// -----------------------------------------------------------------------------
const COST_MAP = [
  ["input", "input"],
  ["output", "output"],
  ["cacheRead", "cache_read"],
  ["cacheWrite", "cache_write"],
]

function normalizeCostFromModelsDev(cost) {
  if (!cost || typeof cost !== "object") return { cost: null, costAbove200kContext: null }
  const out = {}
  for (const [camel, snake] of COST_MAP) {
    const value = cost[snake]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`models.dev cost.${snake} must be a finite non-negative number`)
    }
    out[camel] = value
  }
  let above = null
  const over = cost.context_over_200k
  if (over && typeof over === "object") {
    const o = {}
    for (const [camel, snake] of COST_MAP) {
      const value = over[snake]
      if (value === undefined) continue
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`models.dev cost.context_over_200k.${snake} must be a finite non-negative number`)
      }
      o[camel] = value
    }
    if (typeof o.input === "number" && typeof o.output === "number") above = o
  }
  return {
    cost: Object.keys(out).length > 0 ? out : null,
    costAbove200kContext: above,
  }
}

function normalizeLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

// -----------------------------------------------------------------------------
// Capability metadata (reasoning, input modalities).
//
// Three states are kept distinct on purpose: field ABSENT = unknown, `false` /
// ["text"] = known unsupported / text-only, `true` / [..."image"...] = known
// supported. Nothing here is inferred from a model id or name; a model with no
// precise models.dev match carries no capability fields at all.
//
// models.dev describes the UPSTREAM provider's deployment, not necessarily what
// the USAi gateway forwards. Copying it is therefore OPT-IN (--include-capabilities)
// and provenance-labelled (sources.capabilities); the values must be confirmed
// against the gateway by the live synthetic-image procedure before being
// committed or relied on.
//
// The allowlist mirrors the modality names OpenCode's model config accepts and
// the neutral/USAi catalog schemas. Canonical order keeps output deterministic.
// -----------------------------------------------------------------------------
const INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"]

function normalizeInputModalities(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where} must be a non-empty array of modality names`)
  }
  for (const entry of value) {
    if (!INPUT_MODALITIES.includes(entry)) {
      throw new Error(`${where} contains unsupported modality ${JSON.stringify(entry)}; allowed: ${INPUT_MODALITIES.join(", ")}`)
    }
  }
  if (new Set(value).size !== value.length) throw new Error(`${where} must not contain duplicates`)
  return INPUT_MODALITIES.filter((modality) => value.includes(modality))
}

// Upstream data is untrusted and not ours to fail on: a malformed models.dev
// capability field is treated as UNKNOWN (omitted) with a stderr warning, so one
// bad upstream entry cannot abort the whole catalog build. Our own committed
// data (bootstrap block, catalog.json) stays fail-closed.
function capabilitiesFromModelsDev(data, id) {
  const out = {}
  let malformed = false
  const unknown = (why) => {
    malformed = true
    process.stderr.write(`  WARNING models.dev ${id}: ${why}; capability treated as unknown\n`)
  }
  if (data.reasoning !== undefined) {
    if (typeof data.reasoning === "boolean") out.reasoning = data.reasoning
    else unknown("reasoning is not a boolean")
  }
  const modalities = data.modalities
  if (modalities !== undefined) {
    if (!modalities || typeof modalities !== "object" || Array.isArray(modalities)) {
      unknown("modalities is not an object")
    } else if (modalities.input !== undefined) {
      try {
        out.inputModalities = normalizeInputModalities(modalities.input, `modalities.input`)
      } catch (error) {
        unknown(error.message)
      }
    }
  }
  return { capabilities: out, malformed }
}

// -----------------------------------------------------------------------------
// Bounded fetch + shape validation (mirrors the monolith hardening).
// -----------------------------------------------------------------------------
async function readBodyCapped(response, ref) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text()
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error(`response from ${ref} exceeded ${MAX_RESPONSE_BYTES} bytes`)
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error(`response from ${ref} exceeded ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8")
}

async function fetchJsonBounded(url, options = {}) {
  // `requiresAuth` is our own marker for error reporting, not a fetch option.
  const { requiresAuth = false, timeoutMs, ...fetchOptions } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? FETCH_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal })
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
  // Authentication failures are called out explicitly and always throw: never
  // degrade to bootstrap or to a partial catalog on a rejected credential.
  if (response.status === 401 || response.status === 403) {
    const detail = requiresAuth
      ? `the ${USAI_API_KEY_ENV} value was rejected (expired, revoked, or wrong environment)`
      : `the endpoint requires credentials this build did not send`
    throw new Error(
      `authentication to ${url} failed: ${response.status} ${response.statusText} — ${detail}.\n` +
        `  Verify ${USAI_API_KEY_ENV} in the environment and re-run. The catalog was NOT written.`,
    )
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)")
    throw new Error(`request to ${url} failed: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`)
  }
  const declaredLength = Number(response.headers.get("content-length") || "0")
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`response from ${url} too large: ${declaredLength} bytes > ${MAX_RESPONSE_BYTES}`)
  }
  const text = await readBodyCapped(response, url)
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`response from ${url} was not valid JSON: ${err.message}`)
  }
}

// A source ref is a local file path unless it looks like an http(s) URL.
function isUrl(ref) {
  return /^https?:\/\//i.test(ref)
}

// -----------------------------------------------------------------------------
// USAi gateway authentication.
//
// The USAi models endpoint requires `Authorization: Bearer <key>`; an
// unauthenticated request is rejected. The key comes from the environment only
// (see the header comment for why there is no CLI flag), and the helpers below
// keep it out of every error message and out of the emitted catalog.
// -----------------------------------------------------------------------------
const USAI_API_KEY_ENV = "USAI_API_KEY"

// True only for https URLs served by the USAi gateway host, so a key is never
// attached to models.dev or to any other third-party host. Host is compared
// exactly (or as a subdomain) to defeat lookalikes such as
// "api.gsa.usai.gov.evil.example".
function needsUsaiAuth(ref) {
  if (!isUrl(ref)) return false
  let parsed
  try {
    parsed = new URL(ref)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:") return false
  const host = parsed.hostname.toLowerCase()
  const gatewayHost = buildGateway().host
  return host === gatewayHost || host.endsWith(`.${gatewayHost}`)
}

// Read the key, failing loudly when it is absent. The message names the env var
// and the fix; it never echoes any value.
function requireUsaiApiKey(ref) {
  const key = process.env[USAI_API_KEY_ENV]
  if (typeof key === "string" && key.trim().length > 0) return key.trim()
  throw new Error(
    `${ref} is a USAi gateway URL and requires authentication, but ${USAI_API_KEY_ENV} is unset or empty.\n` +
      `  Set it in the environment and re-run, for example:\n` +
      `    ${USAI_API_KEY_ENV}=<your-usai-key> node scripts/build-catalog.mjs --models-url ${ref}\n` +
      `  The key is read from the environment only — do not pass it as a command-line flag.`,
  )
}

// Build request options for a source ref: an Authorization header for the USAi
// gateway, nothing extra for anything else.
function requestOptionsFor(ref) {
  if (!needsUsaiAuth(ref)) return {}
  const key = requireUsaiApiKey(ref)
  return { headers: { Authorization: `Bearer ${key}` }, requiresAuth: true }
}

async function loadJsonSource(ref, options = {}) {
  if (isUrl(ref)) return fetchJsonBounded(ref, { ...requestOptionsFor(ref), ...options })
  const abs = path.isAbsolute(ref) ? ref : path.resolve(process.cwd(), ref)
  const text = await readFile(abs, "utf8")
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`file ${abs} exceeded ${MAX_RESPONSE_BYTES} bytes`)
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`file ${abs} was not valid JSON: ${err.message}`)
  }
}

// Extract the USAi model list from any accepted shape (array / {data} / {models}).
function extractUsaiList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : null
  if (!list) throw new Error("USAi payload invalid: expected an array or { data | models: [] }")
  if (list.length === 0) throw new Error("USAi payload invalid: model list is empty")
  if (list.length > MAX_MODELS) throw new Error(`USAI payload invalid: ${list.length} models exceeds limit ${MAX_MODELS}`)
  list.forEach((m, index) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`USAI payload invalid: models[${index}] must be an object`)
    const id = m.id ?? m.model_id ?? m.name
    if (typeof id !== "string" || id.length === 0) throw new Error(`USAI payload invalid: models[${index}] has no string id/model_id/name`)
    if ([...id].length > 128 || /[\u0000-\u001F\u007F]/u.test(id)) throw new Error(`USAI payload invalid: models[${index}].id is out of bounds`)
    if (m.name !== undefined && (typeof m.name !== "string" || [...m.name].length > 256 || /[\u0000-\u001F\u007F]/u.test(m.name))) {
      throw new Error(`USAI payload invalid: models[${index}].name is out of bounds`)
    }
  })
  return list
}

// -----------------------------------------------------------------------------
// Bootstrap: parse the renderer contract's GENERATED block into catalog
// models, translating opencode cost keys -> catalog cost keys. This preserves
// model ORDER and vendor grouping exactly as the block declares them.
// -----------------------------------------------------------------------------
function extractGeneratedBlock(jsoncText) {
  const start = jsoncText.indexOf(GENERATED_START)
  const end = jsoncText.indexOf(GENERATED_END)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("GENERATED USAI MODELS markers not found in opencode.jsonc")
  }
  return jsoncText.slice(start + GENERATED_START.length, end)
}

// Parse the block body — a sequence of `// Vendor Comment` lines and
// `"id": { ...json... }` objects — into ordered { id, vendor, name, json }.
// We rely on brace-balancing to slice each model object, then JSON.parse it
// (the model objects are strict JSON; comments only appear between objects).
function parseBootstrapModels(blockBody) {
  const entries = []
  let i = 0
  const n = blockBody.length
  while (i < n) {
    // Skip to the next quoted key that begins a model object: `"<id>": {`
    const keyMatch = /"([^"]+)"\s*:\s*\{/g
    keyMatch.lastIndex = i
    const m = keyMatch.exec(blockBody)
    if (!m) break
    const id = m[1]
    // Find the balanced closing brace of the object starting at m.index + key.
    const objStart = blockBody.indexOf("{", m.index)
    let depth = 0
    let j = objStart
    let inStr = false
    for (; j < n; j++) {
      const ch = blockBody[j]
      if (inStr) {
        if (ch === "\\") j++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    const objText = blockBody.slice(objStart, j)
    let obj
    try {
      obj = JSON.parse(objText)
    } catch (err) {
      throw new Error(`bootstrap: could not parse model "${id}": ${err.message}`)
    }
    entries.push({ id, obj })
    i = j
  }
  if (entries.length === 0) throw new Error("bootstrap: no models parsed from GENERATED block")
  return entries
}

function bootstrapModelsFromBlock(entries) {
  const models = []
  const vendorsSeen = new Set()
  const excluded = []
  for (const { id, obj } of entries) {
    const reason = nonChatReason(id, obj?.name ?? "")
    if (reason) {
      excluded.push({ id, reason })
      continue
    }
    const vendor = classifyVendor(id, "")
    vendorsSeen.add(vendor)
    const model = { id, vendor, name: obj.name ?? generateDisplayName(id) }
    const limit = obj.limit || {}
    if (Number.isInteger(limit.context)) model.contextWindow = limit.context
    if (Number.isInteger(limit.output)) model.maxOutputTokens = limit.output
    const cost = obj.cost || {}
    const baseCost = {}
    for (const [camel, snake] of COST_MAP) {
      if (typeof cost[snake] === "number") baseCost[camel] = cost[snake]
    }
    if (Object.keys(baseCost).length > 0) model.cost = baseCost
    const over = cost.context_over_200k
    if (over && typeof over === "object") {
      const above = {}
      for (const [camel, snake] of COST_MAP) {
        if (typeof over[snake] === "number") above[camel] = over[snake]
      }
      if (Object.keys(above).length > 0) model.costAbove200kContext = above
    }
    if (obj.reasoning !== undefined) {
      if (typeof obj.reasoning !== "boolean") throw new Error(`bootstrap: ${id}.reasoning must be a boolean`)
      model.reasoning = obj.reasoning
    }
    if (obj.modalities !== undefined && (obj.modalities === null || typeof obj.modalities !== "object" || Array.isArray(obj.modalities))) {
      throw new Error(`bootstrap: ${id}.modalities must be an object`)
    }
    if (obj.modalities?.input !== undefined) {
      model.inputModalities = normalizeInputModalities(obj.modalities.input, `bootstrap: ${id}.modalities.input`)
    }
    models.push(model)
  }
  reportExclusions(excluded)
  return { models, vendorsSeen }
}

// Build the ordered vendors[] array. Bootstrap preserves the order the vendors
// first appear in the block; live-feed mode uses VENDOR_CONFIG.order.
function buildVendors(vendorKeysInOrder) {
  return vendorKeysInOrder.map((key, idx) => {
    const cfg = VENDOR_CONFIG[key] || VENDOR_CONFIG.other
    return {
      key,
      label: cfg.label,
      order: idx + 1,
      usaiBackend: cfg.usaiBackend,
    }
  })
}

// -----------------------------------------------------------------------------
// Live-feed shaping: parse USAi list, classify, optionally enrich from models.dev.
// -----------------------------------------------------------------------------
// Models the gateway serves that cannot be prompted, keyed to the reason.
// The gateway's /v1/models response carries no capability field, so
// promptability is decided here rather than read from the feed.
//
// These embedding models have no generation support. Chat deployments are
// eligible once their completion endpoint is available.
const NON_CHAT_MODELS = {
  cohere_english_v3: "embedding model; /chat/completions returns 403 AccessDeniedException",
  "text-embedding-005": "embedding model; /chat/completions returns 400 (no generation support)",
}

// Default-deny net for a non-chat model not yet listed above. Substring, not
// `\bembed\b`: `_` is a word character, so a word-boundary form matches no
// underscore-delimited id.
const EMBEDDING_ID_RE = /embedding|embed/

/**
 * Why this model cannot be offered as a chat model, or null if it can.
 * Checked by exact id first, then by the conservative id pattern.
 */
function nonChatReason(id, name = "") {
  if (Object.hasOwn(NON_CHAT_MODELS, id)) return NON_CHAT_MODELS[id]
  if (EMBEDDING_ID_RE.test(`${id} ${name}`.toLowerCase())) {
    return "id or name indicates an embedding model"
  }
  return null
}

/** Report excluded models to stderr. */
function reportExclusions(excluded) {
  for (const { id, reason } of excluded) {
    process.stderr.write(`  excluded ${id}: ${reason}\n`)
  }
}

// A model the precision guard could not match is NOT a silent condition. Its
// limits fall back to generic defaults and its cost is absent, so the catalog
// entry looks complete while carrying no derived pricing at all. Say so, by id,
// and make the fallback visible — "could not enrich" has to be distinguishable
// from "enriched", or a reviewer cannot tell a generic 128000/8192 from a real
// measurement.
export function reportUnenriched(unenriched, enrichmentAttempted) {
  if (!enrichmentAttempted || unenriched.length === 0) return
  process.stderr.write(`  UNENRICHED (${unenriched.length}): no precise models.dev match; cost is ABSENT:\n`)
  for (const item of unenriched) {
    const suffix = item.fallbacks.length
      ? `; fallback ${item.fallbacks.join("+")} limit(s) used`
      : "; USAi feed limits retained"
    process.stderr.write(`    ${item.id}${suffix}\n`)
  }
}

function shapeFromFeeds(usaiList, modelsDevCatalog, { includeCapabilities = false } = {}) {
  usaiList = extractUsaiList(usaiList)
  // Chat models only, preserve incoming list order but group by vendor display
  // order for a stable catalog.
  const excluded = []
  const parsed = usaiList
    .map((raw) => {
      const id = raw.id || raw.model_id || raw.name
      if (!id) return null
      const vendor = classifyVendor(id, raw.owned_by)
      const reason = nonChatReason(id, raw.name ?? "")
      if (reason) {
        excluded.push({ id, reason })
        return null
      }
      return { id, vendor, name: raw.name || generateDisplayName(id), raw }
    })
    .filter(Boolean)

  reportExclusions(excluded)

  parsed.sort((a, b) => {
    const oa = VENDOR_CONFIG[a.vendor]?.order ?? 99
    const ob = VENDOR_CONFIG[b.vendor]?.order ?? 99
    if (oa !== ob) return oa - ob
    return a.id.localeCompare(b.id)
  })

  const vendorOrder = []
  const models = []
  const unenriched = []
  let capabilityMatches = 0
  let capabilityMalformed = 0
  for (const p of parsed) {
    if (!vendorOrder.includes(p.vendor)) vendorOrder.push(p.vendor)
    const model = { id: p.id, vendor: p.vendor, name: p.name }
    let context = Number.isInteger(p.raw.context_window) && p.raw.context_window > 0 ? p.raw.context_window : null
    let output = Number.isInteger(p.raw.max_output_tokens) && p.raw.max_output_tokens > 0 ? p.raw.max_output_tokens : null
    let baseCost = null
    let above = null
    let capabilities = {}
    let matched = false
    if (modelsDevCatalog) {
      for (const { models: providerModels } of providerModelMaps(p.vendor, modelsDevCatalog)) {
        const match = findModelsDevMatch(p.id, providerModels)
        if (match?.data) {
          matched = true
          if (match.data.limit) {
            const matchedContext = match.data.limit.context
            const matchedOutput = match.data.limit.output
            if (!context && Number.isInteger(matchedContext) && matchedContext > 0) context = matchedContext
            if (!output && Number.isInteger(matchedOutput) && matchedOutput > 0) output = matchedOutput
          }
          const norm = normalizeCostFromModelsDev(match.data.cost)
          baseCost = norm.cost
          above = norm.costAbove200kContext
          if (includeCapabilities) {
            const result = capabilitiesFromModelsDev(match.data, match.id)
            capabilities = result.capabilities
            capabilityMatches += 1
            if (result.malformed) capabilityMalformed += 1
          }
          break
        }
      }
      // The feed itself may carry limits even when enrichment finds nothing;
      // only a model with no derived data at all is reported as unenriched.
      if (!matched) {
        const fallbacks = []
        if (!(Number.isInteger(context) && context > 0)) fallbacks.push("context")
        if (!(Number.isInteger(output) && output > 0)) fallbacks.push("output")
        unenriched.push({ id: p.id, fallbacks })
      }
    }
    model.contextWindow = normalizeLimit(context, FALLBACK_LIMITS.context)
    model.maxOutputTokens = normalizeLimit(output, FALLBACK_LIMITS.output)
    if (baseCost) model.cost = baseCost
    if (above) model.costAbove200kContext = above
    if (capabilities.reasoning !== undefined) model.reasoning = capabilities.reasoning
    if (capabilities.inputModalities !== undefined) model.inputModalities = capabilities.inputModalities
    models.push(model)
  }
  reportUnenriched(unenriched, Boolean(modelsDevCatalog))
  if (capabilityMalformed > 0) {
    process.stderr.write(`${capabilityMalformed} of ${capabilityMatches} matched models had malformed capability data\n`)
  }
  return { models, vendorOrder }
}

// -----------------------------------------------------------------------------
// Minimal structural validator against catalog.schema.json. ajv is NOT a repo
// dependency (checked package.json + node_modules), so we hand-roll a check of
// the constraints that matter for this catalog rather than add a dependency.
// -----------------------------------------------------------------------------
function assert(cond, msg, errors) {
  if (!cond) errors.push(msg)
}

function validateCost(cost, where, errors) {
  if (cost === undefined) return
  assert(cost && typeof cost === "object" && !Array.isArray(cost), `${where}: cost must be an object`, errors)
  if (!cost || typeof cost !== "object") return
  const allowed = new Set(["input", "output", "cacheRead", "cacheWrite"])
  for (const [k, v] of Object.entries(cost)) {
    assert(allowed.has(k), `${where}: cost has disallowed key "${k}"`, errors)
    assert(Number.isFinite(v) && v >= 0, `${where}: cost.${k} must be a finite non-negative number`, errors)
  }
}

function validateStringFromSchema(value, propertySchema, where, errors) {
  assert(typeof value === "string", `${where} must be string`, errors)
  if (typeof value !== "string") return
  if (Number.isInteger(propertySchema.minLength)) {
    assert([...value].length >= propertySchema.minLength, `${where} must not be empty`, errors)
  }
  if (Number.isInteger(propertySchema.maxLength)) {
    assert([...value].length <= propertySchema.maxLength, `${where} exceeds ${propertySchema.maxLength} characters`, errors)
  }
  if (typeof propertySchema.pattern === "string") {
    assert(new RegExp(propertySchema.pattern).test(value), `${where} does not match its schema pattern`, errors)
  }
}

function validateCatalog(catalog, schema) {
  const errors = []
  assert(catalog && typeof catalog === "object" && !Array.isArray(catalog), "catalog must be an object", errors)
  if (errors.length) return errors

  const topAllowed = new Set(Object.keys(schema.properties))
  for (const k of Object.keys(catalog)) {
    assert(topAllowed.has(k), `top-level: disallowed key "${k}"`, errors)
  }
  for (const req of schema.required) {
    assert(req in catalog, `top-level: missing required key "${req}"`, errors)
  }

  assert(catalog.schemaVersion === SCHEMA_VERSION, `schemaVersion must be "${SCHEMA_VERSION}"`, errors)

  // recommendations (optional): role names come from the schema, and every
  // value must name a model that is actually in models[].
  if ("recommendations" in catalog) {
    const recs = catalog.recommendations
    if (!recs || typeof recs !== "object" || Array.isArray(recs)) {
      errors.push("recommendations must be an object")
    } else {
      const roles = new Set(Object.keys(schema.properties.recommendations.properties))
      const ids = new Set(Array.isArray(catalog.models) ? catalog.models.map((m) => m?.id) : [])
      for (const [role, modelId] of Object.entries(recs)) {
        if (!roles.has(role)) {
          errors.push(`recommendations: disallowed role "${role}" (allowed: ${[...roles].join(", ")})`)
        } else if (typeof modelId !== "string" || modelId.length === 0) {
          errors.push(`recommendations.${role} must be a non-empty string`)
        } else if (!ids.has(modelId)) {
          errors.push(`recommendations.${role} references "${modelId}", which is not in models[]`)
        }
      }
    }
  }

  // gateway
  const gw = catalog.gateway
  if (gw && typeof gw === "object") {
    const gwAllowed = new Set(["host", "baseUrl", "api", "apiKeyEnv"])
    for (const k of Object.keys(gw)) assert(gwAllowed.has(k), `gateway: disallowed key "${k}"`, errors)
    for (const r of ["host", "baseUrl", "api", "apiKeyEnv"]) assert(r in gw, `gateway: missing "${r}"`, errors)
    assert(gw.api === "openai-completions", `gateway.api must be "openai-completions"`, errors)
    assert(/^[A-Z][A-Z0-9_]*$/.test(String(gw.apiKeyEnv)), `gateway.apiKeyEnv must be an UPPER_SNAKE env var name`, errors)
    assert(typeof gw.baseUrl === "string" && /^\w+:\/\//.test(gw.baseUrl), `gateway.baseUrl must be a URI`, errors)
  } else {
    assert(false, "gateway must be an object", errors)
  }

  // vendors
  assert(Array.isArray(catalog.vendors), "vendors must be an array", errors)
  if (Array.isArray(catalog.vendors)) {
    const vendorAllowed = new Set(["key", "label", "order", "usaiBackend"])
    const vendorKeysSeen = new Set()
    for (const [idx, v] of catalog.vendors.entries()) {
      for (const k of Object.keys(v)) assert(vendorAllowed.has(k), `vendors[${idx}]: disallowed key "${k}"`, errors)
      for (const r of ["key", "label", "order", "usaiBackend"]) assert(r in v, `vendors[${idx}]: missing "${r}"`, errors)
      assert(typeof v.key === "string", `vendors[${idx}].key must be string`, errors)
      if (typeof v.key === "string") {
        assert(!vendorKeysSeen.has(v.key), `vendors[${idx}].key duplicates "${v.key}"`, errors)
        vendorKeysSeen.add(v.key)
      }
      assert(Number.isInteger(v.order), `vendors[${idx}].order must be integer`, errors)
    }
  }

  // models
  assert(Array.isArray(catalog.models), "models must be an array", errors)
  if (Array.isArray(catalog.models)) {
    const modelAllowed = new Set([
      "id", "vendor", "name", "contextWindow", "maxOutputTokens",
      "cost", "costAbove200kContext", "reasoning", "inputModalities",
    ])
    const vendorKeys = new Set((catalog.vendors || []).map((v) => v.key))
    const modelProperties = schema.properties.models.items.properties
    const modelIds = new Set()
    for (const [idx, m] of catalog.models.entries()) {
      for (const k of Object.keys(m)) assert(modelAllowed.has(k), `models[${idx}]: disallowed key "${k}"`, errors)
      for (const r of ["id", "vendor", "name"]) assert(r in m, `models[${idx}]: missing "${r}"`, errors)
      validateStringFromSchema(m.id, modelProperties.id, `models[${idx}].id`, errors)
      validateStringFromSchema(m.name, modelProperties.name, `models[${idx}].name`, errors)
      if (typeof m.id === "string") {
        assert(!modelIds.has(m.id), `models[${idx}].id duplicates "${m.id}"`, errors)
        modelIds.add(m.id)
      }
      assert(vendorKeys.has(m.vendor), `models[${idx}].vendor "${m.vendor}" not in vendors[]`, errors)
      if ("contextWindow" in m) assert(Number.isInteger(m.contextWindow) && m.contextWindow > 0, `models[${idx}].contextWindow must be a positive integer`, errors)
      if ("maxOutputTokens" in m) assert(Number.isInteger(m.maxOutputTokens) && m.maxOutputTokens > 0, `models[${idx}].maxOutputTokens must be a positive integer`, errors)
      validateCost(m.cost, `models[${idx}]`, errors)
      validateCost(m.costAbove200kContext, `models[${idx}]`, errors)
      if ("reasoning" in m) assert(typeof m.reasoning === "boolean", `models[${idx}].reasoning must be a boolean`, errors)
      if ("inputModalities" in m) {
        const list = m.inputModalities
        assert(
          Array.isArray(list) && list.length > 0 && new Set(list).size === list.length && list.every((entry) => INPUT_MODALITIES.includes(entry)),
          `models[${idx}].inputModalities must be a non-empty, unique array of ${INPUT_MODALITIES.join("|")}`,
          errors,
        )
      }
    }
  }
  return errors
}

// -----------------------------------------------------------------------------
// Deterministic serialization: keys in a fixed order, 2-space indent, trailing
// newline. Order is stable so the committed catalog.json is reproducible.
// -----------------------------------------------------------------------------
const KEY_ORDER = {
  root: ["schemaVersion", "generatedBy", "sources", "recommendations", "gateway", "vendors", "models"],
  recommendations: ["primary", "small", "compaction", "summary", "title"],
  gateway: ["host", "baseUrl", "api", "apiKeyEnv"],
  vendor: ["key", "label", "order", "usaiBackend"],
  model: ["id", "vendor", "name", "contextWindow", "maxOutputTokens", "cost", "costAbove200kContext", "reasoning", "inputModalities"],
  cost: ["input", "output", "cacheRead", "cacheWrite"],
}

function orderObject(obj, order) {
  const out = {}
  for (const k of order) if (k in obj) out[k] = obj[k]
  // Preserve any keys not in the explicit order (defensive; none expected).
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k]
  return out
}

function orderCatalog(catalog) {
  const out = orderObject(catalog, KEY_ORDER.root)
  if (out.recommendations && typeof out.recommendations === "object" && !Array.isArray(out.recommendations)) {
    out.recommendations = orderObject(out.recommendations, KEY_ORDER.recommendations)
  }
  if (out.gateway) out.gateway = orderObject(out.gateway, KEY_ORDER.gateway)
  if (Array.isArray(out.vendors)) out.vendors = out.vendors.map((v) => orderObject(v, KEY_ORDER.vendor))
  if (Array.isArray(out.models)) {
    out.models = out.models.map((m) => {
      const om = orderObject(m, KEY_ORDER.model)
      if (om.cost) om.cost = orderObject(om.cost, KEY_ORDER.cost)
      if (om.costAbove200kContext) om.costAbove200kContext = orderObject(om.costAbove200kContext, KEY_ORDER.cost)
      return om
    })
  }
  return out
}

function serialize(catalog) {
  return JSON.stringify(orderCatalog(catalog), null, 2) + "\n"
}

// -----------------------------------------------------------------------------
// gateway metadata — derived from the shipped provider config (static).
// -----------------------------------------------------------------------------
function buildGateway() {
  return {
    host: "api.gsa.usai.gov",
    baseUrl: "https://api.gsa.usai.gov/api/v1",
    api: "openai-completions",
    apiKeyEnv: "USAI_API_KEY",
  }
}

// -----------------------------------------------------------------------------
// Arg parsing
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--no-enrichment" || a === "--bootstrap" || a === "--check" || a === "--include-capabilities") {
      args.flags.add(a)
    } else if (a === "--models-url" || a === "--models-dev" || a === "--opencode-jsonc" || a === "--out" || a === "--schema") {
      args.opts[a] = argv[++i]
    } else if (a.startsWith("--") && a.includes("=")) {
      const [k, v] = a.split(/=(.*)/s)
      args.opts[k] = v
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return args
}

/**
 * Role defaults are curated by a human, not derived from the feeds, so a
 * regeneration must carry them forward. Returns the existing catalog's
 * `recommendations` object, or undefined when there is nothing to carry:
 *   - the file does not exist (first generation), or
 *   - the file is a catalog (right schemaVersion, models[] array) that has no
 *     `recommendations` yet; there are no roles to lose.
 * Anything else that exists at the output path is an error. In particular a
 * file that parses as JSON but is not a catalog (`[]`, `null`, `123`, `{}`, a
 * catalog with no models[]) must never be silently overwritten with a catalog
 * that has no roles, because that is the failure this guards against.
 */
async function readExistingRecommendations(catalogPath) {
  let raw
  try {
    raw = await readFile(catalogPath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
  const refuse = (why) =>
    new Error(
      `cannot carry recommendations forward: ${catalogPath} ${why}.\n` +
        `  Repair or remove it, then re-run. The catalog was NOT written.`,
    )
  let existing
  try {
    existing = JSON.parse(raw)
  } catch {
    throw refuse("exists but is not valid JSON")
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw refuse("is valid JSON but not a catalog object")
  }
  if (existing.schemaVersion !== SCHEMA_VERSION) {
    throw refuse(`is not a ${SCHEMA_VERSION} catalog (schemaVersion is ${JSON.stringify(existing.schemaVersion)})`)
  }
  if (!Array.isArray(existing.models)) {
    throw refuse("is a catalog without a models[] array")
  }
  return existing.recommendations
}

/**
 * Keep the existing role defaults. If any recommended model is no longer in
 * the regenerated model list, fail closed: a human must pick the replacement.
 * No role is ever re-chosen automatically.
 */
function carryForwardRecommendations(recommendations, models, where = "catalog.json") {
  if (recommendations === undefined) return undefined
  if (!recommendations || typeof recommendations !== "object" || Array.isArray(recommendations)) {
    throw new Error(`recommendations in ${where} must be an object. The catalog was NOT written.`)
  }
  const ids = new Set(models.map((m) => m.id))
  const gone = Object.entries(recommendations).filter(([, id]) => !ids.has(id))
  if (gone.length) {
    throw new Error(
      `recommended model(s) are no longer in the model list:\n` +
        gone.map(([role, id]) => `  - ${role}: ${id}`).join("\n") +
        `\n  Choose a replacement for each role, set it under "recommendations" in ${where}, ` +
        `and re-run. The catalog was NOT written.`,
    )
  }
  return { ...recommendations }
}

async function buildCatalog(args) {
  const schemaPath = args.opts["--schema"] || DEFAULT_SCHEMA
  const schema = JSON.parse(await readFile(schemaPath, "utf8"))

  const modelsUrl = args.opts["--models-url"]
  const noEnrichment = args.flags.has("--no-enrichment")
  const forceBootstrap = args.flags.has("--bootstrap")
  if (args.flags.has("--include-capabilities") && (!modelsUrl || forceBootstrap)) {
    throw new Error("--include-capabilities requires --models-url and cannot be combined with --bootstrap")
  }

  let catalog
  if (modelsUrl && !forceBootstrap) {
    // Live-feed / fixture mode.
    const usaiPayload = await loadJsonSource(modelsUrl)
    const usaiList = extractUsaiList(usaiPayload)
    let modelsDevCatalog = null
    if (!noEnrichment) {
      const modelsDevRef = args.opts["--models-dev"] || MODELS_DEV_URL
      const raw = await loadJsonSource(modelsDevRef)
      if (raw && typeof raw === "object" && !Array.isArray(raw)) modelsDevCatalog = raw
      else throw new Error("models.dev source has unexpected shape (expected provider-keyed object)")
    }
    const includeCapabilities = args.flags.has("--include-capabilities")
    if (includeCapabilities && !modelsDevCatalog) throw new Error("--include-capabilities requires models.dev enrichment (omit --no-enrichment)")
    const { models, vendorOrder } = shapeFromFeeds(usaiList, modelsDevCatalog, { includeCapabilities })
    catalog = {
      schemaVersion: SCHEMA_VERSION,
      generatedBy: GENERATED_MARKER,
      sources: {
        modelsList: modelsUrl,
        enrichment: noEnrichment ? "(none)" : (args.opts["--models-dev"] || MODELS_DEV_URL),
        ...(includeCapabilities ? { capabilities: "models.dev upstream provider data; not verified against the USAi gateway" } : {}),
      },
      gateway: buildGateway(),
      vendors: buildVendors(vendorOrder),
      models,
    }
  } else {
    // Bootstrap from the renderer contract's GENERATED block (default).
    const opencodePath = args.opts["--opencode-jsonc"] || DEFAULT_OPENCODE_JSONC
    const jsoncText = await readFile(opencodePath, "utf8")
    const block = extractGeneratedBlock(jsoncText)
    const entries = parseBootstrapModels(block)
    const { models } = bootstrapModelsFromBlock(entries)
    // Preserve vendor first-appearance order from the block.
    const vendorOrder = []
    for (const m of models) if (!vendorOrder.includes(m.vendor)) vendorOrder.push(m.vendor)
    catalog = {
      schemaVersion: SCHEMA_VERSION,
      generatedBy: GENERATED_MARKER,
      sources: {
        bootstrappedFrom: OPENCODE_JSONC_REL,
      },
      gateway: buildGateway(),
      vendors: buildVendors(vendorOrder),
      models,
    }
  }

  const carried = carryForwardRecommendations(
    await readExistingRecommendations(args.opts["--out"] || DEFAULT_OUT),
    catalog.models,
    args.opts["--out"] || DEFAULT_OUT,
  )
  if (carried !== undefined) catalog.recommendations = carried

  const errors = validateCatalog(catalog, schema)
  if (errors.length) {
    throw new Error(`catalog failed schema validation:\n  - ${errors.join("\n  - ")}`)
  }
  return catalog
}

/**
 * The substantive catalog: everything a consumer renders, with provenance
 * stripped. `sources` names the feed or file this particular run read, so it
 * differs between a live regeneration and an offline bootstrap of identical
 * models — it is metadata about the build, not about the catalog's content.
 */
function substantive(catalog) {
  const { sources: _provenance, ...rest } = catalog
  return rest
}

/**
 * Describe how two catalogs differ, as caller-actionable lines.
 * Returns [] when the substantive content matches.
 */
function describeDrift(existing, fresh) {
  const lines = []
  for (const key of ["schemaVersion", "generatedBy"]) {
    if (existing?.[key] !== fresh?.[key]) {
      lines.push(`${key}: ${JSON.stringify(existing?.[key])} -> ${JSON.stringify(fresh?.[key])}`)
    }
  }
  const rolesBefore = existing?.recommendations ?? {}
  const rolesAfter = fresh?.recommendations ?? {}
  for (const role of [...new Set([...Object.keys(rolesBefore), ...Object.keys(rolesAfter)])].sort()) {
    if (rolesBefore[role] !== rolesAfter[role]) {
      lines.push(
        `recommendations.${role}: ${JSON.stringify(rolesBefore[role] ?? "(none)")} -> ${JSON.stringify(rolesAfter[role] ?? "(none)")}`,
      )
    }
  }
  if (JSON.stringify(existing?.gateway) !== JSON.stringify(fresh?.gateway)) {
    lines.push("gateway block changed")
  }
  if (JSON.stringify(existing?.vendors) !== JSON.stringify(fresh?.vendors)) {
    lines.push("vendors block changed")
  }

  const byId = (list) => new Map((list || []).map((m) => [m.id, m]))
  const before = byId(existing?.models)
  const after = byId(fresh?.models)
  const added = [...after.keys()].filter((id) => !before.has(id)).sort()
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort()
  if (added.length) lines.push(`models added: ${added.join(", ")}`)
  if (removed.length) lines.push(`models removed: ${removed.join(", ")}`)
  for (const id of [...after.keys()].filter((i) => before.has(i)).sort()) {
    if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) {
      lines.push(`model changed: ${id}`)
    }
  }
  return lines
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outPath = args.opts["--out"] || DEFAULT_OUT
  const schemaPath = args.opts["--schema"] || DEFAULT_SCHEMA
  const catalog = await buildCatalog(args)
  const serialized = serialize(catalog)

  if (args.flags.has("--check")) {
    let existingRaw = null
    try {
      existingRaw = await readFile(outPath, "utf8")
    } catch {
      throw new Error(`catalog.json missing at ${outPath}; run without --check to generate`)
    }
    let existing
    try {
      existing = JSON.parse(existingRaw)
    } catch {
      throw new Error(`catalog.json at ${outPath} is not valid JSON; regenerate it`)
    }
    const existingErrors = validateCatalog(existing, JSON.parse(await readFile(schemaPath, "utf8")))
    if (existingErrors.length) {
      throw new Error(`catalog.json at ${outPath} is invalid:\n  - ${existingErrors.join("\n  - ")}`)
    }
    const drift = describeDrift(substantive(existing), substantive(catalog))
    if (drift.length) {
      throw new Error(`catalog.json has drifted from the current sources:\n  - ${drift.join("\n  - ")}`)
    }
    process.stdout.write(`catalog.json is up to date (${catalog.models.length} models)\n`)
    return
  }

  await writeFile(outPath, serialized)
  process.stdout.write(`Wrote ${outPath} (${catalog.models.length} models, ${catalog.vendors.length} vendors)\n`)
}

export {
  buildCatalog,
  validateCatalog,
  serialize,
  substantive,
  describeDrift,
  carryForwardRecommendations,
  parseBootstrapModels,
  bootstrapModelsFromBlock,
  shapeFromFeeds,
  findModelsDevMatch,
  classifyVendor,
  nonChatReason,
  NON_CHAT_MODELS,
  INPUT_MODALITIES,
}

// Compare URL against URL so the check is portable: on Windows
// `process.argv[1]` is a `C:\...` path, which a `file://${...}` template turns
// into `file://C:\...`, while `import.meta.url` is `file:///C:/...`. Those never
// match, so this script would exit 0 without doing anything.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
