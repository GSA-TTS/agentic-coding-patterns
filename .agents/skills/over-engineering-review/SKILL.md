---
id: over-engineering-review
version: "1.0.0"
title: "Over-Engineering Review"
type: skill
description: "Review a diff or codebase for unnecessary complexity, speculative abstraction, and avoidable dependencies, returning a prioritized simplification (delete) list"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "review"
  - "development"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "over-engineering"
  - "simplify"
  - "too complex"
  - "yagni"
  - "delete code"
  - "reduce complexity"

tags:
  - "simplicity"
  - "yagni"
  - "refactoring"
  - "review"
  - "maintainability"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review a diff or module for unnecessary complexity before merge"
    - "Identify speculative features, premature abstraction, and avoidable dependencies"
    - "Produce a prioritized simplification (delete) list"
  exclusions:
    - "Not a correctness or security review (use secure-code-review for that)"
    - "Not a license to remove validation, error handling, security, or accessibility"
    - "Not a style/formatting linter"
---

# Skill: Over-Engineering Review

Review a code change (or an existing module) for unnecessary complexity and return
a prioritized **simplification list** — concrete things to delete, inline, or
replace with something simpler. The goal is *less code because it is necessary*,
not code golf.

This skill operationalizes the **Laziness Ladder** from the agentic-coding-playbook
(`docs/CODING_PRACTICES.md` §13.1.1). It is inspired by the open-source
[ponytail](https://github.com/DietrichGebert/ponytail) ruleset (MIT).

## When to Use

- Reviewing a pull request that feels heavier than the problem it solves
- A module has grown layers of indirection, config, or abstraction
- Before adopting a new dependency for something small
- User asks "is this over-engineered?", "can this be simpler?", or "what can we delete?"

## Prerequisites

- Access to the diff or code under review
- Understanding of what the code is actually *required* to do right now
- The project's existing dependencies (to spot reinvention and redundant adds)

## The Non-Negotiables (read first)

Simpler is the goal, but the following are **never** removed in the name of
simplicity. If a "simplification" touches one of these, it is out of scope —
flag it and stop:

- **Input validation** at trust boundaries
- **Error handling** that prevents data loss or silent failure
- **Security controls** (authn/authz, secrets handling, escaping)
- **Accessibility** (Section 508 / WCAG)
- Anything **explicitly requested** by the user or a requirement

Non-trivial logic must keep at least one runnable check (a test or assertion).
Recommend *adding* a check if one is missing — never deleting the last one.

## Procedure

### Step 1: Establish the actual requirement

Before judging complexity, state in one sentence what the code must do **today**.
Complexity is only "over"-engineering relative to a real requirement. Note any
genuine, known-near-term requirement the author cited — that is not speculation.

### Step 2: Walk the Laziness Ladder in reverse

For each unit (function, class, module, dependency), ask whether a lower rung
would have sufficed. Flag where a simpler rung was available:

| Rung | Question | Smell to flag |
|------|----------|---------------|
| 1 | Does this need to exist? | Dead code, unused export, speculative feature (YAGNI) |
| 2 | Does the stdlib do it? | Hand-rolled what the standard library already provides |
| 3 | Native platform feature? | Reimplemented a built-in framework/runtime capability |
| 4 | Existing dependency? | New dependency for something an installed one already does |
| 5 | Could it be one line? | Multi-line ceremony for a trivial operation |
| 6 | Minimum code? | Extra layers, indirection, or configurability with no current user |

### Step 3: Look for the common over-engineering patterns

- **Premature abstraction** — an interface/base class/factory with a single
  implementation (violates the Rule of Three; see CODING_PRACTICES §13.2)
- **Speculative configurability** — flags, options, or extension points no
  current caller uses
- **Indirection without payoff** — wrappers that only forward calls
- **Dependency for a one-liner** — adding a package to avoid a few lines of code
- **Generic where specific would do** — type gymnastics for cases that cannot occur
- **Copy that should be deleted** — duplicated logic kept "just in case"

### Step 4: Classify each finding by confidence and benefit

- **Delete** — clearly unnecessary; removal reduces code with no loss
- **Inline / simplify** — collapse an abstraction or replace with a lower rung
- **Question** — looks speculative; ask the author whether a real requirement exists
- For each, estimate the benefit (lines/deps removed, fewer concepts) and any risk.

### Step 5: Confirm the non-negotiables are intact

Re-check that no proposed change removes validation, error handling, security, or
accessibility, and that non-trivial logic still has a runnable check. Drop or
re-scope any finding that would.

## Verification

- Every finding cites a specific location and the rung/pattern it violates
- No finding removes a non-negotiable (Step 5 passed)
- The simplification list is ordered by benefit, with risk noted
- If nothing is over-engineered, say so plainly — a clean review is a valid result

## Output Format

### Summary

One paragraph: the requirement (Step 1), overall assessment, and the headline
simplification opportunity (or "no over-engineering found").

### Findings

A prioritized list. For each:

```
[Delete | Simplify | Question] <location>
  Rung/Pattern: <which ladder rung or pattern, e.g. "Rung 4: dependency for a one-liner">
  Why:          <what is unnecessary, relative to the Step 1 requirement>
  Suggestion:   <the simpler alternative>
  Benefit:      <lines/deps/concepts removed>
  Risk:         <none | low | note>
```

## Examples

**Premature abstraction (Rung 1 / Rule of Three):**

```python
# Flagged: single-implementation interface + factory for one concrete type
class StorageBackend(ABC):
    @abstractmethod
    def save(self, data): ...

class LocalStorage(StorageBackend):
    def save(self, data): ...

def make_storage() -> StorageBackend:
    return LocalStorage()

# Suggestion: there is one implementation and no second on the horizon —
# use LocalStorage directly. Reintroduce the interface at the Rule of Three.
```

**Dependency for a one-liner (Rung 4/5):**

```javascript
// Flagged: added `is-odd` dependency
import isOdd from "is-odd";
if (isOdd(n)) { ... }

// Suggestion: one line, no dependency
if (n % 2 !== 0) { ... }
```

**A finding that must NOT be made (non-negotiable):**

```python
# Do NOT flag this as "redundant" — it is input validation at a trust boundary
if not isinstance(user_id, int) or user_id < 0:
    raise ValueError("invalid user_id")
```

## References

- agentic-coding-playbook: `docs/CODING_PRACTICES.md` §13.1.1 (Laziness Ladder),
  §13.1 (KISS/YAGNI), §13.2 (DRY / Rule of Three)
- agentic-coding-playbook: `docs/decisions/0001-adopt-laziness-ladder.md`
- [ponytail](https://github.com/DietrichGebert/ponytail) (MIT) — inspiration
