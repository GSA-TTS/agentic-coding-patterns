import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { runDiscoveryChild, prepareRuntimeModels } from "../files/home/opencode-config/runtime-preparation-source.mjs"
import { runtimePreparationMain } from "../files/home/opencode-config/runtime-model-preparation.mjs"
import { parseJsonc, renderProviderConfig, ownershipFromRendered, withProviderConfigLock } from "../files/home/opencode-config/render-provider-config.mjs"
import { runtimeFailure, failureOutcome, FAILURE_BYTES } from "../../../../providers/usai/scripts/runtime-model-outcome.mjs"

const artifact = fileURLToPath(new URL("../files/home/opencode-config/runtime-model-preparation.mjs", import.meta.url))
const sourceArtifact = fileURLToPath(new URL("../files/home/opencode-config/runtime-preparation-source.mjs", import.meta.url))
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

function cli(root, args = [], executable = artifact, preload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(preload ? ["--import", pathToFileURL(preload).href] : []), executable, "--provider-root", path.join(root, "input"), "--global-dir", path.join(root, "config"), "--base-config", path.join(root, "base.jsonc"), ...args], { env: { HOME: root, ...(preload ? { USAI_API_KEY: "synthetic-outcome-canary" } : {}) }, stdio: ["ignore", "pipe", "pipe"] })
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

test("parent validates real child failure bytes and exit consistency before trusting transient", async (t) => {
  const root = await fixture(t)
  const text = JSON.stringify(failureOutcome(runtimeFailure("membership", "connection")))
  for (const [body, code, expected] of [
    [text, 1, "transient"], [text, 0, "hard"], [text, 2, "hard"],
    [text + " ".repeat(FAILURE_BYTES), 1, "hard"],
    ...Object.entries(JSON.parse(text)).flatMap(([key, original]) =>
      [[original], {}, null, true, 1].map((value) => [JSON.stringify({ ...JSON.parse(text), [key]: value }), 1, "hard"])),
    ...["__proto__", "constructor", "toString"].map((stage) => [JSON.stringify({ ...JSON.parse(text), stage }), 1, "hard"]),
    [text.slice(0, -1) + ',"extra":"synthetic-outcome-canary"}', 1, "hard"],
    [text.slice(0, -1) + ',"\\u0072eason":"connection"}', 1, "hard"],
    ['{"outcome":"failure","failureClass":"transient"}', 1, "hard"],
    ['{"inputs":[],"sourceOutcome":"live","metadataOutcome":"not-requested"}', 1, "hard"],
    ["", 1, "hard"], [text.slice(0, -1), 1, "hard"],
  ]) {
    const worker = path.join(root, "worker.mjs")
    await writeFile(worker, `process.stdout.write(${JSON.stringify(body)}); process.exitCode = ${code}`)
    await assert.rejects(runDiscoveryChild({ providerRoot: root, mode: "live-required", deadline: performance.now() + 3000, artifact: worker, credentials: {} }), (error) => {
      assert.equal(error.outcome.failureClass, expected)
      assert.equal(JSON.stringify(error.outcome).includes("synthetic-outcome-canary"), false)
      return true
    })
  }
})

test("generated exported main rejects bad arguments and base config with closed input outcomes", async (t) => {
  const root = await fixture(t)
  const canary = "synthetic-exported-main-canary"
  const badConfig = path.join(root, canary + ".jsonc")
  await writeFile(badConfig, `{${canary}`)
  for (const argv of [
    ["--unknown", canary], ["--base-config"],
    ["--discovery-child", canary, "live-required", "invalid"],
    ["--base-config", path.join(root, canary, "missing.jsonc")],
    ["--base-config", badConfig],
  ]) {
    await assert.rejects(runtimePreparationMain(argv), (error) => {
      assert.deepEqual(error.outcome, { schemaVersion: "acq-runtime-model-outcome/v1", outcome: "failure", stage: "input", reason: "invalid-input", failureClass: "hard" })
      for (const forbidden of [canary, root, "ENOENT"]) assert.equal((String(error) + JSON.stringify(error)).includes(forbidden), false)
      return true
    })
  }
})

