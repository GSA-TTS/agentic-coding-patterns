---
id: issue-to-merge-request
version: "1.0.0"
title: "Issue to Merge Request Workflow"
type: workflow
description: "Complete development workflow from issue analysis to merged PR"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers

requires:
  anchors: []
  skills:
    - implementation-plan
    - test-generation
    - secure-code-review

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Outcome"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "full workflow"
  - "issue to PR"
  - "development cycle"
  - "feature development"

tags:
  - "workflow"
  - "development"
  - "pr"
  - "git"
---

# Workflow: Issue to Merge Request

Complete development workflow from analyzing an issue through implementation, testing, and creating a merge request.

## When to Use

- Starting work on a new feature or bug fix
- Need structured approach to development
- Want consistent workflow across team
- Ensuring nothing is missed before PR

## Overview

```
Issue Analysis → Planning → Implementation → Testing → PR → Review → Merge
```

This workflow takes you from an issue description to a merged pull request with confidence that all quality checks pass.

## Prerequisites

- Access to issue tracker (GitHub, GitLab, etc.)
- Repository write access
- Development environment set up
- Tests can run locally

## Workflow Steps

### Step 1: Issue Analysis

**Goal:** Understand requirements and acceptance criteria

**Actions:**

1. Read issue thoroughly
2. Identify acceptance criteria
3. Clarify unknowns with issue author
4. Verify issue is ready for work

**Outputs:**

- Clear understanding of requirements
- List of acceptance criteria
- Any assumptions documented

**Verification:**

- [ ] Requirements understood
- [ ] Acceptance criteria identified
- [ ] No blocking unknowns
- [ ] Issue assigned to you

**Related patterns:** N/A

---

### Step 2: Planning

**Goal:** Break work into implementable tasks

**Actions:**

1. Use [implementation-plan prompt](../../prompts/planning/implementation-plan/SKILL.md)
2. Break feature into tasks (T1, T2, T3...)
3. Identify dependencies between tasks
4. Estimate complexity per task

**Outputs:**

- Implementation plan with tasks
- Dependency graph
- Risk assessment

**Verification:**

- [ ] Tasks are granular (1-4 hours each)
- [ ] Dependencies mapped
- [ ] Risks identified
- [ ] Plan reviewed (if complex)

**Related patterns:** [implementation-plan](../../prompts/planning/implementation-plan/SKILL.md)

---

### Step 3: Create Branch

**Goal:** Isolate work in feature branch

**Actions:**

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/issue-123-brief-description

# Verify branch
git branch --show-current
```

**Outputs:**

- Feature branch created
- Branch name follows convention

**Verification:**

- [ ] Branch created from latest main
- [ ] Branch name descriptive
- [ ] No uncommitted changes from main

---

### Step 4: Implementation

**Goal:** Implement tasks according to plan

**Actions:**

1. Work through tasks in dependency order
2. Make small, focused commits
3. Run tests after each task
4. Keep changes reviewable

**For each task:**

```bash
# Implement task
[write code]

# Run tests
make test

# Commit
git add [files]
git commit -m "feat: brief description

Detailed explanation of changes.

Implements task TX from plan."
```

**Outputs:**

- Code implementing requirements
- Tests for new functionality
- Clear commit history

**Verification:**

- [ ] All planned tasks implemented
- [ ] Tests pass locally
- [ ] Code follows style guide
- [ ] No debugging code left in

**Related patterns:** [test-generation](../../skills/test-generation/SKILL.md)

---

### Step 5: Testing

**Goal:** Verify implementation works correctly

**Actions:**

1. Run full test suite
2. Test happy path manually
3. Test error cases
4. Check test coverage

```bash
# Run all tests
make test

# Check coverage
make coverage

# Manual testing
[test in browser/CLI]
```

**Outputs:**

- All tests passing
- Coverage adequate (>80% for new code)
- Manual testing results

**Verification:**

- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Coverage acceptable
- [ ] Manual testing successful

**Related patterns:** [test-generation](../../skills/test-generation/SKILL.md)

---

### Step 6: Security Review

**Goal:** Verify no security issues introduced

**Actions:**

1. Review code against [secure-code-review checklist](../../skills/secure-code-review/SKILL.md)
2. Check for injection vulnerabilities
3. Verify authentication/authorization
4. Scan dependencies

```bash
# Run security linter (example)
bandit -r .

# Check dependencies
npm audit  # or pip-audit, cargo audit, etc.
```

**Outputs:**

- Security review completed
- No critical vulnerabilities

**Verification:**

- [ ] Security review done
- [ ] No SQL/command injection
- [ ] No XSS vulnerabilities
- [ ] Dependencies secure

**Related patterns:** [secure-code-review](../../skills/secure-code-review/SKILL.md), [dependency-analysis](../../skills/dependency-analysis/SKILL.md)

---

### Step 7: Prepare PR

**Goal:** Create comprehensive PR description

**Actions:**

1. Push branch to remote
2. Create PR with complete description
3. Add reviewers
4. Link to original issue

```bash
# Push branch
git push origin feature/issue-123-brief-description

