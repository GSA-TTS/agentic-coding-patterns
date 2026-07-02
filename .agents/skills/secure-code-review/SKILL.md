---
name: secure-code-review
id: secure-code-review
version: "1.1.0"
title: "Secure Code Review"
type: skill
description: "Security-focused code review pattern covering OWASP Top 10 vulnerabilities and common security issues"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

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
      - "Real Secrets"
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

categories:
  - "security"
  - "review"

compliance:
  frameworks:
    - "NIST SP 800-53"
    - "OWASP Top 10 LLM 2025"
  nist_controls:
    - "AC-6"

changelog:
  - version: "1.1.0"
    date: "2026-07-02"
    change_type: minor
    summary: "Add diff modality + IaC and changed-workflow blast-radius sub-sections with flag-and-defer handoffs to sibling skills; extend secrets coverage to non-code surfaces (CI logs, agent reports, git history, base64/binary), placeholder-vs-real discrimination, and rotation. Absorbs proposed security-diff-review and secrets-handling-review."
  - version: "1.0.0"
    date: "2026-05-20"
    change_type: major
    summary: "Initial release."

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
    - "Review code changes for security vulnerabilities"
    - "Identify OWASP Top 10 risks"
    - "Provide remediation guidance"
    - "Review a whole file or a PR diff hunk (diff is a modality)"
    - "Review Infrastructure-as-Code (IaC) for insecure configuration"
    - "Assess blast radius of a changed CI workflow file in a diff"
    - "Detect exposed secrets in code and non-code surfaces"
  exclusions:
    - "Not for compliance auditing"
    - "Not for penetration testing"
    - "Does not replace automated security scanners"
    - "Agent-invoking or injection-reachable CI triggers: defer to agentic-actions-auditor"
    - "Scope-minimality judgments (GITHUB_TOKEN / IAM scope): defer to least-privilege-review"
    - "Supply-chain / dependency intake: defer to dependency-analysis"
---

# Skill: Secure Code Review

Perform security-focused code review to identify common vulnerabilities and security issues before they reach production.

> **Diff is a modality, not a mode.** You can review either a whole file or a
> single PR diff hunk. Every check below applies to both. When you review a
> diff, focus on what the change *introduces* or *removes* — you do not need to
> re-audit unchanged lines, but you should flag when a change weakens an
> existing control.

## Boundaries

This skill is the general **code-review hygiene** lane. Three neighbors own
adjacent lanes — flag and defer, do not re-implement them:

| If you see... | Defer to |
|---------------|----------|
| An agent-invoking or injection-reachable CI trigger (`pull_request_target`, `issue_comment`, `workflow_run` with untrusted checkout, a prompt built from PR/issue text) | **agentic-actions-auditor** |
| A judgment about whether a granted scope is *minimal* (GITHUB_TOKEN permissions, IAM scope) | **least-privilege-review** |
| Supply-chain or dependency intake (new packages, CVEs, licenses) | **dependency-analysis** |

secure-code-review's lane for CI is **general workflow-file code-review hygiene
plus the blast radius of the changed workflow in the diff** — not a full agent
or least-privilege audit.

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

Secrets and sensitive data leak far beyond source code. Check every surface a
value can land on.

**In code:**

- [ ] No secrets in code or comments
- [ ] PII encrypted at rest and in transit
- [ ] Sensitive data not logged
- [ ] Secrets loaded from environment or secret manager
- [ ] API keys not in URLs (query parameters)

**Non-code surfaces (often missed):**

- [ ] CI logs — no token, key, or connection string echoed into build output
- [ ] LLM prompts — no secret pasted into a prompt sent to a model
- [ ] Agent summaries / reports (markdown) — no secret copied into a generated
      report, review, or PR comment
- [ ] Shell history — no secret passed as a command-line argument
- [ ] Git history — a secret removed in the latest commit may still live in an
      earlier commit

**Placeholder vs. real (do not be fooled by a label):**

Judge a value by its **shape, entropy, and context**, not by its name.

> **Anti-bypass note.** An attacker can *name* a real secret `EXAMPLE_TOKEN`,
> `TEST_KEY`, or `dummy_password` to slip it past a naive filter. A "test" or
> "example" label is **not** proof the value is fake. A short, low-entropy
> value like `xxxxx` or `changeme` is a placeholder; a long high-entropy value
> that matches a known key format is a real secret regardless of its name.

**Encoded and generated forms:**

- [ ] Base64 / hex / binary blobs decoded and checked (a secret may hide inside
      an encoded string)
