---
id: qa-round
version: "1.0.0"
title: "QA Round Review"
type: prompt
description: "Guide QA verification including test coverage, bug reproduction, and acceptance criteria validation"

status: experimental
owners:
  - "@community"

primary_personas:
  - testers
  - developers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Test Results"
      - "Issues Found"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "QA"
  - "quality assurance"
  - "testing"
  - "verification"
  - "acceptance criteria"

tags:
  - "qa"
  - "testing"
  - "review"
  - "verification"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Verify test coverage"
    - "Validate acceptance criteria"
    - "Document bugs with reproduction steps"
    - "QA sign-off"
  exclusions:
    - "Not for performance testing"
    - "Not for security penetration testing"
---

# Prompt: QA Round Review

Conduct a thorough QA review to verify test coverage, validate acceptance criteria, and identify bugs before release.

## When to Use

- Before merging a pull request
- During sprint QA cycles
- Pre-release verification
- Validating bug fixes
- User needs "QA this change"

## Prerequisites

- Code changes to review
- Acceptance criteria or requirements
- Test environment access
- Ability to run tests

## Prompt

```
You are a QA engineer conducting a thorough review of a code change.

## Change Description
--- USER INPUT START ---
[User provides PR description, feature description, or bug fix details]
--- USER INPUT END ---

## Your Task

Perform a comprehensive QA review covering:

1. **Test Coverage Analysis**
2. **Acceptance Criteria Validation**
3. **Manual Testing**
4. **Regression Check**
5. **Bug Documentation** (if issues found)

## Test Coverage Analysis

Review the test suite:
- [ ] Unit tests exist for new functionality
- [ ] Edge cases are tested
- [ ] Error handling is tested
- [ ] Integration tests cover interactions
- [ ] Test names are descriptive
- [ ] Tests are not flaky (deterministic)

Report coverage percentage if available.

## Acceptance Criteria Validation

For each acceptance criterion:
- [ ] Implemented as specified
- [ ] Verified through testing
- [ ] Edge cases handled
- [ ] Error cases handled

Mark each criterion: ✅ Pass | ❌ Fail | ⚠️ Partial

## Manual Testing Checklist

- [ ] Happy path works as expected
- [ ] Error messages are clear and helpful
- [ ] UI is responsive (if applicable)
- [ ] No console errors or warnings
- [ ] Links/buttons work correctly
- [ ] Form validation works
- [ ] Data persists correctly

## Regression Check

Verify existing functionality still works:
- [ ] Related features not broken
- [ ] Backward compatibility maintained
- [ ] Performance not degraded
- [ ] No new warnings/errors in logs

## Bug Documentation Format

For each bug found:

**Bug ID**: B1, B2, etc.
**Severity**: Critical | High | Medium | Low
**Title**: Brief description
**Steps to Reproduce**:
1. Step 1
2. Step 2
3. Observe issue

**Expected**: What should happen
**Actual**: What actually happens
**Environment**: Browser/OS/version
**Workaround**: If any exists

## Prohibited Content

Do NOT include:
- Actual user data or PII
- Production credentials
- Internal system details
- Sensitive vulnerability information

## Output Structure

### Summary
[Brief overview of QA results]

### Test Coverage Analysis
**Coverage**: X%
- ✅ Strengths
- ⚠️ Gaps
- 📋 Recommendations

### Acceptance Criteria Validation
| Criterion | Status | Notes |
|-----------|--------|-------|
| AC1: ... | ✅ | ... |
| AC2: ... | ❌ | ... |

### Manual Testing Results
**Happy Path**: ✅ Pass / ❌ Fail
**Edge Cases**: ✅ Pass / ❌ Fail
**Error Handling**: ✅ Pass / ❌ Fail

Details: [describe testing performed]

### Regression Check
✅ No regressions detected
OR
⚠️ Potential regressions:
- Issue 1
- Issue 2

### Bugs Found
[If none: "No bugs found"]
[If bugs: document each using format above]

### Sign-Off Decision
✅ **APPROVED** - Ready to merge
⚠️ **APPROVED WITH NOTES** - Minor issues, can merge
❌ **REJECTED** - Blocking issues must be fixed

**Blocker issues**: [list if any]
**Follow-up issues**: [list if any]
```

## Usage Example

### Input
```
PR #123: Add password reset functionality

Acceptance Criteria:
1. User can request password reset via email
2. Reset link expires after 1 hour
3. Password must meet complexity requirements
4. User is logged in after successful reset
```

### Expected Output
```markdown
### Summary
Reviewed password reset feature. Test coverage is good (87%). All acceptance criteria pass. Found one medium-severity bug with error handling.

### Test Coverage Analysis
**Coverage**: 87% (target: 80%)

✅ **Strengths**:
- All happy paths tested
- Edge cases covered (expired link, invalid token)
- Password validation well-tested

⚠️ **Gaps**:
- Missing test for concurrent reset requests
- Email sending failure not tested

📋 **Recommendations**:
- Add test for race condition (2 resets in quick succession)
- Mock email service and test failure handling

### Acceptance Criteria Validation

| Criterion | Status | Notes |
|-----------|--------|-------|
| Request reset via email | ✅ | Works, email received in 2 seconds |
| Link expires after 1 hour | ✅ | Verified with modified system time |
| Password complexity required | ✅ | Rejects weak passwords, shows requirements |
| User logged in after reset | ✅ | Session created, redirects to dashboard |

### Manual Testing Results

**Happy Path**: ✅ Pass
- Requested reset, received email, completed reset successfully

**Edge Cases**: ⚠️ Partial Pass
- ✅ Expired link shows appropriate error
- ✅ Invalid token shows error
- ❌ **Bug found**: Rapid clicking "Send Reset" sends multiple emails

**Error Handling**: ⚠️ Partial Pass
- ✅ Invalid email format rejected
- ✅ Non-existent email handled gracefully
- ❌ **Bug found**: Email service down causes 500 error (should show friendly message)

### Regression Check
✅ No regressions detected
- Existing login flow still works
- Password change (while logged in) unaffected
- Session management unchanged

### Bugs Found

**B1: Multiple password reset emails sent**
**Severity**: Medium
**Steps to Reproduce**:
1. Go to /forgot-password
2. Enter email
3. Click "Send Reset" button rapidly 5 times
4. Check email inbox

**Expected**: One email sent, button disabled after first click
**Actual**: 5 emails sent with different tokens
**Workaround**: Wait for page to reload
**Fix**: Disable button after first click, rate limit endpoint

**B2: Email service failure shows 500 error**
**Severity**: Medium
**Steps to Reproduce**:
1. Stop email service (simulate outage)
2. Request password reset
3. Observe error page

**Expected**: User-friendly error message
**Actual**: Generic 500 error page
**Workaround**: None
**Fix**: Catch email exception, show friendly message

### Sign-Off Decision
⚠️ **APPROVED WITH NOTES** - Can merge with follow-up issues

**Follow-up issues**:
- Create issue for B1 (rate limiting)
- Create issue for B2 (error handling)
- Add missing test coverage for concurrent requests

Both bugs are medium severity and don't block core functionality.
```

## Verification

Check that QA output:
- [ ] All acceptance criteria evaluated
- [ ] Test coverage assessed
- [ ] Bugs documented with reproduction steps
- [ ] Sign-off decision is clear
- [ ] No sensitive data included

## Related Patterns

- [test-generation](../../../skills/test-generation/SKILL.md) - Generate additional tests for gaps
- [secure-code-review](../../../skills/secure-code-review/SKILL.md) - Security-focused review

## References

- For QA best practices, see industry standards like ISO 29119
