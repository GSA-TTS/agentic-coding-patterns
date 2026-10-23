import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { applyProviderProjection, loadProviderInputs, ownershipFromRendered, parseJsonc, renderProviderConfig, writeConfigAtomically } from "../files/home/opencode-config/render-provider-config.mjs"

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

test("empty authoritative input does not invent a provider", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(renderProviderConfig([]))), { enabled_providers: [], provider: {} })
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

test("renderer composes staged base policy, pre-existing global config, and provider projection in one write", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const root = path.join(directory, "input")
  const globalDir = path.join(directory, "config")
  const providers = path.join(root, "models", "providers", "acme-ai")
  await mkdir(providers, { recursive: true })
  await mkdir(globalDir)
  await writeFile(path.join(globalDir, "opencode.jsonc"), '{ "theme": "dark" }')
  await writeFile(path.join(providers, "facts.json"), JSON.stringify(facts("acme-ai")))
  await writeFile(path.join(providers, "snapshot.json"), JSON.stringify(catalog("acme-ai", ["a"])))
  assert.equal(await applyProviderProjection(root, globalDir, { baseConfig: { instructions: ["AGENTS.md"], permission: { read: { ".env": "deny" } } } }), "authoritative")
  const installed = parseJsonc(await readFile(path.join(globalDir, "opencode.jsonc"), "utf8"))
  assert.deepEqual(installed.instructions, ["AGENTS.md"])
  assert.equal(installed.theme, "dark")
  assert.equal(installed.permission.read[".env"], "deny")
  assert.ok(installed.provider["acme-ai"])
})

test("staged base policy retains complete former OpenCode policy parity", async () => {
  const base = parseJsonc(await readFile(new URL("../files/home/opencode-config/base-config.jsonc", import.meta.url), "utf8"))
  assert.deepEqual(base.instructions, ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".cursor/rules/*.md", ".github/copilot-instructions.md"])
  assert.deepEqual(base.compaction, { auto: true, prune: true, reserved: 20000 })
  assert.deepEqual(base.agent, { compaction: { temperature: 0 }, summary: { temperature: 0 }, title: { temperature: 0 } })
  assert.deepEqual(base.watcher.ignore, [".git/**", "node_modules/**", "dist/**", "build/**", ".next/**", ".cache/**", ".venv/**", "venv/**", "__pycache__/**", ".pytest_cache/**", ".mypy_cache/**", ".ruff_cache/**", "coverage/**"])
  assert.equal(base.permission.edit, "allow")
  assert.equal(base.permission.webfetch, "allow")
  assert.equal(base.permission.websearch, "allow")
  assert.equal(base.permission.read["*"], "allow")
  for (const name of [".env", ".env.*", "*.env", "*.env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*id_rsa*", "*id_ed25519*", "*.tfvars", "*.tfvars.json", "**/.aws/*", "**/.gcloud/*", "**/.azure/*", "**/application_default_credentials.json", "*_accessKeys.csv", "**/kubeconfig*", "**/.kube/*", "**/.npmrc", "**/.pypirc", "**/pip.conf", "**/.docker/config.json", "**/.vault-token", "**/*.hclic", "**/.git-credentials", "**/.netrc", "*vault*.yml", "*vault*.yaml", "**/secrets/**", "**/credentials/**", "**/.secrets/**"]) assert.equal(base.permission.read[name], "deny")
  assert.equal(base.permission.read[".env.example"], "allow")
  assert.equal(base.permission.read["*.env.example"], "allow")
  assert.equal(base.permission.read["*.tfvars.example"], "allow")
  assert.equal(base.permission.bash["*"], "allow")
  for (const command of ["git push", "git push *", "git remote add *", "git remote set-url *", "gh pr create*", "gh api*", "gh pr merge*", "gh api*/pulls/*/merge*", "gh api*/merge*", "scp", "scp *", "sftp", "sftp *", "rsync", "rsync *", "nc", "nc *", "ncat", "ncat *", "netcat", "netcat *", "telnet", "telnet *", "rm *../*", "rm *..", "rm * /*", "rm -* /*", "rm -rf /*", "rm -rf ~*", "rm -rf $HOME*", "curl *-d*", "curl *--data*", "curl *-F*", "curl *--form*", "curl *-T*", "curl *--upload-file*", "curl *-X POST*", "curl *-X PUT*", "curl *--request POST*", "curl *--request PUT*", "wget *--post-data*", "wget *--post-file*", "wget *--method=POST*", "wget *--body-data*", "wget *--body-file*"]) assert.equal(base.permission.bash[command], "ask")
})

