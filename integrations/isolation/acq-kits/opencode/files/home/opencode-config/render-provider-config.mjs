#!/usr/bin/env node
// Render host-projected, provider-neutral inputs into OpenCode's global config.
// This is the only kit that writes OpenCode configuration for provider inputs.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import os from "node:os"
import path from "node:path"
import process from "node:process"

const GLOBAL_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"]
const CANONICAL_FILENAME = "opencode.jsonc"
const ROLE_PATHS = {
  primary: ["model"],
  small: ["small_model"],
  compaction: ["agent", "compaction", "model"],
}
const PROVIDER_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
const KEY_ENV = /^[A-Z][A-Z0-9_]*$/
const API_PROTOCOLS = Object.freeze({ "openai-compatible": Object.freeze({ npm: "@ai-sdk/openai-compatible" }) })
const PROJECTION_FILENAME = "projection.json"
const LOCK_FILENAME = ".acq-provider-config.lock"
const STATE_COMMENT = "// acq-provider-config-state: "
const LOCK_TTL_MS = 30_000
const MAX_WRITE_RETRIES = 8

export function stripJsonc(text) {
  let output = ""
  let quote = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    const next = text[index + 1]
    if (lineComment) {
      if (character === "\n") { lineComment = false; output += character }
      continue
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index++ }
      continue
    }
    if (quote) {
      output += character
      if (character === "\\") { output += next ?? ""; index++ }
      else if (character === '"') quote = false
      continue
    }
    if (character === '"') { quote = true; output += character }
    else if (character === "/" && next === "/") { lineComment = true; index++ }
    else if (character === "/" && next === "*") { blockComment = true; index++ }
    else output += character
  }
  let plain = ""
  quote = false
  for (let index = 0; index < output.length; index++) {
    const character = output[index]
    if (quote) {
      plain += character
      if (character === "\\") { plain += output[index + 1] ?? ""; index++ }
      else if (character === '"') quote = false
      continue
    }
    if (character === '"') { quote = true; plain += character; continue }
    if (character === ",") {
      let next = index + 1
      while (/\s/.test(output[next] ?? "")) next++
      if (output[next] === "}" || output[next] === "]") continue
    }
    plain += character
  }
  return plain
}

export function parseJsonc(text) {
  const parsed = JSON.parse(stripJsonc(text))
  return object(parsed, "OpenCode config")
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
}

function hostname(value, label) {
  let url
  try { url = new URL(string(value, label)) } catch { throw new Error(`${label} must be a URL`) }
  if (url.protocol !== "https:" || !url.hostname) throw new Error(`${label} must be an HTTPS URL`)
  return url.hostname.toLowerCase()
}

function optionalCost(value, label) {
  if (value === undefined) return undefined
  const cost = object(value, label)
  for (const [name, amount] of Object.entries(cost)) {
    if (!new Set(["input", "output", "cacheRead", "cacheWrite"]).has(name) || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`${label} contains an invalid ${name} value`)
    }
  }
  return cost
}

export function deepMerge(base, source) {
  const result = { ...base }
  for (const [key, value] of Object.entries(source)) {
    result[key] = value !== null && typeof value === "object" && !Array.isArray(value) &&
      result[key] !== null && typeof result[key] === "object" && !Array.isArray(result[key])
      ? deepMerge(result[key], value)
      : value
  }
  return result
}

