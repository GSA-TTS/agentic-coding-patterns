// =============================================================================
// matcher-precision.test.mjs — the models.dev enrichment matcher must refuse a
// near-miss instead of enriching a model with a DIFFERENT model's numbers.
//
// WHY THIS EXISTS. Scoring alone cannot reject a wrong candidate: it ranks
// whatever field it is handed, and the best of a bad field still wins. With
// only `claude-opus-5` / `claude-sonnet-5` present under the Anthropic
// provider, `claude_4_5_haiku` was enriched with OPUS numbers — context
// 1,000,000 and $5/$25 input/output, where the reviewed values are 200,000 and
// $1/$5. That is a 5x price overstatement presented as fact.
//
// Mis-enrichment is worse than missing data: the fields come out populated and
// plausible, so a completeness check ("every model has a price") PASSES while
// the values are wrong. The guard therefore fails closed — a model that cannot
// be matched precisely is emitted visibly unenriched.
//
// The fixtures here are INLINE and minimal, not the committed models-dev.json
// subset, so a future refresh of that subset cannot quietly turn a negative
// case positive. Each case states the two ids and nothing else relevant.
// =============================================================================

import assert from "node:assert/strict"
import { test } from "node:test"

import { findModelsDevMatch } from "../scripts/build-catalog.mjs"

// models.dev entries carry limit/cost; identity is all these cases turn on, so
// the payload is a marker we can assert travelled from the right entry.
const entry = (tag) => ({ limit: { context: 1, output: 1 }, cost: { input: 1 }, tag })

const catalogOf = (...ids) => Object.fromEntries(ids.map((id) => [id, entry(id)]))

// -----------------------------------------------------------------------------
// Negative cases: a DIFFERENT model must never be returned.
// -----------------------------------------------------------------------------

test("a haiku id does not match an opus entry (the 5x pricing defect)", () => {
  const catalog = catalogOf("anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude_4_5_haiku", catalog), null)
})

test("a haiku id does not match a sonnet entry", () => {
  const catalog = catalogOf("anthropic.claude-sonnet-5")
  assert.equal(findModelsDevMatch("claude_4_5_haiku", catalog), null)
})

test("tier is checked even when the whole field is wrong: haiku against opus AND sonnet", () => {
  const catalog = catalogOf("anthropic.claude-opus-5", "anthropic.claude-sonnet-5")
  assert.equal(findModelsDevMatch("claude_4_5_haiku", catalog), null)
})

test("version 4.5 does not match a bare version 5 of the same tier", () => {
  const catalog = catalogOf("claude-sonnet-5")
  assert.equal(findModelsDevMatch("claude_4_5_sonnet", catalog), null)
})

test("version 4.6 does not match a bare version 5 of the same tier", () => {
  const catalog = catalogOf("anthropic.claude-sonnet-5")
  assert.equal(findModelsDevMatch("claude_4_6_sonnet", catalog), null)
})

test("flash does not match pro at the same version", () => {
  const catalog = catalogOf("gemini-2.5-pro")
  assert.equal(findModelsDevMatch("gemini-2.5-flash", catalog), null)
})

test("flash-lite does not match plain flash at the same version", () => {
  const catalog = catalogOf("gemini-2.5-flash")
  assert.equal(findModelsDevMatch("gemini-2.5-flash-lite", catalog), null)
})

test("plain flash does not match flash-lite at the same version", () => {
  const catalog = catalogOf("gemini-2.5-flash-lite")
  assert.equal(findModelsDevMatch("gemini-2.5-flash", catalog), null)
})

test("a minor-version mismatch is refused (3.8 against 2.5)", () => {
  const catalog = catalogOf("gemini-2.5-flash")
  assert.equal(findModelsDevMatch("gemini-3.8-flash", catalog), null)
})

test("a gpt minor-version mismatch is refused (5.6 against 5.2)", () => {
  const catalog = catalogOf("gpt-5.2")
  assert.equal(findModelsDevMatch("gpt-5.6-luna", catalog), null)
})

