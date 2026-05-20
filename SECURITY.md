# Security Policy

## Reporting Security Issues

**Do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in a pattern or in the repository infrastructure:

1. **For pattern content issues:** Email security@gsa.gov with:
   - Description of the issue
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)

2. **For repository infrastructure issues:** Follow the same process

We will acknowledge receipt within 3 business days and provide a more detailed response within 7 business days.

## Security Best Practices for Patterns

All patterns in this repository MUST:

### 1. No Sensitive Data
- ❌ No secrets, API keys, tokens, passwords
- ❌ No PII (Personally Identifiable Information)
- ❌ No CUI (Controlled Unclassified Information)
- ❌ No internal URLs or hostnames
- ❌ No customer data

### 2. Placeholder Use
- ✅ Use `<YOUR_API_KEY>` style placeholders
- ✅ Use `example.com` for domains
- ✅ Use `user@example.com` for emails
- ✅ Document what values should replace placeholders

### 3. Input Validation Guidance
Patterns that accept user input MUST:
- Document input validation requirements
- Include sanitization guidance
- Warn about injection risks
- Define input boundaries

### 4. Output Contract
Every pattern MUST define `prohibited_content` in frontmatter:

```yaml
output:
  contract:
    prohibited_content:
      - "Secrets"
      - "PII"
      - "CUI"
      - "Internal URLs"
```

## Validation

All contributions are automatically scanned for:
- Sensitive terms (via `scripts/validate_sensitive_terms.py`)
- Schema compliance (via `scripts/validate_frontmatter.py`)

Note: These are hygiene checks, not comprehensive secret scanners. Use dedicated tools (gitleaks, truffleHog) for production.

## Pattern Review

Patterns marked `experimental` require self-review.
Patterns promoted to `recommended` require peer review with security focus.

## Responsible Disclosure

If a pattern contains a security issue:
1. **Do not create a public issue**
2. Follow the reporting process above
3. We will work with you to address the issue
4. Credit will be given for responsible disclosure

## Updates

This policy may be updated. Check back periodically or watch the repository for changes.

---

**Last Updated:** 2026-05-20
