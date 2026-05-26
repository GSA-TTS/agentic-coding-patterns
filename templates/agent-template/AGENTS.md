---
# Required fields — fill in all of these
id: your-agent-name              # Must match directory name. Lowercase, hyphens only. Never change after creation.
version: "1.0.0"                 # Semantic versioning: MAJOR.MINOR.PATCH
title: "Human-Readable Agent Title"
type: agent                      # This is agent instructions (not skill/prompt/workflow/lesson)
description: "One sentence describing this agent's purpose and when to use it"

# Status and ownership
status: experimental             # experimental | recommended | deprecated (start with experimental)
owners:
  - "@your-github-handle"        # GitHub handle(s) responsible for this agent

# Audience
primary_personas:
  - developers                   # Who uses this agent? developers | agents | security | all
  - agents                       # Agent instructions typically target both developers and agents

# Dependencies
requires:
  anchors: []                    # Other patterns to load first (usually empty)
  skills: []                     # Skills this agent should use

# Output specification
output:
  format: markdown               # markdown | json | yaml | text
  contract:
    required_sections:
      - "Core Principles"        # Sections that must appear in agent output
      - "Work Practices"
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

# triggers:                      # Keywords that suggest using this agent
#   - "keyword1"
#   - "keyword2"

# tags:                          # Keywords for discovery and filtering
#   - "tag1"
#   - "tag2"

# portability:                   # Tool compatibility flags
#   opencode: true               # OpenCode supports AGENTS.md
#   cursor: false                # Cursor uses .cursorrules
#   claude_projects: true        # Claude Projects support agent instructions
#   chatgpt: false               # ChatGPT uses custom instructions
#   generic_llm: true            # Works with generic LLM interfaces

# scope:
#   intended_use:
#     - "What this agent is designed for"
#   exclusions:
#     - "What NOT to use this agent for"

# changelog:                     # Version history
#   - version: "1.0.0"
#     date: "2026-05-20"
#     change_type: major
#     summary: "Initial release"
---

# Agent: Your Agent Title

Brief description of what this agent does (2-3 sentences). Explain the agent's role, what problems it solves, and when someone would use it.

> **Note:** These are specialized agent instructions. For general repository rules, see [main AGENTS.md](../../AGENTS.md)

## Core Principles

Define the agent's core operating principles (priority hierarchy):

```
principle1 > principle2 > principle3 > principle4
```

1. **Principle 1** — Brief explanation
2. **Principle 2** — Brief explanation
3. **Principle 3** — Brief explanation
4. **Principle 4** — Brief explanation

## When to Use

- Scenario 1 when this agent is helpful
- Scenario 2 when you should use this agent
- User asks "help me with [specific task]"
- Working on [specific domain/problem]

## Work Practices

### 1. First Practice Area

**MUST:**

- Required behavior 1
- Required behavior 2
- Required behavior 3

**MUST NOT:**

- Prohibited behavior 1
- Prohibited behavior 2

**Example:**

```bash
# Good example
command --correct-option
```

```bash
# Bad example - avoid this
command --wrong-option
```

### 2. Second Practice Area

**SHOULD:**

- Recommended behavior 1
- Recommended behavior 2

**SHOULD NOT:**

- Discouraged behavior 1
- Discouraged behavior 2

**When:**

- Condition when this practice applies

### 3. Third Practice Area

Describe another important practice area for this agent.

**Steps:**

1. First step in this practice
2. Second step in this practice
3. Verification step

## Validation Requirements

Before completing tasks, the agent MUST verify:

### Code Changes

- [ ] First verification checkpoint
- [ ] Second verification checkpoint
- [ ] Third verification checkpoint

```bash
# Validation commands
make validate
make test
```

### Documentation Changes

- [ ] Documentation verification 1
- [ ] Documentation verification 2

## Safety Requirements

### Input Handling

The agent MUST:

- Define how to handle user input safely
- Validate input boundaries
- Sanitize sensitive data

### Output Standards

The agent MUST:

- Follow output contract in frontmatter
- Never include prohibited content
- Format output consistently

### Error Handling

The agent MUST:

- Handle errors gracefully
- Provide clear error messages
- Never expose sensitive information in errors

## Tool Usage

### Required Tools

- Tool 1 (with version if applicable)
- Tool 2 (with version if applicable)

### Recommended Tools

- Optional tool 1 — for what purpose
- Optional tool 2 — for what purpose

### Tool Safety

- How to use tools safely
- What to avoid with tools
- Verification commands

## Collaboration Patterns

When working with other agents or humans:

**MUST:**

- Clear handoff procedures
- Document assumptions
- Report blockers

**Pattern:**

1. Receive task
2. Clarify requirements
3. Execute work
4. Verify output
5. Hand off results

## Examples

### Example 1: Common Use Case

Describe a typical scenario where this agent would be used.

**Input:**

```
Example task description
```

**Agent Actions:**

1. First action the agent takes
2. Second action the agent takes
3. Verification action

**Output:**

```
Expected output format
```

### Example 2: Edge Case (if relevant)

Show how the agent handles a tricky situation.

## Troubleshooting

Common issues this agent might encounter and how to resolve them:

| Issue | Cause | Resolution |
|-------|-------|------------|
| Error condition 1 | Why it happens | How agent should respond |
| Error condition 2 | Why it happens | How agent should respond |

## Prohibited Actions

The agent MUST NEVER:

| Action | Rationale |
|--------|-----------|
| Prohibited action 1 | Why it's prohibited |
| Prohibited action 2 | Why it's prohibited |
| Prohibited action 3 | Why it's prohibited |

## Related Patterns

- [related-agent](../related-agent/AGENTS.md) - For similar tasks
- [complementary-skill](../../skills/complementary/SKILL.md) - Use together
- [workflow-pattern](../../workflows/related-workflow/SKILL.md) - Part of this workflow

## References

- [Documentation or source](https://example.com)
- For policy requirements, see [AGENTS.md](../../AGENTS.md)
- For security controls, see [playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