test("an id absent from the source matches NOTHING rather than the nearest sibling", () => {
  // The decisive case: the matcher has no floor to fall back to. Before the
  // guard, every one of these returned claude-opus-5.
  const catalog = catalogOf("anthropic.claude-opus-5", "anthropic.claude-sonnet-5")
  for (const invented of ["claude_9_9_nonexistent", "claude-99-zzz", "claude_4_4_haiku"]) {
    assert.equal(findModelsDevMatch(invented, catalog), null, `${invented} must not match`)
  }
})

test("an empty enrichment source yields no match, not a throw", () => {
  assert.equal(findModelsDevMatch("claude_4_5_haiku", {}), null)
})

// -----------------------------------------------------------------------------
// Positive controls: the legitimate normalizations MUST keep working. These are
// the reason the guard is an eligibility filter and not simply exact-match.
// -----------------------------------------------------------------------------

test("gateway deployment suffixes are still stripped (gpt_5_5_default_v2 -> gpt-5.5)", () => {
  const catalog = catalogOf("gpt-5.5")
  assert.equal(findModelsDevMatch("gpt_5_5_default_v2", catalog)?.id, "gpt-5.5")
})

test("the llama4 glue-split still matches the Bedrock form", () => {
  const catalog = catalogOf("meta.llama4-maverick-17b-instruct-v1:0")
  assert.equal(
    findModelsDevMatch("llama_4_maverick", catalog)?.id,
    "meta.llama4-maverick-17b-instruct-v1:0",
  )
})

test("a provider-prefixed entry still matches its unprefixed gateway id", () => {
  const catalog = catalogOf("anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "anthropic.claude-opus-5")
})

test("underscore and dot version spellings are equivalent (gemini-3-7 / gemini-3.7)", () => {
  const catalog = catalogOf("gemini-3.7-flash")
  assert.equal(findModelsDevMatch("gemini-3-7-flash", catalog)?.id, "gemini-3.7-flash")
})

test("a dated SKU still matches its generation when tier and major.minor agree", () => {
  const catalog = catalogOf("anthropic.claude-3-5-sonnet-20241022")
  assert.equal(
    findModelsDevMatch("claude_3_5_sonnet", catalog)?.id,
    "anthropic.claude-3-5-sonnet-20241022",
  )
})

test("an exact id matches itself", () => {
  const catalog = catalogOf("gemini-3.5-flash")
  assert.equal(findModelsDevMatch("gemini-3.5-flash", catalog)?.id, "gemini-3.5-flash")
})

// -----------------------------------------------------------------------------
// Ranking among candidates that ALL pass the guard. The guard decides
// eligibility; the score only breaks ties between duplicate listings of the
// same model, so these must still resolve the way they did before.
// -----------------------------------------------------------------------------

test("the plain generation is preferred over a dated SKU of the same model", () => {
  const catalog = catalogOf("anthropic.claude-opus-5", "anthropic.claude-opus-5-20260101")
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "anthropic.claude-opus-5")
})

test("a us/global regional listing is preferred over eu/au for the same model", () => {
  const catalog = catalogOf(
    "eu.anthropic.claude-opus-5",
    "au.anthropic.claude-opus-5",
    "us.anthropic.claude-opus-5",
  )
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "us.anthropic.claude-opus-5")
})

test("an unprefixed listing beats a regional one for the same model", () => {
  const catalog = catalogOf("us.anthropic.claude-opus-5", "anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "anthropic.claude-opus-5")
})

test("a modality sibling loses to the chat model even though both pass the guard", () => {
  const catalog = catalogOf("gemini-2.5-flash", "gemini-2.5-flash-tts")
  assert.equal(findModelsDevMatch("gemini-2.5-flash", catalog)?.id, "gemini-2.5-flash")
})

test("the returned payload comes from the entry that was actually selected", () => {
  const catalog = catalogOf("anthropic.claude-opus-5", "eu.anthropic.claude-opus-5")
  const match = findModelsDevMatch("claude-opus-5", catalog)
  assert.equal(match?.data.tag, "anthropic.claude-opus-5")
})
