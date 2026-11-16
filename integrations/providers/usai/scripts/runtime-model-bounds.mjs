// Caller-owned resource and shape limits, before the canonical matching core.
export const RUNTIME_LIMITS = Object.freeze({
  totalMs: 45000, requestMs: 15000, lockMs: 5000,
  providers: 8, models: 500, membershipBytes: 10 * 1024 * 1024,
  metadataBytes: 32 * 1024 * 1024, resultBytes: 4 * 1024 * 1024,
  depth: 32, nodes: 250000, string: 16384, cardinality: 20000,
})

export function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object")
  return value
}

export function safeKey(key) {
  if (key === "prototype" || Object.hasOwn(Object.prototype, key)) throw new Error("unsafe object key")
  return key
}

export function modelId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) throw new Error("invalid model identity")
  return safeKey(value)
}

// Inspect JSON tokens before JSON.parse allocates its object graph. Recursion is
// bounded before descent; decoded duplicate/unsafe keys are refused. Error text
// deliberately never contains response bytes (which could echo credentials).
export function boundedJson(text, maxBytes) {
  if (typeof text !== "string" || Buffer.byteLength(text) > maxBytes) throw new Error("JSON byte limit")
  let i = 0
  let nodes = 0
  const space = () => { while (i < text.length && /[\t\n\r ]/.test(text[i])) i++ }
  const stringToken = () => {
    const start = i++
    while (i < text.length) {
      if (i - start > RUNTIME_LIMITS.string) throw new Error("JSON string limit")
      if (text[i] === "\\") i += 2
      else if (text[i++] === '"') {
        try { return JSON.parse(text.slice(start, i)) } catch { throw new Error("invalid JSON string") }
      }
    }
    throw new Error("unterminated JSON string")
  }
  const value = (depth) => {
    if (depth > RUNTIME_LIMITS.depth || ++nodes > RUNTIME_LIMITS.nodes) throw new Error("JSON structural limit")
    space()
    if (text[i] === '"') { stringToken(); return }
    const object = text[i] === "{"
    if (object || text[i] === "[") {
      const close = object ? "}" : "]"
      const keys = new Set()
      let count = 0
      i++; space()
      if (text[i] === close) { i++; return }
      for (;;) {
        if (++count > RUNTIME_LIMITS.cardinality) throw new Error("JSON cardinality limit")
        if (object) {
          if (text[i] !== '"') throw new Error("invalid JSON key")
          const key = safeKey(stringToken())
          if (keys.has(key)) throw new Error("duplicate JSON key")
          keys.add(key); space()
          if (text[i++] !== ":") throw new Error("invalid JSON object")
        }
        value(depth + 1); space()
        if (text[i] === close) { i++; return }
        if (text[i++] !== ",") throw new Error("invalid JSON separator")
        space()
      }
    }
    const start = i
    while (i < text.length && !/[\t\n\r ,\]}]/.test(text[i])) {
      if (i - start > 64) throw new Error("JSON scalar limit")
      i++
    }
    const token = text.slice(start, i)
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token)) throw new Error("invalid JSON scalar")
    if (/^[-0-9]/.test(token) && !Number.isFinite(Number(token))) throw new Error("non-finite JSON number")
  }
  value(0); space()
  if (i !== text.length) throw new Error("trailing JSON data")
  try { return JSON.parse(text) } catch { throw new Error("invalid JSON") }
}

export function validatedFacts(facts) {
  record(facts)
  if (facts.schemaVersion !== "acq-provider-facts/v1" || facts.providerId !== "usai" ||
      facts.apiProtocol !== "openai-compatible" || facts.keyEnv !== "USAI_API_KEY") throw new Error("unsupported discovery facts")
  if (typeof facts.host !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(facts.host)) throw new Error("invalid authorized host")
  for (const route of [facts.baseUrl, facts.modelsUrl]) {
    const url = new URL(route)
    if (url.protocol !== "https:" || url.hostname !== facts.host || url.port || url.username || url.password || url.search || url.hash) throw new Error("unauthorized discovery route")
  }
  // Only declared facts cross the worker result boundary.
  return Object.fromEntries(["schemaVersion", "providerId", "apiProtocol", "host", "baseUrl", "modelsUrl", "keyEnv"].map((key) => [key, facts[key]]))
}

// Written only by the host's v3 projector after manifest validation. Its absence
// must never turn a legacy facts+snapshot projection into live discovery.
export function validatedDiscoveryDescriptor(descriptor, providerId) {
  record(descriptor)
  if (Object.keys(descriptor).length !== 3 ||
      descriptor.schemaVersion !== "acq-runtime-discovery/v1" ||
      descriptor.providerId !== providerId || providerId !== "usai" ||
      descriptor.adapter !== "usai-openai-list/v1") throw new Error("invalid runtime discovery descriptor")
  return descriptor
}

export function validateMetadata(catalog) {
  record(catalog)
  let count = 0
  for (const provider of Object.values(catalog)) {
    record(provider)
    if (provider.models === undefined) continue
    for (const [id, data] of Object.entries(record(provider.models))) {
      if (++count > RUNTIME_LIMITS.cardinality) throw new Error("metadata model limit")
      modelId(id); record(data)
    }
  }
  return catalog
}
