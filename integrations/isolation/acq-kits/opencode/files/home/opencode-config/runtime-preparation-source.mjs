// Source for the standalone guest artifact; do not stage this module itself.
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { discoverRuntimeModels } from "../../../../../../providers/usai/scripts/runtime-model-discovery.mjs"
import { boundedJson, RUNTIME_LIMITS, record, validatedFacts } from "../../../../../../providers/usai/scripts/runtime-model-bounds.mjs"
import { renderProviderConfig, ownershipFromRendered, withProviderConfigLock, parseJsonc } from "./render-provider-config.mjs"

// Pipes rather than Node's deserializing IPC channel: cap bytes BEFORE parsing.
// Child stdout is one result; stderr is discarded so response/credential bytes
// cannot reach logs. Await close (not merely exit/kill) before releasing the lock.
export function runDiscoveryChild({ providerRoot, mode, deadline, artifact, credentials = process.env, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - performance.now()
    if (remaining <= 0) { reject(new Error("preparation deadline")); return }
    const child = spawnImpl(process.execPath, [artifact, "--discovery-child", providerRoot, mode, String(remaining)], {
      env: { USAI_API_KEY: credentials.USAI_API_KEY ?? "" },
      stdio: ["ignore", "pipe", "ignore"],
    })
    let failure
    let size = 0
    const chunks = []
    const terminate = (message) => {
      failure ??= new Error(message)
      child.kill("SIGKILL")
    }
    const timer = setTimeout(() => terminate("preparation deadline"), remaining)
    child.on("error", () => { failure ??= new Error("discovery child failed") })
    child.stdout.on("data", (chunk) => {
      size += chunk.length
      if (size > RUNTIME_LIMITS.resultBytes) terminate("discovery result byte limit")
      else if (!failure) chunks.push(chunk)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (failure || code !== 0 || signal || performance.now() >= deadline) {
        reject(failure ?? new Error("discovery child failed or expired")); return
      }
      try {
        const result = boundedJson(Buffer.concat(chunks).toString("utf8"), RUNTIME_LIMITS.resultBytes)
        record(result)
        if (!Array.isArray(result.inputs) || result.inputs.length > RUNTIME_LIMITS.providers ||
            result.sourceOutcome !== (mode === "snapshot" ? "snapshot-nonlive" : "live") ||
            !["not-requested", "unavailable", "available-unverified"].includes(result.metadataOutcome)) throw new Error("invalid discovery result")
        const providers = new Set()
        for (const input of result.inputs) {
          validatedFacts(input.facts)
          if (providers.has(input.facts.providerId)) throw new Error("duplicate result provider")
          providers.add(input.facts.providerId)
          if (!Array.isArray(input.catalog?.models) || input.catalog.models.length > RUNTIME_LIMITS.models) throw new Error("invalid result models")
        }
        resolve(result)
      } catch { reject(new Error("invalid bounded discovery result")) }
    })
  })
}

export async function prepareRuntimeModels(providerRoot, globalDir, options = {}) {
  const mode = options.mode ?? "live-required"
  if (!["live-required", "snapshot"].includes(mode)) throw new Error("unsupported preparation mode")
  if (!providerRoot || !path.isAbsolute(providerRoot)) throw new Error("required absolute provider root missing")
  // Use this exact standalone file, not a sibling path: MSB stages flat files.
  const artifact = options.artifact ?? fileURLToPath(import.meta.url)
  // Missing artifacts fail even for an authoritative empty inventory.
  await readFile(artifact)
  const transactionOptions = { baseConfig: options.baseConfig ?? {}, noLockRecovery: true, lockWaitMs: RUNTIME_LIMITS.lockMs }
  return withProviderConfigLock(globalDir, async (publish) => {
    const deadline = performance.now() + RUNTIME_LIMITS.totalMs
    const checkDeadline = () => { if (performance.now() >= deadline) throw new Error("preparation deadline") }
    // Check immediately before atomic rename, after temporary-file flush.
    transactionOptions.checkDeadline = checkDeadline
    const result = await runDiscoveryChild({ providerRoot, mode, deadline, artifact, credentials: options.credentials })
    const rendered = renderProviderConfig(result.inputs)
    checkDeadline()
    await publish(rendered, ownershipFromRendered(rendered))
    return { sourceOutcome: result.sourceOutcome, metadataOutcome: result.metadataOutcome }
  }, transactionOptions)
}

// Explicit CLI, not a lifecycle/launch barrier. The host must bind a successful
// invocation to its immutable generation and attempt before launching OpenCode.
export async function runtimePreparationMain(argv = process.argv.slice(2)) {
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runtimePreparationMain().catch(() => {
    console.error("opencode preparation failed; prior configuration is not a successful preparation")
    process.exitCode = 1
  })
}