test("staged base policy defeats attempted user overrides but preserves unrelated config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const baseConfig = parseJsonc(await readFile(new URL("../files/home/opencode-config/base-config.jsonc", import.meta.url), "utf8"))
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify({
    theme: "dark",
    instructions: ["USER.md"],
    mcp: { local: { command: "local-mcp" } },
    provider: { foreign: { models: { model: {} } } },
    permission: { webfetch: "deny", websearch: "deny", read: { ".env": "allow" }, bash: { "git push *": "allow" } },
  }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} }, undefined, { baseConfig })
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.theme, "dark")
  assert.deepEqual(installed.instructions, ["USER.md"])
  assert.equal(installed.mcp.local.command, "local-mcp")
  assert.ok(installed.provider.foreign)
  assert.equal(installed.permission.webfetch, "allow")
  assert.equal(installed.permission.websearch, "allow")
  assert.equal(installed.permission.read[".env"], "deny")
  assert.equal(installed.permission.bash["git push *"], "ask")
})

test("provider projection applies protocol adapter options, OpenCode cost keys, and defaults", async () => {
  const kitRoot = new URL("../../usai-provider/", import.meta.url)
  const [factsText, snapshotText] = await Promise.all([
    readFile(new URL("provider-input/facts.json", kitRoot), "utf8"),
    readFile(new URL("files/home/usai-config/model-catalog-snapshot.json", kitRoot), "utf8"),
  ])
  const output = renderProviderConfig([{ facts: JSON.parse(factsText), catalog: JSON.parse(snapshotText) }])
  assert.deepEqual(output.provider.usai.options, {
    baseURL: "https://api.gsa.usai.gov/api/v1",
    apiKey: "{env:USAI_API_KEY}",
    timeout: 600000,
    chunkTimeout: 120000,
    litellmProxy: true,
    headers: {
      "User-Agent": "OpenCode/1.0",
      "X-Agent-Type": "opencode",
      "X-Agent-Environment": "development",
    },
  })
  assert.deepEqual(output.provider.usai.models.claude_4_5_sonnet.cost, { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 })
  assert.equal(Object.keys(output.provider.usai.models).length, 24)
  assert.equal(output.provider.usai.models["gpt-6.1-sol-latest-guardrails-defaultv2"].name, "GPT 6.1 Sol Latest Guardrails Defaultv2")
  assert.deepEqual(output.provider.usai.models["gpt-6.1-sol-latest-guardrails-defaultv2"].cost.context_over_200k, { input: 4, output: 15, cache_read: 0.2, cache_write: 5 })
  assert.equal(output.model, "usai/claude-sonnet-5")
  assert.equal(output.small_model, "usai/claude_4_5_haiku")
  assert.equal(output.agent.compaction.model, "usai/gpt-5.6-terra")
  assert.equal(output.agent.summary.model, "usai/gpt_5_2_default_v2")
  assert.equal(output.agent.title.model, "usai/gpt_5_2_default_v2")
})

test("user-selected roles remain unowned across repeated renders", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const first = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["primary", "chosen"], { primary: "primary", small: "primary", compaction: "primary" }) }])
  await writeConfigAtomically(directory, first, ownershipFromRendered(first))
  const filename = path.join(directory, "opencode.jsonc")
  const edited = parseJsonc(await readFile(filename, "utf8"))
  edited.model = "acme-ai/chosen"
  edited.small_model = "acme-ai/chosen"
  edited.agent.compaction.model = "acme-ai/chosen"
  await writeFile(filename, JSON.stringify(edited))
  await writeConfigAtomically(directory, first, ownershipFromRendered(first))
  await writeConfigAtomically(directory, first, ownershipFromRendered(first))
  const installed = parseJsonc(await readFile(filename, "utf8"))
  assert.equal(installed.model, "acme-ai/chosen")
  assert.equal(installed.small_model, "acme-ai/chosen")
  assert.equal(installed.agent.compaction.model, "acme-ai/chosen")
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

test("missing provider directory is an explicit empty input for direct callers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  assert.deepEqual(await loadProviderInputs(path.join(directory, "missing")), [])
})