- [ ] Agent-generated markdown reports scanned the same way as code

**If a real secret was exposed — rotation, not deletion:**

Removing a leaked secret from a file does **not** un-leak it. Assume any secret
that reached a shared surface (a commit, a CI log, a report) is **compromised**.

- [ ] Rotate the credential at the issuer (revoke old, issue new)
- [ ] Remove it from the current file *and* from history if feasible
- [ ] Note in the finding that removal alone is insufficient

### Step 4a: Infrastructure-as-Code (IaC) Review

Applies to Terraform, CloudFormation, and Kubernetes manifests. Review them the
same way you review code — the diff modality applies here too.

**What to look for:**

- [ ] No hardcoded secrets (passwords, keys, tokens) in `.tf`, templates, or
      manifests — use a secret manager reference instead
- [ ] No over-permissive IAM / RBAC (wildcard `Action: "*"`,
      `Resource: "*"`, cluster-admin bindings) — see least-privilege-review for
      the *minimality* judgment
- [ ] No unintended public exposure (`0.0.0.0/0` ingress, public S3 buckets,
      `LoadBalancer` on an internal service)
- [ ] Encryption not disabled (at rest and in transit)
- [ ] Destructive / blast-radius changes flagged (deleting a database, replacing
      a resource that forces recreation, widening a security group)

```hcl
# ❌ Over-permissive + hardcoded secret (synthetic)
resource "aws_iam_policy" "app" {
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }] })
}
resource "aws_db_instance" "app" {
  password = "…"                          # FLAG: inline literal secret (redacted); use a secret ref
  publicly_accessible = true              # public exposure
}
```

> **Future-split note.** IaC review may graduate into its own skill later. For
> now it lives here as a sub-section; keep IaC findings clearly labeled so the
> split is clean.

### Step 4b: Changed-Workflow Blast-Radius Review

Applies to **CI workflow files that appear in a diff** (e.g. GitHub Actions
`.github/workflows/*.yml`). Your job is narrow: **what does this change
introduce, and what is the blast radius?**

Ask of the *changed* workflow:

- [ ] What new **permissions** does it grant?
- [ ] What new **secrets** does it read or expose?
- [ ] What new **triggers** does it add, and what can reach them?
- [ ] Does it echo a secret into logs, or pass one to an untrusted step?

**Critical boundary — flag and defer, do not fully audit here:**

- If the change adds an **agent-invoking or injection-reachable trigger**
  (`pull_request_target`, `issue_comment`, `workflow_run` with an untrusted
  checkout, or a prompt built from PR/issue text) → **FLAG it and DEFER to
  agentic-actions-auditor.** Do not attempt to fully audit the trigger here.
- If the question is whether the granted **scope is minimal** (which
  `GITHUB_TOKEN` permissions, which IAM actions) → **DEFER to
  least-privilege-review.**

You still report the *blast radius* of the changed workflow (what it can now
touch), you just do not own the agent-injection or minimality verdicts.

```yaml
# Changed workflow (synthetic diff) — FLAG + DEFER, do not audit the trigger here
on:
  pull_request_target:        # injection-reachable → defer to agentic-actions-auditor
    types: [opened]
permissions:
  contents: write             # new write scope → defer minimality to least-privilege-review
```

Example finding phrasing:

> This change adds a `pull_request_target` trigger and `contents: write`. The
> blast radius is any push to the default branch. This trigger is
> injection-reachable — **flagging and deferring to agentic-actions-auditor**
> for the full agent-trigger audit, and to least-privilege-review for whether
> `contents: write` is minimal. This skill does not audit the trigger itself.

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
- [ ] Sensitive data handling reviewed across code and non-code surfaces
- [ ] IaC config reviewed if manifests are in scope
- [ ] Changed CI workflows: blast radius reported; agent triggers and scope-minimality deferred to siblings
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

- [dependency-analysis](../dependency-analysis/SKILL.md) - Supply-chain and vulnerable-dependency intake
- [agentic-actions-auditor](../agentic-actions-auditor/SKILL.md) - Agent-invoking / injection-reachable CI triggers
- [least-privilege-review](../least-privilege-review/SKILL.md) - Whether a granted scope (token/IAM) is minimal
- [test-generation](../test-generation/SKILL.md) - Generate security test cases

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- For compliance controls, see your organization's playbook / `SECURITY-CONTROLS.md` (federal teams: NIST SP 800-53, e.g. AC-6 least privilege).
