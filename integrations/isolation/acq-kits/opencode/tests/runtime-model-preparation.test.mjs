import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { runDiscoveryChild } from "../files/home/opencode-config/runtime-preparation-source.mjs"
import { parseJsonc, renderProviderConfig, ownershipFromRendered, withProviderConfigLock } from "../files/home/opencode-config/render-provider-config.mjs"

const artifact = fileURLToPath(new URL("../files/home/opencode-config/runtime-model-preparation.mjs", import.meta.url))
const facts = { schemaVersion: "acq-provider-facts/v1", providerId: "usai", apiProtocol: "openai-compatible", host: "gateway.example.test", baseUrl: "https://gateway.example.test/v1", modelsUrl: "https://gateway.example.test/v1/models", keyEnv: "USAI_API_KEY" }

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-preparation-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "input/models/providers"), { recursive: true })
  await mkdir(path.join(root, "config"))
  await writeFile(path.join(root, "base.jsonc"), '{"permission":{"read":{".env":"deny"}}}')
  await writeFile(path.join(root, "config/opencode.jsonc"), '{"theme":"preserved"}\n')
  return root
}

function cli(root, args = [], executable = artifact) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, "--provider-root", path.join(root, "input"), "--global-dir", path.join(root, "config"), "--base-config", path.join(root, "base.jsonc"), ...args], { env: { HOME: root }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

test("standalone CLI works at a flat renamed path with no siblings; empty is a real success", async (t) => {
  const root = await fixture(t)
  const flat = path.join(root, "flat-readonly-artifact.mjs")
  await copyFile(artifact, flat)
  const result = await cli(root, [], flat)
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { sourceOutcome: "live", metadataOutcome: "not-requested" })
  const config = parseJsonc(await readFile(path.join(root, "config/opencode.jsonc"), "utf8"))
  assert.equal(config.theme, "preserved")
  assert.deepEqual(config.enabled_providers, [])
  assert.equal(config.permission.read[".env"], "deny")
})

test("required CLI missing input and missing credentials fail without touching prior config", async (t) => {
  const root = await fixture(t)
  const before = await readFile(path.join(root, "config/opencode.jsonc"))
  await rm(path.join(root, "input"), { recursive: true })
  assert.notEqual((await cli(root)).code, 0)
  assert.deepEqual(await readFile(path.join(root, "config/opencode.jsonc")), before)
  const directory = path.join(root, "input/models/providers/usai")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "facts.json"), JSON.stringify(facts))
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ schemaVersion: "acq-neutral-model-catalog/v1", providerId: "usai", models: [{ id: "example" }] }))
  // No descriptor: legacy snapshot input must fail live mode before a request.
  assert.notEqual((await cli(root)).code, 0)
  assert.deepEqual(await readFile(path.join(root, "config/opencode.jsonc")), before)
  await writeFile(path.join(directory, "discovery.json"), JSON.stringify({ schemaVersion: "acq-runtime-discovery/v1", providerId: "usai", adapter: "usai-openai-list/v1" }))
  // Valid descriptor, still no credential: this is a separate required failure.
  assert.notEqual((await cli(root)).code, 0)
  assert.deepEqual(await readFile(path.join(root, "config/opencode.jsonc")), before)
  await rm(path.join(directory, "discovery.json"))
  const snapshot = await cli(root, ["--mode", "snapshot"])
  assert.equal(snapshot.code, 0, snapshot.stderr)
  assert.equal(JSON.parse(snapshot.stdout).sourceOutcome, "snapshot-nonlive")
})

test("parent deadline kills and reaps a synchronously blocked child; oversized pipe is also killed", async (t) => {
  const root = await fixture(t)
  for (const [name, source, timeout, expected] of [
    ["spin", "for (;;) {}", 250, /deadline/],
    ["flood", 'process.stdout.write("x".repeat(5 * 1024 * 1024), () => { for (;;) {} })', 3000, /byte limit/],
    ["invalid", 'process.stdout.write("not-json")', 3000, /invalid bounded/],
  ]) {
    const worker = path.join(root, name + ".mjs")
    await writeFile(worker, source)
    let child, closed = false
    const start = performance.now()
    await assert.rejects(runDiscoveryChild({ providerRoot: root, mode: "live-required", deadline: start + timeout, artifact: worker,
      spawnImpl: (...args) => { child = spawn(...args); child.once("close", () => { closed = true }); return child },
    }), expected)
    assert.equal(closed, true, "rejection must wait for child close")
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
    assert.ok(performance.now() - start < timeout + 3000)
  }
})

test("required transaction never steals a dead lock, and deadline failure is pre-rename", async (t) => {
  const root = await fixture(t)
  const globalDir = path.join(root, "config")
  const filename = path.join(globalDir, "opencode.jsonc")
  const before = await readFile(filename)
  const lock = path.join(globalDir, ".acq-provider-config.lock")
  await writeFile(lock, '{"pid":99999999,"host":"dead"}')
  await assert.rejects(withProviderConfigLock(globalDir, () => assert.fail("must not acquire"), { noLockRecovery: true, lockWaitMs: 30 }), /timed out/)
  assert.equal(await readFile(lock, "utf8"), '{"pid":99999999,"host":"dead"}')
  await rm(lock)
  const rendered = renderProviderConfig([])
  await assert.rejects(withProviderConfigLock(globalDir, (publish) => publish(rendered, ownershipFromRendered(rendered)), {
    noLockRecovery: true, checkDeadline: () => { throw new Error("expired before rename") },
  }), /expired/)
  assert.deepEqual(await readFile(filename), before)
  await assert.rejects(readFile(lock), { code: "ENOENT" })
})

test("concurrent standalone preparations serialize without nested lock or torn ownership", async (t) => {
  const root = await fixture(t)
  const results = await Promise.all([cli(root), cli(root)])
  for (const result of results) assert.equal(result.code, 0, result.stderr)
  const text = await readFile(path.join(root, "config/opencode.jsonc"), "utf8")
  assert.ok(text.startsWith("// acq-provider-config-state: "))
  assert.equal(parseJsonc(text).theme, "preserved")
  assert.deepEqual(parseJsonc(text).enabled_providers, [])
})