test("missing provider root preserves current config instead of interpreting it as empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const globalDir = path.join(directory, "config")
  await mkdir(globalDir)
  await writeFile(path.join(globalDir, "opencode.jsonc"), '{ "theme": "dark", "provider": { "legacy": {} } }')
  assert.equal(await applyProviderProjection(path.join(directory, "missing"), globalDir), "not-ready")
  assert.equal((await readFile(path.join(globalDir, "opencode.jsonc"), "utf8")).includes('"legacy"'), true)
})

test("authoritative current generation removes only previously generated providers and stale defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const root = path.join(directory, "providers")
  const globalDir = path.join(directory, "config")
  const providers = path.join(root, "models", "providers", "acme-ai")
  await mkdir(providers, { recursive: true })
  await writeFile(path.join(providers, "facts.json"), JSON.stringify(facts("acme-ai")))
  await writeFile(path.join(providers, "snapshot.json"), JSON.stringify(catalog("acme-ai", ["new"], { primary: "new" })))
  const old = renderProviderConfig([{ facts: facts("old-ai"), catalog: catalog("old-ai", ["old"], { primary: "old" }) }])
  await writeConfigAtomically(globalDir, old, ownershipFromRendered(old))
  await writeConfigAtomically(globalDir, { enabled_providers: ["foreign"], provider: { foreign: {} } })
  await applyProviderProjection(root, globalDir, { baseConfig: {} })
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
  await writeConfigAtomically(directory, first, ownershipFromRendered(first))
  const second = renderProviderConfig([{ facts: facts("zeta-ai"), catalog: catalog("zeta-ai", ["b"]) }])
  await writeConfigAtomically(directory, second, ownershipFromRendered(second))
  const installed = JSON.parse((await readFile(path.join(directory, "opencode.jsonc"), "utf8")).split("\n").slice(1).join("\n"))
  assert.deepEqual(Object.keys(installed.provider).sort(), ["foreign", "zeta-ai"])
})

test("malformed and incompatible ownership metadata fail closed for generated config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const filename = path.join(directory, "opencode.jsonc")
  const valid = await readFile(filename, "utf8")
  const body = valid.split("\n").slice(1).join("\n")
  const incompatible = `// acq-provider-config-state: ${Buffer.from(JSON.stringify({ schemaVersion: "acq-opencode-provider-state/v2", providers: { "acme-ai": "0".repeat(64) }, roles: {} })).toString("base64url")}\n${body}`
  for (const broken of [`// acq-provider-config-state: bad\n${body}`, incompatible]) {
    await writeFile(filename, broken)
    await assert.rejects(writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered)), /ownership metadata/)
  }
})

test("byte-equivalent config without ownership metadata migrates to the new state format", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const filename = path.join(directory, "opencode.jsonc")
  const body = (await readFile(filename, "utf8")).split("\n").slice(1).join("\n")
  await writeFile(filename, body)
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(filename, "utf8"))
  assert.ok(installed.provider["acme-ai"])
})

test("the exact previous shipped config migrates once without ownership metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  const rendered = {
    enabled_providers: legacyConfig.enabled_providers,
    provider: { usai: legacyConfig.provider.usai },
    model: legacyConfig.model,
    small_model: legacyConfig.small_model,
    agent: { compaction: { model: legacyConfig.agent.compaction.model } },
  }
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(installed.provider.usai, legacyConfig.provider.usai)
  assert.equal(installed.model, legacyConfig.model)
})

test("metadata-free legacy provider edits fail closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  const rendered = { enabled_providers: legacyConfig.enabled_providers, provider: { usai: legacyConfig.provider.usai } }
  await writeFile(path.join(directory, "opencode.jsonc"), legacy.replace('"name": "GSA USAI"', '"name": "user-modified"'))
  await assert.rejects(writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered)), /ownership metadata/)
})

test("legacy provider is removed when authoritative projection is empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  const rendered = renderProviderConfig([])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(installed.provider ?? {}), [])
  assert.deepEqual(installed.enabled_providers, [])
  assert.equal(installed.model, undefined)
  assert.equal(installed.small_model, undefined)
  assert.equal(installed.agent?.compaction?.model, undefined)
  assert.equal(installed.agent?.summary?.model, undefined)
  assert.equal(installed.agent?.title?.model, undefined)
})

