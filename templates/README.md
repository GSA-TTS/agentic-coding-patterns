# Templates

This directory contains templates for creating new content in the agentic-coding-patterns repository.

## Available Templates

| Template | Content Type | Use For |
|----------|--------------|---------|
| [skill-template](skill-template/SKILL.md) | Skill | Reusable procedures and how-to guides |
| [prompt-template](prompt-template/SKILL.md) | Prompt | Standalone LLM prompts for specific tasks |
| [workflow-template](workflow-template/SKILL.md) | Workflow | Multi-step end-to-end processes |
| [lesson-template](lesson-template/SKILL.md) | Lesson | Lessons learned and retrospectives |

**Note:** For agent instruction patterns (AGENTS.md), see the main [AGENTS.md](../AGENTS.md) as a reference.

## How to Use Templates

1. **Choose the right template** based on what you're creating
2. **Copy the entire directory** (e.g., `cp -r skill-template/ ../skills/my-new-skill/`)
3. **Rename to match your pattern ID** (kebab-case)
4. **Fill in all frontmatter fields** (especially required fields)
5. **Write your content** following the structure
6. **Run validation**: `make validate`
7. **Submit a PR** when ready

## Required Frontmatter Fields

All templates include these required fields (do not omit):

```yaml
id: pattern-name              # kebab-case, never changes
version: "1.0.0"              # semantic versioning
title: "Human-Readable Title"
type: skill | prompt | workflow | lesson  # MUST match template type
description: "One sentence summary"
status: experimental          # Start here for new patterns
owners: ["@your-handle"]
primary_personas: ["developers"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary"]
    prohibited_content: ["Secrets", "Real PII", "Real CUI", "Internal URLs"]
quality_gates:
  readability_max_grade: 10
  citations_required: false
```

## Template-Specific Guidance

### skill-template

Use for **procedures and how-to guides**:

- Code review processes
- Testing strategies
- Documentation practices
- Analysis techniques

Structure: When to Use → Prerequisites → Procedure → Verification → Examples

### prompt-template

Use for **standalone LLM prompts**:

- Planning prompts
- Code generation templates
- Review checklists
- Analysis frameworks

Structure: Context → Prompt Text → Usage Example → Verification

### workflow-template

Use for **multi-step processes**:

- Issue-to-PR workflows
- Release processes
- QA procedures
- Onboarding flows

Structure: Overview → Multiple phases with inputs/outputs → Checklist → Examples

### lesson-template

Use for **lessons learned**:

- Project retrospectives
- Tool evaluations
- Pattern effectiveness
- Failure modes

Structure: Context → Approach → Outcomes → Learnings → Recommendations

## Tips

- **Start with `experimental` status** — it's easier to contribute and get feedback
- **Use the inline comments** — they guide you through required vs optional fields
- **No sensitive data** — use placeholders like `<YOUR_API_KEY>` or `example.com`
- **Keep it reusable** — write for the next person, not just your specific project
- **Run `make validate`** before submitting to catch frontmatter errors

## Help

- See [CONTRIBUTING.md](../CONTRIBUTING.md) for full contribution guidelines
- Check [schemas/skill.schema.json](../schemas/skill.schema.json) for complete schema
- Ask questions via GitHub issues

---

**Ready to create a pattern?** Copy a template and start writing!
