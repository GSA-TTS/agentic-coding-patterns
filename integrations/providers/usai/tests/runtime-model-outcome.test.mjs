import test from "node:test"
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { createServer } from "node:http"
import { runtimeFailure, failureOutcome, parseFailure, requestFailure, FAILURE_BYTES } from "../scripts/runtime-model-outcome.mjs"
import { requestJson } from "../scripts/runtime-model-discovery.mjs"

const url = "https://gateway.example.test/v1/models"
const canary = "synthetic-private-token-header-url-path-digest-canary"
const coded = (code, cause) => Object.assign(new Error(canary, cause ? { cause } : undefined), { code })
const outcome = (error) => failureOutcome(error)
const response = (status, finalUrl = url, redirected = false) => {
  const result = new Response(canary, { status, headers: { "content-type": "application/json", "x-canary": canary } })
  Object.defineProperties(result, { url: { value: finalUrl }, redirected: { value: redirected } })
  return result
}
const request = (fetchImpl, extra = {}) => requestJson(url, { fetchImpl, limit: 1024, deadline: performance.now() + 1000, trustedProvider: true, ...extra })
function classified(failureClass, reason) {
  return (error) => {
    const value = outcome(error)
    assert.equal(value.failureClass, failureClass)
    if (reason) assert.equal(value.reason, reason)
    assert.equal(JSON.stringify(value).includes(canary), false)
    assert.equal(String(error).includes(canary), false)
    return true
  }
}

test("closed versioned failure envelope refuses spoofing, fields, duplicates and size", () => {
  const error = runtimeFailure("membership", "connection")
  const text = JSON.stringify(outcome(error))
  assert.deepEqual(outcome(parseFailure(text)), outcome(error))
  assert.equal(outcome(Object.assign(new Error(canary), { outcome: outcome(error) })).failureClass, "hard")
  for (const invalid of [
    text.replace('"failure"', '"success"'), text.replace('/v1', '/v2'),
    text.replace('"connection"', '"tls"'), text.replace('"membership"', '"input"'),
    text.replace('"failureClass":"transient"', '"failureClass":"hard"'),
    text.slice(0, -1) + ',"extra":"' + canary + '"}',
    text.slice(0, -1) + ',"reason":"connection"}',
    text.slice(0, -1) + ',"\\u0072eason":"connection"}',
    text + " ".repeat(FAILURE_BYTES), "null", "[]", '{"outcome":"failure"}',
  ]) assert.throws(() => parseFailure(invalid))
  for (const [key, original] of Object.entries(outcome(error))) {
    for (const value of [[original], {}, null, 1, true]) {
      assert.throws(() => parseFailure(JSON.stringify({ ...outcome(error), [key]: value })))
    }
  }
  for (const value of [["membership"], {}, new String("membership"), null, 1, "__proto__", "constructor", "toString"]) {
    assert.throws(() => runtimeFailure(value, "connection"))
    assert.throws(() => runtimeFailure("membership", value))
    if (!(value instanceof String)) assert.throws(() => parseFailure(JSON.stringify({ ...outcome(error), stage: value })))
  }
  const coercible = { toString() { assert.fail("must not coerce internal kind or stage") } }
  assert.throws(() => runtimeFailure(coercible, "connection"))
  assert.throws(() => runtimeFailure("membership", coercible))
})

test("network classification uses bounded code evidence, never exception prose; hard wins", () => {
  for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]) {
    assert.equal(outcome(requestFailure(coded(code))).failureClass, "transient")
    assert.equal(outcome(requestFailure(new TypeError(canary, { cause: coded(code) }))).reason, "connection")
  }
  for (const error of [
    new Error("ECONNRESET 429 503 request timeout " + canary),
    { name: "RuntimeFailure", failureClass: "transient", reason: "connection" },
    coded("ENOTFOUND"), coded("EACCES", coded("ECONNRESET")),
    new AggregateError([coded("ECONNRESET"), new Error(canary)]),
    Object.assign(coded("ECONNRESET"), { name: "CertificateError" }),
  ]) assert.equal(outcome(requestFailure(error)).failureClass, "hard")
  for (const code of ["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_SSL_WRONG_VERSION_NUMBER"]) {
    for (const error of [coded(code, coded("ECONNRESET")), coded("ECONNRESET", coded(code)), new AggregateError([coded("ETIMEDOUT"), coded(code)])]) {
      const controller = new AbortController(); controller.abort()
      assert.equal(outcome(requestFailure(error, controller.signal.reason)).reason, "tls")
      assert.equal(JSON.stringify(outcome(requestFailure(error))).includes(canary), false)
    }
  }
  const cyclic = coded("ECONNRESET"); cyclic.cause = cyclic
  assert.equal(outcome(requestFailure(cyclic)).failureClass, "hard")
  let deep = coded("ECONNRESET")
  for (let i = 0; i < 20; i++) deep = new Error(canary, { cause: deep })
  assert.equal(outcome(requestFailure(deep)).failureClass, "hard")
})

