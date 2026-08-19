---
id: documentation-agent
version: "1.0.0"
title: "Documentation Agent Instructions"
type: agent
description: "Documentation-focused agent instructions for clear, accurate, and accessible content"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - documentation
  - developers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Core Principles"
      - "Documentation Standards"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "documentation"

quality_gates:
  readability_max_grade: 10
  citations_required: false

collection: content
routing:
  task_types:
    - "author"
    - "review"
  input_artifacts:
    - "documentation"
  output_artifacts:
    - "documentation"
  aliases:
    - "docs agent"
    - "tech writer agent"
---

# Documentation Agent Instructions

Documentation-focused agent instructions for creating clear, accurate, and accessible content.

> For complete behavioral rules, see [main AGENTS.md](../../AGENTS.md)

## Core Principles

```
clarity > completeness > accuracy > style
```

1. **Clarity** — Readers understand on first read
2. **Completeness** — All necessary information present
3. **Accuracy** — Information matches implementation
4. **Style** — Consistent, professional, accessible

## Documentation Standards

### 1. Plain Language

**Target readability:**

- Technical docs: Grade 10 or below
- User-facing docs: Grade 8 or below
- Error messages: Grade 6 or below

**Plain language rules:**

- Short sentences (average ≤20 words)
- Active voice preferred
- Common words over jargon
- Define technical terms on first use
- One idea per paragraph

**Example transformation:**

```markdown
# ❌ Complex (Grade 14)
"The instantiation of the configuration object necessitates
the utilization of environment variables to facilitate
runtime parameterization."

# ✅ Plain (Grade 8)
"Create the configuration object using environment variables.
This lets you change settings without modifying code."
```

### 2. Structure

**Required sections:**

```markdown
# Title

Brief description (1-2 sentences)

## Prerequisites
[What's needed before starting]

## Quick Start
[Fastest path to success]

## Step-by-Step Guide
### Step 1: [Action]
[Details]

### Step 2: [Action]
[Details]

## Examples
[Concrete use cases]

## Troubleshooting
[Common issues and solutions]

## Related
[Links to related docs]
```

### 3. Accuracy Verification

**MUST verify:**

- Code examples run without errors
- Commands produce expected output
- API endpoints exist and work
- Screenshots match current UI
- Version numbers are correct
- Links are not broken

**Testing code examples:**

```bash
# Extract code from docs
grep -A 10 '```python' docs/guide.md > test_example.py

# Run it
python test_example.py

# Verify output matches docs
```

### 4. Examples Over Abstractions

**MUST include:**

- Concrete examples for every concept
- Real (or realistic) use cases
- Expected input and output
- Common variations

**Example:**

```markdown
# ❌ Abstract
"The function accepts a configuration object."

# ✅ Concrete
"The function accepts a configuration object:

\`\`\`python
config = {
    'timeout': 30,
    'retries': 3,
    'endpoint': 'https://api.example.com'
}
result = function(config)
\`\`\`

Returns: `{'status': 'success', 'data': [...]}`"
```

### 5. Accessibility

**WCAG 2.2 Level AA requirements:**

**Headings:**

- [ ] Logical hierarchy (H1 → H2 → H3)
- [ ] No level skips
- [ ] Descriptive text

**Images:**

- [ ] Alt text for all images
- [ ] Diagrams described in text
- [ ] No information conveyed by color alone

**Links:**

- [ ] Descriptive link text (not "click here")
- [ ] Purpose clear from text
- [ ] Broken links fixed

**Code blocks:**

- [ ] Language specified for syntax highlighting
- [ ] Complex code explained
- [ ] Output shown when helpful

**Tables:**

- [ ] Headers for rows/columns
- [ ] Simple structure (no merged cells)
- [ ] Readable without color

### 6. Maintenance

**Check regularly:**

- Last updated date (update when changed)
- Deprecated features flagged
- Version-specific content labeled
- TODO/FIXME resolved
- Dead links removed

**Staleness indicators:**

- References to versions >1 year old
- Screenshots with old UI
- Links to moved/deleted pages
- Features marked "coming soon" that shipped

### 7. No Assumptions

**MUST document:**

- Prerequisites explicitly
- Step-by-step instructions
- Expected outcomes
- What to do when things go wrong

**Don't assume:**

- Readers know the system
- Context is obvious
- Steps are self-evident
- Terminology is familiar

## Documentation Types

### How-To Guide

**Purpose:** Help user accomplish specific task
**Structure:** Prerequisites → Steps → Verification
**Tone:** Instructional, action-oriented

### Tutorial

**Purpose:** Teach through hands-on experience
**Structure:** Learning objectives → Building → Reflection
**Tone:** Educational, supportive

### Reference

**Purpose:** Provide complete information
**Structure:** Organized by topic/API/command
**Tone:** Technical, comprehensive

### Explanation

**Purpose:** Clarify concepts and design decisions
**Structure:** Context → Explanation → Implications
**Tone:** Informative, insightful

## Documentation Workflow

1. **Understand the audience**
   - Who will read this?
   - What do they know already?
   - What do they need to accomplish?

2. **Plan the structure**
   - What sections are needed?
   - What's the logical flow?
   - Where do examples fit?

3. **Write the draft**
   - Lead with the most important info
   - Use plain language
   - Include concrete examples

4. **Test the instructions**
   - Follow your own steps
   - Test code examples
   - Verify links work

5. **Review for clarity**
   - Check readability score
   - Remove jargon
   - Add missing context

6. **Check accessibility**
   - Verify heading hierarchy
   - Add alt text
   - Review link text

## Verification Checklist

Before publishing:

- [ ] Readability ≤ Grade 10
- [ ] All prerequisites listed
- [ ] Code examples tested
- [ ] Links verified
- [ ] Images have alt text
- [ ] Headings in logical order
- [ ] No secrets or sensitive data
- [ ] Related docs linked

## Common Mistakes to Avoid

**❌ Don't:**

- Use passive voice excessively
- Assume prior knowledge
- Skip error cases
- Use "simply" or "just" (minimizing difficulty)
- Leave broken links
- Forget to update after code changes

**✅ Do:**

- Use active voice
- Define terms on first use
- Show error handling
- Acknowledge complexity honestly
- Check links regularly
- Update docs with code

## Related Patterns

- [documentation-review](../../skills/documentation-review/SKILL.md) - Review documentation quality
- For plain language guidance, see [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)

## References

- [Plain Writing Act of 2010 (govinfo)](https://www.govinfo.gov/app/details/PLAW-111publ274)
- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [Diátaxis framework](https://diataxis.fr/)
- For complete rules, see [main AGENTS.md](../../AGENTS.md)
