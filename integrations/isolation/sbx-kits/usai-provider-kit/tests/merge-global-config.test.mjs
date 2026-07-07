import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  stripJsonc,
  parseJsonc,
  deepMerge,
  computeOutput,
} from "../files/home/usai-config/merge-global-config.mjs"

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(
  new URL("../files/home/usai-config/merge-global-config.mjs", import.meta.url),
)
const kitConfigPath = fileURLToPath(
  new URL("../files/home/usai-config/opencode.jsonc", import.meta.url),
)

test("stripJsonc removes line and block comments but preserves URLs in strings", () => {
  const input = `{
    // a line comment
    "url": "https://api.example.gov/v1", /* trailing block */
    "n": 1, // another
  }`
  const parsed = JSON.parse(stripJsonc(input))
  assert.equal(parsed.url, "https://api.example.gov/v1")
  assert.equal(parsed.n, 1)
})

test("stripJsonc does not strip // sequences inside string values", () => {
  const parsed = parseJsonc('{"a": "x // not a comment", "b": "/* also not */"}')
  assert.equal(parsed.a, "x // not a comment")
  assert.equal(parsed.b, "/* also not */")
})

test("parseJsonc parses the shipped kit config", async () => {
  const text = await readFile(kitConfigPath, "utf8")
  const cfg = parseJsonc(text)
  assert.ok(cfg.provider?.usai, "provider.usai present")
  assert.match(cfg.model, /^usai\//)
})

test("deepMerge: source wins, unrelated keys preserved, conflicts recorded", () => {
  const base = { model: "openai/gpt-4", theme: "dark", provider: { foo: { npm: "x" } } }
  const source = { model: "usai/claude", provider: { usai: { npm: "y" } } }
  const conflicts = []
  const merged = deepMerge(base, source, conflicts)

  assert.equal(merged.model, "usai/claude") // source wins
  assert.equal(merged.theme, "dark") // unrelated preserved
  assert.equal(merged.provider.foo.npm, "x") // existing provider preserved
  assert.equal(merged.provider.usai.npm, "y") // kit provider added
  assert.deepEqual(conflicts, ["model"]) // only the real overwrite
})

test("deepMerge: identical leaf is not reported as a conflict", () => {
  const conflicts = []
  deepMerge({ model: "usai/x" }, { model: "usai/x" }, conflicts)
  assert.deepEqual(conflicts, [])
})

test("computeOutput: no existing config copies verbatim (comments preserved)", async () => {
  const sourceText = await readFile(kitConfigPath, "utf8")
  const { output, merged, conflicts } = computeOutput(sourceText, [])
  assert.equal(merged, false)
  assert.equal(output, sourceText)
  assert.deepEqual(conflicts, [])
  assert.match(output, /usai-provider-kit:owns-opencode-config/)
})

test("computeOutput: existing config merges, USAi provider survives, foreign key kept", async () => {
  const sourceText = await readFile(kitConfigPath, "utf8")
  const existing = [
    { path: "/g/opencode.jsonc", text: '{"theme": "gruvbox", "keybinds": {"leader": "ctrl+x"}}' },
  ]
  const { output, merged, conflicts } = computeOutput(sourceText, existing)
  assert.equal(merged, true)
  const parsed = JSON.parse(output)
  assert.equal(parsed.theme, "gruvbox") // foreign key preserved
  assert.equal(parsed.keybinds.leader, "ctrl+x")
  assert.ok(parsed.provider.usai, "USAi provider merged in")
  assert.match(parsed.model, /^usai\//)
  assert.deepEqual(conflicts, []) // no overlapping leaves
  // Merge branch emits JSON — comments dropped.
  assert.doesNotMatch(output, /owns-opencode-config/)
})

test("computeOutput: conflicting top-level model is overridden and reported", async () => {
  const sourceText = await readFile(kitConfigPath, "utf8")
  const existing = [{ path: "/g/opencode.json", text: '{"model": "openai/gpt-4o"}' }]
  const { output, conflicts } = computeOutput(sourceText, existing)
  const parsed = JSON.parse(output)
  assert.match(parsed.model, /^usai\//)
  assert.ok(conflicts.includes("model"))
})

test("computeOutput: multiple existing files merge in precedence order", async () => {
  const sourceText = '{"model": "usai/x"}'
  const existing = [
    { path: "/g/config.json", text: '{"theme": "a", "shared": "from-config"}' },
    { path: "/g/opencode.json", text: '{"shared": "from-opencode"}' },
  ]
  const { output } = computeOutput(sourceText, existing)
  const parsed = JSON.parse(output)
  assert.equal(parsed.theme, "a")
  assert.equal(parsed.shared, "from-opencode") // later global file wins over earlier
  assert.equal(parsed.model, "usai/x") // kit wins overall
})

// End-to-end: run the script against a temp dir.
test("script copies when global dir is empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usai-merge-copy-"))
  const globalDir = path.join(dir, ".config", "opencode")
  await execFileAsync("node", [
    scriptPath,
    "--source",
    kitConfigPath,
    "--global-dir",
    globalDir,
  ])
  const written = await readFile(path.join(globalDir, "opencode.jsonc"), "utf8")
  assert.match(written, /owns-opencode-config/) // verbatim copy keeps marker
})

test("script merges when a global config already exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usai-merge-merge-"))
  const globalDir = path.join(dir, ".config", "opencode")
  await mkdir(globalDir, { recursive: true })
  await writeFile(path.join(globalDir, "opencode.jsonc"), '{"theme": "solarized"}')

  const { stderr } = await execFileAsync("node", [
    scriptPath,
    "--source",
    kitConfigPath,
    "--global-dir",
    globalDir,
  ])
  const written = await readFile(path.join(globalDir, "opencode.jsonc"), "utf8")
  const parsed = JSON.parse(written)
  assert.equal(parsed.theme, "solarized")
  assert.ok(parsed.provider.usai)
  // theme did not conflict, so no warning expected.
  assert.doesNotMatch(stderr, /warning/)
})
