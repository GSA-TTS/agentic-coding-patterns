# Security Policy

## Scope

This repository is part of the **Agentic Coding Capability Assessment** — an internal GSA initiative. It contains community-contributed patterns and validation scripts for agentic coding practices.

> **Note:** Patterns are informational and not authoritative GSA policy. Review and test all content before production use.

| Component | Supported |
| --------- | --------- |
| Validation scripts (scripts/*.py) | Current main branch |
| Pattern content (skills/, prompts/, etc.) | Community-contributed, review before use |
| CI/CD workflows | Current main branch |

## Reporting and Fixing Security Issues

This is an **internal assessment repository** with trusted contributors. The appropriate response to most issues is to fix them directly.

### For Pattern Content Issues

If you discover a security issue in a pattern (unsafe practices, potential for harm):

1. **Submit a PR to fix it** — This is the preferred approach for internal repos
2. **Open an issue** if you're unsure how to fix it or want to discuss first
3. **Ask in the agentic-coding Slack channel** if you have questions

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

## In Scope for Security Fixes

Issues that **should** be addressed:

- **Validation scripts** — Vulnerabilities in Python scripts (command injection, path traversal, etc.)
- **Dependency vulnerabilities** — CVEs in pinned dependencies (also caught by Dependabot)
- **CI/CD security** — Workflow vulnerabilities, permission issues
- **Secret exposure** — Accidentally committed secrets, API keys, credentials
- **Unsafe patterns** — Patterns that could harm users if followed

## Out of Scope

Issues that are **not** security vulnerabilities:

- **Pattern quality** — Patterns marked `experimental` are use-at-your-own-risk
- **Pattern correctness** — Incorrect or outdated content (report as normal issues)
- **Best practice deviations** — Non-security coding style issues
- **Third-party tools** — Vulnerabilities in tools referenced by patterns (report to tool maintainers)

## Security Best Practices for Contributors

When contributing patterns:

1. **Never include secrets** — No API keys, passwords, tokens, or credentials
2. **Sanitize examples** — Replace real data with placeholders
3. **Define prohibited content** — Use frontmatter `prohibited_content` field
4. **Validate input handling** — If pattern processes user input, document sanitization
5. **Review dependencies** — Check for CVEs before recommending libraries
6. **Document security assumptions** — Be explicit about trust boundaries

## Security Features in This Repository

Current security controls:

| Control | Status | Description |
|---------|--------|-------------|
| **Dependabot** | Active | Weekly dependency updates (Python & GitHub Actions) |
| **pip-audit** | Active | CVE scanning in CI |
| **Gitleaks** | Active | Pre-commit secret scanning |
| **SHA-pinned Actions** | Enforced | All GitHub Actions use commit SHAs |
| **Minimal permissions** | Enforced | CI runs with `contents: read` only |
| **Input validation** | Implemented | Frontmatter schema validation |

## Additional Resources

- [NIST SP 800-53 Security Controls](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

*Last updated: 2026-05-21*
