---
id: qa-workflow
version: "1.0.0"
title: "QA Round Workflow"
type: workflow
description: "Structured QA verification workflow from pre-check through sign-off"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - testers
  - developers

requires:
  anchors: []
  skills:
    - qa-round
    - test-generation

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
  - "QA process"
  - "verification"
  - "testing cycle"
  - "quality assurance"

tags:
  - "workflow"
  - "qa"
  - "testing"
  - "verification"
---

# Workflow: QA Round

Structured QA verification workflow to ensure code meets quality standards before release.

## When to Use

- Before merging pull requests
- During sprint QA cycles
- Pre-release verification
- After bug fixes
- Quality gate enforcement

## Overview

```
Pre-QA Setup → Test Execution → Bug Reporting → Regression → Sign-Off
```

Systematic verification of code changes against acceptance criteria with clear pass/fail decision.

## Prerequisites

- Access to test environment
- Acceptance criteria documented
- Test cases identified
- Ability to reproduce issues

## Workflow Steps

### Step 1: Pre-QA Preparation

**Goal:** Understand what to test and set up environment

**Actions:**

1. Read PR/issue description
2. Review acceptance criteria
3. Identify test scenarios
4. Set up test environment
5. Review related documentation

```bash
# Get the code
git fetch origin
git checkout feature-branch

# Build and start
make build
make start
```

**Outputs:**

- Test environment ready
- Test plan created
- Acceptance criteria list

**Verification:**

- [ ] Environment running
- [ ] Test data prepared
- [ ] Access credentials work
- [ ] Baseline established

---

### Step 2: Acceptance Criteria Validation

**Goal:** Verify each acceptance criterion

**Actions:**
For each acceptance criterion:

1. Execute test steps
2. Observe actual behavior
3. Compare to expected behavior
4. Document result (Pass/Fail)

**Example:**

```
AC1: User can reset password via email

Test:
1. Navigate to /forgot-password
2. Enter valid email
3. Submit form
4. Check email inbox
5. Click reset link
6. Enter new password
7. Attempt login

Result: ✅ PASS - All steps work as expected
```

**Outputs:**

- Each AC marked Pass/Fail
- Evidence captured (screenshots if applicable)
- Notes on any issues

**Verification:**

- [ ] All ACs tested
- [ ] Results documented
- [ ] Evidence collected

**Related patterns:** [qa-round prompt](../../prompts/review/qa-round/SKILL.md)

---

### Step 3: Test Execution

**Goal:** Run comprehensive test suite

**Actions:**

**Automated tests:**

```bash
# Unit tests
make test

# Integration tests
make test-integration

# Coverage
make coverage
```

**Manual tests:**

- Happy path testing
- Edge case testing
- Error handling verification
- Browser compatibility (if web)
- Performance spot check

**Outputs:**

- Test results (pass/fail counts)
- Coverage report
- Performance metrics (if relevant)

**Verification:**

- [ ] All automated tests pass
- [ ] Manual test scenarios complete
- [ ] Coverage meets threshold (80%+)
- [ ] No console errors/warnings

**Related patterns:** [test-generation](../../skills/test-generation/SKILL.md)

---

### Step 4: Bug Documentation

**Goal:** Document any issues found

**Actions:**
For each bug:

1. Create clear title
2. Document reproduction steps
3. Note expected vs actual behavior
4. Assess severity
5. Capture evidence

**Bug Report Template:**

```markdown
## Bug: [Brief Title]

**Severity**: Critical | High | Medium | Low

**Environment**:
- OS: [Windows 10 / macOS 13 / Ubuntu 22.04]
- Browser: [Chrome 120 / Firefox 121 / Safari 17]
- Version: [App version]

**Steps to Reproduce**:
1. First step
2. Second step
3. Third step
4. Observe issue

**Expected**: [What should happen]
**Actual**: [What actually happens]

**Screenshots**: [Attach if helpful]

**Workaround**: [If any exists]

**Additional Context**: [Any relevant info]
```

**Outputs:**

- Bug reports created
- Severity assessed
- Evidence attached

**Verification:**

- [ ] All bugs documented
- [ ] Reproduction steps clear
- [ ] Severity accurate
- [ ] Evidence included

---

### Step 5: Regression Testing

**Goal:** Verify existing functionality still works

**Actions:**

1. Identify features related to changes
2. Test those features
3. Run smoke test suite
4. Check for unexpected side effects

**Critical areas to check:**

