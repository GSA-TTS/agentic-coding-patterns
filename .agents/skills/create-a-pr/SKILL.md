---
id: create-a-pr
version: "1.0.0"
title: "Create a PR"
type: skill
description: "Create a candid, plain-language pull request description that helps people understand the problem, tradeoffs, evidence, and remaining uncertainty."

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - all

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Problem"
      - "Human Digest"
      - "Evidence and Details"
      - "Testing"
      - "Open Questions"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "development"
  - "review"
  - "documentation"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "create a PR"
  - "create-a-pr"
  - "write PR description"
  - "prepare pull request"
  - "PR summary"

tags:
  - "pull request"
  - "plain language"
  - "team communication"
  - "agentic coding"
  - "handoff"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Draft a pull request description from the session, diff, commits, and verification evidence"
    - "Give reviewers a short, human-readable explanation before technical details"
    - "Make uncertainty, limitations, tradeoffs, and testing coverage visible"
  exclusions:
    - "Not permission to create, push, or merge a pull request without user approval"
    - "Not a substitute for repository-specific PR templates, review, or CI"
    - "Not a claim that unrun checks passed or that unverified behavior works"

collection: engineering
routing:
  task_types:
    - "author"
    - "transform"
    - "review"
  input_artifacts:
    - "pull-request-diff"
    - "source-code"
    - "documentation"
  output_artifacts:
    - "pull-request-diff"
  prefer_when:
    - "a team needs an honest PR handoff that separates the human summary from detailed evidence"
  aliases:
    - "create-a-pr"
    - "PR digest"
    - "reviewer handoff"
---

# Skill: Create a PR

Use the single command `/create-a-pr` to draft a pull request description that
starts with the human reason for the work. It turns the useful context from a
working session into a short digest, then links each material claim to a more
detailed evidence section for reviewers who need it.

This skill is for people and agents working together. It does not hide failed,
skipped, or unrun work. A reviewer should be able to answer three questions
quickly: what problem did this solve, why was this approach chosen, and what is
still uncertain?

## When to Use

- You have a completed or reviewable change and need a PR description
- A session included several approaches, investigation steps, or tradeoffs
- An agent needs to hand work back to a human reviewer without losing context
- You want the PR to state limits and test coverage clearly instead of implying certainty

## Prerequisites

- The problem statement or best available description of the intended outcome
- The current diff and changed-file list
- Session notes, commits, or other evidence of approaches considered
- Actual verification results, including failures, skipped checks, and checks not run
- User approval before any remote action, such as pushing a branch or opening a PR

## Command

```text
/create-a-pr
```

The command produces a draft PR body. It does not create a remote pull request
unless the user separately approves that action.

## Procedure

### Step 1: Collect evidence, not assumptions

Read the original request, session decisions, changed files, commits, and every
verification result that is available. Separate evidence into three groups:

- **Observed:** a command ran, a test passed or failed, a reviewer made a decision,
  or the diff contains a change.
- **Reasoned:** a conclusion drawn from observed evidence. Mark the basis.
- **Unknown:** no evidence exists, the check was not run, or the session did not
  answer the question.

Do not fill gaps with conventional expectations. If no test result is available,
write `Not run` or `Not verified`.

### Step 2: Write the human digest first

Start with the problem in everyday language. State what the change does and why
it was chosen. Keep the digest small enough to read before opening a diff.

Use links such as `[D1]` after each material claim. Each link points to a matching
entry in **Evidence and Details** below. Do not link boilerplate or obvious
transitions; link claims about behavior, choices, limitations, and testing.

### Step 3: Describe approaches and their costs

State the approach used and any real alternatives considered during the session.
For each meaningful alternative, describe the cost in plain language. Costs may
include added complexity, more dependencies, delayed delivery, operational risk,
maintenance burden, incomplete coverage, or an unanswered design question.

Do not invent alternatives merely to make the PR look thorough. If only one
approach was considered, say that plainly.

### Step 4: Make limitations and questions visible

List real limitations separately from open questions:

- A **limitation** is a known boundary of the present change.
- An **open question** is something needed to make a decision or confirm behavior.

State whether either blocks review, follow-up work, or release. Do not quietly
turn an open question into a promise of later work.

### Step 5: Report testing exactly as it happened

For every relevant check, name the command or manual action, its observed result,
and what it covers. Include failures and skipped checks. Use `Not run` when a
check was not attempted, and explain why only when the reason is known.

Never use “tested” when only static inspection occurred. Never say “all tests
pass” unless the complete relevant suite was run and passed.

### Step 6: Build the detailed evidence section

Assign stable anchors: `[D1]`, `[D2]`, and so on. Each anchor must include:

- The claim it supports
- The evidence source: changed file, diff, commit, command, session decision, or manual check
- The observed result or an explicit `Unknown`

The details section is not a transcript dump. Keep enough technical detail for
reviewers to check a claim without searching the full session.

### Step 7: Review the PR body before sharing it

Check that the digest comes before the details, every material digest claim has
an anchor, and no heading is empty. Remove guessed outcomes. Keep terms clear
enough for a teammate who was not present in the session.

## PR Template

