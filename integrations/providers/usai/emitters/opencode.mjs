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

function jsonPositiveInteger(value, where) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`emitOpenCodeBlockFromCatalog: ${where} must be a positive integer`)
  }
  return JSON.stringify(value)
}

function jsonNonNegativeNumber(value, where) {
  const rendered = jsonNumber(value, where)
  if (value < 0) throw new TypeError(`emitOpenCodeBlockFromCatalog: ${where} must be non-negative`)
  return rendered
}

// Render one cost tier object (base cost) as multi-line JSON entries, in the
// canonical key order the file uses: input, output, cache_read, cache_write,
// then the compact context_over_200k line last (when present).
function renderCost(model) {
  const lines = []
  const cost = model.cost || {}
  const parts = []
  if ("input" in cost) parts.push([`"input"`, jsonNonNegativeNumber(cost.input, "cost.input")])
  if ("output" in cost) parts.push([`"output"`, jsonNonNegativeNumber(cost.output, "cost.output")])
  if ("cacheRead" in cost) parts.push([`"cache_read"`, jsonNonNegativeNumber(cost.cacheRead, "cost.cacheRead")])
  if ("cacheWrite" in cost) parts.push([`"cache_write"`, jsonNonNegativeNumber(cost.cacheWrite, "cost.cacheWrite")])

  // context_over_200k is rendered as a compact one-line object, always LAST.
  const above = model.costAbove200kContext
  let aboveLine = null
  if (above && typeof above === "object") {
    const inner = []
    const w = "costAbove200kContext"
    if ("input" in above) inner.push(`"input":${jsonNonNegativeNumber(above.input, `${w}.input`)}`)
    if ("output" in above) inner.push(`"output":${jsonNonNegativeNumber(above.output, `${w}.output`)}`)
    if ("cacheRead" in above) inner.push(`"cache_read":${jsonNonNegativeNumber(above.cacheRead, `${w}.cacheRead`)}`)
    if ("cacheWrite" in above) inner.push(`"cache_write":${jsonNonNegativeNumber(above.cacheWrite, `${w}.cacheWrite`)}`)
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
  lines.push(`${INDENT_3}"context": ${jsonPositiveInteger(model.contextWindow, `${where}.contextWindow`)},`)
  lines.push(`${INDENT_3}"output": ${jsonPositiveInteger(model.maxOutputTokens, `${where}.maxOutputTokens`)}`)
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

/**
 * Map neutral catalog defaults to OpenCode configuration values.
 * Values are prefixed with "usai/" per OpenCode provider model namespace convention.
 *
 * @param {object} catalog parsed catalog.json
 * @returns {object} OpenCode formatted defaults
 *   { model, small_model, compaction, summary, title }
 */
export function emitOpenCodeDefaults(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new TypeError("emitOpenCodeDefaults: catalog must be an object")
  }
  if (!catalog.defaults || typeof catalog.defaults !== "object" || Array.isArray(catalog.defaults)) {
    throw new TypeError("emitOpenCodeDefaults: catalog.defaults must be an object")
  }
  const { primary, small } = catalog.defaults
  if (typeof primary !== "string" || primary.length === 0) {
    throw new TypeError("emitOpenCodeDefaults: defaults.primary must be a non-empty string")
  }
  if (typeof small !== "string" || small.length === 0) {
    throw new TypeError("emitOpenCodeDefaults: defaults.small must be a non-empty string")
  }

  // Ensure chosen default IDs do not contain characters that could break out of JSON strings
  // or trigger unexpected template expansions
  const SAFE_ID_RE = /^[A-Za-z0-9_.:-]+$/
  if (!SAFE_ID_RE.test(primary)) {
    throw new TypeError(`emitOpenCodeDefaults: defaults.primary contains invalid characters: "${primary}"`)
  }
  if (!SAFE_ID_RE.test(small)) {
    throw new TypeError(`emitOpenCodeDefaults: defaults.small contains invalid characters: "${small}"`)
  }

  // Optional `agent.<role>.model` roles. Each is validated the same way as the
  // required pair, so an invalid id cannot reach the config by being optional.
  const agentRoles = {}
  for (const role of ["compaction", "summary", "title"]) {
    const value = catalog.defaults[role]
    if (value === undefined) {
      agentRoles[role] = null
      continue
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`emitOpenCodeDefaults: defaults.${role} must be a non-empty string when present`)
    }
    if (!SAFE_ID_RE.test(value)) {
      throw new TypeError(`emitOpenCodeDefaults: defaults.${role} contains invalid characters: "${value}"`)
    }
    agentRoles[role] = `usai/${value}`
  }

  return {
    model: `usai/${primary}`,
    small_model: `usai/${small}`,
    ...agentRoles,
  }
}

