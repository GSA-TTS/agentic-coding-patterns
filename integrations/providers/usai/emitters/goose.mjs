// =============================================================================
// goose.mjs — the RENDER half of the USAi catalog pipeline (goose target).
//
// Data flow:
//   live feeds -> build-catalog.mjs -> catalog.json -> emitters/goose.mjs
//
// This module is a PURE function: given the parsed catalog.json object it returns
// the EXACT text of a goose CUSTOM PROVIDER definition file — a serialized JSON
// string ready to write to the goose-server kit's shipped path:
//   integrations/isolation/acq-kits/goose-server/files/home/goose-config/
//     custom_providers/custom_usai.json
//
// goose Desktop drives an external `goose serve` by NAMED provider + model. The
// goose-server kit ships this custom provider so the in-sandbox server exposes the
// SAME `custom_usai` provider a GSA goose Desktop uses. Generating it from the one
// catalog keeps the goose model list in lockstep with OpenCode/prime-agent instead
// of drifting as a hand-maintained snapshot. A byte-exact lockstep test
// (tests/goose.test.mjs) asserts this emitter reproduces the shipped file.
//
// Neutral (catalog) -> goose custom-provider translation:
//   Provider-level (constants + gateway):
//     name              "custom_usai"        (the provider name Desktop selects)
//     engine            "openai"             (goose's OpenAI-compatible engine)
//     display_name      "USAi"
//     api_key_env       "CUSTOM_USAI_API_KEY" — the ENV VAR NAME goose reads the
//                        key from. This is DELIBERATELY the goose-kit's own env
//                        name, NOT catalog.gateway.apiKeyEnv (USAI_API_KEY): acq
//                        injects the key into the goose guest as CUSTOM_USAI_API_KEY
//                        (see the goose-server kit ADR-0003), and goose's custom
//                        provider reads exactly this name. It is an env-var NAME,
//                        never a secret value.
//     base_url          catalog.gateway.baseUrl + "/chat/completions"
//                        (goose posts to the chat-completions endpoint; the catalog
//                        baseUrl is the api/v1 root)
//   Per model (goose CustomProviderModel shape):
//     name              <- catalog model.id   (goose selects models by this id,
//                          e.g. "claude_4_5_sonnet" — the catalog ID, not the
//                          human label)
//     context_limit     <- catalog contextWindow
//     input_token_cost  <- catalog cost.input  / 1e6   (null if absent)
//     output_token_cost <- catalog cost.output / 1e6   (null if absent)
//        UNIT CONVERSION: the catalog stores cost as USD PER 1,000,000 TOKENS
//        (e.g. Sonnet 5 input=2 meaning $2/1M), but goose's custom-provider
//        input_token_cost/output_token_cost are USD PER SINGLE TOKEN. Emitting the
//        per-1M number verbatim makes goose overstate session cost by 1e6 (a
//        ~$0.25 turn shows as ~$249,406). So we DIVIDE by 1e6 here. OpenCode and
//        prime-agent keep the per-1M value because their configs use per-1M cost
//        fields; goose is the odd one out and needs the conversion.
//     currency          "USD" when any cost is present, else null
//     supports_cache_control  true when the catalog model declares cost.cacheRead
//                          or cost.cacheWrite, else null
//     reasoning         false (constant — the catalog carries no reasoning flag;
//                          goose defaults reasoning off for custom providers)
//   Model order: catalog (vendor-grouped) order preserved, matching the other
//   emitters, so all three harnesses list models in one canonical order.
//
// INTENTIONAL LOSS: the tiered `costAbove200kContext` field is DROPPED — goose's
// custom-provider model shape has a single flat cost pair, so the >200k-context
// pricing tier cannot be represented (same documented loss as the prime-agent
// emitter).
//
// No fetch, no fs — the caller passes the parsed catalog and serializes/writes.
// =============================================================================

