---
id: agentic-value-analyst
name: agentic-value-analyst
version: "0.1.0"
title: "Agentic Value Analyst"
description: "Translate agentic-coding capabilities into organizational value without hype — labeling every claim by evidence class, preferring defensible delivery metrics over vanity metrics, and handling conflicting research honestly."
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
      - "Value Dimensions"
      - "Evidence Basis"
      - "Metrics"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Unsupported productivity multipliers"
quality_gates:
  readability_max_grade: 12
  citations_required: false
collection: communications
triggers:
  - "what is the value of agentic coding"
  - "why should leadership fund this"
  - "how do we measure AI coding value without hype"
tags:
  - "communications"
  - "explainer"
  - "executive"
  - "measurement"
routing:
  task_types:
    - analyze
    - author
  input_artifacts:
    - documentation
  output_artifacts:
    - documentation
  aliases:
    - "value framing"
    - "ROI framing without hype"
  prefer_when:
    - "the request is to argue or measure organizational value of agentic coding"
  avoid_when:
    - "the request is a single concept — use technical-concept-translator"
    - "the request is to explain the process — use software-delivery-explainer"
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
    - "Framing organizational value of agentic coding for leadership"
    - "Choosing and defending delivery metrics; rejecting vanity metrics"
  exclusions:
    - "Explaining a single concept (use technical-concept-translator)"
    - "Producing audited savings figures (this skill produces estimates, clearly labeled)"
    - "Any fixed productivity multiplier presented as fact"
---

# Skill: Agentic Value Analyst

## Summary

Translate what agentic coding can do into organizational value **without hype**.
Every claim is labeled by how strong its evidence is; metrics are defensible
delivery metrics, not vanity counts; conflicting external research is presented
honestly rather than cherry-picked.

## When to Use

- "Why should leadership fund this work?"
- "What is the value of agentic coding, and how would we measure it?"
- "Does AI coding make developers 50% faster?" (answer honestly — see below).

## When NOT to Use

- One concept only → `technical-concept-translator`.
- Explaining the process → `software-delivery-explainer`.
- A finished artifact → the `design-artifact` workflow.

## Prerequisites

- The [measurement guidance](reference/measurement-guidance.md) (evidence classes,
  good vs. vanity metrics, cost/value framing).
- The audience (see the [audience profiles](../technical-concept-translator/reference/audience-profiles.md)).

## Value dimensions to consider

Engineering capacity; cycle time; repetitive-work reduction;
investigation/research acceleration; documentation; testing; code-review
assistance; security analysis; operations/troubleshooting; knowledge reuse;
onboarding; consistency; organizational learning; reduced duplicated effort; and
the ability to encode good practices as reusable skills. Select the dimensions
that fit the actual capability — do not claim all of them by default.

## The evidence discipline (the core of this skill)

Label **every** value claim with one of five classes (see the measurement
guidance): **published research / measured local / anecdotal / hypothesis /
expected future**. A claim with no class is not ready to ship.

Handle conflicting evidence honestly:

- External research is mixed and time-sensitive — some controlled studies show AI
  *slowing* experienced developers on familiar tasks; later self-reports show
  gains. Effect depends on task type, tool, and experience.
- Autocomplete assistants and agentic workflows are different interventions;
  evidence about one is not evidence about the other.
- **"Does AI make developers 50% faster?"** has no honest single-number answer.
  Explain what it depends on and cite the range; refuse the bare multiplier.

## Metrics

Prefer defensible delivery metrics (issue→first-working-implementation, PR cycle
time, change lead time, review time, change-failure rate, rework, defects and
security findings caught before merge, docs-updated-with-change, onboarding time,
reusable-pattern adoption, teams using shared capabilities; developer
satisfaction with the self-reported caveat).

Explicitly reject vanity metrics and say why when asked: **lines of AI-generated
code** (more code is a cost), **prompt/token count** (usage, not value), **agents
spawned** (activity, not outcome), **raw PR count without quality/context**
(effort, not value). Pair any effort metric with a quality/outcome metric.

## Cost / value framing

Distinguish cost-avoidance **estimate** from **audited savings**; note the
absence of a without-AI control group; show the method and the single biggest
assumption; lead with the conservative figure; separate countable inputs from
modeled levers. (See the measurement guidance §5.)

## Procedure

1. Pick the value dimensions that match the real capability.
2. For each claim, attach an evidence class; drop any claim you cannot classify.
3. Choose delivery metrics; if the audience offers a vanity metric, replace it and
   explain why.
4. If a dollar figure is requested, state the method, the assumption, and whether
   it is an estimate or audited; lead conservative.
5. Present conflicting external evidence as a range, not a single number.
6. Adapt emphasis to the audience (acquisition/finance wants the method; a CAIO
   wants the evidence discipline; an SES wants the plain "why it matters").

## Verification

- Every value claim carries an evidence class.
- No fixed productivity multiplier is presented as fact.
- At least one vanity metric is identified and replaced if the input used one.
- Any cost figure is labeled estimate vs. audited, with its basis.
- The "50% faster" style question is answered with a qualified, ranged answer.

## Examples

**"Does AI coding make developers 50% faster?"**
> There is no honest single number. External research is mixed and moves fast:
> some controlled studies found AI *slowing* experienced developers on familiar
> tasks, while later self-reports show gains. The effect depends on the task
> (boilerplate and investigation benefit most), the tool (agentic workflows differ
> from autocomplete), and the developer's experience. A defensible framing is to
> measure our own delivery metrics — cycle time, rework, defects caught before
> merge — rather than adopt a fixed multiplier. *(Evidence class: published
> research, conflicting.)*

## Related Patterns

- [`technical-concept-translator`](../technical-concept-translator/SKILL.md)
- [`software-delivery-explainer`](../software-delivery-explainer/SKILL.md)
- [`design-artifact`](../../../../workflows/design-artifact/SKILL.md)

## Human Review Checklist

- [ ] Every claim has an evidence class.
- [ ] No unsupported productivity multiplier.
- [ ] Vanity metrics rejected/replaced; effort paired with quality.
- [ ] Cost figures labeled estimate vs. audited, with method.
- [ ] Conflicting research shown as a range, not cherry-picked.