test("actual parent and child CLI publish only closed failures, never fallback or diagnostics", async (t) => {
  const root = await fixture(t)
  const directory = path.join(root, "input/models/providers/usai")
  await mkdir(directory)
  await writeFile(path.join(directory, "facts.json"), JSON.stringify(facts))
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ schemaVersion: "acq-neutral-model-catalog/v1", providerId: "usai", models: [] }))
  await writeFile(path.join(directory, "discovery.json"), JSON.stringify({ schemaVersion: "acq-runtime-discovery/v1", providerId: "usai", adapter: "usai-openai-list/v1" }))
  const before = await readFile(path.join(root, "config/opencode.jsonc"))
  const hook = path.join(root, "mock-network.mjs")
  // Test-only loader propagates itself across the real process boundary. The
  // artifact still uses its production CLI, environment filtering and protocol.
  for (const [expression, expected, reason] of [
    ['Object.assign(new Error("synthetic-outcome-canary"), { code: "ECONNRESET" })', "transient", "connection"],
    ['Object.assign(new Error("synthetic-outcome-canary"), { code: "ECONNRESET", cause: Object.assign(new Error("synthetic-outcome-canary"), { code: "CERT_HAS_EXPIRED" }) })', "hard", "tls"],
    ['new Error("ECONNRESET 503 synthetic-outcome-canary")', "hard", "unknown"],
    ["429", "transient", "provider-throttled"], ["503", "transient", "provider-unavailable"],
    ["401", "hard", "authentication"], ["403", "hard", "authentication"],
    ['"malformed"', "hard", "invalid-response"],
  ]) {
    await writeFile(hook, `import cp from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
const original = cp.spawn
cp.spawn = (exe, args, options) => original(exe, ["--import", import.meta.url, ...args], options)
syncBuiltinESMExports()
globalThis.fetch = async (url) => {
  const value = ${expression}
  if (value instanceof Error) throw value
  const result = new Response("synthetic-outcome-canary", { status: typeof value === "number" ? value : 200, headers: { "content-type": "application/json" } })
  Object.defineProperty(result, "url", { value: url })
  return result
}
`)
    const result = await cli(root, [], artifact, hook)
    assert.equal(result.code, 1)
    assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: "acq-runtime-model-outcome/v1", outcome: "failure", stage: "membership", reason, failureClass: expected })
    assert.equal(result.stderr, "opencode preparation failed; prior configuration is not a successful preparation\n")
    for (const secret of ["synthetic-outcome-canary", root, facts.modelsUrl, "Authorization", "ECONNRESET", "CERT_HAS_EXPIRED"]) assert.equal((result.stdout + result.stderr).includes(secret), false)
    assert.deepEqual(await readFile(path.join(root, "config/opencode.jsonc")), before)
  }
})

test("required CLI missing input and missing credentials fail without touching prior config", async (t) => {
  const root = await fixture(t)
  const before = await readFile(path.join(root, "config/opencode.jsonc"))
  await rm(path.join(root, "input"), { recursive: true })
  const missing = await cli(root)
  assert.equal(missing.code, 1)
  assert.deepEqual(JSON.parse(missing.stdout), { schemaVersion: "acq-runtime-model-outcome/v1", outcome: "failure", stage: "input", reason: "invalid-input", failureClass: "hard" })
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
    ["flood", 'process.stdout.write("x".repeat(5 * 1024 * 1024), () => { for (;;) {} })', 3000, /child-protocol/],
    ["invalid", 'process.stdout.write("not-json")', 3000, /child-protocol/],
  ]) {
    const worker = path.join(root, name + ".mjs")
    await writeFile(worker, source)
    let child, closed = false
    const start = performance.now()
    await assert.rejects(runDiscoveryChild({ providerRoot: root, mode: "live-required", deadline: start + timeout, artifact: worker, credentials: {},
      spawnImpl: (...args) => { child = spawn(...args); child.once("close", () => { closed = true }); return child },
    }), expected)
    assert.equal(closed, true, "rejection must wait for child close")
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
    assert.ok(performance.now() - start < timeout + 3000)
  }
})

