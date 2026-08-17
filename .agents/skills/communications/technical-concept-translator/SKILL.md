---
id: technical-concept-translator
name: technical-concept-translator
version: "0.1.0"
title: "Technical Concept Translator"
description: "Translate one software-engineering, security, or agentic-system concept into an accurate executive mental model — what it is, why it matters, what it is NOT, where it fits, and its control implications — without dumbing it down into something technically wrong."
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
      - "Concept"
      - "Plain-Language Explanation"
      - "Why It Matters"
      - "What It Is Not"
      - "Where It Fits"
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
  - "explain this concept to an executive"
  - "what is a pull request in plain language"
  - "translate this technical term for leadership"
tags:
  - "communications"
  - "explainer"
  - "executive"
routing:
  task_types:
    - transform
    - author
  input_artifacts:
    - documentation
  output_artifacts:
    - documentation
  aliases:
    - "concept explainer"
    - "executive glossary"
  prefer_when:
    - "a single technical/security/agentic concept must be explained accurately to a non-engineering audience"
  avoid_when:
    - "the request is to build a full artifact (one-pager/deck) — use the design-artifact workflow"
    - "the request is to explain the whole delivery process — use software-delivery-explainer"
    - "the request is to argue organizational value — use agentic-value-analyst"
  priority: 55
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
scope:
  intended_use:
    - "Explaining one concept (repository, PR, sandbox, agent vs model vs harness, AGENTS.md, secret, etc.) to executives"
    - "Building or extending the executive concept library"
  exclusions:
    - "Producing rendered artifacts (use the design-artifact workflow)"
    - "Making organizational value or ROI claims (use agentic-value-analyst)"
    - "Any explanation that must sacrifice technical accuracy for simplicity"
---

# Skill: Technical Concept Translator

## Summary

Take **one** engineering, security, or agentic-system concept and produce an
accurate executive mental model. The goal is an explanation an executive
understands **without making an engineer wince at the inaccuracy**. Simplify the
language, never the truth.

## When to Use

- "Explain a pull request to a senior executive who has never written software."
- "What is a sandbox, and why does it matter to a CISO?"
- "What is the difference between a model, an agent, a harness, AGENTS.md, and a skill?"
- Building or extending the [executive concept library](reference/concept-library.md).

## When NOT to Use

- You need a finished one-pager or deck → use the `design-artifact` workflow.
- You need to explain the whole delivery pipeline → `software-delivery-explainer`.
- You need to argue value/ROI → `agentic-value-analyst`.

## Prerequisites

- The concept to explain.
- The audience (optional but recommended — see
  [audience profiles](reference/audience-profiles.md)).
- The [concept library](reference/concept-library.md) as ground truth.

## Procedure

1. **Look it up first.** Check the [concept library](reference/concept-library.md).
   If the concept is there, use that entry as the factual base. If it is not,
   derive the explanation from a cited source (playbook/quickstart docs) — do
   **not** invent facts. If you cannot ground a claim, say so.
2. **Fill the structured model** for the concept:
   - **Concept** — the term.
   - **Plain-Language Explanation** — one accurate sentence a non-engineer gets.
   - **Why It Matters** — the leadership-relevant "so what".
   - **What It Is Not** — bound it; stop a false mental model forming. This
     section is required because the most common failure is a tidy-but-wrong analogy.
   - **Where It Fits** — its place in the process or architecture.
   - **Controls** (when relevant) — the security/governance implication, honestly
     bounded (e.g., the sandbox is isolation, *not* a perfect guarantee).
   - **Analogy** (optional) — include **only** if it improves understanding
     without creating a false model. If the closest analogy would mislead, omit it
     and say why in one line.
3. **Adapt depth to the audience** using the
   [audience profiles](reference/audience-profiles.md). Offer 30-second /
   3-minute / deeper variants when the request implies more than one setting.
4. **No jargon substitution.** Replacing one technical word with five vague
   business words is not a translation. Keep a precise technical term when it is
   the honest word; define it in one clause.
5. **Preserve the honesty caveats.** For the sandbox, secrets, and agent-autonomy
   concepts, carry the "what it is not" limits from the concept library verbatim
   in spirit — especially: secrets are proxied into the sandbox on both backends
   in the default setup (the agent does not hold raw key material), the sandbox
   does not verify image integrity, and the agent cannot approve or merge its own
   work.

## Verification

- Every required section is present, including **What It Is Not**.
- No claim is stronger than its source; security claims trace to a cited doc.
- The explanation would not make a knowledgeable engineer wince.
- No jargon is introduced without a plain definition.
- Any analogy improves rather than distorts; if none does, none is used.

## Examples

**"Explain a pull request to an SES."**
> **Concept:** Pull request (PR).
> **Plain-language:** A proposal to add a set of changes to the official code,
> opened so people can review it before anything is accepted.
> **Why it matters:** It is the checkpoint where a person inspects and approves a
> change before it becomes part of the system — the accountability gate.
> **What it is not:** It is not an automatic change and not a release; opening one
> changes nothing live by itself.
> **Where it fits:** After the work is done on a separate branch and automated
> checks have run; before the change is merged.
> **Controls:** A reviewer who is not the author approves it; the person or agent
> that wrote the change cannot approve their own.

**"Model vs. agent vs. harness vs. AGENTS.md vs. skill."** — Pull the five concept-library
entries and present them as a short contrast set: the **model** is the raw
intelligence (takes no action); the **agent** uses the model plus tools to do
work in a loop; the **harness** is the program that runs the agent and enforces
its limits; **AGENTS.md** is the rules file the harness reads (a guide, not
enforcement); a **skill** is a reusable instruction set the agent loads for a
specific task.

## Related Patterns

- [`software-delivery-explainer`](../software-delivery-explainer/SKILL.md) — the whole process.
- [`agentic-value-analyst`](../agentic-value-analyst/SKILL.md) — value framing.
- [`design-artifact`](../../../workflows/design-artifact/SKILL.md) — render an artifact (`technical-explainer` profile).
- [`plain-language-review`](../../frontend/plain-language-review/SKILL.md) — readability check.

**How this differs (not a duplicate):** `plain-language-review` *reviews existing
content* for readability; this skill *generates a new, accurate mental model* of a
concept. `narrative-architect` structures a story for an artifact; this produces a
factual concept explanation, not a narrative. `one-pager`/`slide-deck` *render*
finished files; this is a content source, not a renderer.

## Human Review Checklist

- [ ] Facts trace to the concept library or a cited source; nothing invented.
- [ ] "What It Is Not" is present and correct.
- [ ] Sandbox / secrets / autonomy caveats are intact and accurate.
- [ ] No misleading analogy; no undefined jargon.
- [ ] Depth matches the stated audience.
