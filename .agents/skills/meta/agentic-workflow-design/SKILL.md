---
name: agentic-workflow-design
id: agentic-workflow-design
version: "1.0.0"
title: "Agentic Workflow Design"
description: "Design or review a multi-step agent workflow with explicit data contracts, gates, verification, and run-record requirements."
type: skill
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - agents
  - developers
  - technical-writers
requires:
  anchors: []
  skills: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Workflow Design Brief"
      - "Data Contracts"
      - "Step Graph"
      - "Step Specifications"
      - "Verification Plan"
      - "Readiness Review"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
categories:
  - development
  - testing
  - documentation
collection: meta
triggers:
  - "design agent workflow"
  - "multi-agent workflow"
  - "orchestration design"
  - "workflow data contract"
  - "agent run record"
tags:
  - "agentic"
  - "workflow"
  - "orchestration"
  - "data-contracts"
  - "verification"
routing:
  task_types:
    - plan
    - analyze
    - review
    - orchestrate
  input_artifacts:
    - documentation
  output_artifacts:
    - documentation
  aliases:
    - "agent workflow architecture"
    - "multi-agent pipeline design"
    - "orchestration plan"
  prefer_when:
    - "A multi-step agent process needs explicit state, gates, verification, and execution controls."
  avoid_when:
    - "The request is to execute an already-designed workflow rather than design or review it."
  priority: 70
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
scope:
  intended_use:
    - "Designing or reviewing orchestrated workflows that may use agents, tools, external services, and operator decisions."
  exclusions:
    - "Replacing an implementation-specific scheduler, permissions system, or observability service."
    - "Authorizing actions beyond the operator's stated permissions."
---

# Skill: Agentic Workflow Design

## Summary

Design or review an agent-run workflow as a typed, verifiable system rather
than a sequence of prompts. Use it for multi-step work that may involve
sub-agents, external services, operator decisions, shared state, or a durable
run record.

The outcome is a design package that an implementation team can review before
building or running the workflow. This skill does not execute the workflow,
grant permissions, or replace the controls of the target platform.

## When to Use

- A team asks to design or revise a multi-step workflow run by an orchestrator.
- A workflow needs explicit item states, handoffs, gates, or failure handling.
- A review finds that agents share files, call services, or wait without clear
  ownership and evidence.
- A workflow needs measurable acceptance criteria, replayable records, or a
  design readiness review.

## When Not to Use

- The task is to execute an existing workflow.
- The task is a single, independent agent operation with no handoff or state.
- The requester needs a platform-specific deployment, scheduler, or access
  control implementation. Design the controls here, then use the platform's
  implementation guidance.

## Inputs and Preconditions

Collect the following before finalizing a design. Ask concise questions for
missing information; do not invent authority, classification, or permissions.

- Objective, deliverables, and success criteria.
- Expected input routes, scale, and source formats.
- Data classification, retention rules, and permitted environments.
- External-service, network, rate-limit, and budget constraints.
- Operator availability, approval authority, and standing rules.
- Existing tools, orchestration harness constraints, and shared storage model.

If the workflow will make network calls, change files, spend a material budget,
or act without immediate supervision, require an explicit approval model before
declaring the design ready.

## Required Output Package

Produce all of the following sections:

1. **Workflow Design Brief**: objective, scope, deliverables, constraints,
   success metrics, operator authority, and assumptions.
2. **Data Contracts**: item IDs, states, terminal outcomes, required fields,
   source locators, canonical configuration, and writer ownership.
3. **Step Graph**: typed nodes, dependencies, reads, produces, gates, and
   failure or recovery routes.
4. **Step Specifications**: one specification for every node in the graph.
5. **Verification Plan**: deterministic acceptance checks, fixtures, dry runs,
   reconciliations, and readiness checks.
6. **Readiness Review**: unresolved decisions, risks, and a PASS, BLOCKED, or
   NEEDS-REVISION verdict.

## Procedure

### 1. Establish Scope and Authority

Classify the request as design, revision, or review. State whether the proposed
workflow is attended, unattended-capable, or not yet authorized to run.

For unattended-capable work, identify:

- The exact actions that may proceed without an operator.
- Conditions that force a stop or decision gate.
- Command, tool, write, and network restrictions.
- Timeout, escalation, and recovery rules for background work.

Express standing authority as a rule over conditions, not a list of hoped-for
steps. For example: continue until a quality check fails, a budget cap is met,
or a blocking gate is due.

### 2. Define the Success Contract

Write the outcome before writing the process. Each success metric must be
operational: name the stage, numerator, denominator, data source, and check
that computes it.

| Metric | Stage | Numerator | Denominator | Evidence and check |
|---|---|---|---|---|
| Accepted-item rate | quality gate | accepted items | evaluated items | state ledger; `verify-states` |

Do not use a metric that cannot be calculated from planned records. Define
known limits and assumptions separately from acceptance criteria.

### 3. Model Items and Data Contracts

For every way an item enters the workflow, define an ID grammar, source locator,
initial state, and owner. Keep processing-request state separate from the state
of the underlying item.

Define a single state machine with ordered states and explicit terminal states.
Include every exit route, including rejected, deferred by budget, deferred by
operator, unavailable, and failed. Never reuse a cancelled ID.

For each machine-read field, specify allowed values or an explicit `not_stated`
sentinel. Name one authoritative source for each fact and one writer for every
shared file or column.

| Contract | Required design decision |
|---|---|
| IDs | Grammar and minting rule for each entry route |
| States | Allowed transitions, terminal states, and failure codes |
| Locators | Deterministic source reference for each source format |
| Configuration | One canonical file for caps, thresholds, and vocabularies |
| Events | Required fields for each event type, validated when emitted |
| Ownership | Named writer, reader, and lock or atomic-write strategy |

