import assert from "node:assert/strict"
import { test } from "node:test"

import { shapeFromFeeds } from "../scripts/build-catalog.mjs"

const restored = [
  "gpt-6-luna",
  "gpt-6-sol-latest-guardrails-defaultv2",
  "gpt-6.1-sol-latest-guardrails-defaultv2",
]
const embeddings = ["cohere_english_v3", "text-embedding-005"]
const payload = {
  data: [...restored, ...embeddings].map((id) => ({
    id, object: "model", created: 1, owned_by: "OpenAI",
  })),
}

test("catalog includes restored chat deployments but excludes embeddings", () => {
  const { models } = shapeFromFeeds(payload.data, {})
  assert.deepEqual(models.map((model) => model.id).sort(), [...restored].sort())
})
