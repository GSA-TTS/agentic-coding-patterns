import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { applyProviderProjection, loadProviderInputs, parseJsonc, renderProviderConfig, writeConfigAtomically } from "../files/home/opencode-config/render-provider-config.mjs"

const facts = (providerId) => ({ schemaVersion: "acq-provider-facts/v1", providerId, apiProtocol: "openai-compatible", host: `${providerId}.example.test`, baseUrl: `https://${providerId}.example.test/v1`, modelsUrl: `https://${providerId}.example.test/v1/models`, keyEnv: `${providerId.replaceAll("-", "_").toUpperCase()}_KEY` })
const catalog = (providerId, models, recommendations = {}) => ({ schemaVersion: "acq-neutral-model-catalog/v1", providerId, models: models.map((id) => ({ id, contextWindow: 1000 })), recommendations })

test("two fictitious providers render deterministically and recommendations are advisory", () => {
  const output = renderProviderConfig([
    { facts: facts("zeta-ai"), catalog: catalog("zeta-ai", ["fast"], { primary: "fast" }) },
    { facts: facts("acme-ai"), catalog: catalog("acme-ai", ["large", "small"], { primary: "large", small: "small" }) },
  ])
  assert.deepEqual(output.enabled_providers, ["acme-ai", "zeta-ai"])
  assert.equal(output.model, "acme-ai/large")
  assert.equal(output.small_model, "acme-ai/small")
  assert.deepEqual(Object.keys(output.provider), ["acme-ai", "zeta-ai"])
})

test("empty input does not invent a provider", () => {
  assert.deepEqual(renderProviderConfig([]), { enabled_providers: [], provider: {} })
})

test("duplicate providers, duplicate models, and dangling roles fail closed", () => {
  assert.throws(() => renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }, { facts: facts("acme-ai"), catalog: catalog("acme-ai", ["b"]) }]), /duplicate provider/)
  assert.throws(() => renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a", "a"]) }]), /duplicate model/)
  assert.throws(() => renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"], { primary: "missing" }) }]), /dangling/)
})

test("merge preserves unrelated config and installed bytes parse", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), '{ // user setting\n "theme": "dark" }')
  await writeConfigAtomically(directory, renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }]))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.theme, "dark")
  assert.ok(installed.provider["acme-ai"])
})

test("invalid provider input fails closed", () => {
  assert.throws(() => renderProviderConfig([{ facts: facts("Acme"), catalog: catalog("Acme", ["a"]) }]), /invalid provider/)
  assert.throws(() => renderProviderConfig([{ facts: facts("acme-ai"), catalog: { ...catalog("acme-ai", ["a"]), schemaVersion: "unknown" } }]), /unsupported catalog schema/)
  assert.throws(() => renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"], { reasoning: "a" }) }]), /unsupported recommendation role/)
  assert.throws(() => renderProviderConfig([{ facts: { ...facts("acme-ai"), apiProtocol: "other" }, catalog: catalog("acme-ai", ["a"]) }]), /unsupported apiProtocol/)
  assert.throws(() => renderProviderConfig([{ facts: { ...facts("acme-ai"), host: "other.example.test" }, catalog: catalog("acme-ai", ["a"]) }]), /baseUrl host does not match/)
})

test("JSONC parser does not rewrite commas in string values", () => {
  assert.equal(parseJsonc('{ "label": "model,}" }').label, "model,}")
})

test("missing provider projection is an explicit empty input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  assert.deepEqual(await loadProviderInputs(path.join(directory, "missing")), [])
})

test("missing projection preserves current config instead of interpreting it as empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const globalDir = path.join(directory, "config")
  await mkdir(globalDir)
  await writeFile(path.join(globalDir, "opencode.jsonc"), '{ "theme": "dark", "provider": { "legacy": {} } }')
  assert.equal(await applyProviderProjection(path.join(directory, "missing"), globalDir), "not-ready")
  assert.equal((await readFile(path.join(globalDir, "opencode.jsonc"), "utf8")).includes('"legacy"'), true)
})

