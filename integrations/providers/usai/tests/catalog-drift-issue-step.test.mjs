// =============================================================================
// catalog-drift-issue-step.test.mjs — runs the REAL shell block of the
// "Open or update the tracking issue" step against a stub `gh`.
//
// The block must edit an open issue only when its title is EXACTLY the stable
// title, create one when none matches, and refuse when several match. A fuzzy
// search hit with a different title is never edited.
//
// The workflow is .github/workflows/catalog-drift.yml, or the file named by
// CATALOG_DRIFT_WORKFLOW when that is set (to check a candidate before it lands).
// The file must exist: a missing workflow fails the test.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { parseYamlSubset } from "./helpers/yaml-subset.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const WORKFLOW = process.env.CATALOG_DRIFT_WORKFLOW
  ? path.resolve(process.cwd(), process.env.CATALOG_DRIFT_WORKFLOW)
  : path.join(REPO_ROOT, ".github", "workflows", "catalog-drift.yml")
const STEP_NAME = "Open or update the tracking issue"
const TITLE = "Provider catalog drift report"

const STUB = `#!/bin/bash
# stub gh: records mutating calls, answers "issue list" from STUB_LIST_JSON
case "$1 $2" in
  "label create") exit 0 ;;
  "issue list") printf '%s' "$STUB_LIST_JSON" ;;
  "issue edit") echo "issue edit $3" >> "$STUB_LOG" ;;
  "issue create") echo "issue create" >> "$STUB_LOG" ;;
  *) echo "unexpected gh call: $*" >> "$STUB_LOG"; exit 9 ;;
esac
`

function stepBlock() {
  assert.ok(existsSync(WORKFLOW), `the drift workflow is missing: ${WORKFLOW}`)
  const doc = parseYamlSubset(readFileSync(WORKFLOW, "utf8"))
  const step = doc.jobs.report.steps.find((candidate) => candidate.name === STEP_NAME)
  assert.ok(step && typeof step.run === "string", `step "${STEP_NAME}" not found`)
  assert.equal(step.env.ISSUE_TITLE, TITLE)
  return step.run
}

function runStep(listed) {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-issue-step-"))
  try {
    writeFileSync(path.join(dir, "gh"), STUB)
    chmodSync(path.join(dir, "gh"), 0o755)
    writeFileSync(path.join(dir, "body.md"), "body\n")
    const log = path.join(dir, "log.txt")
    writeFileSync(log, "")
    const result = spawnSync("bash", ["-c", stepBlock()], {
      encoding: "utf8",
      env: {
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        STUB_LIST_JSON: JSON.stringify(listed),
        STUB_LOG: log,
        ISSUE_TITLE: TITLE,
        ISSUE_LABEL: "catalog-drift",
        BODY_FILE: path.join(dir, "body.md"),
        GH_TOKEN: "not-a-real-token",
      },
    })
    return { status: result.status, stderr: result.stderr, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("an exact-title match is edited", () => {
  const run = runStep([{ number: 7, title: TITLE }])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls, ["issue edit 7"])
})

test("a near-miss title is never edited; a new issue is created", () => {
  for (const title of [`${TITLE} (old)`, `Re: ${TITLE}`, TITLE.toLowerCase(), `${TITLE} `]) {
    const run = runStep([{ number: 9, title }])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.calls, ["issue create"], title)
  }
})

test("only the exact match is edited when near-misses come first", () => {
  const run = runStep([
    { number: 3, title: `${TITLE} v2` },
    { number: 4, title: TITLE },
  ])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls, ["issue edit 4"])
})

test("several exact matches: refuse, edit and create nothing", () => {
  const run = runStep([
    { number: 4, title: TITLE },
    { number: 5, title: TITLE },
  ])
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Refusing to edit: 2 open issues/)
  assert.deepEqual(run.calls, [])
})

test("no match: a new issue is created", () => {
  const run = runStep([])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls, ["issue create"])
})