async function cancellationParent(root, modulePath) {
  const worker = path.join(root, "spinning-worker.mjs")
  await writeFile(worker, 'process.stdout.write("ready", () => { for (;;) {} })')
  const parent = path.join(root, "cancellation-parent.mjs")
  await writeFile(parent, `import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { prepareRuntimeModels } from ${JSON.stringify(pathToFileURL(modulePath).href)}
const root = ${JSON.stringify(root)}
const signals = ["SIGINT", "SIGTERM"]
const listeners = signals.map((signal) => process.listenerCount(signal))
const before = await readFile(root + "/config/opencode.jsonc")
let child, closed = false
try {
  await prepareRuntimeModels(root + "/input", root + "/config", {
    credentials: {}, artifact: ${JSON.stringify(worker)},
    spawnImpl: (...args) => {
      child = spawn(...args)
      child.once("close", () => { closed = true })
      child.stdout.once("data", () => process.send({ ready: child.pid }))
      return child
    },
  })
  assert.fail("cancelled preparation succeeded")
} catch (error) {
  assert.equal(error.outcome?.stage, "preparation")
  assert.equal(error.outcome?.failureClass, "hard")
  assert.equal(closed, true)
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
  assert.deepEqual(signals.map((signal) => process.listenerCount(signal)), listeners)
  assert.deepEqual(await readFile(root + "/config/opencode.jsonc"), before)
  assert.deepEqual(await readdir(root + "/config"), ["opencode.jsonc"])
  const result = await prepareRuntimeModels(root + "/input", root + "/config", {
    credentials: {}, artifact: ${JSON.stringify(artifact)},
  })
  assert.equal(result.sourceOutcome, "live")
  assert.deepEqual(signals.map((signal) => process.listenerCount(signal)), listeners)
  process.send({ cleaned: true, recovered: true, exitCode: process.exitCode })
}
process.disconnect()
`)
  return parent
}

function terminateReadyParent(t, parentFile, signal) {
  const parent = spawn(process.execPath, [parentFile], { env: {}, stdio: ["ignore", "ignore", "pipe", "ipc"] })
  let workerPid, stderr = ""
  const messages = []
  t.after(() => {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL")
    if (workerPid) { try { process.kill(workerPid, "SIGKILL") } catch {} }
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { parent.kill("SIGKILL"); reject(new Error("cancellation cleanup timed out")) }, 5000)
    parent.stderr.on("data", (chunk) => { stderr += chunk })
    parent.on("message", (message) => {
      messages.push(message)
      if (message.ready) { workerPid = message.ready; parent.kill(signal) }
    })
    parent.once("error", (error) => { clearTimeout(timer); reject(error) })
    parent.once("close", (code, exitSignal) => {
      clearTimeout(timer)
      resolve({ code, exitSignal, stderr, messages, workerPid })
    })
  })
}

for (const modulePath of [sourceArtifact, artifact]) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${path.basename(modulePath)} ${signal} reaps child, releases lock and permits a normal follow-up`, { timeout: 10000 }, async (t) => {
      const root = await fixture(t)
      const parent = await cancellationParent(root, modulePath)
      const result = await terminateReadyParent(t, parent, signal)
      assert.equal(result.exitSignal, null, result.stderr)
      assert.equal(result.code, 1, result.stderr)
      assert.deepEqual(result.messages.at(-1), { cleaned: true, recovered: true, exitCode: 1 }, result.stderr)
      assert.throws(() => process.kill(result.workerPid, 0), { code: "ESRCH" })
      await assert.rejects(readFile(path.join(root, "config/.acq-provider-config.lock")), { code: "ENOENT" })
    })
  }
}

for (const modulePath of [sourceArtifact, artifact]) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${path.basename(modulePath)} ${signal} during rejected transaction release stays hard`, { timeout: 10000 }, async (t) => {
      const root = await fixture(t)
      const child = path.join(root, "transient-child.mjs")
      await writeFile(child, 'process.stdout.write(JSON.stringify({schemaVersion:"acq-runtime-model-outcome/v1",outcome:"failure",stage:"membership",reason:"provider-unavailable",failureClass:"transient"})); process.exitCode=1')
      const parentFile = path.join(root, "release-parent.mjs")
      await writeFile(parentFile, `import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
const root = ${JSON.stringify(root)}, signal = ${JSON.stringify(signal)}
const filename = root + "/config/opencode.jsonc"
const before = await fs.readFile(filename)
const originalUnlink = fs.unlink
let cancelled = false
fs.unlink = async (...args) => {
  if (String(args[0]).endsWith(".acq-provider-config.lock")) {
    cancelled = true
    const delivered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("release signal not delivered")), 1000)
      process.once(signal, () => { clearTimeout(timer); resolve() })
    })
    process.kill(process.pid, signal)
    await delivered
  }
  return originalUnlink(...args)
}
syncBuiltinESMExports()
const { prepareRuntimeModels } = await import(${JSON.stringify(pathToFileURL(modulePath).href)})
await assert.rejects(prepareRuntimeModels(root + "/input", root + "/config", {
  credentials: {}, artifact: ${JSON.stringify(child)},
}), error => error.outcome?.stage === "preparation" && error.outcome.reason === "unknown" && error.outcome.failureClass === "hard")
assert.equal(cancelled, true)
assert.equal(process.exitCode, 1)
assert.equal(process.listenerCount("SIGINT"), 0)
assert.equal(process.listenerCount("SIGTERM"), 0)
assert.deepEqual(await fs.readFile(filename), before)
assert.deepEqual(await fs.readdir(root + "/config"), ["opencode.jsonc"])
process.send({ cleaned: true })
process.disconnect()
`)
      const result = await terminateReadyParent(t, parentFile, signal)
      assert.equal(result.exitSignal, null, result.stderr)
      assert.equal(result.code, 1, result.stderr)
      assert.deepEqual(result.messages, [{ cleaned: true }], result.stderr)
    })
  }
}

