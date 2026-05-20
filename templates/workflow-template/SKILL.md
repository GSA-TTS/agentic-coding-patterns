---
# Required fields
id: your-workflow-name
version: "1.0.0"
title: "Human-Readable Workflow Title"
type: workflow                   # This is a workflow (multi-step process)
description: "One sentence describing this end-to-end workflow"

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
  skills: []                     # Other skills/patterns used in this workflow

# Output specification
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Outcome"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

# Quality requirements
quality_gates:
  readability_max_grade: 10
  citations_required: false

# Recommended fields
# triggers: ["workflow keyword", "process name"]
# tags: ["workflow", "category"]
---

# Workflow: Your Workflow Title

Brief description of this end-to-end workflow (2-3 sentences). Explain what problem it solves and what the outcome is.

## When to Use

- You need to complete [end-to-end process]
- Multiple steps must be coordinated
- Consistency across [specific process] is important

## Overview

```
[Input] → [Step 1] → [Step 2] → [Step 3] → [Output]
```

Brief explanation of the workflow stages.

## Prerequisites

- Tools or access required
- Knowledge needed
- Initial setup completed

## Workflow Steps

### Step 1: [Phase Name]

**Goal:** What this phase accomplishes

**Actions:**
1. First action
2. Second action
3. Third action

**Outputs:**
- What this step produces
- Artifacts created

**Verification:**
- [ ] Check 1
- [ ] Check 2

**Related patterns:** [skill-name](../../skills/skill-name/SKILL.md)

---

### Step 2: [Phase Name]

**Goal:** What this phase accomplishes

**Actions:**
1. First action
2. Second action

**Inputs from previous step:**
- What's needed from Step 1

**Outputs:**
- What this step produces

**Verification:**
- [ ] Check 1
- [ ] Check 2

**Related patterns:** [prompt-name](../../prompts/category/prompt-name/SKILL.md)

---

### Step 3: [Phase Name]

**Goal:** Final phase objective

**Actions:**
1. Final actions

**Outputs:**
- Final deliverables

**Verification:**
- [ ] Check 1
- [ ] Check 2

## Complete Workflow Checklist

Use this to verify the entire workflow:

- [ ] Step 1 completed successfully
- [ ] Step 2 outputs validated
- [ ] Step 3 delivered expected results
- [ ] No security issues introduced
- [ ] Documentation updated
- [ ] All tests passing

## Example Walkthrough

### Scenario
[Describe a concrete example]

### Execution
**Step 1:** [What happened]
**Step 2:** [What happened]
**Step 3:** [What happened]

### Outcome
[Final result achieved]

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Problem X | Why it happens | How to fix |
| Problem Y | Why it happens | How to fix |

## Variations

### Variation 1: [Use Case]
Modify the workflow by [changes].

### Variation 2: [Use Case]
For different context, adapt [steps].

## Exit Criteria

The workflow is complete when:
- [ ] All steps completed
- [ ] Deliverables meet quality standards
- [ ] Verification checks pass
- [ ] Documentation updated
- [ ] Stakeholders notified

## Related Patterns

- [skill-name](../../skills/skill-name/SKILL.md) - Used in Step 1
- [prompt-name](../../prompts/category/prompt-name/SKILL.md) - Used in Step 2
- [other-workflow](../other-workflow/SKILL.md) - Similar process

## References

- Process documentation: [link]
- Standards: [link if applicable]