test("legacy provider is replaced when authoritative projection switches to a fictitious provider", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["large", "small-model"], { primary: "large", small: "small-model" }) }])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.provider?.usai, undefined)
  assert.ok(installed.provider?.["acme-ai"])
  assert.deepEqual(installed.enabled_providers, ["acme-ai"])
  assert.equal(installed.model, "acme-ai/large")
  assert.equal(installed.small_model, "acme-ai/small-model")
  assert.equal(installed.agent?.compaction?.model, undefined)
})

test("semantic edits to an owned provider fail closed instead of being deleted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const filename = path.join(directory, "opencode.jsonc")
  const edited = (await readFile(filename, "utf8")).replace('"name": "acme-ai"', '"name": "changed"')
  await writeFile(filename, edited)
  await assert.rejects(writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered)), /was modified/)
})

test("existing dangling defaults for managed providers fail closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), '{ "model": "acme-ai/nonexistent" }')
  await assert.rejects(writeConfigAtomically(directory, renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["real"]) }]), ownershipFromRendered(renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["real"]) }]))), /dangling primary default/)
})

test("existing dangling defaults for unmanaged providers are preserved without error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), '{ "model": "anthropic/claude-sonnet-4-5" }')
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} })
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.model, "anthropic/claude-sonnet-4-5")
})

test("failure before replacement leaves the previous config and embedded ownership intact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const first = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, first, ownershipFromRendered(first))
  const before = await readFile(path.join(directory, "opencode.jsonc"), "utf8")
  const second = renderProviderConfig([{ facts: facts("zeta-ai"), catalog: catalog("zeta-ai", ["b"]) }])
  await assert.rejects(writeConfigAtomically(directory, second, ownershipFromRendered(second), { beforeRename: () => { throw new Error("injected failure") } }), /injected failure/)
  assert.equal(await readFile(path.join(directory, "opencode.jsonc"), "utf8"), before)
})

test("an existing lock is not stolen and reports a lifecycle timeout", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const lock = path.join(directory, ".acq-provider-config.lock")
  await writeFile(lock, JSON.stringify({ schemaVersion: "acq-opencode-provider-lock/v3", pid: process.pid, host: os.hostname(), startTime: "unavailable", nonce: "live" }))
  await assert.rejects(writeConfigAtomically(directory, { enabled_providers: [], provider: {} }, undefined, { processStartTime: () => "unavailable" }), /timed out waiting/)
  await readFile(lock)
})

test("a dead local lock is recovered only after PID identity proves it stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const lock = path.join(directory, ".acq-provider-config.lock")
  await writeFile(lock, JSON.stringify({ schemaVersion: "acq-opencode-provider-lock/v3", pid: 999999, host: "test-host", startTime: "missing", nonce: "dead" }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} }, undefined, { hostname: "test-host", isProcessAlive: () => false })
  await assert.rejects(readFile(lock), /ENOENT/)
})

test("a reused PID does not block stale-lock recovery when its process identity differs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const lock = path.join(directory, ".acq-provider-config.lock")
  await writeFile(lock, JSON.stringify({ schemaVersion: "acq-opencode-provider-lock/v3", pid: process.pid, host: os.hostname(), startTime: "old-instance", nonce: "dead" }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} }, undefined, { processStartTime: () => "new-instance" })
  assert.ok(parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8")))
})

test("provider URLs reject credential, port, query, and fragment components", () => {
  for (const baseUrl of ["https://user@acme-ai.example.test/v1", "https://acme-ai.example.test:8443/v1", "https://acme-ai.example.test/v1?x=y", "https://acme-ai.example.test/v1#x"]) {
    assert.throws(() => renderProviderConfig([{ facts: { ...facts("acme-ai"), baseUrl }, catalog: catalog("acme-ai", ["a"]) }]), /without credentials, port, query, or fragment/)
  }
})

test("strict JSONC rejects malformed trailing commas and duplicate properties", () => {
  for (const text of ['{,}', '{"x":,}', '[1,,]', '{"x": 1, "x": 2}']) assert.throws(() => parseJsonc(text), /JSON|expected|duplicate|invalid/i)
})

