# Contributing to Agentic Coding Patterns

Thank you for contributing! This is the **community patterns repository** for agentic coding. We welcome patterns, prompts, skills, workflows, and lessons learned from practitioners.

## Ecosystem Overview

This repo is one of three in the agentic coding ecosystem:

| Repo | Focus | Typical Contributions |
|------|-------|----------------------|
| **[Quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart)** | Environment setup | SBX fixes, troubleshooting docs |
| **[Playbook](https://github.com/GSA-TTS/agentic-coding-playbook)** | Standards & practices | Coding standards, skills, templates |
| **[Patterns](https://github.com/GSA-TTS/agentic-coding-patterns)** (you are here) | Community sharing | Workflows, lessons learned, examples |

**This is the place to share what you've learned.** Don't worry about getting it perfect — use `experimental` status and let the community provide feedback.

## Getting Help

- **Questions:** Ask in the agentic-coding Slack channel
- **Bugs/improvements:** Open a GitHub issue or submit a PR
- **Security issues:** See [SECURITY.md](SECURITY.md) — direct fixes preferred

## Teams

- **[@GSA-TTS/agentic-coding-team](https://github.com/orgs/GSA-TTS/teams/agentic-coding-team):** Team members — review, contribute, share patterns
- **[@GSA-TTS/agentic-coding-admins](https://github.com/orgs/GSA-TTS/teams/agentic-coding-admins):** Repository administrators — merge, release, maintain

## Quick Start

1. **Choose a content type** (skill, prompt, workflow, agent, lesson)
2. **Copy the appropriate template** from `templates/`
3. **Fill in frontmatter** (all required fields)
4. **Write your content** (clear and reusable)
5. **Run validation**: `make validate`
6. **Submit a PR** with the checklist completed

## Content Types

| Type | Directory | Use For |
|------|-----------|---------|
| **Skill** | `skills/` | Reusable procedures (code review, testing, documentation) |
| **Prompt** | `prompts/` | Standalone prompts for specific tasks |
| **Agent** | `agents/` | Agent instruction patterns (AGENTS.md files) |
| **Workflow** | `workflows/` | Multi-step processes end-to-end |
| **Lesson** | `lessons-learned/` | Real experiences and retrospectives |

## Pattern Status Levels

All new patterns start as `experimental`:

| Status | Meaning | Requirements |
|--------|---------|--------------|
| `experimental` | New, untested | Self-review, validation passing |
| `recommended` | Proven useful | Peer review, community feedback |
| `deprecated` | Superseded | Must include `replaces_with` |

**Don't worry about getting it perfect!** Use `experimental` status and let the community provide feedback.

## Required Frontmatter Fields

Every pattern MUST include valid YAML frontmatter. Use one of these three approaches depending on your needs:

### Quick Start: Minimal Pattern (5 minutes)

Start with just the essentials to get your pattern validated:

```yaml
---
id: my-pattern-name                   # kebab-case, never changes
version: "1.0.0"                      # semantic versioning
title: "My Pattern Title"
type: skill                           # skill|prompt|workflow|agent|lesson
status: experimental                  # Start here!
owners: ["@your-github-handle"]
primary_personas: ["developers"]      # Who is this for?
requires:
  anchors: []                         # Dependencies (usually empty)
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"                     # Sections that must appear
    prohibited_content:               # MUST include these 4 minimum
      - "Secrets"
      - "PII"
      - "CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
---
```

**When to use:** First draft, exploring an idea, quick contribution

### Recommended: Full Pattern (15 minutes)

Add these fields to improve discoverability and usability:

```yaml
---
id: my-pattern-name
version: "1.0.0"
title: "My Pattern Title"
description: "One-line summary of what this does"
type: skill
status: experimental
owners: ["@your-github-handle"]
primary_personas: ["developers", "security-engineers"]

# Discovery and categorization
triggers: ["code review", "security", "automation"]
tags: ["security", "python", "review"]

# Tool compatibility
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: false
  generic_llm: true

# Scope definition
scope:
  intended_use:
    - "Review code for security vulnerabilities"
    - "Automate security checks in CI/CD"
  exclusions:
    - "Not for compliance auditing"
    - "Not a replacement for penetration testing"

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
      - "PII"
      - "CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false
---
```

**When to use:** Production-ready pattern, community contribution, tool integration

### Complete: Advanced Pattern (30+ minutes)

Add all optional fields for maximum functionality:

```yaml
---
# ... all fields from "Recommended" plus:

complexity_estimate:
  setup_minutes: 5
  execution_minutes: 30

inputs:
  - name: "code_files"
    type: "file_list"
    required: true
  - name: "severity_threshold"
    type: "string"
    default: "medium"

outputs:
  - name: "findings_report"
    type: "markdown"
    description: "Security findings with recommendations"

related_patterns:
  - id: "test-generation"
    relationship: "follows"
  - id: "documentation-review"
    relationship: "complements"

changelog:
  - version: "1.0.0"
    date: "2026-05-21"
    changes: "Initial release"
---
```

**When to use:** Complex workflows, tool integration, production systems

## Frontmatter Field Reference

**Required fields:**
- `id`: Unique identifier (kebab-case, never changes)
- `version`: Semantic version (e.g., "1.0.0")
- `title`: Human-readable name
- `type`: Pattern type (skill|prompt|workflow|agent|lesson)
- `status`: experimental|recommended|deprecated
- `owners`: GitHub handles (e.g., ["@you"])
- `primary_personas`: Target users (e.g., ["developers"])
- `requires.anchors`: Dependencies (usually empty)
- `output.format`: Output format (usually "markdown")
- `output.contract.required_sections`: Must-have sections
- `output.contract.prohibited_content`: Must NOT include (min: Secrets, PII, CUI, Internal URLs)
- `quality_gates.readability_max_grade`: Max reading level (usually 10)
- `quality_gates.citations_required`: Require citations? (usually false)

**Recommended fields:**
- `description`: One-line summary
- `triggers`: Discovery keywords
- `tags`: Categorization tags
- `portability`: Tool compatibility flags
- `scope.intended_use`: What it's for
- `scope.exclusions`: What it's NOT for

**Optional fields:**
- `complexity_estimate`: Time estimates
- `inputs`/`outputs`: Structured I/O definitions
- `related_patterns`: Dependencies and relationships
- `changelog`: Version history

## Pattern Structure (SKILL.md)

Use this structure for skills, prompts, workflows, and lessons:

```markdown
---
[frontmatter here]
---

# Skill: Your Pattern Title

Brief 2-3 sentence description of what this pattern does.

## When to Use

- Scenario 1 when this pattern is helpful
- Scenario 2 when you should reach for this
- Trigger keywords that suggest using this pattern

## Prerequisites

- Required tools (e.g., Python 3.11+)
- Required knowledge (e.g., familiarity with git)
- Required setup (e.g., access to repository)

## Procedure

### Step 1: First Step

Describe what to do.

```bash
# Example command
make validate
```

### Step 2: Next Step

Continue with clear, numbered steps.

## Verification

After completing this pattern, verify:

- [ ] First check passed
- [ ] Second check passed
- [ ] Expected output achieved

## Examples

### Example 1: Common Use Case

Show a concrete example of using this pattern.

## Related Patterns

- [other-pattern](../other-pattern/SKILL.md) - For related task
```

## Safety Requirements

### MUST NOT Include

❌ Secrets, API keys, tokens, passwords
❌ PII (names, emails, SSNs, addresses)
❌ CUI (Controlled Unclassified Information)
❌ Internal URLs or hostnames
❌ Customer data or sensitive operational details
❌ Vulnerability details that aren't public
❌ Uncited compliance claims

### MUST Include

✅ Placeholders for environment-specific values (e.g., `<YOUR_API_KEY>`)
✅ `prohibited_content` in frontmatter
✅ Clear warnings about sensitive data handling
✅ Input validation guidance
✅ References to policy sources when making claims

## Tool Compatibility

If your pattern works with specific AI coding tools, declare it:

```yaml
portability:
  opencode: true          # OpenCode SKILL.md format
  cursor: true            # Cursor .cursorrules
  claude_projects: true   # Claude Projects
  chatgpt: true           # ChatGPT custom instructions
  generic_llm: true       # Generic LLM prompting
```

Test with the tools you claim compatibility with!

## Validation Before Submitting

Run these commands before your PR:

```bash
make validate      # Validate frontmatter and scan for sensitive terms
make generate      # Regenerate INDEX.yaml
make test          # Run tests (if you added test cases)
```

All checks must pass before merge.

### Pre-commit Hooks

This repository uses pre-commit hooks to enforce quality and security standards:

- **Gitleaks**: Detects hardcoded secrets (API keys, tokens, credentials)
- **Ruff**: Python linting and formatting
- **YAML/JSON validation**: Ensures configuration files are valid
- **Trailing whitespace and EOF fixes**: Maintains clean formatting

To install pre-commit hooks locally:

```bash
pip install pre-commit
pre-commit install
```

Hooks run automatically on `git commit`. To run manually:

```bash
pre-commit run --all-files
```

## Adding Test Cases (Optional)

For complex patterns, add `tests/test-cases.yml`:

```yaml
suite:
  pattern_id: your-pattern-name
  pattern_version: "1.0.0"
  description: "Test suite for your pattern"

test_cases:
  - id: test-case-1
    name: "Descriptive test name"
    description: "What this tests"
    input:
      type: literal
      content: |
        Input content here
    assertions:
      - type: contains
        pattern: "Expected output"
        min_count: 1
```

## Pull Request Checklist

When submitting your PR, complete this checklist:

```markdown
## Summary
Brief description of the pattern and what problem it solves.

## Content Type
- [ ] Skill
- [ ] Prompt
- [ ] Workflow
- [ ] Agent instructions
- [ ] Lesson learned

## Safety Checklist
- [ ] No secrets, tokens, credentials, or private keys
- [ ] No PII, CUI, customer data, or sensitive info
- [ ] No internal URLs or system details
- [ ] Examples use placeholders
- [ ] `prohibited_content` defined in frontmatter

## Quality Checklist
- [ ] Frontmatter complete and valid
- [ ] Content is reusable beyond one project
- [ ] Prerequisites documented
- [ ] Verification steps included
- [ ] `make validate` passes
- [ ] Status is `experimental` (for new patterns)
- [ ] Tool compatibility tested (if claimed)

## Approval
- [ ] Ready for community review
```

## Style Guidelines

### Writing Style
- **Plain language** preferred (Grade 10 or below)
- **Define technical terms** on first use
- **Short sentences** and paragraphs
- **Active voice** over passive
- **Examples** over abstract descriptions

### Code Examples
- Use **syntax highlighting** with language tags
- Include **comments** explaining what's happening
- Show **expected output** when helpful
- Use **placeholders** for secrets/env-specific values

### Markdown
- Use **ATX-style headers** (`#` not underlines)
- **One blank line** between sections
- **Fenced code blocks** with language tags
- **Relative links** to other patterns

## Review Process

1. **Self-review** — Check your work against this guide
2. **Automated validation** — CI runs `make validate`
3. **Community review** — Maintainers and community provide feedback
4. **Iteration** — Address feedback, rerun validation
5. **Merge** — Pattern added with `experimental` status

## Promoting Patterns to `recommended`

Patterns can be promoted from `experimental` to `recommended` when:

- Multiple people have used it successfully
- Community feedback is positive
- Pattern has been tested across different contexts
- Documentation is clear and complete

To propose promotion, open an issue with:
- Link to the pattern
- Evidence of successful usage
- Community feedback summary

## Deprecating Patterns

When a pattern is superseded, mark it `deprecated`:

```yaml
status: deprecated
deprecated:
  as_of: "2026-05-20"
  replaces_with: new-pattern-id
  reason: "Brief explanation"
  migration_notes:
    - "Step 1 to migrate"
    - "Step 2 to migrate"
```

Don't delete deprecated patterns — they provide migration guidance.

## Getting Help

- **Questions**: Open a GitHub issue with `question` label
- **Bugs**: Open a GitHub issue with `bug` label
- **Improvements**: Open a GitHub issue with `enhancement` label
- **Documentation**: See [docs/](docs/) directory

## Code of Conduct

This is a professional, respectful community. Be kind, be helpful, be patient.

## License

All contributions are released under [CC0-1.0](LICENSE) (public domain). By contributing, you agree to release your work under this license.

## See Also

- [README](README.md) — Repository overview and purpose
- [AI Agent Integration Guide](docs/AI-AGENT-GUIDE.md) — For tool developers and automation
- [Pattern Templates](templates/) — Starting points for new patterns
- [Examples](examples/) — Tool-specific integration examples

---

**Ready to contribute?** Copy a template from `templates/`, fill it in, and submit a PR!