export function renderProviderConfig(inputs) {
  const providers = {}
  const enabled = []
  const recommendations = {}
  const seenProviders = new Set()
  const modelReferences = new Set()

  for (const input of [...inputs].sort((left, right) => left.facts.providerId.localeCompare(right.facts.providerId))) {
    const facts = object(input.facts, "facts")
    const catalog = object(input.catalog, "catalog")
    if (facts.schemaVersion !== "acq-provider-facts/v1") throw new Error("unsupported facts schema")
    if (catalog.schemaVersion !== "acq-neutral-model-catalog/v1") throw new Error("unsupported catalog schema")
    const providerId = string(facts.providerId, "facts.providerId")
    if (!PROVIDER_ID.test(providerId)) throw new Error(`invalid provider '${providerId}'`)
    if (seenProviders.has(providerId)) throw new Error(`duplicate provider '${providerId}'`)
    if (catalog.providerId !== providerId) throw new Error(`catalog providerId does not match '${providerId}'`)
    seenProviders.add(providerId)
    const models = {}
    const modelIds = new Set()
    if (!Array.isArray(catalog.models)) throw new Error(`models for '${providerId}' must be an array`)
    for (const model of catalog.models) {
      object(model, `model for '${providerId}'`)
      const modelId = string(model.id, `model id for '${providerId}'`)
      if (modelIds.has(modelId)) throw new Error(`duplicate model '${providerId}/${modelId}'`)
      modelIds.add(modelId)
      const reference = `${providerId}/${modelId}`
      if (modelReferences.has(reference)) throw new Error(`duplicate model '${reference}'`)
      modelReferences.add(reference)
      const contextWindow = model.contextWindow === undefined ? undefined : integer(model.contextWindow, `context window for '${reference}'`)
      const maxOutputTokens = model.maxOutputTokens === undefined ? undefined : integer(model.maxOutputTokens, `output limit for '${reference}'`)
      const cost = optionalCost(model.cost, `cost for '${reference}'`)
      models[modelId] = {
        name: modelId,
        ...(contextWindow === undefined ? {} : { limit: { context: contextWindow, ...(maxOutputTokens === undefined ? {} : { output: maxOutputTokens }) } }),
        ...(cost === undefined ? {} : { cost }),
      }
    }
    const protocol = API_PROTOCOLS[facts.apiProtocol]
    if (!protocol) throw new Error(`unsupported apiProtocol for '${providerId}'`)
    const declaredHost = string(facts.host, `host for '${providerId}'`).toLowerCase()
    const baseUrl = string(facts.baseUrl, `baseUrl for '${providerId}'`)
    if (hostname(baseUrl, `baseUrl for '${providerId}'`) !== declaredHost) throw new Error(`baseUrl host does not match '${providerId}'`)
    if (hostname(facts.modelsUrl, `modelsUrl for '${providerId}'`) !== declaredHost) throw new Error(`modelsUrl host does not match '${providerId}'`)
    const keyEnv = string(facts.keyEnv, `keyEnv for '${providerId}'`)
    if (!KEY_ENV.test(keyEnv)) throw new Error(`invalid keyEnv for '${providerId}'`)
    providers[providerId] = {
      npm: protocol.npm,
      name: providerId,
      options: { baseURL: baseUrl, apiKey: `{env:${keyEnv}}` },
      models,
    }
    enabled.push(providerId)
    if (catalog.recommendations !== undefined && (catalog.recommendations === null || typeof catalog.recommendations !== "object" || Array.isArray(catalog.recommendations))) {
      throw new Error(`recommendations for '${providerId}' must be an object`)
    }
    for (const [role, modelId] of Object.entries(catalog.recommendations ?? {})) {
      if (!ROLE_PATHS[role]) throw new Error(`unsupported recommendation role '${role}'`)
      string(modelId, `${role} recommendation for '${providerId}'`)
      if (!modelIds.has(modelId)) throw new Error(`dangling ${role} recommendation '${providerId}/${modelId}'`)
      recommendations[role] ??= `${providerId}/${modelId}`
    }
  }

  const config = { enabled_providers: enabled, provider: providers }
  for (const [role, target] of Object.entries(ROLE_PATHS)) {
    if (!recommendations[role]) continue
    let cursor = config
    for (const key of target.slice(0, -1)) cursor = cursor[key] ??= {}
    cursor[target.at(-1)] = recommendations[role]
  }
  return config
}