- Authentication/login
- Data persistence
- Core workflows
- Navigation
- API endpoints

```bash
# Run regression test suite
make test-regression

# Manual smoke test
# [Key user journeys]
```

**Outputs:**

- Regression test results
- List of any regressions found

**Verification:**

- [ ] Related features tested
- [ ] Smoke tests pass
- [ ] No regressions detected
- [ ] Performance not degraded

---

### Step 6: Sign-Off Decision

**Goal:** Make clear pass/fail decision

**Actions:**

1. Review all test results
2. Assess bug severity
3. Determine if blocking
4. Make decision
5. Document rationale

**Decision Matrix:**

| Bugs Found | Decision | Action |
|------------|----------|--------|
| None | ✅ APPROVED | Ready to merge |
| Low only | ✅ APPROVED | Can merge, create follow-up issues |
| Medium (non-blocking) | ⚠️ APPROVED WITH NOTES | Can merge with follow-ups |
| High or Critical | ❌ REJECTED | Must fix before merge |

**Outputs:**

- Clear pass/fail decision
- List of blocking issues (if any)
- Follow-up issues created (if approved)
- QA sign-off comment

**Verification:**

- [ ] Decision made
- [ ] Rationale documented
- [ ] Blocking issues listed
- [ ] Follow-ups created

---

## Complete Workflow Checklist

Track QA progress:

- [ ] Environment set up
- [ ] Acceptance criteria validated
- [ ] Automated tests executed
- [ ] Manual testing completed
- [ ] Bugs documented (if any)
- [ ] Regression testing done
- [ ] Sign-off decision made
- [ ] Results communicated

## Example Walkthrough

### Scenario

**PR #78**: Password reset feature

**Acceptance Criteria:**

1. User can request reset via email
2. Reset link expires after 1 hour
3. Password complexity enforced
4. User logged in after reset

### Execution

**Step 1: Preparation**

- Checked out feature branch
- Started local server
- Prepared test email account

**Step 2: AC Validation**

| AC | Result | Notes |
|----|--------|-------|
| AC1: Request reset | ✅ | Email received in 3 seconds |
| AC2: Link expires | ✅ | Expired link shows error |
| AC3: Complexity | ✅ | Weak passwords rejected |
| AC4: Auto-login | ✅ | Redirected to dashboard |

**Step 3: Test Execution**

- Automated: 47 tests pass, 0 fail
- Coverage: 89%
- Manual: All scenarios pass
- Console: No errors

**Step 4: Bugs Found**

**Bug B1: Multiple reset emails**

- **Severity**: Medium
- **Repro**: Click "Send Reset" rapidly 5 times
- **Expected**: One email sent
- **Actual**: 5 emails sent

**Bug B2: Email service error shows 500**

- **Severity**: Medium
- **Repro**: Stop email service, request reset
- **Expected**: Friendly error message
- **Actual**: 500 error page

**Step 5: Regression**

- Existing login flow: ✅ Works
- Password change (logged in): ✅ Works
- Session management: ✅ No issues

**Step 6: Sign-Off**

**Decision**: ⚠️ **APPROVED WITH NOTES**

**Rationale**:

- All acceptance criteria met
- Both bugs are medium severity
- Core functionality works
- No regressions
- Bugs don't block user success

**Follow-up issues created**:

- Issue #79: Rate limit password reset endpoint
- Issue #80: Improve email service error handling

### Outcome

PR approved for merge with 2 follow-up issues for next sprint

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Can't reproduce bug | Environment differences | Document exact environment details |
| Flaky tests | Timing issues, async | Increase timeouts, use better waits |
| Slow test execution | Too many heavy tests | Optimize, use mocks |
| Unclear if bug or feature | Ambiguous requirements | Clarify with product owner |

## Exit Criteria

QA round is complete when:

- [ ] All acceptance criteria tested
- [ ] Test suite executed
- [ ] Bugs documented or none found
- [ ] Regression testing done
- [ ] Sign-off decision made
- [ ] Results communicated to team
- [ ] Follow-up issues created (if needed)

## Related Patterns

- [qa-round prompt](../../prompts/review/qa-round/SKILL.md) - QA review prompt
- [test-generation](../../skills/test-generation/SKILL.md) - Generate tests
- [issue-to-merge-request](../issue-to-merge-request/SKILL.md) - Full dev workflow

## References

- For QA best practices, see industry standards like ISO 29119
- For bug severity guidelines, see your team's QA process
