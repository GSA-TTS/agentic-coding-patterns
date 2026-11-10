// =============================================================================
// runbook.test.mjs — every command in integrations/providers/README.md is real.
//
// Each fenced `bash` line must be a `make <target>` that exists in the
// Makefile, a `node <path>` whose script exists, or a read-only `git` command
// from a short allowlist. Every repository path named in backticks, and every
// relative markdown link, must exist. A runbook that names a command or a file
// that is gone is worse than none.
// =============================================================================

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const RUNBOOK = path.join(REPO_ROOT, "integrations/providers/README.md")
const GIT_ALLOWED = new Set(["git diff --stat"])

const text = readFileSync(RUNBOOK, "utf8")
const makefile = readFileSync(path.join(REPO_ROOT, "Makefile"), "utf8")
const makeTargets = new Set([...makefile.matchAll(/^([A-Za-z0-9_.-]+):/gm)].map((m) => m[1]))

function fencedBlocks(source) {
  return [...source.matchAll(/^[ \t]*```(\w*)[^\n]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => ({ lang: m[1], body: m[2] }))
}

function commandLines() {
  return fencedBlocks(text)
    .filter((block) => block.lang === "bash")
    .flatMap((block) => block.body.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))
}

test("the runbook has command blocks to check", () => {
  assert.ok(commandLines().length >= 5)
})

test("every fenced command is a real make target, an existing script, or an allowed git command", () => {
  for (const line of commandLines()) {
    const [tool, ...rest] = line.split(/\s+/)
    if (tool === "make") {
      assert.ok(makeTargets.has(rest[0]), `no Makefile target "${rest[0]}" for: ${line}`)
    } else if (tool === "node") {
      assert.ok(rest[0] && !rest[0].startsWith("-"), `node needs a script path: ${line}`)
      assert.ok(existsSync(path.join(REPO_ROOT, rest[0])), `script not found: ${rest[0]}`)
    } else if (tool === "git") {
      assert.ok(GIT_ALLOWED.has(line), `git command not allowed in the runbook: ${line}`)
    } else {
      assert.fail(`unrecognized command: ${line}`)
    }
  }
})

test("flags used with refresh.mjs are accepted by the script", () => {
  const script = readFileSync(path.join(REPO_ROOT, "integrations/providers/usai/scripts/refresh.mjs"), "utf8")
  for (const line of commandLines().filter((l) => l.includes("scripts/refresh.mjs"))) {
    for (const flag of line.match(/--[a-z-]+/g) ?? []) assert.ok(script.includes(`"${flag}"`), `refresh.mjs has no ${flag}`)
  }
})

test("every repository path named in backticks exists", () => {
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
  const candidates = inline.filter(
    (token) => /^[A-Za-z0-9_.@-]+(\/[A-Za-z0-9_.@-]+)+\/?$/.test(token) || /^[A-Za-z0-9_.-]+\.(mjs|json|md|yml)$/.test(token),
  )
  assert.ok(candidates.length >= 5)
  const searchRoots = [REPO_ROOT, path.dirname(RUNBOOK), path.join(REPO_ROOT, "integrations/providers/usai"), path.join(REPO_ROOT, "integrations/providers/usai/tests")]
  for (const token of candidates) {
    if (/^(models\/providers|snapshot\.json|facts\.json)/.test(token)) continue // paths inside a projected sandbox, not in this repository
    if (token === "catalog.json" || /\/v\d+$/.test(token)) continue // a file in the examples, or a schema id
    const found = searchRoots.some((root) => existsSync(path.join(root, token)))
    assert.ok(found, `path named in the runbook does not exist: ${token}`)
  }
})

test("every relative markdown link resolves", () => {
  const links = [...text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].map((m) => m[1].split("#")[0])
  assert.ok(links.length >= 3)
  for (const link of links) assert.ok(existsSync(path.resolve(path.dirname(RUNBOOK), link)), `broken link: ${link}`)
})

test("the runbook carries no tracker numbers and no credential value", () => {
  assert.doesNotMatch(text, /(?:^|[\s(])#\d{2,}\b/, "no bare issue or PR numbers in a durable doc")
  assert.doesNotMatch(text, /GSA-TTS\/[\w-]+#\d+/)
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|USAI_API_KEY\s*=/)
})
