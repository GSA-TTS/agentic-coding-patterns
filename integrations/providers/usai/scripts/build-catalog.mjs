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
// catalog. The byte-exact round-trip test against the shipped opencode.jsonc is
// the safety gate; therefore the FIRST committed catalog.json is BOOTSTRAPPED
// from that shipped file's `// BEGIN GENERATED USAI MODELS` block so it exactly
// represents today's models. Live-feed mode (fetch USAi + models.dev) is
// provided for future regeneration.
//
// Modes:
//   (default, no flags)     bootstrap catalog.json from the shipped opencode.jsonc
//                           GENERATED block (offline, deterministic).
//   --models-url <path|url> read the USAi model list from a local path or URL.
//   --no-enrichment         do not fetch/read models.dev; use only the models
//                           list (limits/costs come from the fixture/list only).
//   --models-dev <path|url> read models.dev enrichment from a local path or URL.
//   --bootstrap             force bootstrap-from-opencode.jsonc mode (default
//                           when neither --models-url nor live fetch is used).
//   --opencode-jsonc <path> override the bootstrap source path.
//   --out <path>            override the output catalog.json path.
//   --check                 do not write; fail if catalog.json is out of date.
//
// CI / round-trip callers use the offline paths (--bootstrap, or --models-url
// against committed fixtures with --no-enrichment) so no network is required.
// =============================================================================

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")

const DEFAULT_OUT = path.join(USAI_DIR, "catalog.json")
const DEFAULT_SCHEMA = path.join(USAI_DIR, "catalog.schema.json")
const DEFAULT_OPENCODE_JSONC = path.join(
  REPO_ROOT,
  "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc",
)
// Path recorded in catalog.sources.bootstrappedFrom — repo-relative, stable.
const OPENCODE_JSONC_REL =
  "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc"

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
  cohere_english_v3: "Cohere English v3",
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
function normalizeModelId(id) {
  const withoutProvider = id.includes("/") ? id.split("/").pop() : id
  return withoutProvider
    .toLowerCase()
    .replace(/[_-]+/g, "-")
    .replace(/(\d)\.(\d)/g, "$1-$2")
    .replace(/guardrails.*$/i, "")
    .replace(/latest.*$/i, "")
    .replace(/-+$/, "")
}

function extractModelTokens(id) {
  const normalized = normalizeModelId(id)
  const parts = normalized.split("-")
  let family = ""
  let variant = ""
  const versionParts = []
  for (const part of parts) {
    if (/^(claude|gpt|gemini|llama\d*|cohere|command)$/i.test(part)) {
      family = /^llama/i.test(part) ? "llama" : /^command$/i.test(part) ? "cohere" : part
    } else if (/^(opus|sonnet|haiku|pro|flash|mini|nano|maverick)$/i.test(part)) {
      variant = part
    } else if (/^\d+$/.test(part)) {
      versionParts.push(Number.parseInt(part, 10))
    }
  }
  if (!family) {
    if (/claude/i.test(normalized)) family = "claude"
    else if (/gpt/i.test(normalized)) family = "gpt"
    else if (/gemini/i.test(normalized)) family = "gemini"
    else if (/llama/i.test(normalized)) family = "llama"
    else if (/cohere|command/i.test(normalized)) family = "cohere"
  }
  return { family, version: versionParts, variant }
}

