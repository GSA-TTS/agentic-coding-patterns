// =============================================================================
// opencode.mjs — the RENDER half of the USAi catalog pipeline (opencode target).
//
// Data flow:
//   live feeds -> build-catalog.mjs -> catalog.json -> emitters/opencode.mjs
//
// This module is a PURE function: given the parsed catalog.json object it
// returns the EXACT text of the region between (and including) the
// `// BEGIN GENERATED USAI MODELS` and `// END GENERATED USAI MODELS` marker
// comment lines as it appears in the shipped provider config:
//   integrations/isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc
//
// The byte-exact round-trip test (tests/emitters.test.mjs) asserts that this
// emitter reproduces the shipped block verbatim, which is the guarantee that
// catalog.json losslessly represents the shipped config.
//
// Neutral (catalog) -> OpenCode translation:
//   models are a MAP keyed by id (not an array);
//   contextWindow    -> limit.context
//   maxOutputTokens  -> limit.output
//   cost.cacheRead   -> cost.cache_read
//   cost.cacheWrite  -> cost.cache_write
//   costAbove200kContext -> a compact one-line `context_over_200k` object nested
//                           inside cost.
//   vendor group comments (`// Anthropic Models`, ...) emitted in vendor order;
//   model order within each vendor preserved as in catalog.json.
//
// No fetch, no fs — the caller passes the parsed catalog; the test does the
// file reads.
// =============================================================================

const BEGIN_MARKER = "// BEGIN GENERATED USAI MODELS"
const END_MARKER = "// END GENERATED USAI MODELS"

// Indentation constants matching the shipped opencode.jsonc. The model MAP lives
// under provider.usai.models, which is nested 4 levels deep (8 spaces) in the
// file; nested objects add 2 spaces per level.
const INDENT_MODEL = "        " // 8 spaces — model key + marker/comment lines
const INDENT_2 = "          " // 10 spaces — model body keys (name, limit, cost)
const INDENT_3 = "            " // 12 spaces — nested limit/cost entries

// Vendor-group comment label. The shipped file uses "<Label> Models".
function vendorComment(label) {
  if (typeof label !== "string" || /[\r\n\u2028\u2029]/u.test(label)) {
    throw new TypeError("emitOpenCodeBlockFromCatalog: vendor label must be a single-line string")
  }
  return `${INDENT_MODEL}// ${label} Models`
}

// SERIALIZE, NEVER INTERPOLATE, any value that originates in the upstream feed.
//
// A model's `id` and `name` come from the gateway's response verbatim, and the
// catalog's `cost` numbers come from the enrichment source. This emitter writes
// CONFIGURATION THAT AN AI CODING AGENT THEN OBEYS, so a value that can close
// its own JSON string can add sibling keys to that config — including a
// top-level `permission` block. A `"` inside an id was previously sufficient.
//
// These helpers exist because the emitter is a PURE function over its argument
// and does not call the catalog validator: it cannot assume its input has been
// checked, and a defense that depends on an earlier caller having validated is
// not a defense. `build-catalog.mjs` constrains these fields too (defense in
// depth), but the escaping here is what actually holds.
//
// `JSON.stringify` is the whole mechanism: it emits the surrounding quotes and
// escapes `"`, `\` and control characters. Verified against the live 20-model
// catalog: for every shipped id and name, `JSON.stringify(v)` is byte-identical
// to the old `"${v}"` interpolation, so the byte-exact round-trip guarantee is
// unchanged.
function jsonString(value, where) {
  if (typeof value !== "string") {
    throw new TypeError(`emitOpenCodeBlockFromCatalog: ${where} must be a string (got ${typeof value})`)
  }
  return JSON.stringify(value)
}

// Numbers are interpolated WITHOUT quotes, so a non-number here would be
// written as a bare token and could inject arbitrary JSON. Refuse rather than
// coerce: a string "1" that renders as `1` would silently pass a round-trip
// test while proving nothing about what the feed actually sent. Infinity and
// NaN are rejected because `JSON.stringify` renders them as `null`, which is
// not a valid limit or price.
function jsonNumber(value, where) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(
      `emitOpenCodeBlockFromCatalog: ${where} must be a finite number (got ${typeof value === "number" ? value : typeof value})`,
    )
  }
  return JSON.stringify(value)
}

