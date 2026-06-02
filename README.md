# Agentic Coding Patterns

Community-maintained patterns, prompts, skills, agent instructions, workflows, and lessons learned for responsible agentic coding.

> **Status:** Active development | **License:** CC0-1.0 | **Repo:** <https://github.com/GSA-TTS/agentic-coding-patterns>

## Agentic Coding Ecosystem

This repository is part of a three-repo ecosystem:

| Repo | Purpose | When to Use |
|------|---------|-------------|
| **[Quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart)** | Get running | First day setup, SBX + USAi config |
| **[Playbook](https://github.com/GSA-TTS/agentic-coding-playbook)** | Do it right | Repo setup, standards, best practices |
| **[Patterns](https://github.com/GSA-TTS/agentic-coding-patterns)** (you are here) | Share & learn | Community patterns, lessons learned |

**This is the collaboration hub.** Share what's working, learn from others, and help build a community knowledge base.

---

## Quick Reference

| I want to... | Go to |
|--------------|-------|
| **Use a pattern** | Browse [INDEX.yaml](INDEX.yaml) or [skills/](skills/), [prompts/](prompts/), [workflows/](workflows/) |
| **Contribute a pattern** | Read [CONTRIBUTING.md](CONTRIBUTING.md) → Copy [template](templates/) → Run `make validate` |
| **Integrate with AI tools** | See [AI Agent Integration Guide](docs/AI-AGENT-GUIDE.md) |
| **Security issues** | See [SECURITY.md](SECURITY.md) — direct fixes preferred |
| **Run validation locally** | `make setup && make validate` |

## Purpose

This repository is a **community space** for sharing reusable patterns, workflows, and lessons learned.

- **Behavioral standards** live in the [Playbook](https://github.com/GSA-TTS/agentic-coding-playbook) (don't duplicate them here)
- **Environment setup** lives in the [Quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart)
- **Community patterns and lessons** live here

Content here is a starting point for reuse and review — it's community knowledge sharing.

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
├── skills/              # Reusable procedures (code review, testing, documentation)
├── prompts/             # Standalone prompts for specific tasks
├── agents/              # Agent instruction patterns (AGENTS.md)
├── workflows/           # Multi-step end-to-end processes
├── lessons-learned/     # Community experiences and retrospectives
├── templates/           # Templates for creating new patterns
├── examples/            # Tool-specific integration examples
├── schemas/             # JSON Schemas for validation
└── docs/                # Documentation and guides
```

## Quick Start

### For Contributors

```bash
# Clone the repo
git clone https://github.com/GSA-TTS/agentic-coding-patterns.git
cd agentic-coding-patterns

# Install dependencies
make setup

# Optional: Install pre-commit hooks (recommended for regular contributors)
make install-hooks

# Validate content
make validate

# Generate INDEX.yaml
make generate

# Run tests with coverage report
make coverage
```

**Note:** Pre-commit hooks are opt-in. Use `make install-hooks` to enable automatic checks on commit. CI enforces all checks regardless of local hook installation.

### For Users

**Human users:**

1. Browse available patterns in `INDEX.yaml` or by directory
2. Use the pattern discovery CLI:

   ```bash
   # Search by tag
   python scripts/search_patterns.py --tag security

   # Filter by status
   python scripts/search_patterns.py --status recommended

   # Combined filters
   python scripts/search_patterns.py --tag security --tool opencode
   ```

3. Copy pattern directory to your project
4. Adapt frontmatter and content to your needs
5. Review and test before production use

**AI agents:**

1. Parse `INDEX.yaml` for pattern discovery (see [AI Agent Guide](docs/AI-AGENT-GUIDE.md))
2. Use the CLI for filtering: `python scripts/search_patterns.py --json --tag <tag>`
3. Filter patterns by `type`, `status`, `tags`, and `portability` flags
4. Read frontmatter to understand input/output contracts
5. Validate against `prohibited_content` before using

**INDEX.yaml structure:**

```yaml
schema_version: "1.0"
repo: GSA-TTS/agentic-coding-patterns
patterns:
  skills: [{id, path, title, status, type}, ...]
  prompts: [...]
  agents: [...]
stats:
  total_patterns: 13
```

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

- **Questions:** Ask in the agentic-coding Slack channel
- **Browse docs:** See [docs/](docs/) for guides
- **Improvement ideas:** Open an issue or submit a PR
- **Relationship to other repos:** See [docs/repository-ecosystem.md](docs/repository-ecosystem.md)

## See Also

- [Contributing Guide](CONTRIBUTING.md) — How to add patterns
- [AI Agent Integration Guide](docs/AI-AGENT-GUIDE.md) — Programmatic pattern access
- [Security Policy](SECURITY.md) — Direct fixes preferred
- [Playbook](https://github.com/GSA-TTS/agentic-coding-playbook) — Standards and best practices
- [Quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart) — Execution environment setup

---

> **Note:** Review and test all patterns before production use. Tailor to your specific requirements.

## Development Setup

### Pre-commit Hooks

This repository uses pre-commit hooks for code quality and security:

```bash
# Install pre-commit (if not already installed)
pip install pre-commit

# Install the git hook scripts
pre-commit install
pre-commit install --hook-type commit-msg

# (Optional) Run against all files
pre-commit run --all-files
```

**Hooks configured:**

- **gitleaks** — Secret detection (critical for example code)
- **ruff** — Python linting and formatting with security rules
- **commitlint** — Conventional Commits validation
- **markdownlint** — Markdown formatting
- **zizmor** (optional) — GitHub Actions security scanning (auto-skips if not installed; install: `cargo install zizmor` or `brew install zizmor`)
- **Pattern validation** — Frontmatter schema validation
- **Basic hygiene** — YAML/JSON/TOML validation, trailing whitespace, etc.

**Manual security scanning:**

```bash
# Run zizmor separately for comprehensive GitHub Actions security audit
zizmor .github/workflows/
```

**Note:** zizmor will silently skip if not installed. Install from: <https://github.com/woodruffw/zizmor>

See `.pre-commit-config.yaml` for full configuration.
