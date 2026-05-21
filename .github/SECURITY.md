# Security Policy

## Supported Versions

This repository contains community-contributed patterns and validation scripts for agentic coding practices. Security updates are applied to the current `main` branch only.

| Component | Supported |
| --------- | --------- |
| Validation scripts (scripts/*.py) | ✅ Current main branch |
| Pattern content (skills/, prompts/, etc.) | ⚠️ Community-contributed, review before use |
| CI/CD workflows | ✅ Current main branch |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report security vulnerabilities via one of the following methods:

### For GSA/TTS Staff
- **Email:** gsa-tts-vulnerability-reports@gsa.gov
- **Subject:** `[SECURITY] agentic-coding-patterns: [brief description]`

### For External Security Researchers
- **GitHub Security Advisories:** Use the "Security" tab → "Report a vulnerability" button
- **Email:** vulnerability-reports@gsa.gov (if Security Advisories unavailable)

### What to Include

Please include the following information in your report:

- **Description:** Clear description of the vulnerability
- **Impact:** What an attacker could do with this vulnerability
- **Reproduction:** Step-by-step instructions to reproduce
- **Affected versions:** Which versions are affected (if known)
- **Suggested fix:** If you have ideas for remediation

### Response Timeline

- **Initial response:** Within 2 business days
- **Status update:** Within 5 business days
- **Fix timeline:** Varies based on severity (Critical: 7 days, High: 14 days, Medium: 30 days)

## Scope

### In Scope for Security Reports

Security concerns that **should** be reported:

- **Validation scripts** - Vulnerabilities in Python scripts (command injection, path traversal, etc.)
- **Dependency vulnerabilities** - CVEs in pinned dependencies (also caught by Dependabot)
- **CI/CD security** - Workflow vulnerabilities, secret exposure, permission issues
- **Secret exposure** - Accidentally committed secrets, API keys, credentials
- **Malicious patterns** - Patterns that could harm users if followed

### Out of Scope

Issues that are **not** security vulnerabilities:

- **Pattern quality** - Patterns marked `experimental` are use-at-your-own-risk
- **Pattern correctness** - Incorrect or outdated guidance (report as normal issues)
- **Best practice deviations** - Non-security coding style issues
- **Third-party tools** - Vulnerabilities in tools referenced by patterns (report to tool maintainers)
- **Social engineering** - Attempts to trick maintainers into accepting malicious patterns

## Security Best Practices for Contributors

When contributing patterns:

1. **Never include secrets** - No API keys, passwords, tokens, or credentials
2. **Sanitize examples** - Replace real data with placeholders
3. **Define prohibited content** - Use frontmatter `prohibited_content` field
4. **Validate input handling** - If pattern processes user input, document sanitization
5. **Review dependencies** - Check for CVEs before recommending libraries
6. **Document security assumptions** - Be explicit about trust boundaries

## Disclosure Policy

We follow **coordinated disclosure** practices:

- We ask security researchers to give us reasonable time to fix issues before public disclosure
- We will acknowledge security researchers in release notes (unless they prefer anonymity)
- We will publish security advisories for vulnerabilities that affect users
- We will notify users of critical security updates via GitHub releases and notifications

## Security Features in This Repository

Current security controls:

| Control | Status | Description |
|---------|--------|-------------|
| **Dependabot** | ✅ Active | Weekly dependency updates (Python & GitHub Actions) |
| **pip-audit** | ✅ Active | CVE scanning in CI |
| **Gitleaks** | ✅ Active | Pre-commit secret scanning |
| **SHA-pinned Actions** | ✅ Enforced | All GitHub Actions use commit SHAs |
| **Minimal permissions** | ✅ Enforced | CI runs with `contents: read` only |
| **Input validation** | ✅ Implemented | Frontmatter schema validation |
| **Subprocess hardening** | ✅ Implemented | Timeouts prevent hangs |

## Security Contacts

- **GSA TTS Security Team:** gsa-tts-vulnerability-reports@gsa.gov
- **Repository Maintainers:** See [CODEOWNERS](.github/CODEOWNERS) (if present)

## Additional Resources

- [GSA Vulnerability Disclosure Policy](https://www.gsa.gov/technology/technology-products-services/it-security/vulnerability-disclosure-policy)
- [NIST SP 800-53 Security Controls](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

*Last updated: 2026-05-21*
