// Trusted usai-openai-list/v1 adapter. No provider code is imported or executed.
import { open, readdir, lstat } from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { classifyVendor, generateDisplayName, nonChatReason, enrichModelMetadata, normalizeInputModalities } from "./model-catalog-core.mjs"
import { RUNTIME_LIMITS, boundedJson, record, modelId, validatedFacts, validatedDiscoveryDescriptor, validateMetadata, usableRuntimeMetadata } from "./runtime-model-bounds.mjs"
import { runtimeFailure, requestFailure, preserveRuntimeFailure } from "./runtime-model-outcome.mjs"

export const METADATA_URL = "https://models.dev/api.json"

export async function readBoundedFile(filename, limit) {
  if (!(await lstat(filename)).isFile()) throw new Error("input is not a regular file")
  const file = await open(filename, "r")
  try {
    if ((await file.stat()).size > limit) throw new Error("input byte limit")
    // Read at most limit+1 even if a file grows after stat. Host projection must
    // be immutable and read-only; this is not a substitute for host containment.
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > limit) throw new Error("input byte limit")
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))
  } finally { await file.close() }
}

export async function requestJson(url, { headers = {}, limit, deadline, fetchImpl = fetch, trustedProvider = false }) {
  if (trustedProvider) {
    try {
      const route = new URL(url)
      if (route.protocol !== "https:" || route.username || route.password || route.port || route.search || route.hash) throw new Error()
    } catch { throw runtimeFailure("input", "input") }
  }
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw runtimeFailure("preparation", "deadline")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(RUNTIME_LIMITS.requestMs, remaining))
  try {
    let response
    try { response = await fetchImpl(url, { headers, redirect: "error", signal: controller.signal, credentials: "omit" }) }
    catch (error) { throw trustedProvider ? requestFailure(error, controller.signal.aborted) : runtimeFailure("membership", "unknown") }
    // Identity precedes status: an off-origin 429/5xx is never availability evidence.
    if (response.redirected || (response.url && response.url !== url) || (response.status !== 200 && response.url !== url)) throw runtimeFailure("membership", "identity")
    if (response.status !== 200) {
      const kind = [401, 403].includes(response.status) ? "authentication"
        : trustedProvider && response.status === 429 ? "throttled"
        : trustedProvider && Number.isInteger(response.status) && response.status >= 500 && response.status <= 599 ? "unavailable" : "http"
      throw runtimeFailure("membership", kind)
    }
    const length = response.headers.get("content-length")
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("response byte limit")
    const type = response.headers.get("content-type") ?? ""
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)) throw new Error("discovery content type")
    if (!response.body) throw new Error("missing response body")
    let size = 0
    const chunks = []
    const iterator = response.body[Symbol.asyncIterator]()
    for (;;) {
      let next
      try { next = await iterator.next() }
      catch (error) {
        // A truncated body is integrity failure even if its final read timed out.
        throw size || !trustedProvider ? runtimeFailure("membership", "response") : requestFailure(error, controller.signal.aborted)
      }
      if (next.done) break
      const chunk = next.value
      size += chunk.byteLength
      if (size > limit) throw new Error("response byte limit")
      chunks.push(chunk)
    }
    return boundedJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), limit)
  } catch (error) {
    throw preserveRuntimeFailure(error, "membership", "response")
  } finally { clearTimeout(timer); controller.abort() }
}

// This adapter consumes one complete list, not a paginated partial inventory.
// Recognized continuation signals must be terminal or the entire attempt fails.
function completeMembership(body) {
  const terminal = (value) => value === undefined || value === null || value === "" || value === false
  const check = (scope) => {
    record(scope)
    for (const key of ["has_more", "hasMore"]) {
      if (scope[key] !== undefined && scope[key] !== false) throw new Error("nonterminal membership pagination")
    }
    for (const key of ["next", "cursor", "next_cursor", "nextCursor", "next_page", "nextPage", "next_page_token", "nextPageToken", "continuation_token", "continuationToken"]) {
      if (!terminal(scope[key])) throw new Error("nonterminal membership pagination")
    }
    if (scope.links !== undefined && scope.links !== null) {
      record(scope.links)
      if (!terminal(scope.links.next)) throw new Error("nonterminal membership pagination")
    }
  }
  check(body)
  for (const key of ["pagination", "meta"]) {
    if (body[key] !== undefined && body[key] !== null) check(body[key])
  }
}

