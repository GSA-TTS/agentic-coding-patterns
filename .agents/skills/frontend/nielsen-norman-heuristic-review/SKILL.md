---
# Required fields — fill in all of these
id: nielsen-norman-heuristic-review
version: "1.0.0"
title: "Nielsen Norman Heuristic Review"
type: skill
description: "Conduct a usability heuristic evaluation of a product, design, prototype, or interface using Jakob Nielsen's Ten Usability Heuristics (Nielsen Norman Group)."

# Goose skill discovery (in addition to id/title above)
name: nielsen-norman-heuristic-review

# Status and ownership
status: experimental
owners:
  - "@nolanharrington"

# Audience
primary_personas:
  - developers
  - designers
  - product managers

# Dependencies
requires:
  anchors: []

# Output specification
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings by Heuristic"
      - "Findings Table"
      - "Top Recommendations"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

# Quality requirements
quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "heuristic evaluation"
  - "usability review"
  - "UX audit"
  - "usability heuristics"
  - "review this design"
  - "critique this interface"
  - "Nielsen Norman"

tags:
  - "ux"
  - "usability"
  - "design-review"
  - "heuristic-evaluation"
  - "nielsen-norman"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Evaluating a UI/UX design, prototype, mockup, or live product against the 10 Nielsen Norman usability heuristics"
    - "Producing a structured, actionable usability audit with severity ratings and recommendations"
  exclusions:
    - "Substituting for moderated usability testing with real users"
    - "Accessibility (WCAG) conformance auditing (use a dedicated accessibility skill instead)"
    - "Visual/brand design critique unrelated to usability"

changelog:
  - version: "1.0.0"
    date: "2026-08-28"
    change_type: major
    summary: "Initial release, derived from the NN/g 'Jakob's Ten Usability Heuristics' summary PDF."
---

# Skill: Nielsen Norman Heuristic Review

This skill evaluates a user interface, design mockup, prototype, or existing
product against Jakob Nielsen's Ten Usability Heuristics (Nielsen Norman
Group). It turns informal design feedback into a structured, evidence-based
usability audit with severity ratings and concrete recommendations, instead
of vague opinions about whether a design "feels right."

## When to Use

- The product owner asks for a "heuristic evaluation," "usability review," or "UX
  audit" of a design, app, website, or feature.
- A colleague shares screenshots, a Figma file, a live URL, or a description of
  an interface and wants usability feedback.
- The technologist wants to critique or improve the usability of something they are
  designing or building.
- A colleague asks "how do I know if this design is usable?" or "what's wrong with
  this UI?"

## Prerequisites

- An artifact to review: screenshots, a live URL, a Figma link, a
  prototype, or a detailed written description of the interface/flow.
- Clarity on scope: which screen(s) or flow(s) are in scope for review.
- No special tools or access are required beyond the ability to view the
  artifact (image viewer, browser, or design tool access).

## Procedure

### Step 1: Clarify Scope

Confirm what is being reviewed (a specific flow, a single screen, or a full
product) and what artifacts are available. Ask for anything missing that's
needed to actually see the interface (e.g., a screenshot or link).

### Step 2: Walk the Interface

Go through the relevant user flow(s) step-by-step, noting the state of the
UI at each step (what the user sees, what actions are available, what
feedback the system gives).

### Step 3: Evaluate Against Each of the 10 Heuristics

For each heuristic below, state whether the design satisfies, partially
satisfies, or violates it. Cite the specific element/screen/interaction
observed. If violated, explain the usability impact on the user.

1. **Visibility of System Status** — Designs should keep users informed
   about what is going on, through appropriate, timely feedback.
   *Example:* Interactive mall maps show people where they currently are,
   to help them understand where to go next.

2. **Match Between the System and the Real World** — The design should
   speak the users' language: words, phrases, and concepts familiar to the
   user, rather than internal jargon.
   *Example:* Users can quickly understand which stovetop control maps to
   each heating element.

3. **User Control and Freedom** — Users often perform actions by mistake.
   They need a clearly marked "emergency exit" to leave the unwanted
   action.
   *Example:* Just like physical spaces, digital spaces need quick
   "emergency" exits too (e.g., Cancel, Undo, Back).

4. **Consistency and Standards** — Users should not have to wonder whether
   different words, situations, or actions mean the same thing. Follow
   platform conventions.
   *Example:* Check-in counters are usually located at the front of hotels,
   which meets expectations.

5. **Error Prevention** — Good error messages are important, but the best
   designs carefully prevent problems from occurring in the first place.
   *Example:* Guard rails on curvy mountain roads prevent drivers from
   falling off cliffs.

6. **Recognition Rather Than Recall** — Minimize the user's memory load by
   making elements, actions, and options visible. Avoid making users
   remember information from one part of the interface to another.
   *Example:* Regular routes are listed on maps, but locals with more
   knowledge of the area can take shortcuts.

