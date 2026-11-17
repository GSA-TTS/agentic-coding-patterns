import test from "node:test"
import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:https"
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { prepareRuntimeModels } from "../files/home/opencode-config/runtime-model-preparation.mjs"
import { discoveryChildEnvironment } from "../files/home/opencode-config/runtime-preparation-source.mjs"
import { parseJsonc } from "../files/home/opencode-config/render-provider-config.mjs"

const run = promisify(execFile)
const descriptor = { schemaVersion: "acq-runtime-discovery/v1", providerId: "usai", adapter: "usai-openai-list/v1" }

test("generated parent/child uses validated extra CA trust, refuses untrusted TLS, and omits unsafe optional limits", { timeout: 30000 }, async (t) => {
  // Run in the non-root, no-external-network workspace sandbox. Loopback is
  // real TLS; no checked-in certificate/private key or production routing knob.
  assert.notEqual(process.getuid?.(), 0, "TLS fixture requires a non-root sandbox")
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-tls-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ca = path.join(root, "ca.pem")
  const key = path.join(root, "server.key")
  const certificate = path.join(root, "server.pem")
  const openssl = (args) => run("openssl", args, { cwd: root, timeout: 10000, maxBuffer: 65536 })
  await openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "1", "-subj", "/CN=Runtime synthetic test CA", "-addext", "basicConstraints=critical,CA:TRUE"])
  await openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=gateway.example.test"])
  await writeFile(path.join(root, "extensions.txt"), "basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:gateway.example.test,DNS:models.dev\nextendedKeyUsage=serverAuth\n")
  await openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "1", "-extfile", "extensions.txt"])
  await chmod(ca, 0o444)

  let limit = { context: 1024, output: 64 }
  const requests = []
  const server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization })
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify(request.url === "/v1/models"
      ? { data: [{ id: "gpt-5.2" }] }
      : { azure: { models: { "gpt-5.2": { limit } } } }))
  })
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  const port = server.address().port
  // The test-owned spawn seam supplies a preload, not an environment or CLI
  // feature of the production artifact. This buffered https.request replacement
  // keeps TLS/extra-root loading real; native-fetch streaming/redirects are not tested.
  const hook = path.join(root, "loopback-fixture.mjs")
  await writeFile(hook, `import https from "node:https"
globalThis.fetch = async (url, options) => {
  if (!["https://gateway.example.test/v1/models", "https://models.dev/api.json"].includes(url)) throw new Error("unexpected fixture route")
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      port: ${port}, lookup: (_name, options, callback) => options.all
        ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4),
      headers: options.headers, signal: options.signal, agent: false,
    }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("error", reject)
      response.on("end", () => {
        const result = new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })
        Object.defineProperty(result, "url", { value: url })
        resolve(result)
      })
    })
    request.on("error", (error) => {
      // Even genuine TLS failure wrapped with transient-looking evidence is hard.
      error.cause = Object.assign(new Error("synthetic-tls-canary"), { code: "ECONNRESET" })
      reject(error)
    })
    request.end()
  })
}
`)
  const providerRoot = path.join(root, "input")
  const directory = path.join(providerRoot, "models/providers/usai")
  const globalDir = path.join(root, "config")
  await mkdir(directory, { recursive: true })
  await mkdir(globalDir)
  await writeFile(path.join(directory, "facts.json"), JSON.stringify({ schemaVersion: "acq-provider-facts/v1", providerId: "usai", apiProtocol: "openai-compatible", host: "gateway.example.test", baseUrl: "https://gateway.example.test/v1", modelsUrl: "https://gateway.example.test/v1/models", keyEnv: "USAI_API_KEY" }))
  await writeFile(path.join(directory, "discovery.json"), JSON.stringify(descriptor))
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ schemaVersion: "acq-neutral-model-catalog/v1", providerId: "usai", models: [] }))
  const filename = path.join(globalDir, "opencode.jsonc")
  await writeFile(filename, '{"theme":"preserve"}')
  const before = await readFile(filename)
  const spawnImpl = (executable, args, options) => {
    assert.equal(options.env.NODE_OPTIONS, undefined)
    assert.equal(options.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)
    assert.deepEqual(Object.keys(options.env).sort(), options.env.NODE_EXTRA_CA_CERTS ? ["NODE_EXTRA_CA_CERTS", "USAI_API_KEY"] : ["USAI_API_KEY"])
    return spawn(executable, ["--import", pathToFileURL(hook).href, ...args], options)
  }
  const credentials = { USAI_API_KEY: "synthetic-fixture", NODE_OPTIONS: "--not-allowed", NODE_TLS_REJECT_UNAUTHORIZED: "0" }
   await assert.rejects(prepareRuntimeModels(providerRoot, globalDir, { credentials, spawnImpl }), (error) => error.outcome?.failureClass === "hard" && error.outcome.reason === "tls")
  assert.deepEqual(await readFile(filename), before)
  assert.equal(requests.length, 0, "untrusted TLS must fail before authenticated HTTP")

  for (const value of [{ context: 1024, output: 64 }, { context: 1e20, output: 1e20 }, { context: 1e20, output: 64 }, { context: 1024, output: 1e20 }]) {
    limit = value
    const result = await prepareRuntimeModels(providerRoot, globalDir, { credentials: { ...credentials, NODE_EXTRA_CA_CERTS: ca }, spawnImpl })
    assert.equal(result.sourceOutcome, "live")
    assert.equal(result.metadataOutcome, "available-unverified")
    const config = parseJsonc(await readFile(filename, "utf8"))
    const model = config.provider.usai.models["gpt-5.2"]
    assert.ok(model, "unsafe metadata cannot discard valid membership")
    assert.equal(model.limit?.context, Number.isSafeInteger(value.context) ? value.context : undefined)
    // The existing renderer emits output only with a usable context limit.
    assert.equal(model.limit?.output, Number.isSafeInteger(value.context) && Number.isSafeInteger(value.output) ? value.output : undefined)
    assert.equal(config.theme, "preserve")
  }
  for (const request of requests) assert.equal(request.authorization, request.url === "/v1/models" ? "Bearer synthetic-fixture" : undefined)

  await assert.rejects(discoveryChildEnvironment({ NODE_EXTRA_CA_CERTS: "relative.pem" }), /CA path/)
  const link = path.join(root, "link.pem")
  await symlink(ca, link)
  await assert.rejects(discoveryChildEnvironment({ NODE_EXTRA_CA_CERTS: link }), /CA path/)
  await chmod(ca, 0o644)
  await assert.rejects(discoveryChildEnvironment({ NODE_EXTRA_CA_CERTS: ca }), /must not be writable/)
})
