// Closed failure-only wire protocol. Success API/CLI shapes remain unchanged.
import { boundedJson, record } from "./runtime-model-bounds.mjs"

export const FAILURE_VERSION = "acq-runtime-model-outcome/v1"
export const FAILURE_BYTES = 1024
const reasons = Object.freeze({
  input: ["invalid-input", "hard"],
  trust: ["invalid-trust", "hard"],
  authentication: ["authentication", "hard"],
  identity: ["response-identity", "hard"],
  tls: ["tls", "hard"],
  http: ["http-refused", "hard"],
  response: ["invalid-response", "hard"],
  unknown: ["unknown", "hard"],
  throttled: ["provider-throttled", "transient"],
  unavailable: ["provider-unavailable", "transient"],
  connection: ["connection", "transient"],
  abort: ["request-abort", "transient"],
  protocol: ["child-protocol", "hard"],
  crash: ["child-crash", "hard"],
  deadline: ["parent-deadline", "hard"],
  lock: ["lock", "hard"],
  render: ["render", "hard"],
})
const stages = Object.freeze({
  input: ["input"], trust: ["trust"],
  membership: ["authentication", "identity", "tls", "http", "response", "unknown", "throttled", "unavailable", "connection", "abort"],
  child: ["protocol", "crash"], preparation: ["deadline", "lock", "render", "unknown"],
})
const failures = new WeakMap()

export function runtimeFailure(stage, kind) {
  if (!stages[stage]?.includes(kind)) throw new Error("invalid internal failure kind")
  const [reason, failureClass] = reasons[kind]
  const outcome = Object.freeze({ schemaVersion: FAILURE_VERSION, outcome: "failure", stage, reason, failureClass })
  const error = new Error(`bounded discovery / preparation failed: ${reason}`)
  Object.defineProperty(error, "outcome", { value: outcome, enumerable: true })
  failures.set(error, outcome)
  return error
}

// Never trust an exception's name, message, outcome property or nested cause as
// a wire envelope. Only errors minted in this module carry internal authority.
export function failureOutcome(error, stage = "preparation", kind = "unknown") {
  return failures.get(error) ?? failures.get(runtimeFailure(stage, kind))
}

export function preserveRuntimeFailure(error, stage, kind) {
  return failures.has(error) ? error : runtimeFailure(stage, kind)
}

export function parseFailure(text) {
  const value = record(boundedJson(text, FAILURE_BYTES))
  const keys = ["schemaVersion", "outcome", "stage", "reason", "failureClass"]
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)) ||
      value.schemaVersion !== FAILURE_VERSION || value.outcome !== "failure") throw runtimeFailure("child", "protocol")
  const kind = stages[value.stage]?.find((key) => reasons[key][0] === value.reason && reasons[key][1] === value.failureClass)
  if (!kind) throw runtimeFailure("child", "protocol")
  return runtimeFailure(value.stage, kind)
}

// Called ONLY at the request I/O boundary, not around decoding, parsing or
// validation. Inspect a bounded cause graph; any unrecognized code/type, TLS
// evidence, cycle or excessive graph defeats all transient evidence.
export function requestFailure(error, aborted = false) {
  const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"])
  const pending = [error], seen = new Set()
  let transient = false, hard = false, tls = false
  try {
    while (pending.length) {
      const item = pending.pop()
      if (!item || typeof item !== "object" || seen.has(item) || seen.size >= 16) { hard = true; continue }
      seen.add(item)
      const code = item.code
      if (typeof code === "string" && /^(?:ERR_TLS_|ERR_SSL_|CERT_|DEPTH_|SELF_SIGNED_|UNABLE_TO_)/.test(code)) tls = true
      if (code !== undefined) {
        if (codes.has(code)) transient = true
        else if (!(aborted && (code === "ABORT_ERR" || (code === 20 && item.name === "AbortError")))) hard = true
      }
      if (!["Error", "TypeError", "AggregateError", "AbortError", "TimeoutError"].includes(item.name)) hard = true
      if (item.cause !== undefined) pending.push(item.cause)
      if (item.errors !== undefined) {
        if (!Array.isArray(item.errors) || item.errors.length > 16) hard = true
        else pending.push(...item.errors)
      }
      if (code === undefined && item.cause === undefined && !item.errors?.length && !aborted) hard = true
    }
  } catch { hard = true }
  if (tls) return runtimeFailure("membership", "tls")
  if (hard) return runtimeFailure("membership", "unknown")
  if (aborted) return runtimeFailure("membership", "abort")
  return runtimeFailure("membership", transient ? "connection" : "unknown")
}
