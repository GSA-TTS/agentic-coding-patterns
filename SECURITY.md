# Security Policy

## Scope

This repository is part of the **Agentic Coding Capability Assessment** — an internal GSA initiative. It contains community-contributed patterns, prompts, skills, and lessons learned for agentic coding practices.

> **Note:** Patterns are informational and not authoritative GSA policy. Review and test all content before production use.

## Reporting and Fixing Security Issues

This is an **internal assessment repository** with trusted contributors. The appropriate response to most issues is to fix them directly.

### For Pattern Content Issues

If you discover a security issue in a pattern (unsafe practices, potential for harm, missing warnings):

1. **Submit a PR to fix it** — This is the preferred approach for internal repos
2. **Open an issue** if you're unsure how to fix it or want to discuss first
3. **Ask in the agentic-coding Slack channel** if you have questions or need help coordinating

Include:

- Which pattern is affected
- Description of the security concern
- Potential impact
- Suggested fix (if you have one)

### For Repository Infrastructure Issues

If you find a security issue with the repository infrastructure (validation scripts, CI/CD, dependencies):

1. **Submit a PR to fix it** — You have access, so fix it directly when possible
2. **Open an issue** to track the problem if you need help or it requires discussion
3. **Contact channel admins** if you're unsure about the right approach

Since this is an internal repository, formal security advisories are not required. Use your judgment — if something seems sensitive, discuss with channel admins before posting details publicly.

### For GSA Platform Issues (Outside This Repo)

For security concerns related to GSA systems or infrastructure outside the scope of this repository:

- **Follow your normal GSA security reporting processes**
- **Submit a ticket** or **email GSA security** as appropriate for your organization

These repos are for the assessment — platform and infrastructure security follows standard GSA procedures.

## Security Best Practices for Patterns

All patterns in this repository MUST:

### 1. No Sensitive Data

Patterns must never include:

- ❌ Secrets, API keys, tokens, passwords
- ❌ PII (Personally Identifiable Information)
- ❌ CUI (Controlled Unclassified Information)
- ❌ Internal URLs or hostnames
- ❌ Customer data or production data

### 2. Placeholder Use

- Use `<YOUR_API_KEY>` style placeholders
- Use `example.com` for domains
- Use `user@example.com` for emails
- Document what values should replace placeholders

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

Run `make validate` before submitting contributions.

## Pattern Review

- Patterns marked `experimental` require self-review
- Patterns promoted to `recommended` require peer review with security focus

---

**Last Updated:** 2026-05-21
