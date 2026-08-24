// =============================================================================
// prime-agent.mjs — the RENDER half of the USAi catalog pipeline (prime-agent).
//
// Data flow:
//   live feeds -> build-catalog.mjs -> catalog.json -> emitters/prime-agent.mjs
//
// This module is a PURE function: given the parsed catalog.json object it
// returns the EXACT text of a prime-agent models.json — a serialized JSON string
// ready to write to disk (2-space indent, trailing newline, no comments — it is
// a .json file). Issue #362 wires this output into the prime-agent kit's
// models.json on the kit branch; returning a ready-to-write string keeps that
// wiring a single `writeFileSync(path, emitPrimeAgentModelsFromCatalog(catalog))`.
//
// Neutral (catalog) -> prime-agent translation:
//   gateway.baseUrl   -> providers.usai.baseUrl
//   gateway.api       -> providers.usai.api
//   gateway.apiKeyEnv -> providers.usai.apiKey (the NAME of an env var, never a
//                        value; e.g. "USAI_API_KEY")
//   authHeader: true  (constant — prime-agent auths via an Authorization header)
//   models are an ARRAY of objects (each carries its own `id`), NOT a map;
//   catalog order (vendor-grouped) is preserved as-is.
//   Per model:
//     id            -> id
//     name          -> name
//     contextWindow -> contextWindow   (flat; no OpenCode `limit` object)
//     maxOutputTokens -> maxTokens     (renamed)
//     cost.{input,output,cacheRead,cacheWrite} -> cost.{...} camelCase, verbatim
//                       (no snake_case translation; absent keys omitted)
//
// INTENTIONAL LOSS: the tiered `costAbove200kContext` field is DROPPED. The
// prime-agent models.json shape has no equivalent field, so the >200k-context
// pricing tier carried by gpt-5.5 / gpt-5.4 / gemini-2.5-pro cannot be
// represented here and is deliberately not emitted (see renderCost below).
//
// No fetch, no fs — the caller passes the parsed catalog and serializes/writes.
// =============================================================================

// Copy only the recognized camelCase cost keys, preserving their values and the
// canonical input/output/cacheRead/cacheWrite order. Absent keys are omitted.
//
// NOTE: `costAbove200kContext` is intentionally NOT read here — prime-agent has
// no tiered-pricing field, so that data is dropped (documented loss).
function renderCost(cost) {
  const out = {}
  if (!cost || typeof cost !== "object") return out
  if ("input" in cost) out.input = cost.input
  if ("output" in cost) out.output = cost.output
  if ("cacheRead" in cost) out.cacheRead = cost.cacheRead
  if ("cacheWrite" in cost) out.cacheWrite = cost.cacheWrite
  return out
}

// Map one catalog model to a prime-agent model object.
function renderModel(model) {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens, // catalog.maxOutputTokens -> prime-agent maxTokens
    cost: renderCost(model.cost),
    // costAbove200kContext is intentionally dropped — no prime-agent equivalent.
  }
}

/**
 * Emit a prime-agent models.json (serialized) from a parsed catalog.json object.
 *
 * @param {object} catalog parsed catalog.json (schema usai-model-catalog/v1)
 * @returns {string} pretty-printed JSON (2-space indent) with a trailing newline,
 *                    ready to write directly as models.json
 */
export function emitPrimeAgentModelsFromCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new TypeError("emitPrimeAgentModelsFromCatalog: catalog must be an object")
  }
  const gateway = catalog.gateway && typeof catalog.gateway === "object" ? catalog.gateway : {}
  const models = Array.isArray(catalog.models) ? catalog.models : []

  const doc = {
    providers: {
      usai: {
        baseUrl: gateway.baseUrl,
        api: gateway.api,
        apiKey: gateway.apiKeyEnv, // env-var NAME (e.g. "USAI_API_KEY"), never a value
        authHeader: true,
        models: models.map(renderModel), // ARRAY, catalog order preserved
      },
    },
  }

  return `${JSON.stringify(doc, null, 2)}\n`
}

export default emitPrimeAgentModelsFromCatalog