// Render one cost tier object (base cost) as multi-line JSON entries, in the
// canonical key order the file uses: input, output, cache_read, cache_write,
// then the compact context_over_200k line last (when present).
function renderCost(model) {
  const lines = []
  const cost = model.cost || {}
  const parts = []
  if ("input" in cost) parts.push([`"input"`, jsonNumber(cost.input, "cost.input")])
  if ("output" in cost) parts.push([`"output"`, jsonNumber(cost.output, "cost.output")])
  if ("cacheRead" in cost) parts.push([`"cache_read"`, jsonNumber(cost.cacheRead, "cost.cacheRead")])
  if ("cacheWrite" in cost) parts.push([`"cache_write"`, jsonNumber(cost.cacheWrite, "cost.cacheWrite")])

  // context_over_200k is rendered as a compact one-line object, always LAST.
  const above = model.costAbove200kContext
  let aboveLine = null
  if (above && typeof above === "object") {
    const inner = []
    const w = "costAbove200kContext"
    if ("input" in above) inner.push(`"input":${jsonNumber(above.input, `${w}.input`)}`)
    if ("output" in above) inner.push(`"output":${jsonNumber(above.output, `${w}.output`)}`)
    if ("cacheRead" in above) inner.push(`"cache_read":${jsonNumber(above.cacheRead, `${w}.cacheRead`)}`)
    if ("cacheWrite" in above) inner.push(`"cache_write":${jsonNumber(above.cacheWrite, `${w}.cacheWrite`)}`)
    aboveLine = `"context_over_200k": {${inner.join(",")}}`
  }

  const totalEntries = parts.length + (aboveLine ? 1 : 0)
  let emitted = 0
  for (const [key, value] of parts) {
    emitted++
    const trailing = emitted < totalEntries ? "," : ""
    lines.push(`${INDENT_3}${key}: ${value}${trailing}`)
  }
  if (aboveLine) {
    // context_over_200k is last, so it never carries a trailing comma.
    lines.push(`${INDENT_3}${aboveLine}`)
  }
  return lines
}

// Render one model object body (name, limit, cost). `trailingComma` controls
// whether the closing brace of the model gets a trailing comma (all but the
// last model in the whole block do).
function renderModel(model, trailingComma) {
  const lines = []
  const where = typeof model?.id === "string" ? `models["${model.id}"]` : "models[?]"
  lines.push(`${INDENT_MODEL}${jsonString(model.id, "model.id")}: {`)
  lines.push(`${INDENT_2}"name": ${jsonString(model.name, `${where}.name`)},`)
  lines.push(`${INDENT_2}"limit": {`)
  lines.push(`${INDENT_3}"context": ${jsonNumber(model.contextWindow, `${where}.contextWindow`)},`)
  lines.push(`${INDENT_3}"output": ${jsonNumber(model.maxOutputTokens, `${where}.maxOutputTokens`)}`)
  lines.push(`${INDENT_2}},`)
  lines.push(`${INDENT_2}"cost": {`)
  lines.push(...renderCost(model))
  lines.push(`${INDENT_2}}`)
  lines.push(`${INDENT_MODEL}}${trailingComma ? "," : ""}`)
  return lines
}

/**
 * Emit the OpenCode GENERATED USAI MODELS block (inclusive of the BEGIN/END
 * marker comment lines) from a parsed catalog.json object.
 *
 * @param {object} catalog parsed catalog.json (schema usai-model-catalog/v1)
 * @returns {string} the exact block text, matching the shipped opencode.jsonc
 */
export function emitOpenCodeBlockFromCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new TypeError("emitOpenCodeBlockFromCatalog: catalog must be an object")
  }
  const vendors = Array.isArray(catalog.vendors) ? catalog.vendors : []
  const models = Array.isArray(catalog.models) ? catalog.models : []

  // Vendors in declared display order.
  const orderedVendors = [...vendors].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const vendorKeys = new Set()
  for (const vendor of orderedVendors) {
    if (vendorKeys.has(vendor.key)) {
      throw new TypeError(`emitOpenCodeBlockFromCatalog: duplicate vendor key ${JSON.stringify(vendor.key)}`)
    }
    vendorKeys.add(vendor.key)
  }

  // Group models by vendor, preserving catalog.json order within each vendor.
  const byVendor = new Map()
  const modelIds = new Set()
  for (const v of orderedVendors) byVendor.set(v.key, [])
  for (const m of models) {
    if (modelIds.has(m.id)) {
      throw new TypeError(`emitOpenCodeBlockFromCatalog: duplicate model id ${JSON.stringify(m.id)}`)
    }
    modelIds.add(m.id)
    if (!byVendor.has(m.vendor)) byVendor.set(m.vendor, [])
    byVendor.get(m.vendor).push(m)
  }

  // Only vendors that actually have models get a group comment/section.
  const vendorSections = orderedVendors
    .map((v) => ({ vendor: v, models: byVendor.get(v.key) || [] }))
    .filter((s) => s.models.length > 0)

  const totalModels = vendorSections.reduce((n, s) => n + s.models.length, 0)

  const lines = [`${INDENT_MODEL}${BEGIN_MARKER}`]

  let modelIndex = 0
  vendorSections.forEach((section, sectionIdx) => {
    // A blank line precedes every vendor group EXCEPT the first.
    if (sectionIdx > 0) lines.push("")
    lines.push(vendorComment(section.vendor.label))
    for (const model of section.models) {
      modelIndex++
      const isLast = modelIndex === totalModels
      lines.push(...renderModel(model, !isLast))
    }
  })

  lines.push(`${INDENT_MODEL}${END_MARKER}`)
  return lines.join("\n")
}

export default emitOpenCodeBlockFromCatalog