test("prototype-like keys are own properties and invalid provider IDs are rejected", () => {
  const parsed = parseJsonc('{ "provider": { "__proto__": { "models": { "constructor": {} } } } }')
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.provider, "__proto__"), true)
  assert.throws(() => renderProviderConfig([{ facts: facts("__proto__"), catalog: catalog("__proto__", ["constructor"]) }]), /invalid provider/)
})

test("empty authoritative provider directory cleans stale generated providers but preserves foreign config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const root = path.join(directory, "input")
  const globalDir = path.join(directory, "config")
  await mkdir(path.join(root, "models", "providers"), { recursive: true })
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(globalDir, rendered, ownershipFromRendered(rendered))
  await writeConfigAtomically(globalDir, { enabled_providers: ["foreign"], provider: { foreign: { models: { a: {} } } } })
  await applyProviderProjection(root, globalDir, { baseConfig: {} })
  const installed = parseJsonc(await readFile(path.join(globalDir, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(installed.provider), ["foreign"])
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

// ── Finding 1 regressions ────────────────────────────────────────────────────
// Legacy migration claims roles only when values EXACTLY equal historical shipped
// defaults. Differing user selections on a recognized legacy provider are
// unowned and preserved even when that provider is later removed.

test("legacy migration: user-changed primary on legacy provider is preserved after removal", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  // User changed primary but kept small/compaction/summary/title at shipped defaults
  legacyConfig.model = "usai/some-user-selected-model"
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(legacyConfig))
  const rendered = renderProviderConfig([])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  // User-changed primary must survive (not claimed as kit-owned)
  assert.equal(installed.model, "usai/some-user-selected-model")
  // Shipped defaults for other roles must be removed (kit-owned, provider gone)
  assert.equal(installed.small_model, undefined)
  assert.equal(installed.agent?.compaction?.model, undefined)
  assert.equal(installed.agent?.summary?.model, undefined)
  assert.equal(installed.agent?.title?.model, undefined)
})

test("legacy migration: each role is claimed only if it exactly matches its own shipped default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  // User changed small and compaction; primary, summary, title stay at shipped defaults
  legacyConfig.small_model = "usai/user-custom-small"
  legacyConfig.agent.compaction.model = "usai/user-custom-compaction"
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(legacyConfig))
  const rendered = renderProviderConfig([])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  // User-changed small and compaction must survive
  assert.equal(installed.small_model, "usai/user-custom-small")
  assert.equal(installed.agent?.compaction?.model, "usai/user-custom-compaction")
  // Shipped defaults for primary, summary, title must be removed
  assert.equal(installed.model, undefined)
  assert.equal(installed.agent?.summary?.model, undefined)
  assert.equal(installed.agent?.title?.model, undefined)
})

// ── Finding 2 regressions ────────────────────────────────────────────────────
// Removed providers must remain removed across repeated authoritative renders even
// when stale lower-precedence config.json/opencode.json contains them.

test("removed legacy provider stays removed across repeated empty renders with stale lower config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(legacyConfig))
  // First render removes usai
  const empty = renderProviderConfig([])
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  // Write stale lower-precedence config.json with the usai provider block
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ provider: { usai: legacyConfig.provider.usai } }))
  // Second render must still keep usai removed
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const after2 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(after2.provider?.usai, undefined)
  // Third render must also keep usai removed
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const after3 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(after3.provider?.usai, undefined)
})

test("removed legacy provider stays removed with stale lower config while preserving unrelated lower keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(legacyConfig))
  const empty = renderProviderConfig([])
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  // Stale lower config has usai provider AND an unrelated key (theme)
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ provider: { usai: legacyConfig.provider.usai }, theme: "dark" }))
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.provider?.usai, undefined, "removed provider must stay removed")
  assert.equal(installed.theme, "dark", "unrelated lower key must be preserved")
})

test("all stale legacy role defaults stay removed until a genuine user override replaces one", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  await writeFile(path.join(directory, "config.json"), JSON.stringify(legacyConfig))
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  const empty = renderProviderConfig([])
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
    const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
    assert.equal(installed.model, undefined)
    assert.equal(installed.small_model, undefined)
    assert.equal(installed.agent?.compaction?.model, undefined)
    assert.equal(installed.agent?.summary?.model, undefined)
    assert.equal(installed.agent?.title?.model, undefined)
  }
  const current = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  current.model = "anthropic/claude-sonnet-4-5"
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(current))
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.model, "anthropic/claude-sonnet-4-5")
  assert.equal(installed.small_model, undefined)
})

