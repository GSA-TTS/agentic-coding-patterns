// Source for the standalone guest artifact; do not stage this module itself.
import { spawn } from "node:child_process"
import { readFile, lstat, realpath, access } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { discoverRuntimeModels } from "../../../../../../providers/usai/scripts/runtime-model-discovery.mjs"
import { boundedJson, RUNTIME_LIMITS, record, validatedFacts } from "../../../../../../providers/usai/scripts/runtime-model-bounds.mjs"
import { runtimeFailure, failureOutcome, preserveRuntimeFailure, parseFailure, FAILURE_BYTES } from "../../../../../../providers/usai/scripts/runtime-model-outcome.mjs"
import { renderProviderConfig, ownershipFromRendered, withProviderConfigLock, parseJsonc } from "./render-provider-config.mjs"

// Only the trusted guest launcher supplies this path, never provider data.
// Node loads extra roots at process startup. Preserve that one trust setting,
// not NODE_OPTIONS, preload hooks, proxy variables or TLS-disable switches.
export async function discoveryChildEnvironment(environment) {
  const childEnv = { USAI_API_KEY: environment.USAI_API_KEY ?? "" }
  const caPath = environment.NODE_EXTRA_CA_CERTS
  if (caPath === undefined) return childEnv
  if (typeof caPath !== "string" || !path.isAbsolute(caPath) || path.normalize(caPath) !== caPath ||
      await realpath(caPath) !== caPath) throw new Error("invalid guest CA path")
  const stat = await lstat(caPath)
  if (!stat.isFile() || stat.size === 0 || stat.size > 2 * 1024 * 1024 || (stat.mode & 0o022) !== 0) throw new Error("guest CA bundle must be a bounded read-only regular file")
  await access(caPath, constants.R_OK)
  let writable = true
  try { await access(caPath, constants.W_OK) } catch (error) {
    if (!["EACCES", "EPERM", "EROFS"].includes(error.code)) throw error
    writable = false
  }
  if (writable) throw new Error("guest CA bundle must not be writable by the preparation user")
  childEnv.NODE_EXTRA_CA_CERTS = caPath
  return childEnv
}

// Pipes rather than Node's deserializing IPC channel: cap bytes BEFORE parsing.
// Child stdout is one result; stderr is discarded so response/credential bytes
// cannot reach logs. Await close (not merely exit/kill) before releasing the lock.
export async function runDiscoveryChild({ providerRoot, mode, deadline, artifact, credentials = process.env, spawnImpl = spawn }) {
  let environment
  try { environment = await discoveryChildEnvironment(credentials) }
  catch { throw runtimeFailure("trust", "trust") }
  return new Promise((resolve, reject) => {
    const remaining = deadline - performance.now()
    if (remaining <= 0) { reject(runtimeFailure("preparation", "deadline")); return }
    let child
    try { child = spawnImpl(process.execPath, [artifact, "--discovery-child", providerRoot, mode, String(remaining)], {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    }) } catch { reject(runtimeFailure("child", "crash")); return }
    let failure
    let size = 0
    const chunks = []
    const terminate = (error) => {
      failure ??= error
      child.kill("SIGKILL")
    }
    const timer = setTimeout(() => terminate(runtimeFailure("preparation", "deadline")), remaining)
    child.on("error", () => { failure ??= runtimeFailure("child", "crash") })
    child.stdout.on("error", () => terminate(runtimeFailure("child", "protocol")))
    child.stdout.on("data", (chunk) => {
      size += chunk.length
      if (size > RUNTIME_LIMITS.resultBytes) terminate(runtimeFailure("child", "protocol"))
      else if (!failure) chunks.push(chunk)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (failure || signal || performance.now() >= deadline) {
        reject(failure ?? runtimeFailure(performance.now() >= deadline ? "preparation" : "child", performance.now() >= deadline ? "deadline" : "crash")); return
      }
      try {
        if (code !== 0 && (code !== 1 || size > FAILURE_BYTES)) throw runtimeFailure("child", "protocol")
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
        if (code === 1) {
          const error = parseFailure(text)
          if (mode === "snapshot" && error.outcome.failureClass === "transient") throw runtimeFailure("child", "protocol")
          if (performance.now() >= deadline) { reject(runtimeFailure("preparation", "deadline")); return }
          reject(error); return
        }
        const result = boundedJson(text, RUNTIME_LIMITS.resultBytes)
        record(result)
        if (Object.keys(result).length !== 3 || !Array.isArray(result.inputs) || result.inputs.length > RUNTIME_LIMITS.providers ||
            result.sourceOutcome !== (mode === "snapshot" ? "snapshot-nonlive" : "live") ||
            !["not-requested", "unavailable", "available-unverified"].includes(result.metadataOutcome)) throw new Error("invalid discovery result")
        const providers = new Set()
        for (const input of result.inputs) {
          record(input)
          if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "facts") || !Object.hasOwn(input, "catalog")) throw runtimeFailure("child", "protocol")
          validatedFacts(input.facts)
          if (providers.has(input.facts.providerId)) throw new Error("duplicate result provider")
          providers.add(input.facts.providerId)
          if (!Array.isArray(input.catalog?.models) || input.catalog.models.length > RUNTIME_LIMITS.models) throw new Error("invalid result models")
        }
        if (performance.now() >= deadline) { reject(runtimeFailure("preparation", "deadline")); return }
        resolve(result)
      } catch { reject(runtimeFailure("child", "protocol")) }
    })
  })
}

