// =============================================================================
// feed-fixture.test.mjs — the offline feed path must exclude non-chat models.
//
// Drives the documented offline pipeline through the committed fixtures, which
// is the path CI runs. non-chat-filter.test.mjs unit-tests the same rules with
// inline inputs.
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

const feedList = () => loadJson("models-list.json").data

test("the committed feed fixture CONTAINS non-chat models", () => {
  // Without these entries every exclusion branch is unreachable and this suite
  // passes vacuously.
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
  const feed = feedList()
  const expected = feed.map((m) => m.id).filter((id) => nonChatReason(id) === null)
  const { models } = shapeFromFeeds(feed, loadJson("models-dev.json"))

  assert.equal(models.length, expected.length)
  assert.deepEqual([...models.map((m) => m.id)].sort(), [...expected].sort())
})

test("an excluded-only vendor does not reach the vendor list", () => {
  const { vendorOrder } = shapeFromFeeds(feedList(), loadJson("models-dev.json"))
  assert.equal(vendorOrder.includes("cohere"), false)
})

test("a NEW underscore-delimited embedding id is excluded by the pattern", () => {
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
