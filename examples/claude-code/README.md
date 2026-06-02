# Claude Code Integration

This directory shows how to use patterns with Claude Code (also known as Claude for Code or Claude in VS Code).

## Overview

Claude Code integrates Anthropic's Claude AI directly into VS Code. Patterns can be adapted to guide Claude's code generation, review, and refactoring tasks.

## Quick Setup

1. Install the Claude for VS Code extension
2. Create `.claude/instructions.md` in your workspace
3. Add pattern-derived guidelines
4. Claude will reference these during code sessions

## Example: Project Instructions

```markdown
# Project Coding Standards

## Language: Python 3.12+

## Code Quality Standards

### Functions
- Maximum 50 lines per function
- Use type hints for all parameters and returns
- Include docstrings for public functions
- Follow PEP 8 style guide

### Security
- Never hardcode secrets (use environment variables)
- Validate all user inputs
- Use parameterized queries (prevent SQL injection)
- Log security events

### Testing
- Write tests for all new code
- Target 80%+ code coverage
- Use pytest with descriptive test names
- Test edge cases and error conditions

## Prohibited Content
- ❌ API keys, tokens, passwords
- ❌ PII (names, emails, SSNs)
- ❌ Internal URLs or system paths
- ❌ Copyrighted code without attribution

## Architecture Decisions

See docs/adr/ for Architecture Decision Records using MADR format.
```

## Pattern Conversion

### From SKILL.md to Claude Instructions

**Pattern (SKILL.md):**

```yaml
---
name: secure-code-review
version: 1.0.0
tier: critical
---

## Procedure
1. Check for hardcoded secrets
2. Validate input handling
3. Review error handling
4. Check dependencies for CVEs
```

**Claude Instructions:**

```markdown
# Secure Code Review

When reviewing code, systematically check:

1. **Secrets Management**
   - Scan for hardcoded API keys, tokens, passwords
   - Verify environment variable usage
   - Check for .env file in .gitignore

2. **Input Validation**
   - All user inputs are validated
   - SQL queries use parameterization
   - File paths are sanitized

3. **Error Handling**
   - Errors don't leak sensitive information
   - Stack traces are logged, not displayed
   - Graceful degradation on failures

4. **Dependencies**
   - Run pip-audit for known CVEs
   - Check for outdated packages
   - Verify license compatibility
```

## Chat Examples

### Code Generation

```
User: Create a function to authenticate users

Claude: I'll create a secure authentication function following our project standards:
- Use environment variables for secrets
- Hash passwords with bcrypt
- Implement rate limiting
- Add comprehensive logging
- Include type hints and docstrings
- Write tests
```

### Code Review

```
User: @review this authentication module

Claude: I'll review the code against our security standards:

✅ Environment variables for secrets
✅ Password hashing with bcrypt
❌ Missing rate limiting (add slowapi)
❌ No type hints on helper functions
✅ Good error handling
⚠️ Tests need edge cases (SQL injection, XSS)

I'll show you the recommended changes...
```

### Refactoring

```
User: Refactor this 200-line function

Claude: This function is too long (200 lines vs 50-line limit).
I'll break it into:
1. Input validation helper
2. Business logic core
3. Database interaction layer
4. Response formatting
Each with proper type hints and tests.
```

## Workspace Configuration

Create `.vscode/settings.json`:

```json
{
  "claude.contextFiles": [
    ".claude/instructions.md",
    "docs/CODING_PRACTICES.md",
    "docs/SECURITY-CONTROLS.md"
  ],
  "claude.maxContextSize": 100000,
  "claude.temperature": 0.3
}
```

## Integration with Pre-commit

Use pre-commit hooks to enforce pattern compliance:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.5
    hooks:
      - id: gitleaks

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.13
    hooks:
      - id: ruff
      - id: ruff-format

  - repo: local
    hooks:
      - id: pattern-validation
        name: Validate against patterns
        entry: python scripts/validate_repo.py
        language: system
```

## Best Practices

### 1. Provide Context

Give Claude access to relevant documentation:

```markdown
# Context Files
- docs/ARCHITECTURE.md
- docs/SECURITY-CONTROLS.md
- docs/adr/*.md
```

### 2. Use Explicit Constraints

Be specific about requirements:

- ✅ "Functions must be ≤50 lines"
- ❌ "Keep functions small"

### 3. Include Examples

Show the desired output format:

```python
# Example: Good function structure
def calculate_discount(price: float, tier: str) -> float:
    """Calculate discount based on customer tier.

    Args:
        price: Original price in USD
        tier: Customer tier ('basic', 'premium', 'enterprise')

    Returns:
        Discounted price

    Raises:
        ValueError: If tier is invalid
    """
    ...
```

### 4. Reference ADRs

Link to architectural decisions:

```markdown
## Architecture
See ADR-0001 for database choice
See ADR-0005 for authentication approach
```

## Pattern Priorities

When multiple patterns apply, follow this priority order:

1. **Security** - Always highest priority
2. **Correctness** - Functional requirements
3. **Compliance** - Federal/regulatory requirements
4. **Simplicity** - Clear over clever
5. **Performance** - Only after above are met

## Limitations

- Context window is finite (manage file references)
- Can't automatically update patterns
- Requires manual pattern migration
- No native YAML frontmatter parsing

## Workarounds

1. **Context Management:** Use `.claude/instructions.md` to reference patterns
2. **Pattern Updates:** Set quarterly review reminders
3. **Validation:** Use pre-commit hooks to enforce compliance
4. **Testing:** Always review Claude's output with tests

## See Also

- [Claude for VS Code Documentation](https://www.anthropic.com/claude-code)
- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [Pattern Library](../../)
- [Coding Practices](../../../agentic-coding-playbook/docs/CODING_PRACTICES.md)