export async function loadProviderInputs(providerRoot) {
  let directories
  try {
    directories = await readdir(providerRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
  const inputs = []
  for (const directory of directories.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const root = path.join(providerRoot, directory.name)
    if (!PROVIDER_ID.test(directory.name)) throw new Error(`invalid provider directory '${directory.name}'`)
    const [factsText, catalogText] = await Promise.all([readFile(path.join(root, "facts.json"), "utf8"), readFile(path.join(root, "snapshot.json"), "utf8")])
    const facts = JSON.parse(factsText)
    const catalog = JSON.parse(catalogText)
    if (facts.providerId !== directory.name || catalog.providerId !== directory.name) throw new Error(`provider identity does not match directory '${directory.name}'`)
    inputs.push({ facts, catalog })
  }
  return inputs
}

// A missing projection is not evidence that no providers are configured. Only
// a host-owned authoritative manifest can authorize generated-key removal.
export async function loadProviderProjection(providerRoot) {
  let manifestText
  try {
    manifestText = await readFile(path.join(providerRoot, PROJECTION_FILENAME), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "not-ready" }
    throw error
  }
  const manifest = object(JSON.parse(manifestText), "provider projection")
  if (manifest.schemaVersion !== "acq-provider-projection/v1" || manifest.authoritative !== true) throw new Error("provider projection is not authoritative")
  return { status: "authoritative", inputs: await loadProviderInputs(providerRoot) }
}

async function existingConfig(globalDir) {
  let merged = {}
  let entries = []
  try {
    entries = new Set(await readdir(globalDir))
  } catch (error) {
    if (error?.code === "ENOENT") return { config: merged, canonicalText: undefined }
    throw error
  }
  for (const name of GLOBAL_FILENAMES) {
    if (entries.has(name)) merged = deepMerge(merged, parseJsonc(await readFile(path.join(globalDir, name), "utf8")))
  }
  return { config: merged, canonicalText: await canonicalText(globalDir) }
}

export async function writeConfigAtomically(globalDir, rendered, ownership = { providers: [], roles: {} }, options = {}) {
  object(rendered, "rendered provider config")
  validateOwnership(ownership)
  await mkdir(globalDir, { recursive: true })
  const release = await acquireLock(globalDir, options)
  try {
    for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
      const current = await existingConfig(globalDir)
      const state = readEmbeddedState(current.canonicalText, current.config)
      const output = mergeManagedConfig(current.config, rendered, state, ownership)
      validateRoleReferences(output.config, "merged OpenCode config")
      const text = serializeConfig(output.config, output.state)
      await options.beforeReplace?.(attempt)
      // The lock only coordinates this renderer. Detect a non-cooperating writer
      // before replacing so its settings are merged on the next attempt.
      if ((await canonicalText(globalDir)) !== current.canonicalText) continue
      await replaceAtomically(globalDir, CANONICAL_FILENAME, text, options)
      return
    }
    throw new Error("OpenCode config changed during every replacement attempt")
  } finally { await release() }
}

function mergeManagedConfig(existing, rendered, state, ownership) {
  const managed = new Set(state.providers)
  const provider = { ...(existing.provider ?? {}), ...(rendered.provider ?? {}) }
  for (const id of managed) delete provider[id]
  Object.assign(provider, rendered.provider)
  const enabled = (existing.enabled_providers ?? []).filter((id) => !managed.has(id))
  for (const id of rendered.enabled_providers) if (!enabled.includes(id)) enabled.push(id)
  enabled.sort((left, right) => left.localeCompare(right))
  const config = { ...deepMerge(existing, rendered), provider, enabled_providers: enabled }
  for (const [role, keys] of Object.entries(ROLE_PATHS)) {
    let target = config
    for (const key of keys.slice(0, -1)) target = target?.[key]
    if (state.roles[role] !== undefined && target?.[keys.at(-1)] === state.roles[role]) delete target[keys.at(-1)]
    let source = rendered
    for (const key of keys.slice(0, -1)) source = source?.[key]
    if (source?.[keys.at(-1)] !== undefined) {
      target = config
      for (const key of keys.slice(0, -1)) target = target[key] ??= {}
      target[keys.at(-1)] = source[keys.at(-1)]
    }
  }
  const roles = {}
  for (const [role, keys] of Object.entries(ROLE_PATHS)) {
    let source = rendered
    for (const key of keys) source = source?.[key]
    if (source !== undefined) roles[role] = source
  }
  return { config, state: { schemaVersion: "acq-opencode-provider-state/v2", providers: ownership.providers, roles } }
}

function ownershipFromRendered(rendered) {
  return { providers: [...(rendered.enabled_providers ?? [])], roles: selectedRoles(rendered) }
}

function selectedRoles(config) {
  const roles = {}
  for (const [role, keys] of Object.entries(ROLE_PATHS)) {
    let value = config
    for (const key of keys) value = value?.[key]
    if (value !== undefined) roles[role] = value
  }
  return roles
}

function validateOwnership(state) {
  if (!Array.isArray(state.providers) || new Set(state.providers).size !== state.providers.length || !state.providers.every((id) => typeof id === "string" && PROVIDER_ID.test(id))) throw new Error("invalid provider ownership")
  object(state.roles, "provider ownership roles")
  for (const [role, reference] of Object.entries(state.roles)) {
    if (!ROLE_PATHS[role] || typeof reference !== "string") throw new Error("invalid provider ownership role")
  }
}

function statePayload(state) {
  return Buffer.from(JSON.stringify(state)).toString("base64url")
}

function serializeConfig(config, state) {
  const body = JSON.stringify(config, null, 2) + "\n"
  object(JSON.parse(body), "generated OpenCode config")
  return `${STATE_COMMENT}${statePayload(state)}\n${body}`
}

function generatedProvider(value) {
  return value && typeof value === "object" && value.npm === "@ai-sdk/openai-compatible" && typeof value.options?.baseURL === "string" && typeof value.options?.apiKey === "string"
}

function readEmbeddedState(text, config) {
  if (text === undefined) return { providers: [], roles: {} }
  const line = text.split("\n", 1)[0]
  if (!line.startsWith(STATE_COMMENT)) {
    if (Object.values(config.provider ?? {}).some(generatedProvider)) throw new Error("generated provider config has no trustworthy ownership metadata")
    return { providers: [], roles: {} }
  }
  let state
  try { state = JSON.parse(Buffer.from(line.slice(STATE_COMMENT.length), "base64url").toString("utf8")) } catch { throw new Error("malformed provider ownership metadata") }
  if (state.schemaVersion !== "acq-opencode-provider-state/v2") throw new Error("incompatible provider ownership metadata")
  validateOwnership(state)
  for (const id of state.providers) {
    if (!generatedProvider(config.provider?.[id])) throw new Error(`owned provider '${id}' is missing or was modified`)
  }
  for (const [role, reference] of Object.entries(state.roles)) {
    if (roleValue(config, ROLE_PATHS[role]) !== reference) throw new Error(`owned ${role} default was modified`)
  }
  return state
}

function roleValue(config, keys) {
  let value = config
  for (const key of keys) value = value?.[key]
  return value
}

function validateRoleReferences(config, label) {
  const provider = config.provider === undefined ? {} : object(config.provider, `${label} provider`)
  for (const [role, keys] of Object.entries(ROLE_PATHS)) {
    const reference = roleValue(config, keys)
    if (reference === undefined) continue
    if (typeof reference !== "string") throw new Error(`${label} ${role} default must be a string`)
    const slash = reference.indexOf("/")
    const providerId = reference.slice(0, slash)
    const modelId = reference.slice(slash + 1)
    if (slash < 1 || !provider[providerId] || !provider[providerId].models || !provider[providerId].models[modelId]) throw new Error(`${label} has dangling ${role} default '${reference}'`)
  }
}

async function canonicalText(globalDir) {
  try { return await readFile(path.join(globalDir, CANONICAL_FILENAME), "utf8") } catch (error) { if (error?.code === "ENOENT") return undefined; throw error }
}

async function replaceAtomically(globalDir, filename, text, options = {}) {
  const temporary = path.join(globalDir, `.${filename}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`)
  await writeFile(temporary, text, { mode: 0o600, flag: "wx" })
  await options.beforeRename?.()
  await rename(temporary, path.join(globalDir, filename))
}

async function acquireLock(globalDir, options = {}) {
  const lock = path.join(globalDir, LOCK_FILENAME)
  const owner = JSON.stringify({ schemaVersion: "acq-opencode-provider-lock/v1", pid: process.pid, host: os.hostname(), nonce: randomBytes(16).toString("hex"), expiresAt: Date.now() + (options.lockTtlMs ?? LOCK_TTL_MS) })
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 })
      await writeFile(path.join(lock, "owner.json"), owner, { mode: 0o600, flag: "wx" })
      return async () => releaseLock(lock, owner)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      await recoverStaleLock(lock)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error("timed out waiting for provider config lock")
}

