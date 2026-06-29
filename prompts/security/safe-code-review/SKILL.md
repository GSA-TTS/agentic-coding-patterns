---
id: safe-code-review
version: "1.0.0"
title: "Security-Focused Code Review"
type: prompt
description: "Prompt for identifying OWASP risks, injection vulnerabilities, and security issues in code"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - security
  - developers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings"
      - "Recommendations"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Actual Exploit Code"
      - "Weaponized Payloads"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "security review"
  - "code review"
  - "vulnerabilities"
  - "OWASP"
  - "security check"

tags:
  - "security"
  - "review"
  - "owasp"
  - "vulnerabilities"

categories:
  - "security"
  - "review"

risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Identify OWASP Top 10 risks"
    - "Find injection vulnerabilities"
    - "Review authentication/authorization"
    - "Validate secure defaults"
  exclusions:
    - "Not for penetration testing"
    - "Not for creating exploit code"
    - "Not for vulnerability research"
---

# Prompt: Security-Focused Code Review

Perform security-focused code review to identify vulnerabilities before they reach production.

## When to Use

- Reviewing code changes for security issues
- Pre-deployment security checks
- Investigating potential vulnerabilities
- Security audit preparation
- User asks "is this code secure?"

## Prerequisites

- Code to review
- Understanding of OWASP Top 10
- Knowledge of secure coding practices
- (Optional) Automated security scanner results

## Prompt

```
You are a security engineer conducting a code review focused on identifying security vulnerabilities.

## Code to Review
--- USER INPUT START ---
[User provides code snippet, file path, or PR link]
--- USER INPUT END ---

## Your Task

Perform a security-focused code review covering:

1. **Injection Vulnerabilities** (SQL, Command, XSS, etc.)
2. **Authentication & Authorization**
3. **Sensitive Data Exposure**
4. **Cryptography Issues**
5. **Input Validation**
6. **Security Misconfigurations**

## Review Checklist

### Injection Vulnerabilities

**SQL Injection:**
- [ ] Parameterized queries used (not string concatenation)
- [ ] ORM used safely
- [ ] Input validated before database operations

**Command Injection:**
- [ ] No shell execution with user input
- [ ] Safe APIs used (subprocess with list args, not shell=True)
- [ ] Input sanitized if shell needed

**XSS (Cross-Site Scripting):**
- [ ] Output encoding based on context
- [ ] User input not rendered as HTML without sanitization
- [ ] Content Security Policy headers set

### Authentication & Authorization

**Authentication:**
- [ ] Passwords hashed with strong algorithm (bcrypt, Argon2)
- [ ] No passwords in plaintext
- [ ] Session tokens cryptographically random
- [ ] Token expiration implemented

**Authorization:**
- [ ] Access controls enforced server-side
- [ ] Principle of least privilege applied
- [ ] Authorization checked on every request
- [ ] No client-side-only authorization

### Sensitive Data Exposure

- [ ] No secrets in code/comments
- [ ] Sensitive data encrypted at rest
- [ ] Sensitive data encrypted in transit (TLS)
- [ ] Sensitive data not logged
- [ ] API keys not in URLs

### Cryptography

- [ ] No custom crypto implementations
- [ ] Approved algorithms only (AES-256, RSA-2048+, SHA-256+)
- [ ] TLS 1.2+ for network communication
- [ ] Certificate validation not disabled
- [ ] Cryptographically secure RNG used

### Input Validation

- [ ] All external input validated
- [ ] Allowlists used over denylists
- [ ] Type checking performed
- [ ] Length limits enforced

### Security Misconfigurations

- [ ] Debug mode disabled in production
- [ ] Security headers set (CSP, HSTS, X-Frame-Options)
- [ ] Default credentials changed
- [ ] Unnecessary features disabled
- [ ] Error messages don't leak system details

## Finding Documentation Format

For each finding:

**Finding ID**: F1, F2, etc.
**Severity**: Critical | High | Medium | Low | Info
**Category**: OWASP category (e.g., A03:2021-Injection)
**Issue**: Brief description
**Location**: File:line or function name
**Risk**: What attacker could do
**Remediation**: How to fix (with code example if possible)

## Severity Definitions

- **Critical**: Exploitable remotely, leads to data breach/RCE
- **High**: Exploitable, significant impact
- **Medium**: Exploitable with constraints, moderate impact
- **Low**: Minor impact or difficult to exploit
- **Info**: No immediate risk, improvement suggestion

## Prohibited Content

Do NOT include:
- Working exploit code
- Weaponized payloads
- Actual secrets or credentials
- Detailed vulnerability research
- Information that aids attackers

Instead, describe vulnerabilities conceptually and provide remediation.

## Output Structure

### Summary
**Files Reviewed**: X
**Findings**: X critical, X high, X medium, X low
**Overall Risk**: Critical | High | Medium | Low

### Critical Findings
[List critical issues first]

### High Findings
[Then high severity]

### Medium Findings
[Then medium]

### Low/Info Findings
[Then low severity and informational]

### Recommendations
1. Priority 1 actions
2. Priority 2 actions
3. Long-term improvements

### Verification Steps
[How to verify fixes]
```

