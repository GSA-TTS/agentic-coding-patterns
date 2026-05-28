# Claude Projects Integration

This directory shows how to use patterns with Claude Projects custom instructions.

## Overview

Claude Projects allow custom instructions that guide Claude's behavior. Patterns can be adapted for this format.

## Quick Setup

1. Create a new Claude Project
2. Copy pattern content to custom instructions
3. Adapt format for conversational context
4. Test with sample tasks

## Example Adaptations

- [QA Round Review Instructions](./qa-round-instructions.txt)

## Format Differences

| Pattern (SKILL.md) | Claude Projects |
|-------------------|-----------------|
| Structured sections | Conversational tone |
| YAML frontmatter | Natural language |
| Step-by-step procedures | Guidelines & principles |
| Output contracts | Expected deliverables |

## Conversion Tips

### 1. Conversational Tone

Convert procedural steps to guidance:

**Pattern:**

```
1. Read the specification
2. Check for ambiguities
3. Validate examples
```

**Claude:**

```
You are a specification reviewer. When reviewing specs:
- Look for ambiguous requirements
- Verify examples match requirements
- Check completeness and testability
```

### 2. Focus on Principles

Extract core principles, not just steps:

```
You prioritize:
- Clarity over cleverness
- Testability over complexity
- User needs over technical elegance
```

### 3. Context Awareness

Claude Projects are conversational, so:

```
When asked to review code:
1. First, understand the context
2. Ask clarifying questions if needed
3. Then apply the review criteria
4. Provide actionable feedback
```

## Character Limit

Claude Projects custom instructions have a character limit. Prioritize:

1. Core principles (must-have)
2. Critical prohibitions (security)
3. Example format (helpful)
4. Edge cases (nice-to-have)

## See Also

- [Claude Projects Documentation](https://claude.ai/help)
- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [Pattern Library](../../)
