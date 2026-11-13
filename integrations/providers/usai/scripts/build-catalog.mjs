#!/usr/bin/env node

// =============================================================================
// build-catalog.mjs — the FETCH + SHAPE half of the USAi catalog pipeline.
//
// Data flow:
//   live feeds -> build-catalog.mjs -> catalog.json -> neutral artifacts
//
// This script derives `integrations/providers/usai/catalog.json` (schema
// `usai-model-catalog/v1`). It renders no harness-native configuration.
//
// Most people should not run it directly. The documented entrypoint is
// `make refresh-usai-catalog` (scripts/refresh.mjs), which pulls the feeds once,
// calls this builder, and then regenerates every registered provider-neutral
// artifact from the result. See ../README.md and
// docs/decisions/0003-repo-time-provider-catalog-refresh.md.
//
// Inputs (both required; there is no default source):
//   --models-url <path|url> the USAi model list, from a local file or an https URL.
//   --models-dev <path|url> models.dev enrichment, from a local file or an https URL
//                           (default: https://models.dev/api.json).
//   --no-enrichment         do not read models.dev; limits and costs then come
//                           from the model list only.
//   --out <path>            the catalog to write (and to carry `recommendations`
//                           forward from). Default: ./catalog.json.
//   --check                 do not write; fail if the catalog at --out has drifted.
//   --include-capabilities  OPT-IN: copy reasoning/input-modality values from the
//                           matched models.dev entry. Off by default because
//                           models.dev describes the upstream provider, not what
//                           the USAi gateway forwards; output produced with this
//                           flag must not be committed until each value has
//                           per-model, per-field evidence (see ADR 0006 and the
//                           opencode kit's synthetic-image-validation.md).
//                           sources.capabilitiesVerified is a catalog-wide release
//                           reminder, not that evidence. With the flag, --check
//                           against a capability-free catalog reports drift by
//                           design.
//                           Verified capability values already in the catalog at
//                           --out are carried forward, and the flag is refused
//                           (nothing written) if its upstream values would
//                           conflict with them or sit beside them unverified.
//
// There is no bootstrap mode. The catalog used to be seeded from a frozen
// copy of an old OpenCode config; that made a harness-native file a source of
// truth and let a no-argument run silently replace the catalog. A run with no
// --models-url now refuses and points at the refresh command.
//
// What --check compares: the SUBSTANTIVE catalog — schemaVersion, gateway,
// vendors, models, and recommendations. It deliberately IGNORES the `sources`
// block, which records provenance (which feed this run read) and legitimately
// differs between runs of identical models. Comparing it would make --check fail
// on every run regardless of real drift, and a drift detector that always fires
// is one everybody learns to ignore. On a real difference, --check reports WHICH
// ids were added, removed, or changed, because a diff is actionable where a
// boolean is not.
//
// Live invocation requires a USAi API key, because the gateway rejects
// unauthenticated /models requests. The key is read from the ENVIRONMENT ONLY
// (USAI_API_KEY). There is deliberately NO CLI flag for it (flags land in shell
// history and process listings), it is never logged, and it is never written
// into catalog.json — `sources.modelsList` records the URL, not the credential.
// If the key is missing, or the gateway answers 401/403, the build FAILS LOUDLY
// rather than emitting a partial catalog: a silently-degraded catalog is worse
// than no catalog.
// =============================================================================

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  VENDOR_CONFIG,
  INPUT_MODALITIES,
  NON_CHAT_MODELS,
  classifyVendor,
  generateDisplayName,
  findModelsDevMatch,
  nonChatReason,
  normalizeLimit,
  enrichModelMetadata,
} from "./model-catalog-core.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")

const DEFAULT_OUT = path.join(USAI_DIR, "catalog.json")
const DEFAULT_SCHEMA = path.join(USAI_DIR, "catalog.schema.json")

const SCHEMA_VERSION = "usai-model-catalog/v1"
const GENERATED_MARKER = "build-catalog.mjs (generated — do not hand-edit)"

export const USAI_MODELS_URL = "https://api.gsa.usai.gov/api/v1/models"
export const MODELS_DEV_URL = "https://models.dev/api.json"

// Network hardening (mirrors the monolith sync-usai-models.mjs): bound time and
// size, and shape-validate before trusting third-party content.
const FETCH_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB
const MAX_MODELS = 1000

const FALLBACK_LIMITS = { context: 128000, output: 8192 }

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
  // HTTPS only: refuse before any request is made, so neither the gateway key
  // nor the model data ever travels over plain http.
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`refusing to fetch ${url}: only https:// sources are allowed`)
  }
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
  // degrade to a partial catalog on a rejected credential.
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

