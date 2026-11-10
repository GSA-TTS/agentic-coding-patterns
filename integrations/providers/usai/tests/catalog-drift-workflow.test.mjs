// =============================================================================
// catalog-drift-workflow.test.mjs — policy test for the scheduled, offline-only
// drift workflow (see docs/decisions/0004-offline-catalog-drift-workflow.md).
//
// The test parses the workflow and asserts it can only read, only on a schedule
// or by hand, and only ever writes one thing: a tracking issue.
//
// Where the file comes from:
//   - .github/workflows/catalog-drift.yml, which must exist: a missing file
//     FAILS the test.
//   - CATALOG_DRIFT_WORKFLOW=<path> runs the same policy against one more file,
//     so a reviewer can check a candidate before it is committed:
//       CATALOG_DRIFT_WORKFLOW=tmp/catalog-drift.yml node --test tests/catalog-drift-workflow.test.mjs
// The checker itself is also proven against a built-in good workflow and a set
// of mutations, which always run.
// =============================================================================

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { parseYamlSubset } from "./helpers/yaml-subset.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const COMMITTED = path.join(REPO_ROOT, ".github", "workflows", "catalog-drift.yml")
const ALLOWED_TRIGGERS = ["schedule", "workflow_dispatch"]
const REPORT_JOB = "report"
const SHA_PIN = /^[^@\s]+@[0-9a-f]{40}$/

const GOOD = `name: Catalog Drift (offline)
on:
  schedule:
    - cron: '17 6 * * 1'
  workflow_dispatch:
permissions: {}
jobs:
  offline-check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Check
        env:
          VALUE: \${{ github.run_id }}
        run: |
          node integrations/providers/usai/scripts/offline-check.mjs
          echo "$VALUE"
  report:
    needs: offline-check
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Issue
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh issue list
`