export async function prepareRuntimeModels(providerRoot, globalDir, options = {}) {
  let stage = "input", kind = "input"
  try {
  const mode = options.mode ?? "live-required"
  if (!["live-required", "snapshot"].includes(mode)) throw new Error("unsupported preparation mode")
  if (!providerRoot || !path.isAbsolute(providerRoot)) throw new Error("required absolute provider root missing")
  // Use this exact standalone file, not a sibling path: MSB stages flat files.
  const artifact = options.artifact ?? fileURLToPath(import.meta.url)
  // Missing artifacts fail even for an authoritative empty inventory.
  await readFile(artifact)
  const transactionOptions = { baseConfig: options.baseConfig ?? {}, noLockRecovery: true, lockWaitMs: RUNTIME_LIMITS.lockMs }
  stage = "preparation"; kind = "lock"
  return await withProviderConfigLock(globalDir, async (publish) => {
    const deadline = performance.now() + RUNTIME_LIMITS.totalMs
    const checkDeadline = () => { if (performance.now() >= deadline) throw runtimeFailure("preparation", "deadline") }
    // Check immediately before atomic rename, after temporary-file flush.
    transactionOptions.checkDeadline = checkDeadline
    const result = await runDiscoveryChild({ providerRoot, mode, deadline, artifact, credentials: options.credentials, spawnImpl: options.spawnImpl })
    kind = "render"
    const rendered = renderProviderConfig(result.inputs)
    checkDeadline()
    await publish(rendered, ownershipFromRendered(rendered))
    return { sourceOutcome: result.sourceOutcome, metadataOutcome: result.metadataOutcome }
  }, transactionOptions)
  } catch (error) { throw preserveRuntimeFailure(error, stage, kind) }
}

// Explicit CLI, not a lifecycle/launch barrier. The host must bind a successful
// invocation to its immutable generation and attempt before launching OpenCode.
export async function runtimePreparationMain(argv = process.argv.slice(2)) {
  try {
  if (argv[0] === "--discovery-child") {
    if (argv.length !== 4 || !Number.isFinite(Number(argv[3])) || Number(argv[3]) <= 0 || Number(argv[3]) > RUNTIME_LIMITS.totalMs) throw new Error("invalid child invocation")
    const result = await discoverRuntimeModels(argv[1], { mode: argv[2], deadline: performance.now() + Number(argv[3]) })
    const text = JSON.stringify(result)
    if (Buffer.byteLength(text) > RUNTIME_LIMITS.resultBytes) throw new Error("discovery result byte limit")
    process.stdout.write(text)
    return
  }
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--provider-root", "--global-dir", "--base-config", "--mode"].includes(argv[i]) || !argv[i + 1] || Object.hasOwn(args, argv[i])) throw new Error("invalid preparation arguments")
    args[argv[i]] = argv[i + 1]
  }
  const baseConfig = parseJsonc(await readFile(args["--base-config"] ?? "/home/agent/opencode-config/base-config.jsonc", "utf8"))
  const result = await prepareRuntimeModels(args["--provider-root"] ?? process.env.ACQ_PROVIDER_INPUT_ROOT,
    args["--global-dir"] ?? path.join(process.env.HOME ?? "/home/agent", ".config/opencode"),
    { mode: args["--mode"], baseConfig })
  process.stdout.write(JSON.stringify(result) + "\n")
  } catch (error) { throw preserveRuntimeFailure(error, "input", "input") }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runtimePreparationMain().catch((error) => {
    // v1 failure stdout is machine-readable; stderr remains fixed human text.
    // Child and parent both exit 1, including typed transient failures. No reuse.
    const outcome = failureOutcome(error, "input", "input")
    process.stdout.write(JSON.stringify(outcome) + "\n")
    console.error("opencode preparation failed; prior configuration is not a successful preparation")
    process.exitCode = 1
  })
}