// Build the ordered vendors[] array from the vendors shapeFromFeeds saw, in
// VENDOR_CONFIG.order.
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

function shapeFromFeeds(usaiList, modelsDevCatalog, { includeCapabilities = false, preferredOrder = [] } = {}) {
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

  // Order: vendor group first. Within a vendor, models already in the existing
  // catalog keep their relative position (that order is curated and consumers
  // render it), and new models follow, sorted by id. With no existing catalog
  // the order is vendor group, then id.
  const rank = new Map(preferredOrder.map((id, index) => [id, index]))
  parsed.sort((a, b) => {
    const oa = VENDOR_CONFIG[a.vendor]?.order ?? 99
    const ob = VENDOR_CONFIG[b.vendor]?.order ?? 99
    if (oa !== ob) return oa - ob
    const pa = rank.get(a.id) ?? Number.POSITIVE_INFINITY
    const pb = rank.get(b.id) ?? Number.POSITIVE_INFINITY
    if (pa !== pb) return pa < pb ? -1 : 1
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
    const result = enrichModelMetadata({
      id: p.id,
      vendor: p.vendor,
      contextWindow: p.raw.context_window,
      maxOutputTokens: p.raw.max_output_tokens,
    }, modelsDevCatalog, { includeCapabilities })
    for (const why of result.capabilityWarnings) {
      process.stderr.write(`  WARNING models.dev ${result.matchId}: ${why}; capability treated as unknown\n`)
    }
    if (includeCapabilities && result.matched) {
      capabilityMatches += 1
      if (result.capabilityMalformed) capabilityMalformed += 1
    }
    if (modelsDevCatalog && !result.matched) {
      unenriched.push({ id: p.id, fallbacks: result.missingLimits })
    }
    // Generic defaults belong only to repository authoring, never runtime facts.
    model.contextWindow = normalizeLimit(result.metadata.contextWindow, FALLBACK_LIMITS.context)
    model.maxOutputTokens = normalizeLimit(result.metadata.maxOutputTokens, FALLBACK_LIMITS.output)
    Object.assign(model, result.metadata)
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

  // sources (optional): provenance, an object of string values per the schema.
  if ("sources" in catalog) {
    const sources = catalog.sources
    if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
      errors.push("sources must be an object")
    } else {
      for (const [key, value] of Object.entries(sources)) {
        if (typeof value !== "string") errors.push(`sources.${key} must be a string`)
      }
    }
  }

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
const REFRESH_HINT =
  "Refresh the catalog with `make refresh-usai-catalog` (see integrations/providers/usai/README.md)."

function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--bootstrap" || a === "--opencode-jsonc") {
      throw new Error(`${a} was removed: the catalog is no longer seeded from a harness config. ${REFRESH_HINT}`)
    }
    if (a === "--no-enrichment" || a === "--check" || a === "--include-capabilities") {
      args.flags.add(a)
    } else if (a === "--models-url" || a === "--models-dev" || a === "--out" || a === "--schema" || a === "--carry-from") {
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
 * Read the catalog already at `catalogPath`; undefined when the file does not
 * exist (first generation). Role defaults and model order are curated, not
 * derived from the feeds, so a regeneration carries both forward from here.
 *
 * Anything at the path that is not a catalog is an error. In particular a file
 * that parses as JSON but is not a catalog (`[]`, `null`, `123`, `{}`, a catalog
 * with no models[]) must never be silently overwritten with a catalog that has
 * no roles, because that is the failure this guards against. A real catalog that
 * has no `recommendations` yet is accepted: there are no roles to lose.
 */
async function readExistingCatalog(catalogPath, schema) {
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
  // A catalog that is the right shape but breaks the schema (an unknown field, a
  // dangling role, a bad gateway) is not trusted as the source of roles or order.
  if (schema) {
    const errors = validateCatalog(existing, schema)
    if (errors.length) throw refuse(`is not a valid catalog:\n  - ${errors.join("\n  - ")}`)
  }
  return existing
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

const UNVERIFIED_LABEL = "models.dev upstream provider data; not verified against the USAi gateway"
const CAPABILITY_FIELDS = ["reasoning", "inputModalities"]

// Shape of sources.capabilitiesVerified: a release reminder, not evidence (ADR
// 0006). A carried-forward value is only trusted as verified when it is present.
const RELEASE_REMINDER = /^\d{4}-\d{2}-\d{2}; opencode v?\d+\.\d+\.\d+\S*$/

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Verified capability values, keyed by model id, read from the already
 * shape-validated existing catalog. They are curated overlay data exactly like
 * `recommendations`: the feeds never supply them, a person commits them with
 * per-model evidence, and a regeneration carries them forward.
 *
 * Values with no valid sources.capabilitiesVerified release reminder are not
 * treated as verified (for example the output of an earlier
 * --include-capabilities run): they are not carried, and a warning names how
 * many were left behind. --check then reports them as dropped.
 */
function readVerifiedOverlay(existing, where) {
  const reminder = existing?.sources?.capabilitiesVerified
  const reminderOk = typeof reminder === "string" && RELEASE_REMINDER.test(reminder)
  const overlay = new Map()
  for (const model of existing?.models ?? []) {
    const values = {}
    for (const field of CAPABILITY_FIELDS) if (field in model) values[field] = model[field]
    if (Object.keys(values).length > 0) overlay.set(model.id, values)
  }
  if (!reminderOk) {
    if (overlay.size > 0) {
      process.stderr.write(
        `  WARNING ${where}: capability values for ${overlay.size} model(s) have no valid ` +
          `sources.capabilitiesVerified ("<YYYY-MM-DD>; opencode <version>"); not treated as verified, not carried\n`,
      )
    }
    return { overlay: new Map(), reminder: undefined }
  }
  return { overlay, reminder }
}

const show = (value) => (value === undefined ? "(none)" : JSON.stringify(value))

/**
 * Carry verified capability values onto the regenerated models. A model that
 * left the feed takes its values with it (reported on stderr; --check reports it
 * as drift). Returns the reminder to keep, or undefined when no value remains.
 *
 * With --include-capabilities the unverified upstream values are already on
 * `models`. While any verified value is carried, an upstream value is accepted
 * only if it equals the verified value for the same model and field. A
 * different value is a conflict, and a value for a field that has no verified
 * value would sit unverified under a sources.capabilitiesVerified string that
 * vouches for verified ones; both are refused before anything is written.
 */
function applyVerifiedOverlay(models, { overlay, reminder }, { includeCapabilities, where }) {
  const byId = new Map(models.map((m) => [m.id, m]))
  const gone = [...overlay].filter(([id]) => !byId.has(id))
  if (gone.length > 0) {
    process.stderr.write(
      `capability values dropped for model(s) no longer in the feed:\n` +
        gone.map(([id, values]) => `  - ${id}: ${Object.keys(values).join(", ")}`).join("\n") + "\n",
    )
  }
  const carried = [...overlay].filter(([id]) => byId.has(id))
  if (includeCapabilities && carried.length > 0) {
    const lines = []
    for (const model of models) {
      for (const field of CAPABILITY_FIELDS) {
        if (!(field in model)) continue
        const verified = overlay.get(model.id)?.[field]
        if (verified === undefined) {
          lines.push(`  - ${model.id} ${field}: no verified value, upstream ${show(model[field])} (would be unverified)`)
        } else if (!sameValue(verified, model[field])) {
          lines.push(`  - ${model.id} ${field}: verified ${show(verified)}, upstream ${show(model[field])} (CONFLICT)`)
        }
      }
    }
    if (lines.length > 0) {
      throw new Error(
        `--include-capabilities refused: ${where} carries verified capability values, and the upstream copy ` +
          `would conflict with them or sit beside them unverified:\n${lines.join("\n")}\n` +
          `  To inspect upstream values, run against a scratch --out with no verified values; to change a ` +
          `verified value, re-verify it and edit the catalog by hand. The catalog was NOT written.`,
      )
    }
  }
  for (const [id, values] of carried) Object.assign(byId.get(id), values)
  if (carried.length === 0 && reminder !== undefined) {
    process.stderr.write("no verified capability values remain; sources.capabilitiesVerified is dropped\n")
  }
  return carried.length > 0 ? reminder : undefined
}

const NO_SOURCE_MESSAGE =
  "no model source given: pass --models-url <path|https url>.\n" +
  "  This builder has no default source and no bootstrap mode, so it cannot silently\n" +
  "  replace the catalog. To refresh the catalog and its neutral artifacts, run:\n" +
  "    make refresh-usai-catalog\n" +
  "  (see integrations/providers/usai/README.md)."

/**
 * Build a catalog from a USAi model list and optional models.dev enrichment.
 *
 * `args.sourceLabels` (programmatic only) overrides what `sources` records for
 * the two inputs, so a build from a pulled directory can record the URLs that
 * were pulled instead of a temporary path.
 */
async function buildCatalog(args) {
  const schemaPath = args.opts["--schema"] || DEFAULT_SCHEMA
  const schema = JSON.parse(await readFile(schemaPath, "utf8"))

  const modelsUrl = args.opts["--models-url"]
  if (args.flags.has("--include-capabilities") && !modelsUrl) {
    throw new Error("--include-capabilities requires --models-url")
  }
  if (!modelsUrl) throw new Error(NO_SOURCE_MESSAGE)
  const noEnrichment = args.flags.has("--no-enrichment")
  const modelsDevRef = args.opts["--models-dev"] || MODELS_DEV_URL
  const labels = args.sourceLabels ?? {}

  // The catalog already on disk supplies the curated parts: role defaults and
  // model order. Read it first so an unreadable file fails before any work.
  const carryPath = args.opts["--carry-from"] || args.opts["--out"] || DEFAULT_OUT
  const existing = await readExistingCatalog(carryPath, schema)

  const usaiList = extractUsaiList(await loadJsonSource(modelsUrl))
  let modelsDevCatalog = null
  if (!noEnrichment) {
    const raw = await loadJsonSource(modelsDevRef)
    if (raw && typeof raw === "object" && !Array.isArray(raw)) modelsDevCatalog = raw
    else throw new Error("models.dev source has unexpected shape (expected provider-keyed object)")
  }
  const includeCapabilities = args.flags.has("--include-capabilities")
  if (includeCapabilities && !modelsDevCatalog) throw new Error("--include-capabilities requires models.dev enrichment (omit --no-enrichment)")
  const { models, vendorOrder } = shapeFromFeeds(usaiList, modelsDevCatalog, {
    includeCapabilities,
    preferredOrder: (existing?.models ?? []).map((m) => m?.id),
  })
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: GENERATED_MARKER,
    sources: {
      modelsList: labels.modelsList ?? modelsUrl,
      enrichment: noEnrichment ? "(none)" : (labels.enrichment ?? modelsDevRef),
    },
    gateway: buildGateway(),
    vendors: buildVendors(vendorOrder),
    models,
  }

  const carried = carryForwardRecommendations(existing?.recommendations, catalog.models, carryPath)
  if (carried !== undefined) catalog.recommendations = carried

  const reminder = applyVerifiedOverlay(catalog.models, readVerifiedOverlay(existing, carryPath), {
    includeCapabilities,
    where: carryPath,
  })
  if (reminder !== undefined) catalog.sources.capabilitiesVerified = reminder
  else if (includeCapabilities) catalog.sources.capabilities = UNVERIFIED_LABEL

  const errors = validateCatalog(catalog, schema)
  if (errors.length) {
    throw new Error(`catalog failed schema validation:\n  - ${errors.join("\n  - ")}`)
  }
  return catalog
}

/**
 * The substantive catalog: everything a consumer renders, with provenance
 * stripped. `sources` names the feed or file this particular run read, so it
 * differs between runs that read identical models from different places — it is metadata about the build, not about the catalog's content.
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
  const orderOf = (list) => (list || []).map((m) => m.id).filter((id) => before.has(id) && after.has(id))
  const kept = orderOf(existing?.models)
  const keptAfter = orderOf(fresh?.models)
  if (JSON.stringify(kept) !== JSON.stringify(keptAfter)) lines.push("model order changed")
  const added = [...after.keys()].filter((id) => !before.has(id)).sort()
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort()
  if (added.length) lines.push(`models added: ${added.join(", ")}`)
  if (removed.length) lines.push(`models removed: ${removed.join(", ")}`)
  for (const id of removed) {
    const fields = CAPABILITY_FIELDS.filter((field) => field in before.get(id))
    if (fields.length) lines.push(`capability values dropped with removed model: ${id} (${fields.join(", ")})`)
  }
  for (const id of [...after.keys()].filter((i) => before.has(i)).sort()) {
    const was = before.get(id)
    const now = after.get(id)
    const capabilityLines = []
    for (const field of CAPABILITY_FIELDS) {
      if (sameValue(was[field], now[field])) continue
      if (!(field in was)) capabilityLines.push(`capability added: ${id}.${field} = ${show(now[field])}`)
      else if (!(field in now)) capabilityLines.push(`capability dropped: ${id}.${field} (was ${show(was[field])})`)
      else capabilityLines.push(`capability changed: ${id}.${field}: ${show(was[field])} -> ${show(now[field])}`)
    }
    const strip = (model) => Object.fromEntries(Object.entries(model).filter(([key]) => !CAPABILITY_FIELDS.includes(key)))
    if (JSON.stringify(strip(was)) !== JSON.stringify(strip(now))) lines.push(`model changed: ${id}`)
    lines.push(...capabilityLines)
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
  readExistingCatalog,
  loadJsonSource,
  fetchJsonBounded,
  MAX_RESPONSE_BYTES,
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
