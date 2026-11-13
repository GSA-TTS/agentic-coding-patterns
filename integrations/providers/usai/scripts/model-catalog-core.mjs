// Pure model identity, filtering and optional upstream enrichment shared by the
// repository-time builder and guest consumers. No I/O, credentials, CLI, logging
// or generic limit defaults belong here. Callers validate their input boundary;
// upstream metadata does not prove gateway capabilities or model availability.

// Vendor grouping + USAi backend routing. Order here is the canonical vendor
// display order for the catalog (Anthropic, OpenAI, Google, Meta, Cohere).
// usaiBackend records the backend USAi routes each vendor through — the same
// backend the monolith sources pricing from (Anthropic->Bedrock, OpenAI->Azure,
// Gemini->Vertex, Meta->Bedrock, Cohere->Cohere).
export const VENDOR_CONFIG = {
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

function normalizeText(value) {
  return String(value ?? "").toLowerCase()
}

export function classifyVendor(id, ownedBy) {
  const owned = normalizeText(ownedBy)
  if (owned.includes("anthropic") || /^claude/i.test(id)) return "anthropic"
  if (owned.includes("open ai") || owned.includes("openai") || /^gpt/i.test(id)) return "openai"
  if (owned.includes("google") || /^gemini/i.test(id)) return "google"
  if (owned.includes("meta") || /^llama/i.test(id)) return "meta"
  if (owned.includes("cohere") || /^cohere/i.test(id)) return "cohere"
  return "other"
}

export function generateDisplayName(id) {
  if (DISPLAY_NAME_OVERRIDES[id]) return DISPLAY_NAME_OVERRIDES[id]
  return id
    .replace(/[_-]+/g, " ")
    .replace(/(\d)\s+(\d)/g, "$1.$2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bLlama\b/g, "Llama")
}

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

export function normalizeModelId(id) {
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

export function extractModelTokens(id) {
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
export function isPreciseMatch(usaiTokens, catalogTokens) {
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

export function findModelsDevMatch(usaiId, catalog) {
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

export function providerModelMaps(vendor, catalog) {
  const mapping = VENDOR_PROVIDER_MAP[vendor] || VENDOR_PROVIDER_MAP.other
  const providerIds = [mapping.primary, ...mapping.fallback].filter(Boolean)
  const maps = []
  for (const id of providerIds) {
    const models = catalog[id]?.models
    if (models && typeof models === "object") maps.push({ providerId: id, models })
  }
  return maps
}

// Cost normalization. The catalog uses camelCase keys; models.dev uses
// snake_case and nests tiered pricing under context_over_200k.
const COST_MAP = [
  ["input", "input"],
  ["output", "output"],
  ["cacheRead", "cache_read"],
  ["cacheWrite", "cache_write"],
]

export function normalizeCostFromModelsDev(cost) {
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

export function normalizeLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

// ABSENT = unknown, false / ["text"] = known unsupported / text-only.
// Upstream capabilities are opt-in, never proof of gateway support. The
// allowlist mirrors the model config and catalog schemas in canonical order.
export const INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"]

export function normalizeInputModalities(value, where) {
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

// Malformed upstream capabilities are unknown, not fatal. Return diagnostics
// as data so the caller owns whether and where to report them.
export function capabilitiesFromModelsDev(data) {
  const out = {}
  const warnings = []
  const unknown = (why) => warnings.push(why)
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
  return { capabilities: out, malformed: warnings.length > 0, warnings }
}

// Models the gateway serves that cannot be prompted, keyed to the reason.
// The gateway's /v1/models response carries no capability field, so
// promptability is decided here rather than read from the feed.
//
// These embedding models have no generation support. Chat deployments are
// eligible once their completion endpoint is available.
export const NON_CHAT_MODELS = {
  cohere_english_v3: "embedding model; /chat/completions returns 403 AccessDeniedException",
  "text-embedding-005": "embedding model; /chat/completions returns 400 (no generation support)",
}

// Default-deny net for a non-chat model not yet listed above. Substring, not
// `\bembed\b`: `_` is a word character, so a word-boundary form matches no
// underscore-delimited id.
const EMBEDDING_ID_RE = /embedding|embed/

/** Why this model cannot be offered as chat, or null if not excluded. */
export function nonChatReason(id, name = "") {
  if (Object.hasOwn(NON_CHAT_MODELS, id)) return NON_CHAT_MODELS[id]
  if (EMBEDDING_ID_RE.test(`${id} ${name}`.toLowerCase())) {
    return "id or name indicates an embedding model"
  }
  return null
}

/**
 * Optional metadata for ONE already validated, advertised model. Positive
 * provider limits (contextWindow/maxOutputTokens) win independently; the first
 * precise match in backend preference order supplies remaining metadata.
 * Missing limits stay ABSENT: only authoring callers may apply generic defaults.
 * No membership, recommendations or curated capabilities are copied here.
 * includeCapabilities opts into UNVERIFIED upstream values, not gateway facts.
 * Inputs are not mutated. Invalid upstream cost retains the builder's throwing
 * behavior; callers own their optional-enrichment failure policy.
 */
export function enrichModelMetadata(model, modelsDevCatalog, { includeCapabilities = false } = {}) {
  let context = normalizeLimit(model.contextWindow, null)
  let output = normalizeLimit(model.maxOutputTokens, null)
  let baseCost = null
  let above = null
  let capabilities = {}
  let matched = false
  let matchId = null
  let capabilityWarnings = []
  let capabilityMalformed = false
  if (modelsDevCatalog) {
    for (const { models: providerModels } of providerModelMaps(model.vendor, modelsDevCatalog)) {
      const match = findModelsDevMatch(model.id, providerModels)
      if (match?.data) {
        matched = true
        matchId = match.id
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
          const result = capabilitiesFromModelsDev(match.data)
          capabilities = result.capabilities
          capabilityWarnings = result.warnings
          capabilityMalformed = result.malformed
        }
        break
      }
    }
  }
  const metadata = {}
  const missingLimits = []
  if (context) metadata.contextWindow = context
  else missingLimits.push("context")
  if (output) metadata.maxOutputTokens = output
  else missingLimits.push("output")
  if (baseCost) metadata.cost = baseCost
  if (above) metadata.costAbove200kContext = above
  if (capabilities.reasoning !== undefined) metadata.reasoning = capabilities.reasoning
  if (capabilities.inputModalities !== undefined) metadata.inputModalities = capabilities.inputModalities
  return { metadata, matched, matchId, missingLimits, capabilityWarnings, capabilityMalformed }
}
