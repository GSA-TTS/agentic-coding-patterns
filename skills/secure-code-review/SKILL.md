---
id: secure-code-review
version: "1.0.0"
title: "Secure Code Review"
type: skill
description: "Security-focused code review pattern covering OWASP Top 10 vulnerabilities and common security issues"

status: experimental
owners:
  - "@community"

primary_personas:
  - developers
  - security

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Actual Exploit Code"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "code review"
  - "security"
  - "vulnerability"
  - "OWASP"

tags:
  - "security"
  - "review"
  - "owasp"
  - "vulnerabilities"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review code changes for security vulnerabilities"
    - "Identify OWASP Top 10 risks"
    - "Provide remediation guidance"
  exclusions:
    - "Not for compliance auditing"
    - "Not for penetration testing"
    - "Does not replace automated security scanners"
---

# Skill: Secure Code Review

Perform security-focused code review to identify common vulnerabilities and security issues before they reach production.

## When to Use

- Reviewing pull requests or code changes
- Pre-deployment security checks
- Identifying injection vulnerabilities
- Validating authentication and authorization logic
- Checking for insecure configurations
- User asks "is this code secure?" or "check for vulnerabilities"

## Prerequisites

- Access to codebase
- Understanding of OWASP Top 10
- Familiarity with the programming language being reviewed
- Knowledge of secure coding practices

## Procedure

### Step 1: Input Validation Review

Check all external inputs (user input, API calls, file reads, environment variables):

**What to look for:**

- [ ] All inputs are validated against allowlists (not denylists)
- [ ] Input length limits enforced
- [ ] Special characters handled safely
- [ ] Type checking performed

**Common issues:**

```python
# ❌ Vulnerable - no validation
user_input = request.GET['id']
query = f"SELECT * FROM users WHERE id = {user_input}"

# ✅ Secure - parameterized query
user_id = int(request.GET['id'])  # Type check
query = "SELECT * FROM users WHERE id = ?"
cursor.execute(query, (user_id,))
```

### Step 2: Injection Vulnerability Check

**SQL Injection:**

- [ ] No string concatenation in SQL queries
- [ ] Parameterized queries or ORM used
- [ ] Input sanitized before database operations

**Command Injection:**

- [ ] No shell execution with user input
- [ ] If shell needed, use safe APIs (e.g., `subprocess` with list args, not shell=True)

**XSS (Cross-Site Scripting):**

- [ ] Output encoding based on context (HTML, JavaScript, CSS, URL)
- [ ] Content Security Policy headers set
- [ ] User input not rendered as HTML without sanitization

### Step 3: Authentication and Authorization

**Authentication:**

- [ ] Passwords never stored in plaintext
- [ ] Strong password hashing (bcrypt, Argon2, scrypt)
- [ ] Multi-factor authentication supported
- [ ] Session tokens cryptographically random
- [ ] Tokens expire appropriately

**Authorization:**

- [ ] Access controls enforced server-side
- [ ] Principle of least privilege applied
- [ ] Authorization checked on every request
- [ ] No client-side-only authorization

```python
# ❌ Client-side only
if user.is_admin:  # Trust client data
    return admin_panel()

# ✅ Server-side enforcement
@require_role('admin')
def admin_panel(request):
    # Check on every request
    pass
```

### Step 4: Sensitive Data Handling

- [ ] No secrets in code or comments
- [ ] PII encrypted at rest and in transit
- [ ] Sensitive data not logged
- [ ] Secrets loaded from environment or secret manager
- [ ] API keys not in URLs (query parameters)

### Step 5: Cryptography Review

- [ ] No custom crypto implementations
- [ ] Approved algorithms only (AES-256, RSA-2048+, SHA-256+)
- [ ] TLS 1.2+ for network communication
- [ ] Certificate validation not disabled
- [ ] Random values use cryptographically secure RNG

### Step 6: Error Handling and Logging

- [ ] Errors handled explicitly (no empty catch blocks)
- [ ] Stack traces not exposed to users
- [ ] Sensitive data not logged
- [ ] Error messages don't leak system details
- [ ] Security events logged for audit

### Step 7: Configuration and Deployment

- [ ] Security headers set (CSP, HSTS, X-Frame-Options, etc.)
- [ ] Debug mode disabled in production
- [ ] Default credentials changed
- [ ] Unnecessary features/endpoints disabled
- [ ] CORS configured restrictively

## Verification

After review, confirm:

- [ ] All OWASP Top 10 risks checked
- [ ] Injection vulnerabilities identified or ruled out
- [ ] Authentication/authorization logic verified
- [ ] Sensitive data handling reviewed
- [ ] Findings documented with severity and remediation
- [ ] No false positives that would block legitimate code

## Examples

### Example 1: SQL Injection Detection

**Code:**

```python
def get_user(username):
    query = "SELECT * FROM users WHERE name = '" + username + "'"
    return db.execute(query)
```

**Finding:**

- **Issue:** SQL injection vulnerability
- **Severity:** High
- **Impact:** Attacker can read/modify database
- **Remediation:** Use parameterized query:

```python
def get_user(username):
    query = "SELECT * FROM users WHERE name = ?"
    return db.execute(query, (username,))
```

### Example 2: XSS Prevention

**Code:**

```javascript
document.getElementById('message').innerHTML = userInput;
```

**Finding:**

- **Issue:** XSS vulnerability
- **Severity:** High
- **Impact:** Script injection, session hijacking
- **Remediation:** Use textContent or sanitize:

```javascript
document.getElementById('message').textContent = userInput;
// Or use DOMPurify if HTML needed
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Too many false positives | Overly aggressive checks | Focus on high/critical severity issues first |
| Unclear remediation | Generic security advice | Provide specific code examples |
| Missed vulnerabilities | Limited scope | Use automated scanners as complement |

## Related Patterns

- [dependency-analysis](../dependency-analysis/SKILL.md) - Check for vulnerable dependencies
- [test-generation](../test-generation/SKILL.md) - Generate security test cases

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- For compliance controls, see [agentic-coding-playbook SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)
