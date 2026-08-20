---
id: software-delivery-explainer
name: software-delivery-explainer
version: "0.1.0"
title: "Software Delivery Explainer"
description: "Explain how software moves from a need to production, and exactly where AI agents participate and where the human control points are — so leadership sees that agents do more work between the controls, not that the controls go away."
type: skill
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"
primary_personas:
  - developers
  - developer-advocates
  - technical-writers
requires:
  anchors: []
  skills: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "The Delivery Process"
      - "Where Agents Participate"
      - "Human Control Points"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 12
  citations_required: false
collection: communications
triggers:
  - "explain how agents fit the software process"
  - "where do humans stay in control of agentic coding"
  - "explain the software delivery pipeline to leadership"
tags:
  - "communications"
  - "explainer"
  - "executive"
  - "workflow"
routing:
  task_types:
    - transform
    - author
  input_artifacts:
    - documentation
  output_artifacts:
    - documentation
  aliases:
    - "delivery pipeline explainer"
    - "agentic workflow explainer"
  prefer_when:
    - "the request is to explain the end-to-end delivery process and where agents/humans act"
  avoid_when:
    - "the request is a single concept — use technical-concept-translator"
    - "the request is a value/ROI argument — use agentic-value-analyst"
    - "the request is to render a finished artifact — use the design-artifact workflow"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
scope:
  intended_use:
    - "Explaining the software delivery process to non-engineering leadership"
    - "Showing where agents participate and where human control points remain"
  exclusions:
    - "Explaining a single isolated concept (use technical-concept-translator)"
    - "Making organizational value claims (use agentic-value-analyst)"
    - "Implying one universal workflow all organizations use"
---

# Skill: Software Delivery Explainer

## Summary

Explain how software moves from a need to production, and make **explicit** where
AI agents do work and where humans keep control. The central, honest thesis:

> The agent accelerates work **inside** the engineering process. It does not
> replace the process or its controls — it does more of the work **between** the
> control points, which remain human.

## When to Use

- "Explain how agentic coding actually works, end to end, to leadership."
- "Show where humans remain accountable in an agentic workflow."
- "Where does the agent fit in our delivery pipeline?"

## When NOT to Use

- One concept only → `technical-concept-translator`.
- A value/ROI argument → `agentic-value-analyst`.
- A finished one-pager/deck → the `design-artifact` workflow.

## Prerequisites

- The audience (see the [audience profiles](../technical-concept-translator/reference/audience-profiles.md)).
- Ground truth for control points:
  [concept library](../technical-concept-translator/reference/concept-library.md)
  and the playbook `AGENTS.md` / `SECURITY-CONTROLS.md`.

## The baseline delivery model

Present this as *a common shape, not the one true workflow* — organizations
differ. Each arrow is a step; the **bold** steps are human/automated control
points that do not go away when an agent is involved.

```
need / problem
  → issue (define the work)
  → branch / isolated workspace
  → implementation
  → automated tests
  → pull request
  → **CI / security checks**        (automated control)
  → **human review**                (human control — author ≠ approver)
  → **merge**                       (human-gated)
  → **deployment**                  (human-gated; separate release controls)
```

## Where agents participate

Agents can do more of the work between the controls. Typically:

- investigate the repository and gather context
- research relevant implementation details and dependencies
- propose a plan
- make changes in the isolated sandbox
- generate and run tests, static analysis, and security checks
- iterate on failures
- update documentation
- prepare the pull request and summarize the evidence

## Human control points (these do not move)

Cite these to the ground truth — do not soften them:

- **Approval gates** — the agent must get explicit human approval before
  destructive operations, external network requests, dependency installs,
  license acceptance, CI/CD changes, and committing/pushing (playbook AGENTS.md §3.2).
- **No self-approval** — the agent may not approve its own code for production
  (AGENTS.md §8.2).
- **No self-merge** — the agent may not merge its own pull requests or commit to
  protected branches (AGENTS.md §14.2).
- **Separation of duties** — author ≠ approver; the agent may assist review but is
  not the sole reviewer for production-bound code (SECURITY-CONTROLS.md AC-5).
- **Human author of record** — a human is accountable for every AI-assisted change
  and must be able to explain it; "the AI wrote it" is never a sufficient account
  (AI-CONTRIBUTION-POLICY.md).
- **Fail closed** — on ambiguity the agent halts and escalates rather than guessing
  (AGENTS.md §14.5).

## Procedure

1. **Anchor the model.** Lay out the pipeline above; state up front that workflows
   vary by organization.
2. **Split the work.** For each stage, say plainly whether an agent can do it,
   assist with it, or whether it is a human decision.
3. **Make the control points loud.** Name each human/automated gate and cite it.
   Do not imply any gate is removed or that the agent can pass its own gate.
4. **State the thesis.** Close on "more work between the controls, not fewer
   controls."
5. **Adapt to audience.** A CISO wants the control detail; an SES wants the plain
   shape and the reassurance that humans stay accountable.
6. **Optionally ground in a real change.** If given a real issue/PR, walk it
   through the stages — but only assert what the evidence shows (this is the
   future `repo-evidence-extractor` capability; until it exists, do not fabricate
   the walkthrough).

## Verification

- All four required sections present.
- Every human control point is named and none is described as something the agent
  can perform for its own change.
- The output does **not** state the agent merges, approves, or deploys on its own.
- The pipeline is presented as common, not universal.

## Examples

**"Show where humans remain accountable."** → produce the pipeline, then the
Human Control Points list, then the thesis. The reader should be able to point to
review, merge, and deploy as human-held gates.

## Related Patterns

- [`technical-concept-translator`](../technical-concept-translator/SKILL.md)
- [`agentic-value-analyst`](../agentic-value-analyst/SKILL.md)
- [`design-artifact`](../../../../workflows/design-artifact/SKILL.md)

## Human Review Checklist

- [ ] Control points named and cited; none attributed to the agent for its own work.
- [ ] Output does not imply autonomous merge/approve/deploy.
- [ ] Pipeline framed as common, not universal.
- [ ] "More work between the controls" thesis is present and accurate.