test("lower-file-only shipped legacy config is recognized and remains removed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  await writeFile(path.join(directory, "config.json"), legacy)
  const empty = renderProviderConfig([])
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
    const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
    assert.equal(installed.provider?.usai, undefined)
    assert.equal(installed.model, undefined)
    assert.equal(installed.small_model, undefined)
  }
})

// ── Finding 3 regressions ────────────────────────────────────────────────────
// Built-in provider/model references (e.g. anthropic/claude-sonnet-4-5) must not
// fail global-file validation when provider is not managed/defined.
// Dangling references to MANAGED providers still fail.

test("built-in unmanaged provider reference in model does not fail validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify({ model: "anthropic/claude-sonnet-4-5", provider: {} }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} })
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.model, "anthropic/claude-sonnet-4-5")
})

test("built-in unmanaged provider references in all five roles do not fail validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify({
    model: "anthropic/claude-sonnet-4-5",
    small_model: "anthropic/claude-haiku-4-5",
    agent: { compaction: { model: "openai/gpt-4o-mini" }, summary: { model: "openai/gpt-4o-mini" }, title: { model: "openai/gpt-4o-mini" } },
    provider: {},
  }))
  await writeConfigAtomically(directory, { enabled_providers: [], provider: {} })
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.model, "anthropic/claude-sonnet-4-5")
  assert.equal(installed.small_model, "anthropic/claude-haiku-4-5")
  assert.equal(installed.agent?.compaction?.model, "openai/gpt-4o-mini")
  assert.equal(installed.agent?.summary?.model, "openai/gpt-4o-mini")
  assert.equal(installed.agent?.title?.model, "openai/gpt-4o-mini")
})

test("dangling reference to a managed provider still fails validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify({ model: "acme-ai/nonexistent", provider: {} }))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["real-model"]) }])
  await assert.rejects(writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered)), /dangling primary default/)
})

test("unmanaged built-in reference in lower-priority config survives managed render without error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ model: "openai/gpt-4o" }))
  const rendered = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"], { primary: "a" }) }])
  await writeConfigAtomically(directory, rendered, ownershipFromRendered(rendered))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  // openai/gpt-4o is an unowned user selection — preserved, no validation error
  assert.equal(installed.model, "openai/gpt-4o")
})

// ── Finding 5 regressions (b43916b) ─────────────────────────────────────────
// Role removal ownership must retain ALL superseded kit-owned references across
// provider switches, not only the latest per role. A stale lower-file historical
// USAi default must stay suppressed after rendering fictitious provider
// recommendations then empty twice. Genuine differing user values still survive.

test("older role defaults stay removed after provider switch then two empty renders", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  const legacyConfig = parseJsonc(legacy)
  // Both global files start with the legacy USAi config
  await writeFile(path.join(directory, "config.json"), JSON.stringify(legacyConfig))
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  // Render fictitious provider with all five recommendations (replaces USAi)
  const fictitious = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["large", "small-m", "compact-m", "summary-m", "title-m"], { primary: "large", small: "small-m", compaction: "compact-m", summary: "summary-m", title: "title-m" }) }])
  await writeConfigAtomically(directory, fictitious, ownershipFromRendered(fictitious))
  // First empty render: acme-ai roles removed, USAi still in config.json
  const empty = renderProviderConfig([])
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const after1 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(after1.model, undefined, "primary must be absent after first empty render")
  // Second empty render: USAi defaults from config.json must NOT resurrect
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const after2 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(after2.model, undefined, "primary must stay absent after second empty render")
  assert.equal(after2.small_model, undefined, "small must stay absent")
  assert.equal(after2.agent?.compaction?.model, undefined, "compaction must stay absent")
  assert.equal(after2.agent?.summary?.model, undefined, "summary must stay absent")
  assert.equal(after2.agent?.title?.model, undefined, "title must stay absent")
  // Genuine user override after the history is established must survive
  const canonical = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  canonical.model = "anthropic/claude-sonnet-4-5"
  await writeFile(path.join(directory, "opencode.jsonc"), JSON.stringify(canonical))
  await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
  const after3 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(after3.model, "anthropic/claude-sonnet-4-5", "genuine user override must survive")
  assert.equal(after3.small_model, undefined, "other roles still suppressed")
})