7. **Flexibility and Efficiency of Use** — Shortcuts, hidden from novice
   users, may speed up the interaction for the expert user, so the design
   can cater to both inexperienced and experienced users.
   *Example:* People are likely to correctly answer "Is Lisbon the capital
   of Portugal?" without needing to look it up — expert shortcuts work the
   same way.

8. **Aesthetic and Minimalist Design** — Interfaces should not contain
   irrelevant information. Every extra unit of information competes with
   the relevant units and diminishes their relative visibility.
   *Example:* A minimalist three-legged stool is still a place to sit.

9. **Help Users Recognize, Diagnose, and Recover from Errors** — Error
   messages should be expressed in plain language (no error codes),
   precisely indicate the problem, and constructively suggest a solution.
   *Example:* Wrong-way signs on the road remind drivers that they are
   heading in the wrong direction.

10. **Help and Documentation** — It's best if the design doesn't need any
    additional explanation. However, it may be necessary to provide
    documentation to help users complete their tasks. Any such information
    should be easy to search, focused on the user's task, and list concrete
    steps to be carried out.
    *Example:* Information kiosks at airports are easily recognizable and
    solve customers' problems in context and immediately.

### Step 4: Rate Severity of Each Issue Found

Use this scale for every issue identified in Step 3:

- **0 – Not a problem**
- **1 – Cosmetic** (fix if time permits)
- **2 – Minor** (low priority)
- **3 – Major** (important, should fix)
- **4 – Catastrophic** (must fix before release)

### Step 5: Recommend Fixes

For each issue, give a concrete, actionable recommendation tied to the
violated heuristic — not just "make it better."

### Step 6: Summarize

Produce a findings table:

| # | Heuristic | Location | Issue | Severity | Recommendation |
|---|-----------|----------|-------|----------|-----------------|

Then give a short, prioritized list of the top 3–5 fixes to address first
(highest severity, lowest effort first, when reasonable).

## Verification

After completing this skill, verify that:

- [ ] All 10 heuristics were considered (explicitly noted as "no issues" if
      not applicable)
- [ ] Every finding cites a specific element, screen, or interaction
- [ ] Every finding has a severity rating (0–4)
- [ ] Every issue has a concrete, actionable recommendation
- [ ] The findings table is sorted by severity, highest first
- [ ] Output includes all required sections: Summary, Findings by
      Heuristic, Findings Table, Top Recommendations
- [ ] No secrets, real PII, real CUI, or internal URLs appear in the output

## Examples

### Example 1: Reviewing a Checkout Flow

**Input:**

```
Review these 3 screenshots of our checkout flow for usability issues.
```

**Output:**

```
## Summary
Reviewed the 3-step checkout flow (cart → shipping → payment) against
the 10 Nielsen Norman usability heuristics. Found 4 issues, 1 major,
3 minor.

## Findings by Heuristic
### Visibility of System Status
- Violation: No step indicator (e.g., "Step 2 of 3") is shown on the
  shipping screen, so users can't tell how much of the flow remains.

### Error Prevention
- Violation: The "Place Order" button is enabled even when required
  fields are empty, allowing a failed submission instead of preventing it.

## Findings Table
| # | Heuristic | Location | Issue | Severity | Recommendation |
|---|-----------|----------|-------|----------|-----------------|
| 1 | Error Prevention | Payment screen | Submit enabled with empty required fields | 3 | Disable "Place Order" until all required fields are valid |
| 2 | Visibility of System Status | Shipping screen | No step indicator | 2 | Add a persistent "Step X of 3" progress indicator |

## Top Recommendations
1. Disable submission until required fields are valid (Error Prevention).
2. Add a persistent step indicator across all checkout screens (Visibility
   of System Status).
```

### Example 2: No Artifact Provided (Edge Case)

**Input:**

```
Can you do a heuristic review of our app?
```

**Output:**

```
I'd be glad to run a Nielsen Norman heuristic review. To do that I need
to see the interface — could you share screenshots, a live URL, or a
Figma link, and let me know which flow(s) or screen(s) are in scope?
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Review feels vague or generic | No concrete artifact was reviewed | Ask the user for screenshots, a URL, or a Figma link before evaluating |
| User treats findings as validated by real users | Heuristic evaluation is an expert review, not user testing | Explicitly note this is an expert heuristic evaluation and recommend usability testing with real users for validation |
| Too many low-value findings (severity 0–1) reported | Every minor cosmetic nit was logged | Focus the Findings Table and Top Recommendations on severity 2+ issues; mention severity 0–1 items briefly if at all |

## Related Patterns
- [plain-language-review](https://github.com/GSA-TTS/agentic-coding-patterns/blob/main/.agents/skills/frontend/plain-language-review/SKILL.md)
- [accessibility-review](https://github.com/GSA-TTS/agentic-coding-patterns/blob/main/.agents/skills/frontend/accessibility-review/SKILL.md)

## References

- [Jakob's Ten Usability Heuristics for User Interface Design — Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/)
- Source PDF: "Heuristic Summary" (Nielsen Norman Group), converted into this skill.
