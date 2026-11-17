import test from "node:test"
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
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
      assert.equal(outcome(requestFailure(error, true)).reason, "tls")
      assert.equal(JSON.stringify(outcome(requestFailure(error))).includes(canary), false)
    }
  }
  const cyclic = coded("ECONNRESET"); cyclic.cause = cyclic
  assert.equal(outcome(requestFailure(cyclic)).failureClass, "hard")
  let deep = coded("ECONNRESET")
  for (let i = 0; i < 20; i++) deep = new Error(canary, { cause: deep })
  assert.equal(outcome(requestFailure(deep)).failureClass, "hard")
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
  }), { deadline: performance.now() + 20 }), classified("transient", "request-abort"))
  await assert.rejects(request(async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }), { deadline: performance.now() + 20 }), classified("transient", "request-abort"))
  for (const body of ['{"data":', '{"data":[],"data":[]}', '{"__proto__":{}}', '"' + "x".repeat(1025) + '"']) {
    await assert.rejects(request(async () => new Response(body, { headers: { "content-type": "application/json" } })), classified("hard", "invalid-response"))
  }
  await assert.rejects(request(async () => ({ status: 200, url, headers: new Headers({ "content-type": "application/json" }), body: {
    async *[Symbol.asyncIterator]() { yield Buffer.from('{"data":'); throw coded("ECONNRESET") },
  } })), classified("hard", "invalid-response"))
  await assert.rejects(request(async () => response(503), { deadline: performance.now() - 1 }), classified("hard", "parent-deadline"))
})
