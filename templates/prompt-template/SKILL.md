---
# Required fields
id: your-prompt-name
version: "1.0.0"
title: "Human-Readable Prompt Title"
type: prompt                     # This is a prompt, not a skill
description: "One sentence describing what this prompt generates"

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
      - "Summary"
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
# triggers: ["keyword1", "keyword2"]
# tags: ["category1", "category2"]
# portability:
#   opencode: true
#   cursor: true
#   claude_projects: true
#   chatgpt: true
#   generic_llm: true
---

# Prompt: Your Prompt Title

Brief description of what this prompt generates (2-3 sentences). Explain the use case and expected output.

## When to Use

- Scenario 1 when you need this prompt
- Scenario 2 when this prompt is helpful
- User needs to generate [specific output type]

## Prerequisites

- Access to LLM (OpenCode, Claude, ChatGPT, etc.)
- Input data or context required
- Any specific knowledge needed

## Prompt

```
You are a [role] helping with [task].

Your goal is to [specific objective].

## Context
[Provide relevant context here]

## Input
--- USER INPUT START ---
[User provides input here]
--- USER INPUT END ---

## Requirements
- [Requirement 1]
- [Requirement 2]
- Output format: [specify format]

## Prohibited Content
Do NOT include:
- Secrets, credentials, API keys
- Personal information
- Internal system details
- Unsupported claims without citations

## Output Structure
Provide your response with these sections:
1. Summary
2. [Section 2]
3. [Section 3]
```

## Usage Example

### Input

```
Example user input
```

### Expected Output

```
Example of what the prompt should generate
```

## Verification

Check that the output:

- [ ] Follows the required structure
- [ ] Contains no prohibited content
- [ ] Meets quality requirements
- [ ] Is accurate and actionable

## Variations

### Variation 1: [Use Case]

Adapt the prompt by changing [specific part].

### Variation 2: [Use Case]

For different context, modify [specific section].

## Related Patterns

- [related-skill](../../skills/related/SKILL.md) - Complementary pattern
- [related-prompt](../related/SKILL.md) - Similar prompt

## References

- Documentation: [link if applicable]
- Standards: [link if making compliance claims]
