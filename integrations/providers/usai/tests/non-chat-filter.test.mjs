// =============================================================================
// non-chat-filter.test.mjs — the gate that keeps unpromptable models out of a
// harness model block.
//
// Why this test exists: the USAi gateway serves chat and embedding models from
// one /v1/models list and its response carries no capability field (only id,
// created, object, owned_by). So "is this promptable?" is inferred here, and
// getting it wrong is not symmetric:
//
//   - a wrongly EXCLUDED chat model is a visible absence someone reports
//   - a wrongly INCLUDED embedding model ships as a selectable option that
//     fails opaquely at prompt time
//
// `cohere_english_v3` is the live proof of the second case: it does not announce
// itself in its id, passed the original pattern-only filter, and reached both
// shipped opencode.jsonc kits listed with limit/cost as though selectable. It
// answers POST /embeddings with a 1024-dim vector and POST /chat/completions
// with 403 AccessDeniedException.
//
// The regenerated-artifact tests elsewhere assert the EMITTED output matches the
// catalog. None of them exercises the gate itself, so the bootstrap-path filter
// could be deleted and every other test would stay green. This file covers the
// rules, not the rendering.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import {
  NON_CHAT_MODELS,
  bootstrapModelsFromBlock,
  nonChatReason,
  shapeFromFeeds,
} from "../scripts/build-catalog.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const CATALOG = path.join(USAI_DIR, "catalog.json")

test("every explicitly excluded id is rejected, and carries a reason", () => {
  const ids = Object.keys(NON_CHAT_MODELS)
  assert.ok(ids.length > 0, "the exclusion map must not be empty")
  for (const id of ids) {
    const reason = nonChatReason(id)
    assert.equal(typeof reason, "string")
    assert.ok(reason.length > 0, `${id} must record WHY it is excluded`)
    assert.equal(reason, NON_CHAT_MODELS[id], "the map's reason must be surfaced verbatim")
  }
})

test("cohere_english_v3 is excluded by exact id, not by pattern", () => {
  // The regression that motivated the exclusion map: its id contains no
  // embedding-ish token, so a pattern alone cannot catch it.
  assert.equal(/embedding|embed/.test("cohere_english_v3"), false)
  assert.ok(nonChatReason("cohere_english_v3"), "must still be excluded")
  assert.ok(Object.hasOwn(NON_CHAT_MODELS, "cohere_english_v3"))
})

test("the id pattern is substring, not word-boundary (default-deny)", () => {
  // A `\bembed\b` pattern would admit these. The asymmetric cost of the two
  // error directions means this net must stay wide; narrowing it silently
  // re-opens the exact hole the exclusion map exists to cover.
  for (const id of ["text-embed-v2", "embedded-retrieval", "embedding-gecko-001"]) {
    assert.ok(nonChatReason(id), `${id} must be excluded by the conservative pattern`)
  }
})

test("real chat models are NOT excluded", () => {
  // Guards against an over-greedy pattern: a false exclusion silently removes a
  // working model from every shipped config.
  const promptable = [
    "claude_4_5_haiku",
    "claude_4_8_opus",
    "claude-opus-5",
    "claude-sonnet-5",
    "gpt_5_2_default_v2",
    "gpt-5.6-luna",
    "gpt-5.6-sol-latest-guardrails-defaultv2",
    "gpt-5.6-terra",
    "gemini-2.5-pro",
    "gemini-3.8-flash",
    "llama_4_maverick",
  ]
  for (const id of promptable) {
    assert.equal(nonChatReason(id), null, `${id} must remain selectable`)
  }
})

test("every model in the committed catalog passes the gate", () => {
  // Closes the loop: the shipped catalog must contain nothing the gate rejects.
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"))
  for (const model of catalog.models) {
    assert.equal(
      nonChatReason(model.id, model.name),
      null,
      `${model.id} is in the catalog but the gate rejects it`,
    )
  }
})

test("the live-feed path drops non-chat models", () => {
  const usaiList = [
    { id: "claude-opus-5", owned_by: "Anthropic" },
    { id: "cohere_english_v3", owned_by: "Cohere" },
    { id: "text-embedding-005", owned_by: "Google" },
  ]
  const { models } = shapeFromFeeds(usaiList, null)
  assert.deepEqual(
    models.map((m) => m.id),
    ["claude-opus-5"],
  )
})

test("the BOOTSTRAP path drops non-chat models too", () => {
  // The bootstrap path reads the shipped config, which is how an already
  // committed non-chat model persists. Gating only the feed path would let a
  // regeneration reintroduce exactly what the feed excludes.
  const entries = [
    { id: "claude-opus-5", obj: { name: "Claude Opus 5" } },
    { id: "cohere_english_v3", obj: { name: "Cohere English v3" } },
    { id: "text-embedding-005", obj: { name: "Text Embedding 005" } },
  ]
  const { models } = bootstrapModelsFromBlock(entries)
  assert.deepEqual(
    models.map((m) => m.id),
    ["claude-opus-5"],
  )
})

test("an excluded model's vendor does not leak into the vendor list", () => {
  // cohere_english_v3 was the only Cohere entry; dropping it must drop the
  // vendor, or the catalog advertises a vendor with no usable models.
  const { models, vendorsSeen } = bootstrapModelsFromBlock([
    { id: "claude-opus-5", obj: { name: "Claude Opus 5" } },
    { id: "cohere_english_v3", obj: { name: "Cohere English v3" } },
  ])
  assert.deepEqual(
    models.map((m) => m.id),
    ["claude-opus-5"],
  )
  assert.equal(vendorsSeen.has("cohere"), false, "excluded-only vendors must not appear")
})

test("name is consulted, not just id", () => {
  // A gateway entry can carry an uninformative id and a descriptive name.
  assert.ok(nonChatReason("vendor-model-7", "Text Embedding Large"))
  assert.equal(nonChatReason("vendor-model-7", "Chat Model Large"), null)
})

test("nonChatReason tolerates a missing name", () => {
  assert.equal(nonChatReason("claude-opus-5"), null)
  assert.equal(nonChatReason("claude-opus-5", undefined), null)
  assert.ok(nonChatReason("text-embedding-005"))
})
