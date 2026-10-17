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

test("profile-qualified models do not match their base siblings", () => {
  const catalog = catalogOf("gpt-5.2-codex", "gpt-5.2-max")
  assert.equal(findModelsDevMatch("gpt-5.2", catalog), null)
  assert.equal(findModelsDevMatch("gpt-5.2-codex", catalog)?.id, "gpt-5.2-codex")
  assert.equal(findModelsDevMatch("gpt-5.2-max", catalog)?.id, "gpt-5.2-max")
})

// -----------------------------------------------------------------------------
// UNRECOGNIZED qualifiers. The decisive property: the guard must not depend on
// knowing a qualifier's name.
//
// An earlier version of this guard compared a hard-coded list (`codex`, `mini`,
// `nano`, `max`). Anything outside that list was invisible to it, so a
// qualified gateway id collapsed onto its base model and inherited that
// sibling's limits and pricing — recreating the exact defect the guard exists
// to prevent, for every qualifier the list did not happen to name.
//
// The names below are deliberately INVENTED. A test using a real qualifier
// would pass the moment someone adds that token to a list, which is the failure
// mode being guarded against; an invented token can only pass if identity
// comparison is genuinely closed over unknown input.
// -----------------------------------------------------------------------------

test("an unrecognized qualifier does not match the bare base model", () => {
  // Each of these matched its base before identity comparison failed closed.
  for (const [qualified, base] of [
    ["gpt-5.2-luna", "gpt-5.2"],
    ["claude-opus-5-thinking", "claude-opus-5"],
    ["gemini-2.5-flash-preview", "gemini-2.5-flash"],
  ]) {
    assert.equal(findModelsDevMatch(qualified, catalogOf(base)), null, `${qualified} must not match ${base}`)
  }
})

test("a bare base model does not match an unrecognized-qualifier entry", () => {
  // The reverse direction: the wrong-way match is just as damaging, because the
  // base model is the one most likely to be requested.
  for (const [base, qualified] of [
    ["gpt-5.2", "gpt-5.2-luna"],
    ["claude-opus-5", "claude-opus-5-thinking"],
  ]) {
    assert.equal(findModelsDevMatch(base, catalogOf(qualified)), null, `${base} must not match ${qualified}`)
  }
})

test("two different unrecognized qualifiers do not match each other", () => {
  const catalog = catalogOf("gpt-5.2-luna")
  assert.equal(findModelsDevMatch("gpt-5.2-solstice", catalog), null)
})

test("an unrecognized qualifier still matches its own exact entry", () => {
  // Failing closed must not mean failing always: when the source really does
  // list the qualified model, it has to be found.
  const catalog = catalogOf("gpt-5.2-luna", "gpt-5.2")
  assert.equal(findModelsDevMatch("gpt-5.2-luna", catalog)?.id, "gpt-5.2-luna")
  assert.equal(findModelsDevMatch("gpt-5.2", catalog)?.id, "gpt-5.2")
})