test("normal and failed preparations remove only their own signal handlers", async (t) => {
  const root = await fixture(t)
  const signals = ["SIGINT", "SIGTERM"]
  const existing = () => {}
  for (const signal of signals) process.on(signal, existing)
  t.after(() => { for (const signal of signals) process.removeListener(signal, existing) })
  const listeners = signals.map((signal) => process.listeners(signal))
  await prepareRuntimeModels(path.join(root, "input"), path.join(root, "config"), { artifact, credentials: {} })
  assert.deepEqual(signals.map((signal) => process.listeners(signal)), listeners)
  await assert.rejects(prepareRuntimeModels("relative", path.join(root, "config"), { artifact, credentials: {} }))
  assert.deepEqual(signals.map((signal) => process.listeners(signal)), listeners)
})

async function boundaryCancellationParent(root, phase) {
  const parent = path.join(root, "boundary-parent.mjs")
  await writeFile(parent, `import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { prepareRuntimeModels } from ${JSON.stringify(pathToFileURL(sourceArtifact).href)}
const root = ${JSON.stringify(root)}, phase = ${JSON.stringify(phase)}
const originalOpen = fs.open
const originalRead = fs.readFile
const before = await fs.readFile(root + "/config/opencode.jsonc")
if (phase === "lock-wait") await fs.writeFile(root + "/config/.acq-provider-config.lock", "foreign-owner")
let cancelled = false
fs.readFile = (...args) => {
  if (phase === "lock-wait" && String(args[0]).endsWith(".lock.recovery")) {
    cancelled = true; process.emit("SIGTERM")
  }
  return originalRead(...args)
}
fs.open = async (...args) => {
  const handle = await originalOpen(...args)
  if (phase === "pre-rename" && String(args[0]).endsWith(".tmp")) {
    const sync = handle.sync.bind(handle)
    handle.sync = async () => { await sync(); cancelled = true; process.emit("SIGTERM") }
  }
  return handle
}
syncBuiltinESMExports()
const attempt = prepareRuntimeModels(root + "/input", root + "/config", {
  credentials: {}, artifact: ${JSON.stringify(artifact)},
  ...(phase !== "pre-rename" ? { spawnImpl: () => assert.fail("spawn after cancellation") } : {}),
})
if (phase === "entry") { cancelled = true; process.emit("SIGTERM") }
await assert.rejects(attempt, (error) => error.outcome?.stage === "preparation" && error.outcome.failureClass === "hard")
assert.equal(cancelled, true)
assert.equal(process.exitCode, 1)
assert.equal(process.listenerCount("SIGTERM"), 0)
assert.equal(process.listenerCount("SIGINT"), 0)
assert.deepEqual(await fs.readFile(root + "/config/opencode.jsonc"), before)
if (phase === "lock-wait") {
  assert.equal(await fs.readFile(root + "/config/.acq-provider-config.lock", "utf8"), "foreign-owner")
  await fs.unlink(root + "/config/.acq-provider-config.lock")
}
assert.deepEqual(await fs.readdir(root + "/config"), ["opencode.jsonc"])
process.send({ cleaned: true, phase })
process.disconnect()
`)
  return parent
}

for (const phase of ["entry", "lock-wait", "pre-rename"]) {
  test(`cancellation at ${phase} cannot spawn or publish and removes handlers`, { timeout: 10000 }, async (t) => {
    const root = await fixture(t)
    const result = await terminateReadyParent(t, await boundaryCancellationParent(root, phase), "SIGTERM")
    assert.equal(result.exitSignal, null, result.stderr)
    assert.equal(result.code, 1, result.stderr)
    assert.deepEqual(result.messages, [{ cleaned: true, phase }], result.stderr)
  })
}

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
