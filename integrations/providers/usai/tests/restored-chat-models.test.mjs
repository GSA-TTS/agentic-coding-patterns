import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { shapeFromFeeds } from "../scripts/build-catalog.mjs"
import { updateTemplate as updateAcq } from "../../../isolation/acq-kits/usai-provider/scripts/sync-usai-models.mjs"
import { updateTemplate as updateSbx } from "../../../isolation/sbx-kits/usai-provider-kit/scripts/sync-usai-models.mjs"

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

for (const [name, update] of [["acq", updateAcq], ["sbx", updateSbx]]) {
  test(`${name} sync includes restored chat deployments but excludes embeddings`, () => {
    const template = readFileSync(new URL(
      "../../../isolation/acq-kits/usai-provider/files/home/usai-config/opencode.jsonc",
      import.meta.url,
    ), "utf8")
    const { models } = update(template, payload)
    assert.deepEqual(models.map((model) => model.id).sort(), [...restored].sort())
  })
}
