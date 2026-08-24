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
  return `${INDENT_MODEL}// ${label} Models`
}

// Render one cost tier object (base cost) as multi-line JSON entries, in the
// canonical key order the file uses: input, output, cache_read, cache_write,
// then the compact context_over_200k line last (when present).
function renderCost(model) {
  const lines = []
  const cost = model.cost || {}
  const parts = []
  if ("input" in cost) parts.push([`"input"`, cost.input])
  if ("output" in cost) parts.push([`"output"`, cost.output])
  if ("cacheRead" in cost) parts.push([`"cache_read"`, cost.cacheRead])
  if ("cacheWrite" in cost) parts.push([`"cache_write"`, cost.cacheWrite])

  // context_over_200k is rendered as a compact one-line object, always LAST.
  const above = model.costAbove200kContext
  let aboveLine = null
  if (above && typeof above === "object") {
    const inner = []
    if ("input" in above) inner.push(`"input":${above.input}`)
    if ("output" in above) inner.push(`"output":${above.output}`)
    if ("cacheRead" in above) inner.push(`"cache_read":${above.cacheRead}`)
    if ("cacheWrite" in above) inner.push(`"cache_write":${above.cacheWrite}`)
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
  lines.push(`${INDENT_MODEL}"${model.id}": {`)
  lines.push(`${INDENT_2}"name": "${model.name}",`)
  lines.push(`${INDENT_2}"limit": {`)
  lines.push(`${INDENT_3}"context": ${model.contextWindow},`)
  lines.push(`${INDENT_3}"output": ${model.maxOutputTokens}`)
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

  // Group models by vendor, preserving catalog.json order within each vendor.
  const byVendor = new Map()
  for (const v of orderedVendors) byVendor.set(v.key, [])
  for (const m of models) {
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
