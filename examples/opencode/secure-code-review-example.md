# Example: Secure Code Review with OpenCode

This example shows how to integrate the secure-code-review pattern into an OpenCode project.

## Step 1: Copy Pattern

```bash
# From the patterns repository
cp skills/secure-code-review/SKILL.md .opencode/skills/secure-code-review.md
```

## Step 2: Verify Compatibility

Check the pattern's portability flags:

```yaml
portability:
  opencode: true  # ✓ Compatible
  cursor: true
  claude_projects: true
  chatgpt: false
  generic_llm: true
```

## Step 3: Adapt for Your Project

Edit `.opencode/skills/secure-code-review.md` frontmatter:

```yaml
---
id: secure-code-review
version: "1.0.0"
title: "Secure Code Review"
# ... other fields ...

# Add project-specific prohibited content
output:
  contract:
    prohibited_content:
      - "Secrets"
      - "PII"
      - "CUI"
      - "Internal URLs"
      - "DatabasePassword"        # Project-specific
      - "prod-api-key"            # Project-specific
---
```

## Step 4: Use in AGENTS.md

Reference the skill in your agent instructions:

```markdown
# My Project AGENTS.md

## Security Review Agent

### Available Skills

When performing code reviews, use the [Secure Code Review](skills/secure-code-review.md) skill to:
- Check for OWASP Top 10 vulnerabilities
- Validate input sanitization
- Review authentication/authorization
- Check for hardcoded secrets

### Usage

```

Human: Review this pull request for security issues
Agent: I'll use the Secure Code Review skill to analyze the changes.

[Loads and executes secure-code-review.md]

```
```

## Step 5: Test Integration

```bash
# Run OpenCode with the skill available
opencode

# In the chat:
> Use secure code review skill on src/auth.py
```

## Output Example

When the skill executes, it produces structured output:

```markdown
# Security Review: src/auth.py

## Summary
Reviewed 156 lines for OWASP Top 10 vulnerabilities.

## Findings

### HIGH: SQL Injection Risk
**Location:** Line 45
**Issue:** User input directly concatenated into SQL query
**Recommendation:** Use parameterized queries

### MEDIUM: Weak Password Policy
**Location:** Line 78
**Issue:** Minimum length only 6 characters
**Recommendation:** Increase to 12+ characters, require complexity

## Verification Checklist
- [x] Input validation present
- [x] Authentication implemented
- [ ] Authorization checks complete
- [x] No hardcoded secrets
- [ ] Error messages don't leak info
```

## Advanced: Skill Composition

Combine multiple skills in a workflow:

```markdown
# .opencode/workflows/pr-review.md

## Pull Request Review Workflow

1. Use [Secure Code Review](skills/secure-code-review.md) for security
2. Use [Test Generation](skills/test-generation.md) for coverage
3. Use [Documentation Review](skills/documentation-review.md) for docs

Aggregate findings and produce summary report.
```

## Troubleshooting

### Skill Not Found

```bash
# Check skill is in correct location
ls -la .opencode/skills/secure-code-review.md

# Verify frontmatter is valid
make validate
```

### Output Doesn't Meet Contract

If OpenCode reports contract violations:

1. Check `required_sections` in frontmatter
2. Verify all sections are present in output
3. Ensure no `prohibited_content` appears

## See Also

- [Secure Code Review Pattern](../../skills/secure-code-review/SKILL.md)
- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [Pattern Validation](../../README.md#validation)
