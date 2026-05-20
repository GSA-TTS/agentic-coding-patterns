# Agentic Coding Patterns

Community-maintained patterns, prompts, skills, agent instructions, workflows, and lessons learned for responsible agentic coding.

> **Status:** Early development | **License:** CC0-1.0 | **Repo:** https://github.com/GSA-TTS/agentic-coding-patterns

## Purpose

This repository provides reusable patterns for AI-assisted software development that complement:

- **[agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)**: Policy, standards, and compliance guidance (upstream)
- **[agentic-coding-quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart)**: Execution environment setup (downstream)
- **agentic-coding-patterns**: Community patterns and examples (this repo)

Content here is a starting point for reuse and review. **It is not policy unless explicitly adopted** through your organization's governance process.

## What Belongs Here

- ✅ Reusable skills for common tasks (code review, documentation, testing)
- ✅ Prompt templates for planning, implementation, review
- ✅ Agent instruction patterns (AGENTS.md examples)
- ✅ Multi-step workflows
- ✅ Lessons learned from real usage
- ✅ Tool-specific examples (OpenCode, Claude, Copilot, Cursor)

## What Does NOT Belong Here

- ❌ Secrets, credentials, API keys, tokens
- ❌ PII (Personally Identifiable Information)
- ❌ CUI (Controlled Unclassified Information)
- ❌ Internal URLs or system details
- ❌ Customer data or operational details
- ❌ Uncited compliance claims

## Repository Structure

```
agentic-coding-patterns/
├── skills/              # Reusable skills (SKILL.md format)
├── prompts/             # Standalone prompts
├── agents/              # Agent instruction patterns (AGENTS.md)
├── workflows/           # Multi-step workflows
├── lessons-learned/     # Community experiences
├── templates/           # Templates for new content
├── examples/            # Tool-specific examples
├── schemas/             # JSON Schemas for validation
└── docs/                # Documentation
```

## Quick Start

### For Contributors

```bash
# Clone the repo
git clone https://github.com/GSA-TTS/agentic-coding-patterns.git
cd agentic-coding-patterns

# Install dependencies
make setup

# Validate content
make validate

# Generate INDEX.yaml
make generate
```

### For Users

1. Browse available patterns in `INDEX.yaml` or by directory
2. Copy pattern directory to your project
3. Adapt frontmatter and content to your needs
4. Review and test before production use

## Content Status Levels

| Status | Meaning | Use When |
|--------|---------|----------|
| `experimental` | New, untested in production | Exploring, testing |
| `recommended` | Proven useful, peer-reviewed | Production use |
| `deprecated` | Superseded by newer pattern | Migration only |

**Default for new contributions:** `experimental`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

**Quick version:**
1. Use a template from `templates/`
2. Fill in frontmatter (all required fields)
3. Write clear, reusable content
4. No secrets, PII, or CUI
5. Run `make validate` before commit
6. Submit PR with review checklist

## Safety Requirements

All patterns MUST:
- Define `prohibited_content` in frontmatter
- Use placeholders for environment-specific values
- Pass sensitive term scanning
- Include human review checklist

See [docs/safety-guidance.md](docs/safety-guidance.md) for details.

## Validation

```bash
make validate    # Run all validators
make test        # Run tests
make ci          # Full CI check
```

## Tool Compatibility

Patterns track compatibility via `portability` frontmatter:
- `opencode`: OpenCode SKILL.md format
- `cursor`: Cursor .cursorrules
- `claude_projects`: Claude Projects
- `chatgpt`: ChatGPT custom instructions
- `generic_llm`: Generic LLM prompting

## License

This repository is released under [CC0-1.0](LICENSE) (public domain). Content is provided as-is with no warranties.

## Getting Help

- Browse [docs/](docs/) for guidance
- File issues for improvements or questions
- Review [docs/repository-ecosystem.md](docs/repository-ecosystem.md) for relationship to sibling repos

---

> **Disclaimer:** Patterns are informational only and not authoritative policy. Review and test all content before production use. Each organization must tailor patterns to their specific requirements and risk tolerance.