// -----------------------------------------------------------------------------
// JSONC-aware structural scanner.
//
// WHY THIS EXISTS INSTEAD OF A REGEX. The default-model keys this emitter has to
// patch live at known OBJECT PATHS (`model`, `small_model`,
// `agent.compaction.model`), and a regex cannot express "the value at this
// path". The previous implementation approximated `agent.compaction.model` with
//
//     /("agent"\s*:\s*\{[^{}]*?"compaction"\s*:\s*\{[^{}]*?"model"\s*:\s*")/
//
// where `[^{}]*?` forbids any brace between `agent` and `compaction`. That only
// holds when `compaction` is the FIRST nested object under `agent`. The shipped
// config happens to satisfy it, but `agent` also carries `summary` and `title`
// siblings — reorder them and the pattern silently matches nothing, leaving a
// stale compaction model in a file the pipeline reports as regenerated.
//
// The top-level patterns had a related weakness: `/^[ \t]*"model"[ \t]*:/m`
// matches the FIRST line-anchored `"model"` anywhere in the file, which is a
// nested `agent.*.model` whenever the `agent` block precedes the top-level keys.
//
// This scanner walks the text once, tracking object/array nesting and the
// current key path, and skipping comments and string contents. It reports the
// span of the string value at an exact path, so sibling order, nesting depth,
// and commented-out or in-array decoys cannot affect the result. It does not
// build a JSON value — patching is textual, to preserve comments and formatting
// byte-for-byte.
// -----------------------------------------------------------------------------

// Marker for an array element frame: array indices are not part of any path we
// patch, so elements are tracked only to keep nesting depth correct.
const ARRAY_ELEMENT = Symbol("arrayElement")

function skipLineComment(text, i) {
  while (i < text.length && text[i] !== "\n") i++
  return i
}

function skipBlockComment(text, i) {
  i += 2
  while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
  return i + 2
}

// Index of the closing quote of the string whose contents start at `start`.
// Returns -1 on an unterminated string.
function stringEnd(text, start) {
  let j = start
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2
      continue
    }
    if (text[j] === '"') return j
    j++
  }
  return -1
}

/**
 * Locate a value at an exact object path in JSONC text.
 *
 * @param {string} text JSONC document
 * @param {string[]} path object keys, outermost first
 * @param {"value"|"container"} mode `value` returns the {start,end} span of the
 *   string value at `path`; `container` reports whether an OBJECT exists at
 *   `path` (used to tell "the template has no such section" apart from "the
 *   section is there but we failed to patch it")
 * @returns {{start: number, end: number}|{found: true}|null}
 */
