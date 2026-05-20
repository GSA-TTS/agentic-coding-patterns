---
# Required fields — fill in all of these
id: your-skill-name              # Must match directory name. Lowercase, hyphens only. Never change after creation.
version: "1.0.0"                 # Semantic versioning: MAJOR.MINOR.PATCH
title: "Human-Readable Skill Title"
type: skill                      # skill | prompt | workflow | lesson (REQUIRED)
description: "One sentence describing what this skill does and when to use it"

# Status and ownership
status: experimental             # experimental | recommended | deprecated (start with experimental)
owners:
  - "@your-github-handle"        # GitHub handle(s) responsible for this skill

# Audience
primary_personas:
  - developers                   # Who is this for? developers | security | documentation | testers | all

# Dependencies
requires:
  anchors: []                    # Other patterns to load first (usually empty)

# Output specification
output:
  format: markdown               # markdown | json | yaml | text
  contract:
    required_sections:
      - "Summary"                # Sections that must appear in output
    prohibited_content:          # Content that must NEVER appear (minimum 4)
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

# Quality requirements
quality_gates:
  readability_max_grade: 10      # Maximum Flesch-Kincaid grade level (8 = general public, 10 = technical)
  citations_required: false      # true if making compliance/regulatory claims

# Recommended fields below (uncomment and fill in as needed)

# triggers:                      # Keywords that suggest using this skill
#   - "keyword1"
#   - "keyword2"

# tags:                          # Keywords for discovery and filtering
#   - "tag1"
#   - "tag2"

# portability:                   # Tool compatibility flags
#   opencode: true
#   cursor: true
#   claude_projects: true
#   chatgpt: true
#   generic_llm: true

# scope:
#   intended_use:
#     - "What this skill is designed for"
#   exclusions:
#     - "What NOT to use this skill for"

# compliance:                    # If applicable
#   frameworks:
#     - "Framework name"
#   nist_controls:
#     - "AC-3"

# changelog:                     # Version history
#   - version: "1.0.0"
#     date: "2026-05-20"
#     change_type: major
#     summary: "Initial release"
---

# Skill: Your Skill Title

Brief description of what this skill does (2-3 sentences). Explain the problem it solves and when someone would use it.

## When to Use

- Scenario 1 when this skill is helpful
- Scenario 2 when you should reach for this skill
- User asks "how do I [specific task]?"
- You encounter [specific problem this solves]

## Prerequisites

- Required tool or software (e.g., Python 3.11+, git, specific library)
- Required knowledge (e.g., familiarity with REST APIs)
- Required access or permissions (e.g., repository write access)
- Required setup steps (e.g., environment variables configured)

## Procedure

### Step 1: First Step Title

Describe what to do in this step. Be specific and actionable.

```bash
# Example command or code
command --option value
```

Expected output or what should happen after this step.

### Step 2: Second Step Title

Continue with the next step.

```python
# Example code if relevant
def example_function():
    return "result"
```

### Step 3: Third Step Title

Keep steps focused and manageable. Break complex steps into substeps if needed.

## Verification

After completing this skill, verify that:

- [ ] First expected outcome was achieved
- [ ] Second expected outcome was achieved
- [ ] No errors in output
- [ ] Results match expected format

```bash
# Verification command if applicable
verify-command
```

## Examples

### Example 1: Common Use Case

Show a concrete example of using this skill.

**Input:**
```
Example input
```

**Output:**
```
Expected output
```

### Example 2: Edge Case (if relevant)

Show how to handle a tricky situation.

## Troubleshooting

Common issues and solutions:

| Issue | Cause | Solution |
|-------|-------|----------|
| Error message X | Why it happens | How to fix |
| Unexpected behavior Y | Why it happens | How to fix |

## Related Patterns

- [related-pattern](../related-pattern/SKILL.md) - For similar task
- [complementary-pattern](../../prompts/complementary/SKILL.md) - Use together

## References

- [Documentation or source](https://example.com)
- For policy requirements, see [playbook section](https://github.com/GSA-TTS/agentic-coding-playbook)
