// =============================================================================
// legacy-isolation.test.mjs — the provider-owned renderers under emitters/ are
// legacy. They must never become a default refresh step, and the committed
// catalog must carry no reference to the removed bootstrap source.
// =============================================================================

import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), "utf8")
const EMITTERS = readdirSync(path.join(USAI_DIR, "emitters")).filter((name) => name.endsWith(".mjs"))

test("every emitter is labelled legacy in its header", () => {
  assert.deepEqual(EMITTERS.sort(), ["opencode.mjs"])
  for (const name of EMITTERS) {
    const head = read(`integrations/providers/usai/emitters/${name}`).split("\n").slice(0, 3).join("\n")
    assert.match(head, /LEGACY/, name)
  }
})

test("the refresh and builder scripts never import or spawn an emitter", () => {
  for (const script of ["refresh.mjs", "build-catalog.mjs"]) {
    const text = read(`integrations/providers/usai/scripts/${script}`)
    assert.doesNotMatch(text, /from\s+["'][^"']*emitters/, script)
    assert.doesNotMatch(text, /import\s*\([^)]*emitters/, script)
    assert.doesNotMatch(text, /require\s*\([^)]*emitters/, script)
    assert.doesNotMatch(text, /--legacy/, `${script} has no legacy flag, so no legacy step can be default`)
  }
})

test("the refresh Make targets run only refresh.mjs", () => {
  const makefile = read("Makefile")
  const recipes = makefile.split("\n").filter((line, i, lines) => {
    const target = lines.slice(0, i + 1).reverse().find((l) => /^[A-Za-z0-9_.-]+:/.test(l))
    return target?.startsWith("refresh-usai-catalog") && line.startsWith("\t")
  })
  assert.ok(recipes.length >= 2, "expected the refresh and refresh-check recipes")
  for (const line of recipes) {
    assert.match(line, /providers\/usai\/scripts\/refresh\.mjs/)
    assert.doesNotMatch(line, /emitters|legacy|prime/i)
  }
})

test("no non-test code anywhere under integrations/ imports an emitter", () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "tests") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(mjs|js|cjs)$/.test(entry.name) && /usai\/emitters\/|\.\/emitters\//.test(readFileSync(full, "utf8")))
        offenders.push(path.relative(REPO_ROOT, full))
    }
  }
  walk(path.join(REPO_ROOT, "integrations"))
  // The emitters' own headers name their sibling paths; they are not importers.
  assert.deepEqual(offenders.filter((file) => !file.includes(`${path.sep}emitters${path.sep}`)), [])
})

test("catalog.json and its schema carry no reference to a removed bootstrap source", () => {
  const catalog = JSON.parse(read("integrations/providers/usai/catalog.json"))
  assert.ok(!("bootstrappedFrom" in catalog.sources))
  for (const [key, value] of Object.entries(catalog.sources)) {
    assert.doesNotMatch(`${key} ${value}`, /bootstrap|opencode-.*\.jsonc/i, key)
  }
  assert.doesNotMatch(read("integrations/providers/usai/catalog.schema.json"), /bootstrap/i)
})