## Usage Example

### Input

```python
def get_user(username):
    query = f"SELECT * FROM users WHERE name = '{username}'"
    return db.execute(query)

def admin_panel(request):
    if request.GET.get('is_admin') == 'true':
        return render_admin_page()
    return HttpResponseForbidden()
```

### Expected Output

```markdown
### Summary
**Files Reviewed**: 1
**Findings**: 1 critical, 1 high, 0 medium, 0 low
**Overall Risk**: Critical

### Critical Findings

**F1: SQL Injection in get_user()**
**Severity**: Critical
**Category**: A03:2021-Injection
**Issue**: SQL query built with string formatting using unsanitized user input
**Location**: get_user(), line 2
**Risk**: Attacker can read/modify/delete database records, potentially dump entire database
**Proof of Concept** (conceptual): Input like `' OR '1'='1` would bypass WHERE clause
**Remediation**:

```python
# ✅ Use parameterized query
def get_user(username):
    query = "SELECT * FROM users WHERE name = ?"
    return db.execute(query, (username,))
```

### High Findings

**F2: Client-Side Authorization Check**
**Severity**: High
**Category**: A01:2021-Broken Access Control
**Issue**: Authorization decision based on client-controlled GET parameter
**Location**: admin_panel(), line 5
**Risk**: Any user can access admin functionality by adding `?is_admin=true` to URL
**Remediation**:

```python
# ✅ Check server-side session/database
def admin_panel(request):
    user = get_authenticated_user(request)
    if not user.has_role('admin'):
        return HttpResponseForbidden()
    return render_admin_page()
```

### Recommendations

1. **Immediate (Priority 1)**:
   - Fix F1 (SQL injection) before any deployment
   - Fix F2 (broken access control) before any deployment
   - Audit entire codebase for similar patterns

2. **Short-term (Priority 2)**:
   - Implement input validation middleware
   - Add security headers (CSP, HSTS, X-Frame-Options)
   - Run automated security scanner (Bandit for Python)

3. **Long-term**:
   - Security training for development team
   - Add security review to PR process
   - Implement automated security testing in CI/CD

### Verification Steps

1. **For F1**: Review all database queries, ensure parameterization
2. **For F2**: Test admin access without proper authentication
3. Run security scanner: `bandit -r .`
4. Manual penetration test before deployment

```

## Verification

Check that review output:
- [ ] All OWASP categories checked
- [ ] Findings have severity and remediation
- [ ] No actual exploit code included
- [ ] Recommendations are prioritized
- [ ] Verification steps provided

## Related Patterns

- [secure-code-review](../../../skills/secure-code-review/SKILL.md) - Detailed security review skill
- [dependency-analysis](../../../skills/dependency-analysis/SKILL.md) - Check for vulnerable dependencies

## References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [OWASP Code Review Guide](https://owasp.org/www-project-code-review-guide/)
- For compliance controls, see [agentic-coding-playbook SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)
