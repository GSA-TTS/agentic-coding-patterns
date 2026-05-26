---
id: dependency-analysis
version: "1.0.0"
title: "Dependency Security Analysis"
type: skill
description: "Analyze project dependencies for security vulnerabilities, license compatibility, and supply chain risks"

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
      - "Recommendations"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "dependencies"
  - "supply chain"
  - "vulnerabilities"
  - "CVE"
  - "npm audit"
  - "pip audit"

tags:
  - "security"
  - "dependencies"
  - "supply-chain"
  - "vulnerabilities"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Scan dependencies for known vulnerabilities"
    - "Check license compatibility"
    - "Identify outdated dependencies"
    - "Assess supply chain risks"
  exclusions:
    - "Not for runtime dependency injection"
    - "Not for performance profiling"
---

# Skill: Dependency Security Analysis

Analyze project dependencies to identify security vulnerabilities, license issues, and supply chain risks.

## When to Use

- Before deploying to production
- During security reviews
- When adding new dependencies
- Regularly (weekly/monthly automated scans)
- User asks "check dependencies for vulnerabilities" or "audit packages"

## Prerequisites

- Access to project dependency files (package.json, requirements.txt, Cargo.toml, go.mod, etc.)
- Package manager installed (npm, pip, cargo, go, etc.)
- (Recommended) Vulnerability scanning tools installed

## Procedure

### Step 1: Inventory Dependencies

List all direct and transitive dependencies:

**Python:**

```bash
pip list
pip show <package-name>  # Details including dependencies
```

**Node.js:**

```bash
npm list
npm list --depth=0  # Direct dependencies only
```

**Rust:**

```bash
cargo tree
```

**Go:**

```bash
go list -m all
```

### Step 2: CVE Vulnerability Scan

Check for known security vulnerabilities:

**Python:**

```bash
# Using pip-audit
pip install pip-audit
pip-audit

# Or safety
pip install safety
safety check
```

**Node.js:**

```bash
npm audit
npm audit --json  # Machine-readable output

# Fix automatically (review changes!)
npm audit fix
```

**Rust:**

```bash
cargo install cargo-audit
cargo audit
```

**Go:**

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

### Step 3: License Compatibility Check

Verify all licenses are compatible with your project:

**Python:**

```bash
pip install pip-licenses
pip-licenses --format=markdown
```

**Node.js:**

```bash
npm install -g license-checker
license-checker --summary
```

**Check for:**

- [ ] GPL licenses (copyleft - may require source disclosure)
- [ ] Permissive licenses (MIT, Apache, BSD - generally safe)
- [ ] Proprietary/commercial licenses
- [ ] Missing or unclear licenses

### Step 4: Outdated Dependency Check

Identify dependencies with available updates:

**Python:**

```bash
pip list --outdated
```

**Node.js:**

```bash
npm outdated
```

**Rust:**

```bash
cargo outdated
```

**Go:**

```bash
go list -u -m all
```

### Step 5: Supply Chain Risk Assessment

Evaluate dependency trustworthiness:

- [ ] **Maintenance status:** Last commit/release date
- [ ] **Popularity:** Download counts, GitHub stars
- [ ] **Author reputation:** Known maintainers vs unknown
- [ ] **Typosquatting check:** Similar names to popular packages
- [ ] **Dependency depth:** Limit transitive dependencies
- [ ] **Scope creep:** Package does what it claims

**Red flags:**

- Recently created packages mimicking popular ones
- Packages with no repository link
- Obfuscated or minified source
- Excessive permissions requested
- Unmaintained (no updates in >2 years)

### Step 6: Version Pinning Verification

Check that versions are pinned:

**Python (requirements.txt):**

```
# ❌ Unpinned
requests>=2.0

# ✅ Pinned
requests==2.31.0
```

**Node.js (package.json):**

```json
{
  "dependencies": {
    "express": "4.18.2"  // ✅ Exact version
    // NOT: "^4.18.2" or "~4.18.2"
  }
}
```

Use lock files for reproducible builds:

- `requirements.txt` + `pip freeze` (Python)
- `package-lock.json` (Node.js)
- `Cargo.lock` (Rust)
- `go.sum` (Go)

### Step 7: Generate SBOM (Software Bill of Materials)

Create a manifest of all dependencies:

**Using CycloneDX:**

```bash
# Python
pip install cyclonedx-bom
cyclonedx-py -o sbom.json

# Node.js
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
```

## Verification

After analysis, confirm:

- [ ] All vulnerabilities identified
- [ ] Severity assessed (Critical/High/Medium/Low)
- [ ] License compatibility verified
- [ ] Outdated dependencies flagged
- [ ] Supply chain risks documented
- [ ] SBOM generated
- [ ] Remediation plan created

## Examples

### Example 1: Critical Vulnerability Found

**Tool Output:**

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ High          │ Regular Expression Denial of Service                │
├───────────────┼──────────────────────────────────────────────────────┤
│ Package       │ minimatch                                            │
├───────────────┼──────────────────────────────────────────────────────┤
│ Installed     │ 3.0.4                                                │
├───────────────┼──────────────────────────────────────────────────────┤
│ Fixed in      │ 3.0.5                                                │
└───────────────┴──────────────────────────────────────────────────────┘
```

**Remediation:**

1. Update to fixed version: `npm update minimatch@3.0.5`
2. Test application
3. Commit updated package-lock.json

### Example 2: License Incompatibility

**Finding:**

- Package `gpl-library@1.0.0` uses GPL-3.0 license
- Your project is MIT licensed
- GPL requires derivative works to be GPL

**Recommendation:**

- Find MIT/Apache alternative
- Or obtain legal approval for GPL use
- Or isolate as separate service

### Example 3: Typosquatting Detection

**Suspicious package:**

- Name: `reqeusts` (note typo)
- Created: 2 days ago
- Downloads: 100
- No repository link

**Legitimate package:**

- Name: `requests`
- Created: 10 years ago
- Downloads: 500M+
- Repository: <https://github.com/psf/requests>

**Action:** Remove typosquatted package, use legitimate one

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Too many false positives | Dev dependencies flagged | Exclude dev dependencies from production scans |
| No fix available | Vulnerability in unmaintained package | Find alternative or apply workaround |
| Breaking changes in update | Major version upgrade | Review changelog, test thoroughly |
| Transitive vulnerability | Dependency of dependency | Update parent package or use overrides |

## Related Patterns

- [secure-code-review](../secure-code-review/SKILL.md) - Review code for security issues
- For supply chain controls, see [agentic-coding-playbook SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)

## References

- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
- [Snyk Vulnerability Database](https://security.snyk.io/)
- [National Vulnerability Database](https://nvd.nist.gov/)
- [CycloneDX SBOM Standard](https://cyclonedx.org/)
