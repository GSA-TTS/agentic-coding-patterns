---
id: general-agent
version: "1.0.0"
title: "General Agent Instructions"
type: agent
description: "General-purpose agent instructions for incremental, safe development work"

status: experimental
owners:
  - "@community"

primary_personas:
  - developers
  - agents

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Core Principles"
      - "Work Practices"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false
---

# General Agent Instructions

These are general-purpose agent instructions for safe, incremental development work.

> For complete behavioral rules, see [main AGENTS.md](../../AGENTS.md)

## Core Principles

```
safety > correctness > simplicity > performance
```

1. **Safety** — Never break existing functionality
2. **Correctness** — Produce working, tested code
3. **Simplicity** — Clear code over clever code
4. **Performance** — Optimize only when needed

## Work Practices

### 1. Read Before Write

**MUST:**

- Read existing code before modifying
- Understand context before making changes
- Check related files for dependencies
- Review existing tests

**Example:**

```bash
# Before editing function.py
cat function.py  # Read current implementation
grep -r "import function" .  # Check usage
pytest tests/test_function.py  # Run existing tests
```

### 2. Incremental Changes

**MUST:**

- Make small, focused changes
- One logical change per commit
- Test after each change
- Don't combine refactoring with feature work

**Good:**

- Change 1: Add input validation (10 lines)
- Change 2: Add error handling (15 lines)
- Change 3: Add tests (20 lines)

**Bad:**

- Change 1: Refactor + new feature + fix bug (200 lines)

### 3. Validation

**MUST run before committing:**

```bash
make validate    # Lint, format, type check
make test        # Run test suite
```

**MUST verify:**

- All tests pass
- No new linter errors
- Code compiles/runs
- Changes work as intended

### 4. No Silent Failures

**MUST:**

- Report errors immediately
- Don't swallow exceptions
- Don't continue after failures
- Ask when uncertain

**Example:**

```python
# ❌ Bad - silent failure
try:
    result = risky_operation()
except:
    pass  # Silently fails!

# ✅ Good - explicit handling
try:
    result = risky_operation()
except SpecificError as e:
    logger.error(f"Operation failed: {e}")
    raise  # Re-raise or handle appropriately
```

### 5. Clear Communication

**MUST:**

- Explain what you're doing
- Show command outputs
- Report validation results
- Summarize changes made

**Format:**

```
I'm going to:
1. Add input validation to process_data()
2. Add tests for edge cases
3. Run validation

[performs work]

Changes made:
- Added validation in process_data() (line 45)
- Added 3 test cases
- All tests pass ✓
```

### 6. Safety Checks

**MUST NEVER:**

- Include secrets or credentials
- Delete files without confirmation
- Modify production systems
- Bypass security controls

**MUST:**

- Use placeholders for secrets
- Ask before destructive operations
- Work in development/test environments
- Follow security best practices

## Common Tasks

### Adding a Feature

1. Read existing code
2. Write tests first (TDD)
3. Implement feature
4. Run tests
5. Validate and commit

### Fixing a Bug

1. Reproduce the bug
2. Write regression test
3. Fix the issue
4. Verify test passes
5. Validate and commit

### Refactoring

1. Ensure tests exist
2. Make small refactors
3. Run tests after each change
4. Keep behavior unchanged
5. Validate and commit

## Verification Checklist

Before declaring done:

- [ ] Code works as intended
- [ ] Tests pass
- [ ] Linter passes
- [ ] No secrets in code
- [ ] Changes documented
- [ ] Commit message clear

## Related Patterns

- [test-generation](../../skills/test-generation/SKILL.md) - Generate tests
- [secure-code-review](../../skills/secure-code-review/SKILL.md) - Security review

## References

- For complete rules, see [main AGENTS.md](../../AGENTS.md)
- For coding standards, see [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
