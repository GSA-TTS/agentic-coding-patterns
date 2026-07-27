---
# Required fields
id: example-agentic-session
version: "1.0.0"
title: "Example Agentic Coding Session"
type: lesson
description: "Lessons from using agentic coding patterns for a security documentation task"

# Status and ownership
status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

# Audience
primary_personas:
  - developers
  - agents

# Dependencies
requires:
  anchors: []

# Output specification
output:
  format: markdown
  contract:
    required_sections:
      - "Context"
      - "Outcomes"
      - "Learnings"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Customer Names"
      - "Proprietary Information"

# Quality requirements
quality_gates:
  readability_max_grade: 10
  citations_required: false

# Recommended fields
tags: ["documentation", "security", "multi-pattern", "success"]
categories:
  - "security"
  - "documentation"
risk_tier: low
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny
scope:
  intended_use:
    - "Learn from successful use of multiple patterns"
  exclusions:
    - "Not a tutorial or step-by-step guide"

collection: meta
routing:
  task_types:
    - "analyze"
  input_artifacts:
    - "documentation"
  output_artifacts:
    - "documentation"
  aliases:
    - "session lesson"
    - "multi-pattern example"
    - "retro"
---

# Lesson Learned: Example Agentic Coding Session

This lesson documents a successful agentic coding session where multiple patterns were combined to complete a security documentation task. Key learnings include planning with implementation-plan prompts, iterative QA rounds, and effective agent collaboration.

## Context

### Project/Task

Describe what you were working on:

- **Type of project:** Adding security control mappings to API documentation
- **Scale:** Medium feature - 8 API endpoints needing NIST control documentation
- **Timeline:** 1 day sprint

### Tools Used

- **AI coding tool:** OpenCode with Claude-4.5-Sonnet
- **Patterns applied:**
  - [implementation-plan](../../prompts/planning/implementation-plan/SKILL.md) - Initial planning
  - [secure-code-review](../../skills/secure-code-review/SKILL.md) - Security validation
  - [documentation-review](../../skills/documentation-review/SKILL.md) - Quality check
  - [qa-round](../../prompts/review/qa-round/SKILL.md) - Iterative review
- **Programming language:** Python (FastAPI)
- **Team:** Solo developer with AI assistant

### Initial Goals

What we were trying to accomplish:

- Add NIST 800-53 control mappings to existing API docs
- Ensure security accuracy and completeness
- Maintain readability for non-security personnel
- Complete validation and peer review

## Approach

### What We Did

1. **Planning phase:** Used implementation-plan prompt to break down work into 8 tasks (one per endpoint)
2. **Execution phase:** Iteratively documented each endpoint with control mappings
3. **Review phase:** Applied secure-code-review to validate mappings, then documentation-review for clarity
4. **QA rounds:** Ran 2 qa-round cycles to catch edge cases

### Patterns Applied

- **[implementation-plan](../../prompts/planning/implementation-plan/SKILL.md)** — Generated task breakdown and acceptance criteria upfront
- **[secure-code-review](../../skills/secure-code-review/SKILL.md)** — Validated control mappings for technical accuracy
- **[documentation-review](../../skills/documentation-review/SKILL.md)** — Checked readability and completeness
- **[qa-round](../../prompts/review/qa-round/SKILL.md)** — Iterative verification after each endpoint group

### Key Decisions

Major decisions made during the work:

- **Decision:** Use implementation-plan before writing any docs
  - **Rationale:** Wanted clear acceptance criteria and task boundaries upfront
  - **Outcome:** ✅ Saved time by avoiding scope creep and rework

- **Decision:** Apply secure-code-review first, documentation-review second
  - **Rationale:** Correctness before clarity (safety > readability)
  - **Outcome:** ✅ Caught 3 incorrect control mappings early

- **Decision:** Run QA rounds after every 4 endpoints instead of at the end
  - **Rationale:** Catch patterns of errors early
  - **Outcome:** ✅ Identified reusable boilerplate for remaining endpoints

## Outcomes

### What Worked Well ✅

- **Implementation-plan upfront:** Having clear tasks and acceptance criteria prevented drift and provided a checklist
- **Layered review approach:** secure-code-review → documentation-review → qa-round caught different classes of issues
- **Incremental QA:** Running qa-round halfway through revealed a pattern error that would have affected all 8 endpoints
- **Pattern reuse:** After reviewing 4 endpoints, extracted a template that accelerated the remaining 4

### What Didn't Work ❌

- **Initial scope:** First implementation-plan was too detailed (12 tasks instead of 8), had to consolidate
- **Over-reliance on secure-code-review:** Spent 20 minutes on first endpoint, realized some checks weren't relevant for docs
- **No test cases for control mappings:** Validated manually instead of creating test-cases.yml (would have caught regression later)

### Unexpected Results

Surprises during execution:

- **Positive:** documentation-review suggested simplifying jargon, which improved readability score from Grade 12 → Grade 9
- **Positive:** QA round identified 2 endpoints with duplicate control mappings (copy-paste error)
- **Negative:** secure-code-review flagged false positives for placeholder code in examples (needed to exempt examples)

### Metrics

Quantitative results:

- **Time spent:** 6 hours (estimated 8 hours without patterns)
- **Quality:** 0 security mapping errors in final peer review
- **Readability:** Improved from Grade 12 to Grade 9
- **Review cycles:** 2 QA rounds (would have been 4+ without incremental approach)

## Learnings

### Key Takeaways

1. **Learning:** Planning prompts (implementation-plan) provide high ROI
   - **Why it matters:** Clear acceptance criteria prevent scope creep and provide objective completion checkpoints
   - **Applicability:** Any multi-task effort (3+ related changes)

2. **Learning:** Incremental QA catches systematic errors early
   - **Why it matters:** Pattern errors (like copy-paste mistakes) propagate if not caught mid-work
   - **Applicability:** Repetitive tasks with 5+ similar units of work

3. **Learning:** Layered review patterns catch different issue types
   - **Why it matters:** secure-code-review finds correctness issues, documentation-review finds clarity issues, qa-round finds completeness issues
   - **Applicability:** Any work requiring multiple quality dimensions (correctness + clarity + completeness)

4. **Learning:** Not all pattern steps apply to all contexts
   - **Why it matters:** secure-code-review includes runtime security checks that don't apply to documentation
   - **Applicability:** Adapt patterns to context, don't follow blindly

### Pattern Recommendations

Based on this experience:

| Pattern | Recommendation | Notes |
|---------|----------------|-------|
| [implementation-plan](../../prompts/planning/implementation-plan/SKILL.md) | ✅ Highly Recommended | Essential for multi-task work. Start with this. |
| [secure-code-review](../../skills/secure-code-review/SKILL.md) | ✅ Recommended | Excellent for control mapping validation. Skip runtime checks for docs. |
| [documentation-review](../../skills/documentation-review/SKILL.md) | ✅ Highly Recommended | Caught clarity issues that technical review missed. |
| [qa-round](../../prompts/review/qa-round/SKILL.md) | ✅ Recommended | Run incrementally (not just at end). High value for catching edge cases. |
| [test-generation](../../skills/test-generation/SKILL.md) | ⚠️ Use with caution | We skipped this but should have created test-cases.yml for control mappings. |

### What We'd Do Differently

If starting over:

1. **Simplify the initial plan:** Ask implementation-plan for 5-8 tasks max, not exhaustive breakdown
2. **Create test cases upfront:** Use test-generation to create test-cases.yml for control mapping validation
3. **Adapt patterns more aggressively:** Skip irrelevant secure-code-review steps instead of running everything

## Recommendations

### For Similar Projects

If you're working on security documentation:

- **Do:** Use implementation-plan to define clear acceptance criteria before starting
- **Do:** Run QA rounds incrementally (every N items) to catch systematic errors
- **Do:** Layer review patterns (correctness → clarity → completeness)
- **Don't:** Skip test cases for repeatable validations (control mappings, schema checks)
- **Consider:** Extracting templates after reviewing 2-3 examples (speeds up remaining work)

### For Tool Users

Specific advice for OpenCode users:

- **Tip:** Use `@pattern-name` to load patterns mid-session without restarting
- **Tip:** Chain patterns explicitly: "First apply secure-code-review, then documentation-review"
- **Gotcha:** Some patterns assume code context - adapt for documentation/config work

### For Pattern Authors

Feedback for pattern maintainers:

- **implementation-plan:** Could include a "simplify" option for high-level task lists
- **secure-code-review:** Consider splitting into "code security" and "security documentation" variants
- **qa-round:** Add guidance on when to run incrementally vs. at end
- **New pattern needed:** "extract-template" - identify reusable patterns in completed work

## Applicability

### When This Lesson Applies

- **Project type:** Documentation, configuration, or repetitive coding tasks with security/compliance requirements
- **Team size:** Solo or small team (1-3 people)
- **Timeline:** Short sprint (1-3 days)
- **Experience level:** Intermediate - comfortable with planning and review cycles

### When It Doesn't Apply

This lesson may not be relevant if:

- **Exploratory work:** Research or prototyping without clear requirements
- **Emergency fixes:** Hotfixes where planning overhead outweighs benefits
- **Large team:** Coordination overhead may require different patterns
- **Non-security domains:** Some learnings specific to security/compliance documentation

## Related Content

### Patterns Used

- [implementation-plan](../../prompts/planning/implementation-plan/SKILL.md)
- [secure-code-review](../../skills/secure-code-review/SKILL.md)
- [documentation-review](../../skills/documentation-review/SKILL.md)
- [qa-round](../../prompts/review/qa-round/SKILL.md)

### Similar Lessons

- *Future lesson:* Agentic workflow for refactoring legacy code
- *Future lesson:* Test-driven agentic development

### Further Reading

- [NIST 800-53 Rev 5](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) - Security control catalog
- [OpenCode documentation](https://opencode.ai/docs) - Tool-specific guidance

## Metadata

**Date of experience:** 2026-05-15
**Tools/versions:** OpenCode 1.2.0, Claude-4.5-Sonnet, Python 3.11, FastAPI 0.109
**Contributors:** Solo developer (anonymized)
**Review status:** Self-documented

---

**Note:** Lessons learned are experimental by default. They represent individual experiences and may not generalize to all contexts. Use judgment when applying learnings from this document.