test("authoritative projection removes only previously generated providers and stale defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const root = path.join(directory, "providers")
  const globalDir = path.join(directory, "config")
  await mkdir(path.join(root, "acme-ai"), { recursive: true })
  await writeFile(path.join(root, "projection.json"), '{ "schemaVersion": "acq-provider-projection/v1", "authoritative": true }')
  await writeFile(path.join(root, "acme-ai", "facts.json"), JSON.stringify(facts("acme-ai")))
  await writeFile(path.join(root, "acme-ai", "snapshot.json"), JSON.stringify(catalog("acme-ai", ["new"], { primary: "new" })))
  const old = renderProviderConfig([{ facts: facts("old-ai"), catalog: catalog("old-ai", ["old"], { primary: "old" }) }])
  await writeConfigAtomically(globalDir, old, { providers: ["old-ai"], roles: { primary: "old-ai/old" } })
  await writeConfigAtomically(globalDir, { enabled_providers: ["foreign"], provider: { foreign: {} } })
  await applyProviderProjection(root, globalDir)
  const installed = parseJsonc(await readFile(path.join(globalDir, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(installed.provider).sort(), ["acme-ai", "foreign"])
  assert.deepEqual(installed.enabled_providers, ["acme-ai", "foreign"])
  assert.equal(installed.model, "acme-ai/new")
})

test("cooperating concurrent writes preserve unrelated settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await Promise.all([
    writeConfigAtomically(directory, { enabled_providers: ["one"], provider: { one: {} }, theme: "dark" }),
    writeConfigAtomically(directory, { enabled_providers: ["two"], provider: { two: {} }, formatter: { enabled: true } }),
  ])
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.theme, "dark")
  assert.equal(installed.formatter.enabled, true)
})

test("foreign providers are not claimed as generated ownership", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeConfigAtomically(directory, { enabled_providers: ["foreign"], provider: { foreign: { models: { a: {} } } } })
  const first = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, first, { providers: ["acme-ai"], roles: {} })
  const second = renderProviderConfig([{ facts: facts("zeta-ai"), catalog: catalog("zeta-ai", ["b"]) }])
  await writeConfigAtomically(directory, second, { providers: ["zeta-ai"], roles: {} })
  const installed = JSON.parse((await readFile(path.join(directory, "opencode.jsonc"), "utf8")).split("\n").slice(1).join("\n"))
  assert.deepEqual(Object.keys(installed.provider).sort(), ["foreign", "zeta-ai"])
})

test("missing, malformed, and incompatible ownership metadata fail closed for generated config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, rendered, { providers: ["acme-ai"], roles: {} })
  const filename = path.join(directory, "opencode.jsonc")
  const valid = await readFile(filename, "utf8")
  const body = valid.split("\n").slice(1).join("\n")
  const incompatible = `// acq-provider-config-state: ${Buffer.from(JSON.stringify({ schemaVersion: "acq-opencode-provider-state/v1", providers: ["acme-ai"], roles: {} })).toString("base64url")}\n${body}`
  for (const broken of [body, `// acq-provider-config-state: bad\n${body}`, incompatible]) {
    await writeFile(filename, broken)
    await assert.rejects(writeConfigAtomically(directory, rendered, { providers: ["acme-ai"], roles: {} }), /ownership metadata/)
  }
})

test("existing dangling defaults fail closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), '{ "model": "missing/model" }')
  await assert.rejects(writeConfigAtomically(directory, { enabled_providers: [], provider: {} }), /dangling primary default/)
})

test("failure before replacement leaves the previous config and embedded ownership intact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const first = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, first, { providers: ["acme-ai"], roles: {} })
  const before = await readFile(path.join(directory, "opencode.jsonc"), "utf8")
  await assert.rejects(writeConfigAtomically(directory, renderProviderConfig([{ facts: facts("zeta-ai"), catalog: catalog("zeta-ai", ["b"]) }]), { providers: ["zeta-ai"], roles: {} }, { beforeRename: () => { throw new Error("injected failure") } }), /injected failure/)
  assert.equal(await readFile(path.join(directory, "opencode.jsonc"), "utf8"), before)
})

test("stale locks recover with owner metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const lock = path.join(directory, ".acq-provider-config.lock")
  await mkdir(lock)
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ schemaVersion: "acq-opencode-provider-lock/v1", expiresAt: 0 }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} })
  await assert.rejects(readFile(lock), /ENOENT/)
})

test("separate process writers retain unrelated settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const script = new URL("../files/home/opencode-config/render-provider-config.mjs", import.meta.url).pathname
  const run = (rendered) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { writeConfigAtomically } from ${JSON.stringify(`file://${script}`)}; await writeConfigAtomically(${JSON.stringify(directory)}, ${JSON.stringify(rendered)});`])
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`writer exited ${code}`)))
  })
  await Promise.all([run({ enabled_providers: [], provider: {}, theme: "dark" }), run({ enabled_providers: [], provider: {}, formatter: { enabled: true } })])
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.theme, "dark")
  assert.equal(installed.formatter.enabled, true)
})