function membershipModels(body) {
  record(body)
  completeMembership(body)
  if (!Array.isArray(body.data) || body.data.length > RUNTIME_LIMITS.models) throw new Error("invalid membership list")
  const seen = new Set()
  const models = []
  for (const entry of body.data) {
    record(entry)
    const id = modelId(entry.id)
    if (seen.has(id)) throw new Error("duplicate membership identity")
    seen.add(id)
    if (entry.owned_by !== undefined && typeof entry.owned_by !== "string") throw new Error("invalid membership owner")
    if (entry.name !== undefined && typeof entry.name !== "string") throw new Error("invalid membership name")
    if (nonChatReason(id, entry.name ?? "")) continue
    models.push({ id, name: generateDisplayName(id), vendor: classifyVendor(id, entry.owned_by) })
  }
  return models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function retainExactCapabilities(models, snapshot) {
  const exact = new Map(snapshot.models.map((model) => [model.id, model]))
  return models.map((model) => {
    const curated = exact.get(model.id)
    if (!curated) return model
    const metadataProvenance = {}
    if (curated.reasoning !== undefined) {
      if (typeof curated.reasoning !== "boolean") throw new Error("invalid curated reasoning capability")
      model.reasoning = curated.reasoning
      metadataProvenance.reasoning = "snapshot-exact-id"
    }
    if (curated.inputModalities !== undefined) {
      model.inputModalities = normalizeInputModalities(curated.inputModalities, "curated modalities")
      metadataProvenance.inputModalities = "snapshot-exact-id"
    }
    // Snapshot limits/prices mix authoring defaults and upstream metadata with
    // no per-field provenance. Do not promote them to live provider facts.
    if (Object.keys(metadataProvenance).length) model.metadataProvenance = metadataProvenance
    return model
  })
}

function snapshotCatalog(catalog, providerId) {
  record(catalog)
  if (catalog.schemaVersion !== "acq-neutral-model-catalog/v1" || catalog.providerId !== providerId ||
      !Array.isArray(catalog.models) || catalog.models.length > RUNTIME_LIMITS.models) throw new Error("invalid snapshot")
  const ids = new Set()
  for (const model of catalog.models) {
    record(model); modelId(model.id)
    if (ids.has(model.id)) throw new Error("duplicate snapshot model")
    ids.add(model.id)
  }
  if (catalog.recommendations !== undefined) record(catalog.recommendations)
  return catalog
}

export async function discoverRuntimeModels(providerRoot, { mode = "live-required", credentials = process.env, fetchImpl = fetch, deadline = performance.now() + RUNTIME_LIMITS.totalMs } = {}) {
  try {
  if (!["live-required", "snapshot"].includes(mode)) throw new Error("unsupported preparation mode")
  if (typeof providerRoot !== "string" || !path.isAbsolute(providerRoot)) throw new Error("required absolute provider root missing")
  const inventory = path.join(providerRoot, "models", "providers")
  if (!(await lstat(inventory)).isDirectory()) throw new Error("required provider inventory missing")
  const entries = await readdir(inventory, { withFileTypes: true })
  if (entries.length > RUNTIME_LIMITS.providers || entries.some((entry) => !entry.isDirectory() || entry.name !== "usai")) throw new Error("invalid provider inventory")
  const inputs = []
  let count = 0
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (performance.now() >= deadline) throw runtimeFailure("preparation", "deadline")
    const directory = path.join(inventory, entry.name)
    const facts = validatedFacts(boundedJson(await readBoundedFile(path.join(directory, "facts.json"), 65536), 65536))
    if (entry.name !== facts.providerId) throw new Error("provider identity mismatch")
    const snapshot = snapshotCatalog(boundedJson(await readBoundedFile(path.join(directory, "snapshot.json"), RUNTIME_LIMITS.resultBytes), RUNTIME_LIMITS.resultBytes), facts.providerId)
    let models
    if (mode === "snapshot") {
      models = snapshot.models.filter((model) => !nonChatReason(model.id, model.name ?? ""))
    } else {
      validatedDiscoveryDescriptor(boundedJson(await readBoundedFile(path.join(directory, "discovery.json"), 4096), 4096), facts.providerId)
      retainExactCapabilities(snapshot.models.map((model) => ({ ...model })), snapshot)
      const key = credentials[facts.keyEnv]
      if (typeof key !== "string" || !key || key.length > 8192 || /[\r\n]/.test(key)) throw runtimeFailure("membership", "authentication")
      const body = await requestJson(facts.modelsUrl, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        limit: RUNTIME_LIMITS.membershipBytes, deadline, fetchImpl, trustedProvider: true,
      })
      try { models = retainExactCapabilities(membershipModels(body), snapshot) }
      catch { throw runtimeFailure("membership", "response") }
    }
    count += models.length
    const ids = new Set(models.map((model) => model.id))
    const recommendations = Object.fromEntries(Object.entries(snapshot.recommendations ?? {}).filter(([, id]) => ids.has(id)))
    inputs.push({ facts, catalog: { schemaVersion: "acq-neutral-model-catalog/v1", providerId: facts.providerId, models, recommendations } })
  }
  let metadataOutcome = "not-requested"
  // No credential-bearing request shares a headers object with public metadata.
  // Membership must succeed in full first. Metadata never restores membership.
  if (mode === "live-required" && count > 0) {
    metadataOutcome = "unavailable"
    try {
      // Leave a small publication margin; optional metadata must not consume
      // the entire parent deadline merely by waiting on its response body.
      const metadata = validateMetadata(await requestJson(METADATA_URL, { limit: RUNTIME_LIMITS.metadataBytes, deadline: deadline - 1000, fetchImpl }))
      for (const input of inputs) {
        input.catalog.models = input.catalog.models.map((model) => {
          try {
            const enriched = usableRuntimeMetadata(enrichModelMetadata(model, metadata).metadata)
            return { ...model, ...enriched, metadataProvenance: {
              ...model.metadataProvenance,
              ...Object.fromEntries(Object.keys(enriched).map((key) => [key, "models.dev-unverified"])),
            } }
          } catch { return model }
        })
      }
      metadataOutcome = "available-unverified"
    } catch { /* Optional metadata is unknown; membership remains authoritative. */ }
  }
  if (performance.now() >= deadline) throw runtimeFailure("preparation", "deadline")
  const result = { inputs, sourceOutcome: mode === "snapshot" ? "snapshot-nonlive" : "live", metadataOutcome }
  // A gateway can echo the request credential even in a syntactically valid
  // model ID. Fail rather than carrying that value into IPC or user config.
  const key = credentials.USAI_API_KEY
  if (typeof key === "string" && key && JSON.stringify(result).includes(key)) throw new Error("credential echo refused")
  return result
  } catch (error) { throw preserveRuntimeFailure(error, "input", "input") }
}