async function recoverStaleLock(lock) {
  let owner
  try { owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) } catch (error) {
    if (error?.code === "ENOENT") {
      const details = await stat(lock)
      if (Date.now() - details.mtimeMs < LOCK_TTL_MS) return
    } else { return }
  }
  if (owner && (owner.schemaVersion !== "acq-opencode-provider-lock/v1" || !Number.isSafeInteger(owner.expiresAt) || Date.now() <= owner.expiresAt)) return
  const retired = `${lock}.stale.${randomBytes(12).toString("hex")}`
  try { await rename(lock, retired); await rm(retired, { recursive: true, force: true }) } catch (error) { if (error?.code !== "ENOENT") throw error }
}

async function releaseLock(lock, owner) {
  try {
    if (await readFile(path.join(lock, "owner.json"), "utf8") !== owner) return
    const retired = `${lock}.released.${randomBytes(12).toString("hex")}`
    await rename(lock, retired)
    await rm(retired, { recursive: true, force: true })
  } catch (error) { if (error?.code !== "ENOENT") throw error }
}

export async function applyProviderProjection(providerRoot, globalDir) {
  const projection = await loadProviderProjection(providerRoot)
  if (projection.status !== "authoritative") return projection.status
  const rendered = renderProviderConfig(projection.inputs)
  await writeConfigAtomically(globalDir, rendered, ownershipFromRendered(rendered))
  return projection.status
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const providerRoot = argument("--provider-root", "/var/lib/acq/host/models/providers")
  const globalDir = argument("--global-dir", path.join(process.env.HOME ?? "/home/agent", ".config/opencode"))
  applyProviderProjection(providerRoot, globalDir).catch((error) => {
    console.error(`opencode-config: ${error.message}`)
    process.exit(1)
  })
}