### 4. Draw the Typed Step Graph

Represent the workflow as nodes and edges before drafting detailed prose. Each
node lists its reads, produces, required decisions, and deterministic closure
check. Each edge names the produced artifact or decision it carries.

```text
intake -> normalize -> quality_gate -> operator_gate -> deliver -> close_out
```

Check the graph for:

- A producer for every value a step reads.
- A terminal route for every item.
- No work that depends on a gate decision running before the gate.
- No concurrent writers to the same output.
- A recovery or stop route for each external dependency.

### 5. Specify Each Step

Use this template for every node, including gates and close-out:

```markdown
### Step: <stable-step-id> - <name>

**Goal:** <outcome>
**Reads:** <artifacts, configuration, decisions>
**Produces:** <artifacts, events, state changes>
**Consumes decisions:** <gate IDs or none>
**Volume:** <expected items and work-unit maximum>
**Agents:** <model, maximum concurrency, ownership boundaries>
**Network:** <no calls or explicit permitted-service policy>
**Sub-steps:** <stable IDs, dependencies, non-overlapping outputs>
**Failure rule:** <programmatic response by failure class>
**Evidence location:** <record artifacts; distinguish from scratch>
**Time estimate:** <per item and slow-tail estimate>
**Done when:** `<deterministic verification command or check>`
```

Keep each rule in one canonical location. Generate restated briefs or kickoff
materials from that source instead of manually copying requirements.

### 6. Design Agents, External Calls, and Gates

Add execution controls only when the workflow needs them.

For sub-agents, define a bounded work unit, model, deadline, concurrency cap,
one owner per item, and one writer per output. Use a dispatch ledger with a
separate record for prepared, launched, and completed work. Count active agents
from the ledger, not from chat history.

For external services, use one queue-owning client per service. It must own
ordering, rate limits, retries, budget enforcement, raw-response retention, and
event logging. Record refusal and wait events as well as successful sends.

For each operator gate, present two to four genuine options, consequences for
cost, time, coverage, and quality, one recommendation, a blocking flag, and an
evidence path. Record the question, decision, and resulting configuration.

### 7. Define Verification and Readiness Checks

Prefer deterministic checks over judgment-only review. Give workers the same
verifier that the orchestrator will apply, and rerun it after every repair.

Plan tests for:

- State transitions, terminal statuses, and numeric caps.
- External vocabulary mappings and source-locator rules.
- Concurrent writes, locks, timeouts, and recovery paths.
- Failure policies, retry boundaries, and budget stops.
- Known-good and known-bad fixtures for each gate.
- Reconciliation of expected items, disk artifacts, state records, and events.

Dry-run each step on a small representative slice before a live run. Freeze the
specification and configuration versions or hashes at run start; record later
changes as amendments with affected artifacts and rechecks.

### 8. Design the Run Record and Close-Out

Define event types before choosing time or cost metrics. At minimum, distinguish
active work, operator wait, permission wait, rate-limit wait, session pause, and
agent activity. Validate events when written, not after an append-only record
has accumulated invalid data.

Classify every artifact as `record` or `scratch`. Before cleanup, promote every
cited brief, gate decision, exception, repair note, and evidence artifact into
the record area. Produce one machine-readable carry-forward list with item,
owner, and durable evidence path.

## Review Mode

When reviewing an existing design, report findings before proposing a redesign.
For each finding, state the affected step or contract, evidence, impact, and
smallest corrective change. Flag at least these defects when present:

- A value is read but has no producer.
- An item route has no ID, locator, terminal status, or owner.
- A gate is bypassed by downstream work.
- A shared file has multiple writers or no atomic-write strategy.
- A metric lacks a numerator, denominator, or evidence source.
- A failure policy relies on an agent guessing what to do.
- A cited artifact can be deleted as scratch.

## Verification

Before returning the design package, confirm:

- [ ] Every item route has an ID form, source locator, and terminal status.
- [ ] The state machine and failure codes are declared once.
- [ ] Every graph read has a named producer and every gate dependency is valid.
- [ ] Each step has bounded inputs, outputs, owner, failure rule, and done-when check.
- [ ] Network, write, budget, and operator authority rules are explicit where needed.
- [ ] Verification includes fixtures, reconciliation, and a small-slice dry run.
- [ ] Record artifacts are protected from scratch cleanup.
- [ ] Missing authority or material assumptions produce BLOCKED or NEEDS-REVISION, not an invented approval.

## Output Template

```markdown
## Summary
<design, revision, or review; readiness verdict>

## Workflow Design Brief
<objective, scope, constraints, success metrics, authority, assumptions>

## Data Contracts
<IDs, state machine, locators, events, configuration, ownership>

## Step Graph
<typed nodes and dependencies; graph review results>

## Step Specifications
<one completed specification per step>

## Verification Plan
<tests, fixtures, dry run, reconciliation, acceptance checks>

## Readiness Review
<PASS, BLOCKED, or NEEDS-REVISION; unresolved decisions and next action>
```

## Common Failure Modes

| Failure | Smallest corrective change |
|---|---|
| Agents infer missing fields | Add an allowed-value set and `not_stated` sentinel. |
| Work starts before approval | Make the gate decision a required graph input. |
| Shared records diverge | Assign one writer and add atomic writes plus reconciliation. |
| Budget or rate limit is exceeded | Put the cap and wait behavior in the queue-owning client. |
| A repair invalidates downstream work | List consumers and regenerate each affected artifact. |
| A workflow cannot explain a delay | Emit start and end events for work, waits, pauses, and agents. |

## Related Patterns

- [pattern-router](../pattern-router/SKILL.md) - Select this skill when a request needs workflow design or review.
- [test-generation](../../test-generation/SKILL.md) - Add implementation tests after the workflow design is accepted.