test("abort evidence is identity-bound and unknown or mismatched names stay hard", () => {
  const controller = new AbortController(); controller.abort()
  const reason = controller.signal.reason
  const wrapper = Object.assign(new Error(canary, { cause: reason }), { name: "AbortError", code: "ABORT_ERR" })
  for (const error of [reason, wrapper, new TypeError(canary, { cause: reason })]) {
    assert.equal(outcome(requestFailure(error, reason)).reason, "request-abort")
  }
  for (const error of [
    new Error(canary), new AggregateError([coded("ECONNRESET"), new Error(canary)]),
    new AggregateError([reason, new Error(canary)]), coded("ECONNRESET", new Error(canary)),
    new Error(canary, { cause: new AggregateError([reason, new Error(canary)]) }),
    new DOMException(canary, "AbortError"),
    Object.assign(new Error(canary), { name: "AbortError" }),
    Object.assign(new Error(canary), { name: "AbortError", code: "ABORT_ERR" }),
    Object.assign(new Error(canary), { name: "AbortError", code: 20 }),
    { name: "AbortError", code: "ABORT_ERR", cause: reason },
    Object.assign(new Error(canary), { aborted: true, abortReason: reason }),
    Object.assign(coded("ECONNRESET"), { name: "TimeoutError" }),
    Object.assign(coded("ECONNRESET"), { name: "AbortError" }),
  ]) {
    assert.equal(outcome(requestFailure(error, reason)).failureClass, "hard")
    assert.equal(outcome(requestFailure(error, true)).failureClass, "hard")
  }
  for (const [code, name] of Object.entries({ UND_ERR_CONNECT_TIMEOUT: "ConnectTimeoutError", UND_ERR_HEADERS_TIMEOUT: "HeadersTimeoutError", UND_ERR_BODY_TIMEOUT: "BodyTimeoutError", UND_ERR_SOCKET: "SocketError" })) {
    const error = Object.assign(coded(code), { name })
    assert.equal(outcome(requestFailure(error)).reason, "connection")
    assert.equal(outcome(requestFailure(new TypeError(canary, { cause: error }))).reason, "connection")
    assert.equal(outcome(requestFailure(Object.assign(coded("ECONNRESET"), { name }))).failureClass, "hard")
    for (const other of ["ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError", "SocketError"].filter((value) => value !== name)) {
      assert.equal(outcome(requestFailure(Object.assign(coded(code), { name: other }))).failureClass, "hard")
    }
    assert.equal(outcome(requestFailure(Object.assign(coded(code), { name: "CertificateError" }))).failureClass, "hard")
    assert.equal(outcome(requestFailure(new AggregateError([error, reason, new Error(canary)]), reason)).failureClass, "hard")
    assert.equal(outcome(requestFailure(new AggregateError([error, reason, coded("CERT_HAS_EXPIRED")]), reason)).reason, "tls")
  }
})

