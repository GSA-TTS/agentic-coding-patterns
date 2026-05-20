---
# Required fields
id: your-lesson-name
version: "1.0.0"
title: "Human-Readable Lesson Title"
type: lesson                     # This is a lesson learned
description: "One sentence summary of the lesson and context"

# Status and ownership
status: experimental
owners:
  - "@your-github-handle"

# Audience
primary_personas:
  - developers

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
# tags: ["tool-name", "pattern-type", "outcome"]
# scope:
#   intended_use:
#     - "Learn from real experience with [tool/pattern]"
#   exclusions:
#     - "Not a tutorial or how-to guide"
---

# Lesson Learned: Your Lesson Title

Brief summary of the lesson (2-3 sentences). What was tried, what was learned, and why it matters.

## Context

### Project/Task
Describe what you were working on (anonymize if needed):
- Type of project (e.g., web app, API, documentation)
- Scale (e.g., small feature, large refactor)
- Timeline (e.g., 2 days, 2 weeks)

### Tools Used
- AI coding tool(s): [OpenCode, Claude, Copilot, Cursor, etc.]
- Patterns/skills applied: [link to patterns if applicable]
- Programming language/framework
- Team size/composition

### Initial Goals
What were you trying to accomplish?
- Goal 1
- Goal 2
- Goal 3

## Approach

### What We Did
Describe the approach taken:
1. First step/decision
2. Second step/decision
3. Third step/decision

### Patterns Applied
Link to specific patterns used:
- [pattern-name](../../skills/pattern-name/SKILL.md) - How it was used
- [pattern-name](../../prompts/category/pattern-name/SKILL.md) - How it was used

### Key Decisions
Major decisions made during the work:
- **Decision:** [What was decided]
  - **Rationale:** [Why]
  - **Outcome:** [What happened]

## Outcomes

### What Worked Well ✅
- Success 1 and why it worked
- Success 2 and why it worked
- Success 3 and why it worked

### What Didn't Work ❌
- Challenge 1 and why it failed
- Challenge 2 and why it failed
- Challenge 3 and why it failed

### Unexpected Results
Surprises (positive or negative):
- Unexpected outcome 1
- Unexpected outcome 2

### Metrics (if applicable)
Quantitative results:
- Time saved/spent: X hours
- Code coverage: X%
- Bugs introduced: X
- Review cycles: X

## Learnings

### Key Takeaways
1. **Learning 1:** [What you learned]
   - **Why it matters:** [Context]
   - **Applicability:** [When to apply this]

2. **Learning 2:** [What you learned]
   - **Why it matters:** [Context]
   - **Applicability:** [When to apply this]

3. **Learning 3:** [What you learned]
   - **Why it matters:** [Context]
   - **Applicability:** [When to apply this]

### Pattern Recommendations

Based on this experience:

| Pattern | Recommendation | Notes |
|---------|----------------|-------|
| [pattern-name] | ✅ Recommended | Works well for [use case] |
| [pattern-name] | ⚠️ Use with caution | Requires [condition] |
| [pattern-name] | ❌ Not recommended | Better alternatives exist |

### What We'd Do Differently

If starting over:
1. Change 1 and why
2. Change 2 and why
3. Change 3 and why

## Recommendations

### For Similar Projects
If you're working on something similar:
- Do: [Recommendation]
- Don't: [Anti-pattern to avoid]
- Consider: [Trade-offs]

### For Tool Users
Specific advice for [tool] users:
- Tip 1
- Tip 2
- Gotcha to avoid

### For Pattern Authors
Feedback for pattern maintainers:
- Pattern X could be improved by...
- New pattern needed for...
- Documentation gap in...

## Applicability

### When This Lesson Applies
- Project type: [characteristics]
- Team size: [range]
- Timeline: [duration]
- Experience level: [required skill]

### When It Doesn't Apply
This lesson may not be relevant if:
- Different project type
- Different tool/environment
- Different constraints

## Related Content

### Patterns Used
- [pattern-name](../../skills/pattern-name/SKILL.md)
- [pattern-name](../../prompts/category/pattern-name/SKILL.md)

### Similar Lessons
- [lesson-name](../lesson-name/SKILL.md)

### Further Reading
- External resource: [link]
- Tool documentation: [link]

## Metadata

**Date of experience:** YYYY-MM-DD
**Tools/versions:** [specific versions if relevant]
**Contributors:** [anonymized roles if team effort]
**Review status:** Peer reviewed / Self-documented

---

**Note:** Lessons learned are experimental by default. They represent individual experiences and may not generalize to all contexts. Use judgment when applying learnings from this document.