function scanJsonc(text, path, mode) {
  let i = 0
  const here = []
  // Whether each open brace/bracket pushed a path segment, so `}`/`]` pops
  // symmetrically. A brace that is not a keyed value (the document root, or an
  // object inside an array) contributes no key.
  const pushedSegment = []
  const frame = []
  let pendingKey = null
  let expectValue = false

  const atPathForKey = (key) => {
    if (here.length + 1 !== path.length) return false
    for (let x = 0; x < here.length; x++) if (here[x] !== path[x]) return false
    return key === path[path.length - 1]
  }
  const atPath = () => {
    if (here.length !== path.length) return false
    for (let x = 0; x < here.length; x++) if (here[x] !== path[x]) return false
    return true
  }

  while (i < text.length) {
    const c = text[i]
    if (c === "/" && text[i + 1] === "/") {
      i = skipLineComment(text, i)
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i)
      continue
    }
    if (c === '"') {
      const start = i + 1
      const end = stringEnd(text, start)
      if (end === -1) return null
      if (expectValue) {
        if (mode === "value" && frame[frame.length - 1] === "object" && pendingKey !== null && atPathForKey(pendingKey)) {
          return { start, end }
        }
        expectValue = false
        pendingKey = null
      } else if (frame[frame.length - 1] === "object") {
        pendingKey = text.slice(start, end)
      }
      i = end + 1
      continue
    }
    if (c === ":") {
      expectValue = true
      i++
      continue
    }
    if (c === "{" || c === "[") {
      if (expectValue && pendingKey !== null) {
        here.push(pendingKey)
        pushedSegment.push(true)
      } else if (frame[frame.length - 1] === "array") {
        here.push(ARRAY_ELEMENT)
        pushedSegment.push(true)
      } else {
        pushedSegment.push(false)
      }
      frame.push(c === "{" ? "object" : "array")
      expectValue = false
      pendingKey = null
      if (mode === "container" && frame[frame.length - 1] === "object" && atPath()) return { found: true }
      i++
      continue
    }
    if (c === "}" || c === "]") {
      frame.pop()
      if (pushedSegment.pop()) here.pop()
      expectValue = false
      pendingKey = null
      i++
      continue
    }
    if (c === ",") {
      expectValue = false
      pendingKey = null
      i++
      continue
    }
    i++
  }
  return null
}

// Replace the string value at `path`. Throws when the path is absent, because a
// requested role that cannot be patched must fail loudly rather than leave a
// stale model behind in a file reported as regenerated.
function setJsoncStringAtPath(text, path, value, label) {
  const span = scanJsonc(text, path, "value")
  if (!span) {
    throw new Error(
      `patchOpenCodeConfig: could not locate a string value at ${label} ("${path.join(".")}") in template`,
    )
  }
  return text.slice(0, span.start) + value + text.slice(span.end)
}

function hasJsoncObjectAtPath(text, path) {
  return Boolean(scanJsonc(text, path, "container"))
}

/**
 * Patch an existing opencode.jsonc template text with both the models block
 * and the default model selections from the catalog.
 *
 * @param {string} templateText raw opencode.jsonc text
 * @param {object} catalog parsed catalog.json
 * @returns {string} updated opencode.jsonc text
 */
export function patchOpenCodeConfig(templateText, catalog) {
  if (typeof templateText !== "string") {
    throw new TypeError("patchOpenCodeConfig: templateText must be a string")
  }
  const defaults = emitOpenCodeDefaults(catalog)
  const modelsBlock = emitOpenCodeBlockFromCatalog(catalog)

  // 1. Replace generated models block
  const beginIdx = templateText.indexOf(BEGIN_MARKER)
  const endIdx = templateText.indexOf(END_MARKER)
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error("patchOpenCodeConfig: BEGIN/END GENERATED USAI MODELS markers not found in template")
  }

  const beforeMarker = templateText.slice(0, beginIdx)
  const afterMarker = templateText.slice(endIdx + END_MARKER.length)

  let updated = `${beforeMarker}${modelsBlock.trim()}${afterMarker}`

  // 2. Top-level roles. Resolved by path, so a nested `agent.*.model` earlier in
  // the file cannot be mistaken for the top-level key.
  updated = setJsoncStringAtPath(updated, ["model"], defaults.model, "top-level 'model'")
  updated = setJsoncStringAtPath(updated, ["small_model"], defaults.small_model, "top-level 'small_model'")

  // 3. agent.<role>.model for each modelled agent role. A template that does
  // not configure a role at all is legitimate and left alone; a template that
  // DOES configure it must be patched, so a present-but-unpatchable section is
  // an error rather than a silent skip.
  for (const role of ["compaction", "summary", "title"]) {
    const value = defaults[role]
    if (!value) continue
    if (!hasJsoncObjectAtPath(updated, ["agent", role])) continue
    updated = setJsoncStringAtPath(updated, ["agent", role, "model"], value, `'agent.${role}.model'`)
  }

  return updated
}


export default emitOpenCodeBlockFromCatalog
