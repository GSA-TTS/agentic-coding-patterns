#!/usr/bin/env node

// =============================================================================
// drift-report.mjs — format the result of the scheduled, offline drift check.
//
// The catalog-drift workflow runs
//   refresh.mjs --from <fixtures> --check
// and hands its exit status and output to this script. This script turns them
// into (a) a job summary, (b) a tracking-issue body, and (c) a state the
// workflow uses to decide whether to open or update the issue.
//
// It reads files and writes files. It makes no request and reads no credential.
//
// States:
//   ok      the offline check passed (the live comparison is still BLOCKED)
//   drift   the offline check found drift (refresh.mjs exit 1)
//   failed  the offline check could not run (any other exit status)
//
// The live comparison is reported as BLOCKED, or FAILED when a live fetch was
// attempted and failed. It is never reported as PASS, and a fetch failure is
// never reported as drift or as "no drift".
//
//   node drift-report.mjs --exit-code <n> --output-file <file>
//        --summary <file> --issue-body <file> [--github-output <file>]
//        [--live-failed-reason <text>]
// =============================================================================

import { readFileSync, appendFileSync, writeFileSync } from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"
import path from "node:path"

export const ISSUE_TITLE = "Provider catalog drift report"
export const ISSUE_LABEL = "catalog-drift"
export const LIVE_BLOCKED_REASON =
  "no USAi credential is stored for CI by design, so the live feed was not compared"

const MAX_OUTPUT_CHARS = 20_000

/** Map the refresh exit status to a report state. */
export function stateFromExitCode(exitCode) {
  if (exitCode === 0) return "ok"
  if (exitCode === 1) return "drift"
  return "failed"
}

function oneLine(text) {
  return String(text ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300)
}

/** Fence the text so nothing inside it can end the fence or be read as markup. */
function fenced(text) {
  let body = String(text ?? "").replace(/\r/g, "")
  if (body.length > MAX_OUTPUT_CHARS) body = body.slice(0, MAX_OUTPUT_CHARS) + "\n... (truncated)"
  const longest = Math.max(0, ...(body.match(/~+/g) ?? []).map((run) => run.length))
  const fence = "~".repeat(Math.max(3, longest + 1))
  return `${fence}text\n${body.replace(/\n+$/, "")}\n${fence}`
}

function liveLine(live) {
  if (live?.state === "failed") {
    return `Live comparison: **FAILED** (fetch failed: ${oneLine(live.reason) || "no reason given"}). This is not a drift result and not a pass.`
  }
  return `Live comparison: **BLOCKED** (${LIVE_BLOCKED_REASON}). BLOCKED is not a pass. A maintainer runs \`make refresh-usai-catalog-check\` on a maintainer host.`
}

const HEADLINE = {
  ok: "Offline check: **PASS** (the committed tooling reproduces the committed fixture artifacts, and the shipped derived artifacts match the shipped catalog).",
  drift: "Offline check: **DRIFT** (a committed artifact differs from what the committed tooling and catalog produce).",
  failed: "Offline check: **FAILED** (the check could not complete).",
}

/**
 * Build the report. `exitCode` and `output` come from refresh.mjs; `live` is
 * { state: "blocked" } (default) or { state: "failed", reason }.
 */
export function formatDriftReport({ exitCode, output = "", live = { state: "blocked" }, runUrl } = {}) {
  const state = stateFromExitCode(exitCode)
  const liveFailed = live?.state === "failed"
  const lines = [
    `## ${ISSUE_TITLE}`,
    "",
    HEADLINE[state],
    "",
    liveLine(live),
    "",
    "Nothing was committed, pushed or opened by this run.",
  ]
  if (runUrl) lines.push("", `Run: ${runUrl}`)
  lines.push("", "### Check output", "", fenced(output || "(no output)"))
  if (state !== "ok") {
    lines.push(
      "",
      "### What to do",
      "",
      "1. On a maintainer host with a USAi key, run `make refresh-usai-catalog-check`.",
      "2. If it reports drift, run `make refresh-usai-catalog`, review `git diff`, and open a normal pull request.",
      "3. See `integrations/providers/README.md` for the full steps.",
    )
  }
  const markdown = lines.join("\n") + "\n"
  return {
    state,
    markdown,
    shouldReport: state !== "ok" || liveFailed,
    issueTitle: ISSUE_TITLE,
    issueLabel: ISSUE_LABEL,
  }
}

function parseArgs(argv) {
  const options = {}
  const valueFlags = {
    "--exit-code": "exitCode",
    "--output-file": "outputFile",
    "--summary": "summary",
    "--issue-body": "issueBody",
    "--github-output": "githubOutput",
    "--live-failed-reason": "liveFailedReason",
    "--run-url": "runUrl",
  }
  for (let i = 0; i < argv.length; i++) {
    const key = valueFlags[argv[i]]
    if (!key) throw new Error(`unknown argument: ${argv[i]}`)
    const value = argv[++i]
    if (value === undefined) throw new Error(`${argv[i - 1]} requires a value`)
    options[key] = value
  }
  for (const required of ["exitCode", "outputFile", "summary", "issueBody"]) {
    if (options[required] === undefined) throw new Error(`missing required argument for ${required}`)
  }
  if (!/^\d+$/.test(options.exitCode)) throw new Error("--exit-code must be a non-negative integer")
  options.exitCode = Number(options.exitCode)
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const live = options.liveFailedReason === undefined ? undefined : { state: "failed", reason: options.liveFailedReason }
  const report = formatDriftReport({
    exitCode: options.exitCode,
    output: readFileSync(options.outputFile, "utf8"),
    live,
    runUrl: options.runUrl,
  })
  appendFileSync(options.summary, report.markdown)
  writeFileSync(options.issueBody, report.markdown)
  if (options.githubOutput) {
    appendFileSync(options.githubOutput, `state=${report.state}\nreport=${report.shouldReport}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