// The provider NAME Desktop selects and the kit's config primer marks active.
const PROVIDER_NAME = "custom_usai"
// goose's OpenAI-compatible custom-provider engine.
const ENGINE = "openai"
const DISPLAY_NAME = "USAi"
// The ENV VAR NAME goose reads the key from — the goose-server kit's own injected
// name (acq injects the USAi key as CUSTOM_USAI_API_KEY into the goose guest).
// NOT catalog.gateway.apiKeyEnv. This is a name, never a value.
const API_KEY_ENV = "CUSTOM_USAI_API_KEY"
// goose posts to the chat-completions endpoint under the gateway's api/v1 root.
const CHAT_COMPLETIONS_PATH = "/chat/completions"

// Catalog cost is USD per 1,000,000 tokens; goose wants USD per single token.
const TOKENS_PER_COST_UNIT = 1_000_000

// Map one catalog model to a goose custom-provider model object, in the exact key
// order the shipped custom_usai.json uses.
function renderModel(model) {
  const cost = model.cost && typeof model.cost === "object" ? model.cost : {}
  const hasInput = typeof cost.input === "number"
  const hasOutput = typeof cost.output === "number"
  const hasAnyCost = hasInput || hasOutput
  const supportsCache =
    typeof cost.cacheRead === "number" || typeof cost.cacheWrite === "number" ? true : null
  return {
    name: model.id,
    context_limit: model.contextWindow,
    // Convert per-1M-token catalog cost -> per-token cost for goose (see header).
    input_token_cost: hasInput ? cost.input / TOKENS_PER_COST_UNIT : null,
    output_token_cost: hasOutput ? cost.output / TOKENS_PER_COST_UNIT : null,
    currency: hasAnyCost ? "USD" : null,
    supports_cache_control: supportsCache,
    reasoning: false,
    // costAbove200kContext is intentionally dropped — no goose equivalent.
  }
}

/**
 * Emit a goose custom_usai provider definition (serialized) from a parsed
 * catalog.json object.
 *
 * @param {object} catalog parsed catalog.json (schema usai-model-catalog/v1)
 * @returns {string} pretty-printed JSON (2-space indent) with a trailing newline,
 *                    ready to write directly as custom_providers/custom_usai.json
 */
export function emitGooseProviderFromCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new TypeError("emitGooseProviderFromCatalog: catalog must be an object")
  }
  const gateway = catalog.gateway && typeof catalog.gateway === "object" ? catalog.gateway : {}
  const models = Array.isArray(catalog.models) ? catalog.models : []

  const baseUrl =
    typeof gateway.baseUrl === "string" ? `${gateway.baseUrl}${CHAT_COMPLETIONS_PATH}` : undefined

  const doc = {
    name: PROVIDER_NAME,
    engine: ENGINE,
    display_name: DISPLAY_NAME,
    description:
      "Custom USAi provider (GSA USAi OpenAI-compatible gateway). Shipped by the " +
      "goose-server acq kit so the in-sandbox goosed server exposes the SAME " +
      "provider a goose Desktop client already uses, letting Desktop drive the " +
      "external server without reconfiguring. The API key is NOT in this file: " +
      "goose reads it from the CUSTOM_USAI_API_KEY env var (api_key_env), which " +
      "acq injects at runtime bound to api.gsa.usai.gov. GENERATED from the USAi " +
      "catalog by the goose emitter — do not hand-edit; regenerate via the emitter.",
    api_key_env: API_KEY_ENV,
    base_url: baseUrl,
    models: models.map(renderModel), // ARRAY, catalog (vendor-grouped) order preserved
    headers: null,
    timeout_seconds: null,
    supports_streaming: true,
    requires_auth: true,
    catalog_provider_id: null,
    base_path: null,
    env_vars: null,
    dynamic_models: null,
    skip_canonical_filtering: false,
    model_doc_link: null,
    setup_steps: [],
    fast_model: null,
    preserves_thinking: true,
    emit_clear_thinking: false,
    setup: null,
  }

  return `${JSON.stringify(doc, null, 2)}\n`
}

export default emitGooseProviderFromCatalog
