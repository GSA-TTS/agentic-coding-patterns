// =============================================================================
// feed-fixture.test.mjs — the OFFLINE feed path must exclude non-chat models.
//
// Why this file is separate from non-chat-filter.test.mjs: that one unit-tests
// the gate's rules with inline inputs. This one drives the whole documented
// offline pipeline end to end through the COMMITTED fixtures, which is the path
// a contributor and CI actually run:
//
//   build-catalog.mjs --models-url tests/fixtures/models-list.json \
//                     --models-dev tests/fixtures/models-dev.json
//
// The fixture carries the two real embedding models the live gateway serves
// (cohere_english_v3, text-embedding-005) in the gateway's own response shape,
// so the exclusion branches are reachable here. Before that entry existed the
// fixture held only promptable models, which left `excluded.push(...)`,
// `reportExclusions`, and the bootstrap-path `continue` dead in CI — a safety
// filter nothing executed.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { nonChatReason, shapeFromFeeds } from "../scripts/build-catalog.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, "fixtures")

const loadJson = (file) => JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8"))

/** The gateway returns {object, data:[...]}; mirror how the CLI unwraps it. */
const feedList = () => loadJson("models-list.json").data

test("the committed feed fixture CONTAINS non-chat models", () => {
  // Load-bearing: without these entries every exclusion branch is unreachable
  // and this suite would pass vacuously. Assert the fixture's own fitness first.
  const ids = feedList().map((m) => m.id)
  const nonChat = ids.filter((id) => nonChatReason(id) !== null)
  assert.ok(
    nonChat.length >= 2,
    `fixture must exercise the exclusion path; found ${nonChat.length} non-chat ids`,
  )
  assert.ok(nonChat.includes("cohere_english_v3"), "the exact-id case must be covered")
  assert.ok(nonChat.includes("text-embedding-005"), "the id-pattern case must be covered")
})

test("fixture entries use the gateway's real response shape", () => {
  // A fixture that drifts from the live shape tests the wrong thing. The live
  // /v1/models response carries exactly these four fields and no capability
  // field, which is the whole reason the gate has to infer promptability.
  for (const entry of feedList()) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["created", "id", "object", "owned_by"],
      `${entry.id} must match the gateway's field set`,
    )
    assert.equal(entry.object, "model")
  }
})

test("shapeFromFeeds drops every non-chat model from the fixture", () => {
  const { models } = shapeFromFeeds(feedList(), loadJson("models-dev.json"))
  const ids = models.map((m) => m.id)

  assert.equal(ids.includes("cohere_english_v3"), false, "excluded by exact id")
  assert.equal(ids.includes("text-embedding-005"), false, "excluded by id pattern")
  for (const id of ids) {
    assert.equal(nonChatReason(id), null, `${id} survived the feed path but the gate rejects it`)
  }
})

test("shapeFromFeeds keeps every promptable fixture model", () => {
  // The complement: the filter must not over-reach. A false exclusion silently
  // removes a working model from every shipped config.
  const feed = feedList()
  const expected = feed.map((m) => m.id).filter((id) => nonChatReason(id) === null)
  const { models } = shapeFromFeeds(feed, loadJson("models-dev.json"))

  assert.equal(models.length, expected.length)
  assert.deepEqual([...models.map((m) => m.id)].sort(), [...expected].sort())
})

test("an excluded-only vendor does not reach the vendor list", () => {
  // cohere_english_v3 is the fixture's only Cohere entry, so Cohere must vanish
  // rather than appear as a vendor with no selectable models.
  const { vendorOrder } = shapeFromFeeds(feedList(), loadJson("models-dev.json"))
  assert.equal(vendorOrder.includes("cohere"), false)
})

test("a NEW underscore-delimited embedding id is excluded by the pattern", () => {
  // Regression guard for the \b narrowing: `_` is a word char, so `\bembed\b`
  // matches no underscore-delimited id — and that is the gateway's own
  // convention for most ids. A future titan_embed_text_v2 must be excluded by
  // default, which is the secondary net's entire purpose.
  const feed = [
    ...feedList(),
    { id: "titan_embed_text_v2", created: 1, object: "model", owned_by: "Amazon" },
    { id: "cohere_embed_v4", created: 2, object: "model", owned_by: "Cohere" },
  ]
  const { models } = shapeFromFeeds(feed, loadJson("models-dev.json"))
  const ids = models.map((m) => m.id)

  assert.equal(ids.includes("titan_embed_text_v2"), false)
  assert.equal(ids.includes("cohere_embed_v4"), false)
})