# Create PR (via gh CLI or web UI)
gh pr create --title "feat: Brief description" --body "See template"
```

**PR Description Template:**

```markdown
## Summary
[Brief description of changes]

## Related Issue
Closes #123

## Changes Made
- Change 1
- Change 2
- Change 3

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing completed
- [ ] All tests pass

## Security
- [ ] Security review completed
- [ ] No sensitive data in code
- [ ] Dependencies scanned

## Screenshots (if UI changes)
[Add screenshots]

## Checklist
- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

**Outputs:**

- PR created
- Description complete
- Reviewers assigned

**Verification:**

- [ ] PR title descriptive
- [ ] Description complete
- [ ] Issue linked
- [ ] CI checks triggered

---

### Step 8: Address Review Feedback

**Goal:** Incorporate reviewer suggestions

**Actions:**

1. Read review comments
2. Respond to questions
3. Make requested changes
4. Push updates

```bash
# Make changes based on feedback
[edit files]

# Commit changes
git add [files]
git commit -m "fix: address review feedback

- Changed X based on @reviewer comment
- Fixed Y as suggested"

# Push updates
git push origin feature/issue-123-brief-description
```

**Outputs:**

- Review feedback addressed
- Discussion resolved
- Tests still passing

**Verification:**

- [ ] All comments addressed
- [ ] Changes explained in responses
- [ ] Tests still pass
- [ ] CI green

---

### Step 9: Merge

**Goal:** Integrate changes into main branch

**Actions:**

1. Wait for approval
2. Ensure CI passes
3. Resolve any conflicts
4. Merge PR

**Outputs:**

- PR merged
- Feature branch can be deleted

**Verification:**

- [ ] Approved by required reviewers
- [ ] CI passing
- [ ] No conflicts
- [ ] Merged successfully

---

## Complete Workflow Checklist

Use this to track progress:

- [ ] Issue analyzed and understood
- [ ] Implementation plan created
- [ ] Feature branch created
- [ ] Code implemented
- [ ] Tests written and passing
- [ ] Security review completed
- [ ] PR created with description
- [ ] Review feedback addressed
- [ ] CI passing
- [ ] PR merged

## Example Walkthrough

### Scenario

**Issue #45**: Add password strength indicator to registration form

### Execution

**Step 1: Issue Analysis**

- Requirement: Visual indicator showing password strength
- Acceptance criteria: Shows weak/medium/strong, updates in real-time
- Assumptions: Use existing validation library

**Step 2: Planning**

- T1: Add password strength calculation (Simple)
- T2: Add UI indicator component (Medium)
- T3: Connect component to input (Simple)
- T4: Add tests (Medium)
- T5: Update documentation (Simple)

**Step 3-4: Implementation**

```bash
git checkout -b feature/issue-45-password-strength
# Implemented T1-T5
git log --oneline
# abc123 docs: update registration guide
# def456 test: add password strength tests
# ghi789 feat: connect strength indicator
# jkl012 feat: add strength indicator component
# mno345 feat: add password strength calculation
```

**Step 5: Testing**

- All 15 tests pass
- Coverage: 95%
- Manual test: indicator updates as expected

**Step 6: Security**

- Password not logged or exposed
- No XSS vulnerabilities in indicator
- Client-side only (server validates separately)

**Step 7: PR Created**
PR #46 created with description, screenshots, checklist

**Step 8-9: Review and Merge**

- Reviewer suggested accessibility improvement
- Added ARIA labels
- Approved and merged

### Outcome

Feature delivered, all tests passing, fully documented

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Merge conflicts | Branch out of date | Rebase or merge main regularly |
| CI failures | Tests pass locally but fail in CI | Check environment differences |
| Unclear requirements | Ambiguous issue | Ask for clarification before coding |
| PR too large | Too many changes at once | Break into smaller PRs |

## Exit Criteria

The workflow is complete when:

- [ ] All acceptance criteria met
- [ ] Tests passing in CI
- [ ] Code reviewed and approved
- [ ] PR merged to main
- [ ] Issue closed
- [ ] Documentation updated

## Related Patterns

- [implementation-plan](../../prompts/planning/implementation-plan/SKILL.md) - Planning
- [test-generation](../../skills/test-generation/SKILL.md) - Testing
- [secure-code-review](../../skills/secure-code-review/SKILL.md) - Security
- [qa-round](../qa-round/SKILL.md) - QA workflow

## References

- For git best practices, see your team's contribution guide
- For PR templates, see [GitHub docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests)