Use this template as the output of `/create-a-pr`. Replace bracketed guidance
with facts from the session. Delete sections that truly do not apply only when
the result still makes uncertainty and testing clear.

```markdown
## Problem

[In plain language, explain the problem this change set out to solve.]

## Human Digest

[Explain what changed and why it is expected to help. Link each material claim
to evidence below, for example: “The new check prevents empty submissions [D1].”]

### Approach and Tradeoffs

- **Chosen approach:** [What was done and why.] [D2]
- **Other approaches considered:** [Approach and its cost, or “No other approach
  was considered during this session.”] [D3]

### Known Limitations

- [Known boundary of this change and whether it blocks review or release.] [D4]

### Open Questions

- [Question, owner if known, and whether it blocks review or release.] [D5]

## Testing

| Check | Observed result | What it covers |
| --- | --- | --- |
| `[exact command or manual action]` | [Passed / Failed / Not run] | [Behavior or risk covered] [D6] |

**Testing honesty statement:** [State exactly what was and was not tested. Do
not imply that an unrun check passed.]

## Evidence and Details

### D1: [Short claim name]

- **Claim:** [The digest claim this supports.]
- **Evidence:** [Changed file, diff, command, commit, session decision, or manual check.]
- **Observed result:** [Fact, failure, or `Unknown`.]

### D2: [Short claim name]

- **Claim:** [Why the chosen approach was selected.]
- **Evidence:** [What the session actually considered.]
- **Observed result:** [Fact, failure, or `Unknown`.]

[Add D3 and later entries for every remaining digest link.]
```

## Plain-Language Maintenance

This skill is intended to be updated without specialized tooling. To change its
behavior, edit these sections in order:

1. **PR Template** changes what the command produces.
2. **Procedure** changes how an agent gathers and judges session evidence.
3. **Testing honesty statement** sets the wording reviewers see about verification.
4. **Evidence and Details** rules control the link between the digest and proof.

Use direct words. Prefer `Not run`, `Failed`, `Unknown`, and `Needs decision`
over vague wording such as `looks good`, `likely works`, or `should be fine`.
When a new requirement affects the output, add it to the template and add a test
case that demonstrates the expected wording.

## Verification

- [ ] The first substantive section is **Problem**, written for a person who did not attend the session
- [ ] The human digest is short and every material claim links to `[D#]` evidence
- [ ] The approach and meaningful costs are stated without invented alternatives
- [ ] Known limitations and open questions are explicit, including any blocker status
- [ ] Each test result is observed, failed, skipped, or marked `Not run`
- [ ] The PR does not claim broader testing than the evidence supports
- [ ] The evidence anchors are sufficient to check the digest without a session transcript

## Example

```markdown
## Problem

People could submit a blank display name and only learn about the error after a
round trip to the server.

## Human Digest

The form now stops blank display names before submission, which gives people an
immediate explanation and avoids an unnecessary request [D1].

### Approach and Tradeoffs

- **Chosen approach:** Reuse the form's existing client-side validation path so
  the new rule follows the same error-display behavior as the other fields [D2].
- **Other approaches considered:** No other approach was considered during this
  session.

### Known Limitations

- Server-side validation remains the authority. This change improves feedback but
  does not replace server validation [D3]. This does not block review.

### Open Questions

- None identified during this session.

## Testing

| Check | Observed result | What it covers |
| --- | --- | --- |
| `npm test -- display-name` | Passed | Blank and non-blank display-name validation [D4] |
| Keyboard-only browser check | Not run | Focus and error announcement behavior; no observed result is available [D5] |

**Testing honesty statement:** Unit tests for the changed validation passed. A
keyboard-only browser check was not run, so accessibility behavior is not verified.

## Evidence and Details

### D1: Blank values are stopped before submission

- **Claim:** The form rejects a blank display name before requesting submission.
- **Evidence:** The changed form validation branch checks for an empty trimmed value.
- **Observed result:** The focused unit test passed.

### D2: Existing validation path was reused

- **Claim:** The chosen approach keeps error display consistent with existing fields.
- **Evidence:** The new condition uses the same validation function and error component.
- **Observed result:** Code inspection confirms the shared path; browser behavior was not manually checked.

### D3: Server validation remains required

- **Claim:** Client-side validation is not the final authority.
- **Evidence:** The server-side validation was unchanged by this PR.
- **Observed result:** The limitation remains.

### D4: Focused unit tests

- **Claim:** Blank and non-blank display-name cases were exercised.
- **Evidence:** `npm test -- display-name`.
- **Observed result:** Passed.

### D5: Keyboard-only browser check

- **Claim:** No accessibility result is available for keyboard-only use.
- **Evidence:** No manual browser check was run.
- **Observed result:** Not run.
```

## Related Patterns

- [Issue to Merge Request Workflow](../../workflows/issue-to-merge-request/SKILL.md) - Use for the broader development-to-review process
- [Documentation Review](../documentation-review/SKILL.md) - Use to review clarity and accuracy of the completed PR body
- [Over-Engineering Review](../over-engineering-review/SKILL.md) - Use when reviewers need a focused complexity assessment
