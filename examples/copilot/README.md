# GitHub Copilot Integration

This directory shows how to use patterns with GitHub Copilot custom instructions and workspace settings.

## Overview

GitHub Copilot supports custom instructions that guide AI behavior. Patterns can be adapted for inline code generation and code review scenarios.

## Quick Setup

1. Create `.github/copilot-instructions.md` in your repository
2. Add pattern-derived guidelines
3. Copilot will automatically use them during coding sessions

## Example: Code Review Guidelines

```markdown
# Copilot Instructions

## Code Review Standards

When generating or reviewing code:

### Security
- Never generate hardcoded secrets or API keys
- Use environment variables for sensitive data
- Validate all user inputs
- Follow OWASP Top 10 guidelines

### Code Quality
- Functions should be ≤50 lines
- Use descriptive variable names
- Add docstrings to public functions
- Include type hints (Python) or types (TypeScript)

### Testing
- Generate tests alongside production code
- Aim for 80%+ code coverage
- Include edge cases and error conditions
- Use descriptive test names

## Prohibited Content
- No PII (Personally Identifiable Information)
- No internal URLs or system paths
- No company-specific secrets
- No copyrighted code without attribution
```

## Workspace Settings

Create `.vscode/settings.json` for project-specific Copilot configuration:

```json
{
  "github.copilot.enable": {
    "*": true,
    "markdown": true,
    "plaintext": false
  },
  "github.copilot.advanced": {
    "debug.overrideChatEngine": "gpt-4",
    "length": 500
  }
}
```

## Pattern Adaptation

### From SKILL.md to Copilot Instructions

**Pattern Structure:**
```markdown
## Procedure
1. Read specification
2. Generate code
3. Add tests
4. Validate security
```

**Copilot Format:**
```markdown
When generating code:
- Start with clear type signatures
- Generate comprehensive tests
- Check for security vulnerabilities
- Add inline documentation
```

## Code Review Example

Use Copilot Chat for pattern-based code reviews:

```
@workspace Review this code using our secure code review standards:
- Check for hardcoded secrets
- Verify input validation
- Assess error handling
- Check test coverage
```

## Inline Completions

Copilot learns from comments in your code:

```python
# TODO: Implement secure authentication following our security guidelines
# - Use environment variables for secrets
# - Hash passwords with bcrypt
# - Implement rate limiting
def authenticate_user(username: str, password: str) -> bool:
    # Copilot will generate code following the guidelines
```

## Best Practices

### 1. Concise Instructions
Copilot instructions should be brief and actionable:
- ✅ "Functions ≤50 lines"
- ❌ "We believe in writing small functions because they are easier to test, understand, and maintain"

### 2. Security First
Always include security guidelines:
- No hardcoded secrets
- Input validation required
- Follow least privilege principle
- Use secure defaults

### 3. Project-Specific Rules
Add project conventions:
- Naming conventions
- Error handling patterns
- Logging standards
- Testing requirements

### 4. Update Regularly
Review and update instructions as patterns evolve:
- Quarterly review of guidelines
- Add new patterns as needed
- Remove deprecated practices
- Test with real code generation

## Integration with CI/CD

Combine Copilot with pre-commit hooks:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: copilot-generated-check
        name: Verify Copilot-generated code
        entry: python scripts/check_generated_code.py
        language: system
        files: '\.(py|js|ts)$'
```

## Limitations

- Copilot doesn't parse YAML frontmatter
- Context window is limited
- Can't enforce output contracts
- May not follow all guidelines consistently

## Workarounds

1. **Use Comments:** Add inline reminders
2. **Code Review:** Always review generated code
3. **Testing:** Verify compliance with tests
4. **Pre-commit Hooks:** Automated validation

## See Also

- [GitHub Copilot Documentation](https://docs.github.com/copilot)
- [Copilot Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot)
- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [Pattern Templates](../../templates/)
