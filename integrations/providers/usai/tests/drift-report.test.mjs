// =============================================================================
// drift-report.test.mjs — the report formatter and the offline check behind the
// scheduled catalog-drift workflow. Offline, fixtures and a temporary root only.
// =============================================================================

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { ISSUE_LABEL, ISSUE_TITLE, formatDriftReport, stateFromExitCode } from "../scripts/drift-report.mjs"
import { runOfflineCheck } from "../scripts/offline-check.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAI_DIR = path.resolve(HERE, "..")
const REPO_ROOT = path.resolve(USAI_DIR, "../../..")
const REPORT_SCRIPT = path.join(USAI_DIR, "scripts/drift-report.mjs")

test("exit codes map to ok, drift and failed", () => {
  assert.equal(stateFromExitCode(0), "ok")
  assert.equal(stateFromExitCode(1), "drift")
  for (const code of [2, 3, 127, 255]) assert.equal(stateFromExitCode(code), "failed")
})

test("no drift: PASS for the offline check, live comparison BLOCKED, no issue", () => {
  const report = formatDriftReport({ exitCode: 0, output: "catalog: up to date\n" })
  assert.equal(report.state, "ok")
  assert.equal(report.shouldReport, false)
  assert.match(report.markdown, /Offline check: \*\*PASS\*\*/)
  assert.match(report.markdown, /Live comparison: \*\*BLOCKED\*\*/)
  assert.doesNotMatch(report.markdown, /Live comparison: \*\*PASS/)
  assert.doesNotMatch(report.markdown, /### What to do/)
})

test("drift: names the output, asks for a maintainer refresh, and files an issue", () => {
  const output = "catalog: DRIFT (x)\n  - models added: gemini-9-flash\n"
  const report = formatDriftReport({ exitCode: 1, output, runUrl: "https://github.com/o/r/actions/runs/1" })
  assert.equal(report.state, "drift")
  assert.equal(report.shouldReport, true)
  assert.match(report.markdown, /Offline check: \*\*DRIFT\*\*/)
  assert.match(report.markdown, /models added: gemini-9-flash/)
  assert.match(report.markdown, /make refresh-usai-catalog-check/)
  assert.match(report.markdown, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/1/)
  assert.match(report.markdown, /Nothing was committed, pushed or opened/)
  assert.equal(report.issueTitle, ISSUE_TITLE)
  assert.equal(report.issueLabel, "catalog-drift")
  assert.equal(ISSUE_LABEL, "catalog-drift")
})

test("fetch failure: FAILED live comparison, never drift and never 'no drift'", () => {
  const report = formatDriftReport({
    exitCode: 0,
    output: "ok\n",
    live: { state: "failed", reason: "gateway returned 503\nsecond line" },
  })
  assert.equal(report.state, "ok", "a fetch failure is not a drift result")
  assert.equal(report.shouldReport, true, "a fetch failure is reported")
  assert.match(report.markdown, /Live comparison: \*\*FAILED\*\* \(fetch failed: gateway returned 503 second line\)/)
  assert.match(report.markdown, /not a drift result and not a pass/)
  assert.doesNotMatch(report.markdown, /BLOCKED/)
})

test("a check that could not run is FAILED and reported", () => {
  const report = formatDriftReport({ exitCode: 2, output: "offline check failed: boom\n" })
  assert.equal(report.state, "failed")
  assert.equal(report.shouldReport, true)
  assert.match(report.markdown, /Offline check: \*\*FAILED\*\*/)
})

test("check output cannot break out of its fence or grow without bound", () => {
  const hostile = "~~~~\n## injected heading\n[x](https://example.invalid)\n"
  const { markdown } = formatDriftReport({ exitCode: 1, output: hostile })
  const fence = /^(~+)text$/m.exec(markdown)[1]
  assert.ok(fence.length > 4, "the fence is longer than any ~ run in the output")
  assert.ok(markdown.includes(`\n${fence}\n`), "the fence is closed")
  const big = formatDriftReport({ exitCode: 1, output: "x".repeat(100_000) })
  assert.ok(big.markdown.length < 25_000)
  assert.match(big.markdown, /\(truncated\)/)
})

test("CLI: writes the summary and issue body, and the step outputs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "usai-drift-report-"))
  try {
    writeFileSync(path.join(dir, "out.txt"), "catalog: DRIFT\n  - models removed: a\n")
    const args = [
      REPORT_SCRIPT,
      "--exit-code", "1",
      "--output-file", path.join(dir, "out.txt"),
      "--summary", path.join(dir, "summary.md"),
      "--issue-body", path.join(dir, "body.md"),
      "--github-output", path.join(dir, "gh-output"),
    ]
    const run = spawnSync(process.execPath, args, { encoding: "utf8", env: { PATH: process.env.PATH } })
    assert.equal(run.status, 0, run.stderr)
    assert.match(readFileSync(path.join(dir, "summary.md"), "utf8"), /models removed: a/)
    assert.equal(readFileSync(path.join(dir, "body.md"), "utf8"), readFileSync(path.join(dir, "summary.md"), "utf8"))
    assert.equal(readFileSync(path.join(dir, "gh-output"), "utf8"), "state=drift\nreport=true\n")
    const bad = spawnSync(process.execPath, [REPORT_SCRIPT, "--exit-code", "x"], { encoding: "utf8" })
    assert.equal(bad.status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the offline check passes on the committed repository", () => {
  const { status, lines } = runOfflineCheck({ root: REPO_ROOT })
  assert.equal(status, 0, lines.join("\n"))
  assert.match(lines.join("\n"), /neutral-snapshot: up to date/)
})

test("the offline check reports a snapshot that no longer matches the catalog", () => {
  const root = mkdtempSync(path.join(tmpdir(), "usai-offline-root-"))
  try {
    const rels = [
      "integrations/providers/usai/refresh-registry.json",
      "integrations/providers/usai/catalog.schema.json",
      "integrations/providers/usai/catalog.json",
      "integrations/providers/usai/scripts/refresh.mjs",
      "integrations/providers/usai/scripts/build-catalog.mjs",
      "integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs",
      "integrations/isolation/acq-kits/usai-provider/files/home/usai-config/model-catalog-snapshot.json",
      "integrations/providers/usai/tests/fixtures/refresh/usai-models.json",
      "integrations/providers/usai/tests/fixtures/refresh/models-dev.json",
      "integrations/providers/usai/tests/fixtures/refresh/pull.json",
      "integrations/providers/usai/tests/fixtures/refresh/artifacts/catalog.json",
      "integrations/providers/usai/tests/fixtures/refresh/artifacts/snapshot.json",
    ]
    for (const rel of rels) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      cpSync(path.join(REPO_ROOT, rel), path.join(root, rel))
    }
    assert.equal(runOfflineCheck({ root }).status, 0)

    const snapshot = path.join(root, rels[6])
    writeFileSync(snapshot, readFileSync(snapshot, "utf8").replace("claude", "claudx"))
    const drifted = runOfflineCheck({ root })
    assert.equal(drifted.status, 1, drifted.lines.join("\n"))
    assert.match(drifted.lines.join("\n"), /neutral-snapshot: DRIFT/)

    // Fixture drift: the builder no longer reproduces the fixture artifact.
    writeFileSync(snapshot, readFileSync(path.join(REPO_ROOT, rels[6]), "utf8"))
    const fixtureSnapshot = path.join(root, rels[11])
    writeFileSync(fixtureSnapshot, readFileSync(fixtureSnapshot, "utf8").replace("claude", "claudx"))
    const fixtureDrift = runOfflineCheck({ root })
    assert.equal(fixtureDrift.status, 1, fixtureDrift.lines.join("\n"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a broken refresh script is reported as 'could not run' (exit 2), not as drift (exit 1)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "usai-offline-broken-"))
  try {
    const scripts = path.join(root, "integrations/providers/usai/scripts")
    mkdirSync(scripts, { recursive: true })
    cpSync(path.join(USAI_DIR, "scripts/offline-check.mjs"), path.join(scripts, "offline-check.mjs"))
    writeFileSync(path.join(scripts, "refresh.mjs"), "export const x = (\n")
    const run = spawnSync(process.execPath, [path.join(scripts, "offline-check.mjs"), "--root", root], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    })
    assert.equal(run.status, 2, run.stderr)
    assert.match(run.stderr, /cannot load the refresh tooling/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
