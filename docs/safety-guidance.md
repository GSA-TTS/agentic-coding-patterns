# Safety Guidance

> **Purpose:** Security and safety rules for contributors to this repository

## Overview

This repository contains **community patterns for AI-assisted coding**. While the content itself is public (CC0-1.0 license), we must ensure patterns are safe, ethical, and appropriate for federal use.

## Prohibited Content

**NEVER include in patterns:**

| Prohibited | Why | Examples |
|------------|-----|----------|
| **Secrets** | Security risk | API keys, tokens, passwords, private keys |
| **PII** | Privacy violation | Names, emails, SSNs, phone numbers, addresses |
| **CUI** | Classification violation | Controlled Unclassified Information |
| **Internal URLs** | Information disclosure | Internal hostnames, endpoints, IP addresses |
| **Customer data** | Privacy violation | Project names, user data, operational details |
| **Vulnerability details** | Responsible disclosure | Unfixed security flaws, exploit code |

**Use placeholders instead:**

- URLs: `https://example.com`, `https://api.example.com`
- Emails: `user@example.com`
- Names: `[Your Name]`, `[Project Name]`
- Keys: `YOUR_API_KEY_HERE`, `[REDACTED]`

## Input Sanitization

Patterns that accept user input MUST include safety guidance:

### 1. Define Input Boundaries

```markdown
## Input
Provide the following:
- Code snippet (max 500 lines)
- Programming language
- Specific concerns (optional)

**Do not include:**
- Secrets or credentials
- PII or customer data
- Proprietary algorithms
```

### 2. Use Input Delimiters

When accepting untrusted input, use clear delimiters:

```markdown
Analyze this code:

--- USER INPUT START ---
[USER CODE HERE]
--- USER INPUT END ---
```

This helps AI agents distinguish pattern instructions from user data.

### 3. Warn About Prompt Injection

For patterns that combine instructions with user input:

```markdown
⚠️ **Security Note:** This pattern combines instructions with user-provided code.
Ensure user input does not contain malicious prompts that could override
the pattern's safety instructions.
```

## Output Contracts

Every pattern MUST define what outputs are allowed and forbidden.

### Required: prohibited_content

In frontmatter:

```yaml
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Analysis"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Exploit Code"
```

### Minimum Prohibited Content

**Every pattern must prohibit at minimum:**

1. Secrets (API keys, tokens, passwords)
2. PII (names, emails, addresses)
3. CUI (controlled information)
4. Internal URLs (hostnames, endpoints)

### Additional Prohibitions (Pattern-Specific)

Add based on pattern context:

- **Code generation:** "Insecure code patterns", "Deprecated APIs"
- **Security review:** "Actual exploit code", "Live vulnerability details"
- **Documentation:** "Internal project names", "Customer references"

## Safe Examples

### ✅ Good: Placeholder Example

```python
# Connect to API
api_key = os.environ.get("API_KEY")  # Set via environment variable
response = requests.get(
    "https://api.example.com/data",
    headers={"Authorization": f"Bearer {api_key}"}
)
```

### ❌ Bad: Real Credentials

```python
# DON'T DO THIS
api_key = "sk_live_abcd1234xyz"  # NEVER hardcode real keys
```

### ✅ Good: Anonymized User Data

```python
# Example user data structure
user = {
    "id": "user_12345",
    "email": "user@example.com",
    "role": "admin"
}
```

### ❌ Bad: Real User Data

```python
# DON'T DO THIS
user = {
    "name": "John Smith",  # Real PII
    "email": "john.smith@agency.gov"  # Real email
}
```

## Testing Patterns Safely

When creating test cases:

### ✅ Use Fake Data

```yaml
test_cases:
  - id: api-call-test
    input:
      api_endpoint: "https://api.example.com/test"
      api_key: "test_key_12345"
    assertions:
      - type: contains
        pattern: "Success"
```

### ❌ Never Use Real Data in Tests

Don't include real credentials, URLs, or data in test files.

## Security Review Patterns

Patterns that review code for security issues:

### Do

- Detect vulnerability patterns
- Explain risks in general terms
- Suggest remediation approaches
- Link to public resources (OWASP, CWE)

### Don't

- Provide working exploit code
- Disclose unfixed vulnerabilities
- Include actual malicious payloads
- Give step-by-step attack instructions

### Example: Safe Security Guidance

```markdown
**Finding:** Potential SQL injection vulnerability

**Risk:** User input is concatenated directly into SQL query without sanitization.

**Remediation:** Use parameterized queries or an ORM:
```python
# Safe approach
cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
```

**Reference:** OWASP SQL Injection Prevention Cheat Sheet

```

## Compliance Considerations

### Federal Information Security
Patterns used in federal contexts may need to comply with:
- FISMA (Federal Information Security Management Act)
- NIST SP 800-53 security controls
- FedRAMP baselines
- Agency-specific policies

**This repository does not:**
- Create security policy (see playbook for that)
- Guarantee compliance (patterns must be reviewed per agency policy)
- Replace security review processes

**This repository does:**
- Provide safety guidance for pattern creation
- Enforce prohibited content rules
- Validate patterns don't contain sensitive data

### Attribution and Licensing
- All contributions are CC0-1.0 (public domain)
- Contributors must have rights to contributed content
- Do not copy proprietary patterns without permission
- Cite sources when adapting external patterns

## Validation and Enforcement

### Automated Checks
The repository validates:
1. **Sensitive terms scan** - Detects secrets, PII, CUI markers
2. **Frontmatter validation** - Ensures `prohibited_content` is defined
3. **Schema compliance** - Checks all required fields present

### Manual Review
Maintainers check:
- Pattern safety and appropriateness
- Example code uses placeholders
- No internal/sensitive references
- Alignment with federal best practices

## Reporting Security Issues

If you find a security issue in this repository:

1. **Do NOT create a public issue**
2. Email security contact (see [SECURITY.md](../.github/SECURITY.md) when created)
3. Include description and steps to reproduce
4. Allow time for fix before public disclosure

## Questions?

- **Content safety:** See [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Pattern validation:** Run `make validate` locally
- **Prohibited content questions:** Open a discussion (not issue) on GitHub

---

**Remember:** When in doubt, leave it out. Use placeholders, anonymize data, and keep patterns safe for public use.
