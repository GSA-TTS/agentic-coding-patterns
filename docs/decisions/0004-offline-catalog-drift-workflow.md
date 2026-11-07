---
title: "Report provider catalog drift from a scheduled, offline-only workflow"
status: "proposed"
date: "2026-11-05"
decision_makers: ["Patterns maintainers", "OpenCode Agent"]
category: "provider-catalog"
impact_level: "low"
---

# ADR 0004 - Report Provider Catalog Drift from a Scheduled, Offline-Only Workflow

## Context and Problem Statement

ADR 0003 gives maintainers one command that refreshes the USAi catalog and its
neutral artifacts, and a `--check` mode that reports drift. Nothing runs that
check on a schedule, so a catalog that no longer reproduces from its committed
inputs would go unnoticed until someone ran the command by hand.

ADR 0003 also decided that no USAi key is stored in this repository's Actions
secrets, and that the refresh refuses a live pull in CI. A scheduled job
therefore cannot compare the catalog with the live USAi feed. This record
decides what a scheduled job can still do, and how it reports.

Adding a scheduled CI job is a change to the pipeline, so it needs a record
(AGENTS.md section 15.1).

## Decision

Add one workflow, `.github/workflows/catalog-drift.yml`, that is **offline-only**
and **never changes the repository**.

1. **Triggers.** `schedule` (weekly) and `workflow_dispatch`. Nothing else. No
   `pull_request`, no `pull_request_target`.
2. **No credential.** The workflow reads no secret and does not name the USAi
   key. The default workflow token is the only credential, and the permissions
   below limit it.
3. **What it checks.** It runs `integrations/providers/usai/scripts/offline-check.mjs`,
   which needs no network and no credential. It does two things. First, it runs
   `refresh.mjs --from <fixtures> --check` in a temporary root that holds the
   committed fixture artifacts, which proves the builder, the registry and the
   generators still reproduce known data byte for byte. Second, it regenerates
   every registered derived artifact from the shipped `catalog.json` and compares
   it with the committed file, which catches a catalog change that was not
   followed by a matching snapshot change. It does not compare the shipped
   catalog with the fixture feeds, because the shipped catalog comes from the
   live feed.
4. **The live comparison is BLOCKED, never PASS.** The report always states that
   the live feed was not compared, and why. If a future job does try a live
   fetch and it fails, the report says FAILED. Neither state is ever written as
   "no drift" (AGENTS.md section 8.3).
5. **Reporting.** A job summary on every run. When the offline check finds
   drift or fails, or a live fetch fails, a second job opens or updates **one**
   tracking issue with a stable title and the label `catalog-drift`. That job has
   `issues: write` and nothing else. It never closes the issue, never pushes,
   and never opens a pull request. A maintainer runs the refresh on a
   maintainer host and opens a normal reviewed pull request.
6. **Least privilege.** Workflow-level `permissions: {}`. The check job has
   `contents: read`. Every action is pinned to a commit SHA, checkout uses
   `persist-credentials: false`, and no `run:` string interpolates a `${{ }}`
   expression: values reach scripts through environment variables.
7. **Enforced by a test.** `integrations/providers/usai/tests/catalog-drift-workflow.test.mjs`
   parses the workflow and fails on any other trigger, any `write` permission
   other than `issues: write` on the reporting job, any commit or push step, any
   secret reference, any unpinned action, or any expression inside a `run:`
   string.

## Scope

This decision covers only the drift signal for repository-time provider-neutral
artifacts. It adds no runtime component and does not change the refresh command
or its exit codes. A maintainer runs the live pull by hand, as ADR 0003 decides.
Runtime refresh stays with ADR 0002.

## Consequences

**Positive:**

- A weekly, reviewable signal that the committed artifacts still reproduce.
- No credential and no write path to the repository, so the blast radius is one
  issue.
- The "live not checked" gap is stated on every report instead of hidden.

**Negative / trade-offs:**

- The workflow cannot see upstream changes to the USAi list. A maintainer still
  has to run the live check. The weekly report reminds them by saying BLOCKED.
- The agent token used to prepare this change cannot write under
  `.github/workflows/`, so a maintainer lands the workflow file. The pull request
  stays a draft until they do.
- A resolved drift leaves the tracking issue open until a maintainer closes it,
  by design.

## Alternatives Considered

1. **Store a USAi key as an Actions secret and fetch live.** Rejected by ADR 0003:
   no key is stored for CI in a public repository.
2. **Fail the workflow run and open no issue.** Rejected: a red scheduled run is
   easy to miss and gives no place to track the follow-up.
3. **Open a new issue each time.** Rejected: it would create noise. One issue is
   updated instead.
4. **Open a pull request with the refreshed files.** Rejected: nothing in this
   workflow can fetch new data, and an automated commit path is the thing this
   decision avoids.

## Implementation

Delivered with this record: `integrations/providers/usai/scripts/drift-report.mjs`
(the report formatter), its tests, the workflow policy test, and the workflow
file itself, which a maintainer lands because the contributing agent's token has
no `workflow` scope.