test("an unrecognized qualifier is not rescued by a provider prefix or region", () => {
  // Noise normalization must not accidentally strip the qualifier along with
  // the parts that genuinely carry no identity.
  const catalog = catalogOf("us.anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude-opus-5-thinking", catalog), null)
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

test("a cohere provider prefix and marketplace revision stay packaging noise", () => {
  const catalog = catalogOf("cohere.command-r-plus-v1:0")
  assert.equal(findModelsDevMatch("command-r-plus", catalog)?.id, "cohere.command-r-plus-v1:0")
})

test("a dated Bedrock SKU still matches when v1:0 follows the date", () => {
  const catalog = catalogOf("anthropic.claude-opus-4-5-20251101-v1:0")
  assert.equal(
    findModelsDevMatch("claude_4_5_opus", catalog)?.id,
    "anthropic.claude-opus-4-5-20251101-v1:0",
  )
})

test("provider and revision words are noise only in their packaging positions", () => {
  assert.equal(findModelsDevMatch("gpt-5", catalogOf("gpt-5-anthropic")), null)
  assert.equal(findModelsDevMatch("gpt-5-preview", catalogOf("gpt-5-v1:0-preview")), null)
  assert.equal(findModelsDevMatch("gpt-5", catalogOf("eu.gpt-5"))?.id, "eu.gpt-5")
  assert.equal(findModelsDevMatch("gpt-5", catalogOf("gpt-5-v1:0"))?.id, "gpt-5-v1:0")
})

test("a provider-prefixed entry still matches its unprefixed gateway id", () => {
  const catalog = catalogOf("anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "anthropic.claude-opus-5")
})

test("a dated gpt-4o SKU still matches its undated gateway id", () => {
  const catalog = catalogOf("gpt-4o-2024-08-06")
  assert.equal(findModelsDevMatch("gpt-4o", catalog)?.id, "gpt-4o-2024-08-06")
})

test("a dated gateway id matches only the same calendar date", () => {
  const catalog = catalogOf("gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20")
  assert.equal(findModelsDevMatch("gpt-4o-2024-08-06", catalog)?.id, "gpt-4o-2024-08-06")
  assert.equal(findModelsDevMatch("gpt-4o-2024-08-07", catalog), null)
})

test("basic and extended forms of the same valid date are equivalent", () => {
  const catalog = catalogOf("anthropic.claude-3-5-sonnet-20241022")
  assert.equal(
    findModelsDevMatch("claude-3-5-sonnet-2024-10-22", catalog)?.id,
    "anthropic.claude-3-5-sonnet-20241022",
  )
})

test("a leap day is accepted only in a leap year", () => {
  assert.equal(
    findModelsDevMatch("gpt-4o-2024-02-29", catalogOf("gpt-4o-20240229"))?.id,
    "gpt-4o-20240229",
  )
  assert.equal(findModelsDevMatch("gpt-4o-2025-02-29", catalogOf("gpt-4o-20250228")), null)
})

test("invalid date-shaped suffixes remain identity-bearing and fail closed", () => {
  for (const invalid of ["2025-02-29", "2024-13-01", "20240230"]) {
    const qualified = `claude-3-5-sonnet-${invalid}`
    assert.equal(findModelsDevMatch(qualified, catalogOf("claude-3-5-sonnet")), null)
    assert.equal(findModelsDevMatch("claude-3-5-sonnet", catalogOf(qualified)), null)
    assert.equal(findModelsDevMatch(qualified, catalogOf(qualified))?.id, qualified)
  }
})

test("numeric qualifiers beyond major.minor remain ordered identity", () => {
  for (const [gateway, catalog] of [
    ["claude-3-5-sonnet-99", "claude-3-5-sonnet"],
    ["claude-3-5-sonnet-2024023", "claude-3-5-sonnet"],
    ["claude-3-5-sonnet-202402290", "claude-3-5-sonnet"],
    ["claude-3-5-sonnet-2024-1-01", "claude-3-5-sonnet-2025-2-02"],
    ["claude-3-5-sonnet-123", "claude-3-5-sonnet-456"],
  ]) {
    assert.equal(findModelsDevMatch(gateway, catalogOf(catalog)), null, `${gateway} must not match ${catalog}`)
  }
})

test("large numeric identity tokens compare without Number precision loss", () => {
  assert.equal(
    findModelsDevMatch("gpt-5-2-9007199254740992", catalogOf("gpt-5-2-9007199254740993")),
    null,
  )
  assert.equal(
    findModelsDevMatch("gpt-999999999999999999999-1", catalogOf("gpt-999999999999999999998-1")),
    null,
  )
})

test("unknown identity residue preserves token order and multiplicity", () => {
  assert.equal(findModelsDevMatch("gpt-5.2-luna", catalogOf("gpt-5.2-luna-luna")), null)
  assert.equal(findModelsDevMatch("gpt-5.2-luna-solstice", catalogOf("gpt-5.2-solstice-luna")), null)
  assert.equal(findModelsDevMatch("gpt-5-mini", catalogOf("gpt-5-mini-mini")), null)
  assert.equal(findModelsDevMatch("gpt-5", catalogOf("gpt-gpt-5")), null)
})

test("an eu-prefixed entry still matches when it is the only exact-identity candidate", () => {
  const catalog = catalogOf("eu.anthropic.claude-opus-5")
  assert.equal(findModelsDevMatch("claude-opus-5", catalog)?.id, "eu.anthropic.claude-opus-5")
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

test("an undated entry beats dated aliases in either insertion order", () => {
  for (const ids of [
    ["anthropic.claude-opus-5-20260101", "anthropic.claude-opus-5"],
    ["anthropic.claude-opus-5", "anthropic.claude-opus-5-20260101"],
  ]) {
    assert.equal(findModelsDevMatch("claude-opus-5", catalogOf(...ids))?.id, "anthropic.claude-opus-5")
  }
})

test("the latest valid dated alias wins in either insertion order", () => {
  for (const ids of [
    ["gpt-4o-2024-08-06", "gpt-4o-2024-11-20"],
    ["gpt-4o-2024-11-20", "gpt-4o-2024-08-06"],
  ]) {
    assert.equal(findModelsDevMatch("gpt-4o", catalogOf(...ids))?.id, "gpt-4o-2024-11-20")
  }
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

test("modality qualifiers are identity-bearing and fail closed both ways", () => {
  assert.equal(findModelsDevMatch("gemini-2.5-flash", catalogOf("gemini-2.5-flash-tts")), null)
  assert.equal(findModelsDevMatch("gemini-2.5-flash-tts", catalogOf("gemini-2.5-flash")), null)
  assert.equal(
    findModelsDevMatch("gemini-2.5-flash-tts", catalogOf("gemini-2.5-flash-tts"))?.id,
    "gemini-2.5-flash-tts",
  )
})

test("the returned payload comes from the entry that was actually selected", () => {
  const catalog = catalogOf("anthropic.claude-opus-5", "eu.anthropic.claude-opus-5")
  const match = findModelsDevMatch("claude-opus-5", catalog)
  assert.equal(match?.data.tag, "anthropic.claude-opus-5")
})
