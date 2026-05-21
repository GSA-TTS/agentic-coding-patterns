# OpenCode Integration Examples

This directory demonstrates how to use patterns from this repository with OpenCode.

## Quick Start

OpenCode natively supports SKILL.md files. Simply copy patterns to your project's skills directory:

```bash
# Copy a pattern to your project
cp ../../skills/secure-code-review/SKILL.md .opencode/skills/

# OpenCode will automatically discover it
```

## Example: Secure Code Review

See [secure-code-review-example.md](./secure-code-review-example.md) for a complete integration example.

## Directory Structure

```
your-project/
├── .opencode/
│   ├── skills/
│   │   ├── secure-code-review.md    # Copied from patterns repo
│   │   └── documentation-review.md  # Another pattern
│   └── config.json                  # Optional: skill configuration
└── your-code/
```

## Skill Discovery

OpenCode automatically discovers skills in `.opencode/skills/`. You can also reference them in AGENTS.md:

```markdown
## Available Skills

- [Secure Code Review](skills/secure-code-review.md)
- [Documentation Review](skills/documentation-review.md)
```

## Pattern Adaptation

Before using a pattern:

1. **Review frontmatter** - Check compatibility flags
2. **Adapt scope** - Adjust to your project's needs
3. **Update prohibited content** - Add project-specific restrictions
4. **Test locally** - Verify behavior before committing

## See Also

- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [OpenCode Documentation](https://opencode.ai/docs)