function findModelsDevMatch(usaiId, catalog) {
  const usaiTokens = extractModelTokens(usaiId)
  const usaiNorm = normalizeModelId(usaiId)
  const usaiHasLite = /lite/.test(usaiNorm)
  let bestMatch = null
  let bestScore = -Infinity
  for (const [catalogId, data] of Object.entries(catalog)) {
    const catalogTokens = extractModelTokens(catalogId)
    const catalogNorm = normalizeModelId(catalogId)
    if (usaiTokens.family !== catalogTokens.family) continue
    let score = 10
    if (usaiTokens.variant && usaiTokens.variant === catalogTokens.variant) score += 50
    const catalogHasLite = /lite/.test(catalogNorm)
    if (usaiHasLite !== catalogHasLite) score -= 40
    const versionMatch = usaiTokens.version.every((v, i) => catalogTokens.version[i] === v)
    if (versionMatch && usaiTokens.version.length > 0) {
      score += 30
      if (catalogTokens.version.length === usaiTokens.version.length) score += 3
    }
    for (const suffix of ["tts", "image", "audio", "vision", "embed", "embedding", "search", "realtime"]) {
      const re = new RegExp(`(^|[.\\-/])${suffix}([.\\-]|$)`)
      if (re.test(catalogNorm) && !re.test(usaiNorm)) score -= 60
    }
    for (const v of ["pro", "codex", "mini", "nano", "max"]) {
      const re = new RegExp(`(^|[.\\-/])${v}([.\\-]|$)`)
      if (re.test(catalogNorm) && !re.test(usaiNorm)) score -= 20
    }
    if (/^(eu|au)\./.test(catalogId)) score -= 15
    else if (/^(us|global)\./.test(catalogId)) score += 2
    else if (/^[a-z]{2}\./.test(catalogId)) score += 1
    else score += 3
    if (normalizeModelId(catalogId).startsWith(normalizeModelId(usaiId).slice(0, 10))) score += 5
    if (score > bestScore) {
      bestScore = score
      bestMatch = { id: catalogId, data }
    }
  }
  return bestMatch && bestScore > 0 ? bestMatch : null
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
    if (typeof cost[snake] === "number") out[camel] = cost[snake]
  }
  let above = null
  const over = cost.context_over_200k
  if (over && typeof over === "object") {
    const o = {}
    for (const [camel, snake] of COST_MAP) {
      if (typeof over[snake] === "number") o[camel] = over[snake]
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`)
    throw err
  } finally {
    clearTimeout(timer)
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

async function loadJsonSource(ref, options = {}) {
  if (isUrl(ref)) return fetchJsonBounded(ref, options)
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
  const hasUsableId = list.some((m) => m && typeof m === "object" && (m.id || m.model_id || m.name))
  if (!hasUsableId) throw new Error("USAi payload invalid: no entries have an id/model_id/name field")
  return list
}

// -----------------------------------------------------------------------------
// Bootstrap: parse the shipped opencode.jsonc GENERATED block into catalog
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
  for (const { id, obj } of entries) {
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
    models.push(model)
  }
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
function shapeFromFeeds(usaiList, modelsDevCatalog) {
  // Chat models only (exclude embeddings), preserve incoming list order but
  // group by vendor display order for a stable catalog.
  const parsed = usaiList
    .map((raw) => {
      const id = raw.id || raw.model_id || raw.name
      if (!id) return null
      const vendor = classifyVendor(id, raw.owned_by)
      const haystack = `${id} ${raw.name ?? ""}`.toLowerCase()
      const isEmbedding = /embedding|embed/.test(haystack)
      return { id, vendor, name: raw.name || generateDisplayName(id), isEmbedding, raw }
    })
    .filter(Boolean)
    .filter((m) => !m.isEmbedding)

  parsed.sort((a, b) => {
    const oa = VENDOR_CONFIG[a.vendor]?.order ?? 99
    const ob = VENDOR_CONFIG[b.vendor]?.order ?? 99
    if (oa !== ob) return oa - ob
    return a.id.localeCompare(b.id)
  })

  const vendorOrder = []
  const models = []
  for (const p of parsed) {
    if (!vendorOrder.includes(p.vendor)) vendorOrder.push(p.vendor)
    const model = { id: p.id, vendor: p.vendor, name: p.name }
    let context = Number.isInteger(p.raw.context_window) ? p.raw.context_window : null
    let output = Number.isInteger(p.raw.max_output_tokens) ? p.raw.max_output_tokens : null
    let baseCost = null
    let above = null
    if (modelsDevCatalog) {
      for (const { models: providerModels } of providerModelMaps(p.vendor, modelsDevCatalog)) {
        const match = findModelsDevMatch(p.id, providerModels)
        if (match?.data) {
          if (match.data.limit) {
            context = context || match.data.limit.context || null
            output = output || match.data.limit.output || null
          }
          const norm = normalizeCostFromModelsDev(match.data.cost)
          baseCost = norm.cost
          above = norm.costAbove200kContext
          break
        }
      }
    }
    model.contextWindow = normalizeLimit(context, FALLBACK_LIMITS.context)
    model.maxOutputTokens = normalizeLimit(output, FALLBACK_LIMITS.output)
    if (baseCost) model.cost = baseCost
    if (above) model.costAbove200kContext = above
    models.push(model)
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
    assert(typeof v === "number", `${where}: cost.${k} must be a number`, errors)
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
    for (const [idx, v] of catalog.vendors.entries()) {
      for (const k of Object.keys(v)) assert(vendorAllowed.has(k), `vendors[${idx}]: disallowed key "${k}"`, errors)
      for (const r of ["key", "label", "order", "usaiBackend"]) assert(r in v, `vendors[${idx}]: missing "${r}"`, errors)
      assert(typeof v.key === "string", `vendors[${idx}].key must be string`, errors)
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
    for (const [idx, m] of catalog.models.entries()) {
      for (const k of Object.keys(m)) assert(modelAllowed.has(k), `models[${idx}]: disallowed key "${k}"`, errors)
      for (const r of ["id", "vendor", "name"]) assert(r in m, `models[${idx}]: missing "${r}"`, errors)
      assert(typeof m.id === "string", `models[${idx}].id must be string`, errors)
      assert(typeof m.name === "string", `models[${idx}].name must be string`, errors)
      assert(vendorKeys.has(m.vendor), `models[${idx}].vendor "${m.vendor}" not in vendors[]`, errors)
      if ("contextWindow" in m) assert(Number.isInteger(m.contextWindow), `models[${idx}].contextWindow must be integer`, errors)
      if ("maxOutputTokens" in m) assert(Number.isInteger(m.maxOutputTokens), `models[${idx}].maxOutputTokens must be integer`, errors)
      validateCost(m.cost, `models[${idx}]`, errors)
      validateCost(m.costAbove200kContext, `models[${idx}]`, errors)
    }
  }
  return errors
}

// -----------------------------------------------------------------------------
// Deterministic serialization: keys in a fixed order, 2-space indent, trailing
// newline. Order is stable so the committed catalog.json is reproducible.
// -----------------------------------------------------------------------------
const KEY_ORDER = {
  root: ["schemaVersion", "generatedBy", "sources", "gateway", "vendors", "models"],
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
    if (a === "--no-enrichment" || a === "--bootstrap" || a === "--check") {
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

async function buildCatalog(args) {
  const schemaPath = args.opts["--schema"] || DEFAULT_SCHEMA
  const schema = JSON.parse(await readFile(schemaPath, "utf8"))

  const modelsUrl = args.opts["--models-url"]
  const noEnrichment = args.flags.has("--no-enrichment")
  const forceBootstrap = args.flags.has("--bootstrap")

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
    const { models, vendorOrder } = shapeFromFeeds(usaiList, modelsDevCatalog)
    catalog = {
      schemaVersion: SCHEMA_VERSION,
      generatedBy: GENERATED_MARKER,
      sources: {
        modelsList: modelsUrl,
        enrichment: noEnrichment ? "(none)" : (args.opts["--models-dev"] || MODELS_DEV_URL),
      },
      gateway: buildGateway(),
      vendors: buildVendors(vendorOrder),
      models,
    }
  } else {
    // Bootstrap from the shipped opencode.jsonc GENERATED block (default).
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

  const errors = validateCatalog(catalog, schema)
  if (errors.length) {
    throw new Error(`catalog failed schema validation:\n  - ${errors.join("\n  - ")}`)
  }
  return catalog
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outPath = args.opts["--out"] || DEFAULT_OUT
  const catalog = await buildCatalog(args)
  const serialized = serialize(catalog)

  if (args.flags.has("--check")) {
    let existing = null
    try {
      existing = await readFile(outPath, "utf8")
    } catch {
      throw new Error(`catalog.json missing at ${outPath}; run without --check to generate`)
    }
    if (existing !== serialized) {
      throw new Error("catalog.json is out of date with the current sources")
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
  parseBootstrapModels,
  bootstrapModelsFromBlock,
  shapeFromFeeds,
  findModelsDevMatch,
  classifyVendor,
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