test("provider-switch role regression: usai defaults replaced by fictitious then returned to empty twice", async () => {
  // Focused regression: exactly mirrors the reviewer scenario at b43916b.
  // Legacy in opencode.jsonc only (no config.json stale file), same logic applies.
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const legacy = await readFile(new URL("../../../../providers/usai/tests/fixtures/opencode-production.jsonc", import.meta.url), "utf8")
  await writeFile(path.join(directory, "opencode.jsonc"), legacy)
  const fictitious = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["m"], { primary: "m", small: "m", compaction: "m", summary: "m", title: "m" }) }])
  await writeConfigAtomically(directory, fictitious, ownershipFromRendered(fictitious))
  const empty = renderProviderConfig([])
  for (let i = 0; i < 3; i++) {
    await writeConfigAtomically(directory, empty, ownershipFromRendered(empty))
    const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
    assert.equal(installed.model, undefined, `model must be absent on empty render ${i + 1}`)
    assert.equal(installed.small_model, undefined, `small_model must be absent on empty render ${i + 1}`)
    assert.equal(installed.agent?.compaction?.model, undefined, `compaction must be absent on empty render ${i + 1}`)
    assert.equal(installed.agent?.summary?.model, undefined, `summary must be absent on empty render ${i + 1}`)
    assert.equal(installed.agent?.title?.model, undefined, `title must be absent on empty render ${i + 1}`)
  }
})

// ── Finding 6 regressions (b43916b) ─────────────────────────────────────────
// Catalog shrinkage: canonical ownership validation must examine the canonical
// owned provider before merging lower files. Owned provider blocks must be
// replaced wholesale from the authoritative rendered provider, so stale
// lower-file models cannot reappear and invalidate next startup.

test("catalog shrink a,b -> a -> a succeeds (stale lower file has a,b)", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  // Step 1: first authoritative render a,b (canonical owns it)
  const ab = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a", "b"]) }])
  await writeConfigAtomically(directory, ab, ownershipFromRendered(ab))
  // Step 2: stale config.json written after initial render (simulates sync lag)
  await writeFile(path.join(directory, "config.json"), JSON.stringify(ab))
  // Step 3: first shrink — catalog reduced to a-only
  const aOnly = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  const after1 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(after1.provider["acme-ai"].models), ["a"], "first shrink: only model a present")
  // Step 4: second render with same a-only catalog — must not fail ownership check
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  const after2 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(after2.provider["acme-ai"].models), ["a"], "second render: still only model a")
  // Step 5: third render for good measure
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  const after3 = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(after3.provider["acme-ai"].models), ["a"], "third render: still only model a")
})

test("catalog shrink preserves foreign providers and unrelated settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const ab = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a", "b"]) }])
  await writeConfigAtomically(directory, ab, ownershipFromRendered(ab))
  // Stale config.json has a,b PLUS foreign provider and theme
  const stale = { ...ab, provider: { ...ab.provider, foreign: { models: { f: {} } } }, theme: "dark" }
  await writeFile(path.join(directory, "config.json"), JSON.stringify(stale))
  const aOnly = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"]) }])
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.deepEqual(Object.keys(installed.provider["acme-ai"].models), ["a"], "stale model b removed")
  assert.ok(installed.provider.foreign, "foreign provider preserved")
  assert.equal(installed.theme, "dark", "unrelated theme preserved")
})

test("provider-switch role regression: a,b -> a -> a with role recommendation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-config-"))
  const ab = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a", "b"], { primary: "a" }) }])
  await writeConfigAtomically(directory, ab, ownershipFromRendered(ab))
  await writeFile(path.join(directory, "config.json"), JSON.stringify(ab))
  const aOnly = renderProviderConfig([{ facts: facts("acme-ai"), catalog: catalog("acme-ai", ["a"], { primary: "a" }) }])
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  await writeConfigAtomically(directory, aOnly, ownershipFromRendered(aOnly))
  const installed = parseJsonc(await readFile(path.join(directory, "opencode.jsonc"), "utf8"))
  assert.equal(installed.model, "acme-ai/a", "recommendation preserved after shrink")
  assert.deepEqual(Object.keys(installed.provider["acme-ai"].models), ["a"], "only model a present")
})