/** Return a list of policy violations (empty when the workflow is acceptable). */
export function workflowViolations(text) {
  const problems = []
  let doc
  try {
    doc = parseYamlSubset(text)
  } catch (error) {
    return [`workflow does not parse: ${error.message}`]
  }
  const triggers = doc?.on && typeof doc.on === "object" ? Object.keys(doc.on) : []
  if (triggers.length === 0) problems.push("no triggers found")
  for (const trigger of triggers) {
    if (!ALLOWED_TRIGGERS.includes(trigger)) problems.push(`disallowed trigger: ${trigger}`)
  }
  if (!triggers.includes("schedule")) problems.push("missing the schedule trigger")
  if (/pull_request_target/.test(text)) problems.push("mentions pull_request_target")

  if (JSON.stringify(doc?.permissions) !== "{}") problems.push("workflow-level permissions must be {}")
  if (/\bwrite-all\b|\bcontents:\s*write\b/.test(text)) problems.push("contents: write (or write-all) is not allowed")
  if (/\bsecrets\b|USAI_API_KEY|GITHUB_TOKEN\s*:/.test(text)) problems.push("references a secret or a credential name")

  const jobs = doc?.jobs && typeof doc.jobs === "object" ? Object.entries(doc.jobs) : []
  if (jobs.length === 0) problems.push("no jobs found")
  for (const [name, job] of jobs) {
    const permissions = job?.permissions
    if (!permissions || typeof permissions !== "object") {
      problems.push(`job ${name}: permissions must be declared`)
    } else {
      for (const [scope, level] of Object.entries(permissions)) {
        if (level === "write" && scope !== "issues") problems.push(`job ${name}: ${scope}: write is not allowed`)
        if (level === "write" && scope === "issues" && Object.keys(permissions).length !== 1) {
          problems.push(`job ${name}: issues: write must be the only permission`)
        }
        if (level === "write" && scope === "issues" && name !== REPORT_JOB) {
          problems.push(`job ${name}: issues: write is only allowed on the ${REPORT_JOB} job`)
        }
      }
    }
    for (const [index, step] of (job?.steps ?? []).entries()) {
      const where = `job ${name} step ${index + 1}`
      if (step.uses !== undefined) {
        if (!SHA_PIN.test(step.uses)) problems.push(`${where}: action is not pinned to a commit SHA: ${step.uses}`)
        if (/^actions\/checkout@/.test(step.uses) && step.with?.["persist-credentials"] !== false) {
          problems.push(`${where}: checkout must set persist-credentials: false`)
        }
      }
      if (typeof step.run === "string") {
        if (/\$\{\{/.test(step.run)) problems.push(`${where}: an expression is interpolated into a run: string`)
        if (/\bgit\s+(push|commit|tag|add)\b/.test(step.run)) problems.push(`${where}: runs a git write command`)
        if (/\bgh\s+pr\b|\bgh\s+issue\s+(close|delete|lock)\b/.test(step.run)) {
          problems.push(`${where}: runs a gh command outside open-or-update issue`)
        }
        for (const call of step.run.match(/\bgh\s+api\b[^\n|]*/g) ?? []) {
          if (/\s(-X|--method|-f|-F|--field|--raw-field|--input)\b/.test(call) || !/--paginate\b/.test(call)) {
            problems.push(`${where}: gh api is allowed only as a read-only --paginate listing`)
          }
        }
        if (/curl|wget|\bnpm\s+(i|install)\b|pip\s+install/.test(step.run)) problems.push(`${where}: installs or fetches something`)
      }
    }
  }
  const reportPermissions = doc?.jobs?.[REPORT_JOB]?.permissions
  if (reportPermissions?.issues !== "write") problems.push(`the ${REPORT_JOB} job must have issues: write`)
  return problems
}

test("the policy checker accepts the built-in good workflow", () => {
  assert.deepEqual(workflowViolations(GOOD), [])
})

test("the policy checker rejects each forbidden pattern", () => {
  const mutate = (from, to) => {
    assert.ok(GOOD.includes(from), `mutation anchor missing: ${from}`)
    return GOOD.replace(from, to)
  }
  const echo = '          echo "$VALUE"\n'
  const cases = [
    ["another trigger", mutate("  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n"), /disallowed trigger: push/],
    ["pull_request_target", mutate("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request_target:\n"), /pull_request_target/],
    ["no schedule", mutate("  schedule:\n    - cron: '17 6 * * 1'\n", ""), /missing the schedule trigger/],
    ["workflow permissions", mutate("permissions: {}\njobs", "permissions:\n  contents: read\njobs"), /workflow-level permissions/],
    ["contents write", mutate("      contents: read\n", "      contents: write\n"), /contents: write/],
    ["pull-requests write", mutate("      contents: read\n", "      pull-requests: write\n"), /pull-requests: write/],
    ["issues write with others", mutate("      issues: write\n", "      issues: write\n      contents: read\n"), /issues: write must be the only/],
    ["issues write on the check job", mutate("      contents: read\n", "      issues: write\n"), /issues: write is only allowed on the report job/],
    ["issues write on another job", mutate("  report:\n    needs: offline-check\n", "  other:\n    runs-on: ubuntu-latest\n    permissions:\n      issues: write\n    steps: []\n  report:\n    needs: offline-check\n"), /job other: issues: write is only allowed/],
    ["report job without issues write", mutate("      issues: write\n    steps", "      issues: read\n    steps"), /report job must have issues: write/],
    ["no job permissions", mutate("    permissions:\n      contents: read\n", ""), /permissions must be declared/],
    ["git push", mutate(echo, "          git push origin HEAD\n"), /git write command/],
    ["git commit", mutate(echo, "          git commit -am x\n"), /git write command/],
    ["gh pr", mutate("run: gh issue list", "run: gh pr create"), /outside open-or-update/],
    ["gh api write", mutate("run: gh issue list", "run: gh api -X POST repos/o/r/issues"), /read-only --paginate/],
    ["gh api input", mutate("run: gh issue list", "run: gh api --paginate --input x repos/o/r/issues"), /read-only --paginate/],
    ["gh issue close", mutate("run: gh issue list", "run: gh issue close 1"), /outside open-or-update/],
    ["a secret", mutate("${{ github.token }}", "${{ secrets.USAI_API_KEY }}"), /secret or a credential/],
    ["expression in run", mutate('echo "$VALUE"', 'echo "${{ github.actor }}"'), /interpolated into a run/],
    ["unpinned action", mutate("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v4"), /not pinned/],
    ["persisted credentials", mutate("persist-credentials: false", "persist-credentials: true"), /persist-credentials/],
    ["curl", mutate(echo, "          curl https://example.invalid\n"), /installs or fetches/],
  ]
  for (const [label, text, expected] of cases) {
    const problems = workflowViolations(text)
    assert.ok(problems.some((problem) => expected.test(problem)), `${label}: expected ${expected}, got ${JSON.stringify(problems)}`)
  }
})

test("the committed .github/workflows/catalog-drift.yml exists and satisfies the policy", () => {
  assert.ok(existsSync(COMMITTED), `the drift workflow is missing: ${COMMITTED}`)
  assert.deepEqual(workflowViolations(readFileSync(COMMITTED, "utf8")), [])
})

test("the file named by CATALOG_DRIFT_WORKFLOW satisfies the policy", (t) => {
  const file = process.env.CATALOG_DRIFT_WORKFLOW
  if (!file) {
    t.skip("CATALOG_DRIFT_WORKFLOW is not set")
    return
  }
  const resolved = path.resolve(process.cwd(), file)
  assert.ok(existsSync(resolved), `CATALOG_DRIFT_WORKFLOW points at a missing file: ${resolved}`)
  assert.deepEqual(workflowViolations(readFileSync(resolved, "utf8")), [])
})

test("the workflow runs only the offline scripts and never the live refresh", () => {
  const candidates = [COMMITTED, process.env.CATALOG_DRIFT_WORKFLOW && path.resolve(process.cwd(), process.env.CATALOG_DRIFT_WORKFLOW)]
  for (const file of candidates.filter(Boolean)) {
    assert.ok(existsSync(file), `workflow file is missing: ${file}`)
    const text = readFileSync(file, "utf8")
    assert.match(text, /scripts\/offline-check\.mjs/, file)
    assert.match(text, /scripts\/drift-report\.mjs/, file)
    assert.doesNotMatch(text, /refresh-usai-catalog|scripts\/refresh\.mjs|build-catalog\.mjs/, file)
  }
})