test("native fetch loopback refusal, socket body failure and controller abort preserve actual error shapes", { timeout: 10000 }, async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/body") {
      response.writeHead(200, { "content-type": "application/json", "content-length": "100" })
      response.write('{"data":')
      // Destroy only after fetch has returned headers and the test starts reading.
      bodyResponse = response
      return
    }
    observedRequest()
  })
  let bodyResponse, observedRequest
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections()
    if (server.listening) server.close(resolve)
    else resolve()
  }))
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(base + "/body")
  const body = response.arrayBuffer()
  bodyResponse.destroy()
  await assert.rejects(body, (error) => {
    assert.equal(error.cause?.code, "UND_ERR_SOCKET")
    assert.equal(error.cause?.name, "SocketError")
    assert.equal(outcome(requestFailure(error)).reason, "connection")
    return true
  })
  const controller = new AbortController()
  const observed = new Promise((resolve) => { observedRequest = resolve })
  const pending = fetch(base + "/abort", { signal: controller.signal })
  const rejected = assert.rejects(pending, (error) => {
    assert.equal(error, controller.signal.reason)
    assert.equal(outcome(requestFailure(error, controller.signal.reason)).reason, "request-abort")
    return true
  })
  await observed
  controller.abort()
  await rejected
  // A fresh, closed listener avoids a stale pooled socket masking refusal.
  const refused = createServer()
  await new Promise((resolve) => refused.listen(0, "127.0.0.1", resolve))
  const refusedUrl = `http://127.0.0.1:${refused.address().port}/refused`
  await new Promise((resolve) => refused.close(resolve))
  await assert.rejects(fetch(refusedUrl), (error) => {
    assert.equal(error.cause?.code, "ECONNREFUSED")
    assert.equal(outcome(requestFailure(error)).reason, "connection")
    return true
  })
})

test("only trusted exact-origin HTTP 429 and 5xx are transient", async () => {
  for (const status of [429, 500, 502, 503, 599]) {
    await assert.rejects(request(async () => response(status)), classified("transient", status === 429 ? "provider-throttled" : "provider-unavailable"))
    for (const finalUrl of ["", "https://other.example.test/" + canary, url + "?" + canary]) {
      await assert.rejects(request(async () => response(status, finalUrl)), classified("hard", "response-identity"))
    }
    await assert.rejects(request(async () => response(status, url, true)), classified("hard", "response-identity"))
    await assert.rejects(request(async () => response(status), { trustedProvider: false }), classified("hard", "http-refused"))
  }
  for (const status of [301, 400, 401, 403, 404, 408]) await assert.rejects(request(async () => response(status)), classified("hard"))
})

test("mock fetch errors and explicit request abort are distinct from JSON/body integrity", async () => {
  await assert.rejects(request(async () => { throw coded("ECONNRESET") }), classified("transient", "connection"))
  await assert.rejects(request(async () => { throw new Error("429 ETIMEDOUT " + canary) }), classified("hard", "unknown"))
  await assert.rejects(request(async () => { throw coded("ECONNRESET", coded("CERT_HAS_EXPIRED")) }), classified("hard", "tls"))
  await assert.rejects(request(async () => { throw new DOMException(canary, "AbortError") }), classified("hard", "unknown"))
  await assert.rejects(request(async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error(canary)), { once: true })
  }), { deadline: performance.now() + 20 }), classified("hard", "unknown"))
  await assert.rejects(request(async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }), { deadline: performance.now() + 20 }), classified("transient", "request-abort"))
  for (const [makeError, expected] of [
    [(reason) => Object.assign(new Error(canary, { cause: reason }), { name: "AbortError", code: "ABORT_ERR" }), "request-abort"],
    [() => new AggregateError([coded("ECONNRESET"), new Error(canary)]), "unknown"],
    [(reason) => new AggregateError([reason, new Error(canary)]), "unknown"],
    [(reason) => new AggregateError([reason, coded("ECONNRESET"), coded("CERT_HAS_EXPIRED")]), "tls"],
    [() => Object.assign(new Error(canary), { name: "AbortError", code: "ABORT_ERR", aborted: true }), "unknown"],
  ]) {
    await assert.rejects(request(async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(makeError(signal.reason)), { once: true })
    }), { deadline: performance.now() + 20 }), classified(expected === "request-abort" ? "transient" : "hard", expected))
  }
  for (const body of ['{"data":', '{"data":[],"data":[]}', '{"__proto__":{}}', '"' + "x".repeat(1025) + '"']) {
    await assert.rejects(request(async () => new Response(body, { headers: { "content-type": "application/json" } })), classified("hard", "invalid-response"))
  }
  await assert.rejects(request(async () => ({ status: 200, url, headers: new Headers({ "content-type": "application/json" }), body: {
    async *[Symbol.asyncIterator]() { yield Buffer.from('{"data":'); throw coded("ECONNRESET") },
  } })), classified("hard", "invalid-response"))
  await assert.rejects(request(async () => response(503), { deadline: performance.now() - 1 }), classified("hard", "parent-deadline"))
})
