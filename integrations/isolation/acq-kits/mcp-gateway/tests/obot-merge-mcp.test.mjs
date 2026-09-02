import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  stripJsonc,
  parseJsonc,
  deepMerge,
  mcpFragment,
  computeOutput,
} from "../files/home/obot-merge-mcp.mjs"

test("stripJsonc: removes comments but preserves // inside string URLs", () => {
  const input = `{
    // a line comment
    "url": "http://example.com/mcp-connect/x/mcp", /* block */
    "n": 1,
  }`
  const parsed = JSON.parse(stripJsonc(input))
  assert.equal(parsed.url, "http://example.com/mcp-connect/x/mcp")
  assert.equal(parsed.n, 1)
})

test("parseJsonc: parses JSONC with trailing comma", () => {
  assert.deepEqual(parseJsonc(`{ "a": 1, }`), { a: 1 })
})

test("deepMerge: source wins, objects merge recursively, arrays replace", () => {
  const base = { a: 1, o: { x: 1, y: 2 }, arr: [1, 2] }
  const src = { a: 2, o: { y: 3, z: 4 }, arr: [9] }
  assert.deepEqual(deepMerge(base, src), {
    a: 2,
    o: { x: 1, y: 3, z: 4 },
    arr: [9],
  })
})

test("mcpFragment: builds the remote entry with a Bearer {env:VAR} header", () => {
  const f = mcpFragment("cdc-places", "http://gw/mcp-connect/ms1frnfd/mcp", "OBOT_TOKEN")
  assert.deepEqual(f, {
    mcp: {
      "cdc-places": {
        type: "remote",
        url: "http://gw/mcp-connect/ms1frnfd/mcp",
        enabled: true,
        headers: { Authorization: "Bearer {env:OBOT_TOKEN}" },
      },
    },
  })
})

test("computeOutput: fresh write when no existing config", () => {
  const f = mcpFragment("cdc-places", "http://gw/mcp-connect/x/mcp", "OBOT_TOKEN")
  const { output, merged } = computeOutput(f, [])
  assert.equal(merged, false)
  const parsed = JSON.parse(output)
  assert.equal(parsed.mcp["cdc-places"].url, "http://gw/mcp-connect/x/mcp")
})

test("computeOutput: merges into existing config, preserving foreign keys", () => {
  const existing = [
    {
      path: "opencode.jsonc",
      text: `{
        // pre-existing
        "model": "usai/claude-opus-5",
        "mcp": { "grep": { "type": "remote", "url": "https://grep.app/mcp", "enabled": true } }
      }`,
    },
  ]
  const f = mcpFragment("cdc-places", "http://gw/mcp-connect/x/mcp", "OBOT_TOKEN")
  const { output, merged } = computeOutput(f, existing)
  assert.equal(merged, true)
  const parsed = JSON.parse(output)
  assert.equal(parsed.model, "usai/claude-opus-5")
  assert.equal(parsed.mcp.grep.url, "https://grep.app/mcp")
  assert.equal(parsed.mcp["cdc-places"].headers.Authorization, "Bearer {env:OBOT_TOKEN}")
})

test("computeOutput: idempotent re-run updates url for the same entry name", () => {
  const first = computeOutput(
    mcpFragment("cdc-places", "http://gw/mcp-connect/OLD/mcp", "OBOT_TOKEN"),
    [],
  ).output
  const { output } = computeOutput(
    mcpFragment("cdc-places", "http://gw/mcp-connect/NEW/mcp", "OBOT_TOKEN"),
    [{ path: "opencode.jsonc", text: first }],
  )
  const parsed = JSON.parse(output)
  assert.equal(parsed.mcp["cdc-places"].url, "http://gw/mcp-connect/NEW/mcp")
  // still exactly one entry (no duplication)
  assert.deepEqual(Object.keys(parsed.mcp), ["cdc-places"])
})

test("end-to-end: script writes opencode.jsonc into a temp global dir", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-gateway-test-"))
  const globalDir = path.join(dir, ".config", "opencode")
  await mkdir(globalDir, { recursive: true })
  // seed a foreign key to prove it survives
  await writeFile(path.join(globalDir, "opencode.jsonc"), `{ "model": "keep-me" }\n`)

  const { spawnSync } = await import("node:child_process")
  const script = path.resolve("files/home/obot-merge-mcp.mjs")
  const r = spawnSync(process.execPath, [
    script,
    "--global-dir", globalDir,
    "--name", "cdc-places",
    "--url", "http://gw/mcp-connect/ms1frnfd/mcp",
    "--token-env", "OBOT_TOKEN",
  ])
  assert.equal(r.status, 0, r.stderr?.toString())
  const written = JSON.parse(await readFile(path.join(globalDir, "opencode.jsonc"), "utf8"))
  assert.equal(written.model, "keep-me")
  assert.equal(written.mcp["cdc-places"].url, "http://gw/mcp-connect/ms1frnfd/mcp")
})
