---
name: dependency-analysis
id: dependency-analysis
version: "1.1.0"
title: "Dependency Security Analysis"
type: skill
description: "Analyze project dependencies for security vulnerabilities, license compatibility, and supply chain risks"

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
      - "Recommendations"
    prohibited_content:
      - "Secrets"
      - "Real Secrets"
      - "Real Credentials"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

compliance:
  frameworks:
    - "NIST SP 800-218 SSDF"
    - "NIST SP 800-53"
  nist_controls:
    - "SR-3"
    - "SA-15"

changelog:
  - version: "1.1.0"
    date: "2026-07-02"
    change_type: minor
    summary: "Add pre-add decision ladder, OSV/GHSA advisory check, GitHub Action SHA-pinning review, external-script (curl|sh) execution review, and public-skill-inspiration intake gate. Adds supply-chain category. Absorbs proposed supply-chain-skeptic."
  - version: "1.0.0"
    date: "2026-05-20"
    change_type: minor
    summary: "Initial dependency security analysis skill."

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

categories:
  - "security"
  - "dependencies"
  - "supply-chain"

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
    - "Gate the decision to add a dependency (pre-add ladder)"
    - "Scan dependencies for known vulnerabilities (OSV/GHSA)"
    - "Check license compatibility"
    - "Identify outdated dependencies"
    - "Review GitHub Action SHA-pinning and external-script install steps"
    - "Assess supply chain risks"
  exclusions:
    - "Not for runtime dependency injection"
    - "Not for performance profiling"
    - "Not for the runtime safety of agent-invoking CI workflows (see agentic-actions-auditor)"
    - "Not for authoring safe shell scripts (see safe-shell-script-author); this skill audits install patterns"
---

# Skill: Dependency Security Analysis

Analyze project dependencies to identify security vulnerabilities, license issues, and supply chain risks. This skill also gates the *decision to add* a dependency, Action, or install step in the first place.

Framing is federal-first: it treats NIST SP 800-218 (SSDF) and NIST SP 800-53 supply-chain controls (SR-3, SA-15) as normal baseline expectations. It is agency-portable — it references frameworks generically and anchors to the playbook, not to any single agency's files.

## Boundaries

This skill covers the **intake question**: should this dependency, Action, or install step be added, and is it supply-chain-safe. It does not restate what sibling skills own:

- **agentic-actions-auditor** — runtime safety of agent-invoking CI workflows.
- **safe-shell-script-author** — *authoring* safe shell scripts. This skill only *audits* the install pattern that pulls a script in.

When a task crosses those lines, defer to the sibling skill instead of duplicating its rules.

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

### Step 0: Pre-add Decision Ladder

Before adding *any* new dependency, walk this ordered gate. The rule is **least-effort-additive**: the smallest addition that meets the need wins, and "add nothing" is the preferred outcome. Stop at the first rung that satisfies the requirement.

1. **Native capability already exists** → use it. If the platform, framework, or runtime already does this, add nothing.
2. **Language standard library covers it** → use it. Prefer `stdlib` over a third-party package for common needs (HTTP, JSON, hashing, date math).
3. **A vetted dependency already in the project covers it** → reuse it. Do not add a second package that overlaps an existing one.
4. **A genuinely new dependency is needed** → justify it in writing:
   - What it does and the specific gap it fills.
   - Why rungs 1–3 do not suffice.
   - Maintenance/health signals (recent releases, active maintainers, issue responsiveness).
5. **Route to human review** for the add. A security skill add is `human_review_required: true`.
6. **Reject** if the justification is missing or weak. An unjustified new dependency is rejected by default, not deferred.

**Example — deflected add:**

> Request: add `left-pad` to pad a string.
> Ladder result: **reject**. The language `stdlib` (`str.rjust` / `padStart`) already provides padding natively. No new dependency is justified.

### Step 1: Dependency Health / Advisory Check

Before trusting a package, check it against vulnerability and malicious-advisory databases. **Do not rely on popularity alone** — download counts and stars do not prove safety.

- Query **[OSV.dev](https://osv.dev)** for known vulnerabilities across ecosystems.
- Query the **GitHub Advisory Database (GHSA)** for security and malware advisories.
- Cross-check the intended package name for **typosquatting** (a look-alike name of a popular package).

Popularity-blind trust is exactly how recent supply-chain incidents spread. Conceptually, watch three threat classes:

- **Maintainer / build-chain compromise** (e.g., the *xz-utils* class): a trusted package gets a malicious payload injected upstream.
- **Account takeover of a dependency** (e.g., the *event-stream* class): a legitimate package pulls in a newly-malicious transitive dependency.
- **Typosquatting**: a hostile package published under a name one keystroke from the real one.

**Example finding:**

> Package `color-covert` (note the swap) has a GHSA malware advisory and was published 3 days ago. The intended package is `color-convert`. **Action:** do not add; use the correct package after an OSV/GHSA check.

### Step 2: Inventory Dependencies

List all direct and transitive dependencies:

```bash
pip list                 # Python (pip show <pkg> for details)
npm list --depth=0       # Node.js direct deps
cargo tree               # Rust
go list -m all           # Go
```

### Step 3: CVE Vulnerability Scan

Check for known security vulnerabilities:

```bash
pip-audit                                    # Python (or: safety check)
npm audit                                    # Node.js (npm audit fix — review first!)
cargo audit                                  # Rust
govulncheck ./...                            # Go
```

### Step 4: License Compatibility Check

Verify all licenses are compatible with your project:

```bash
pip-licenses --format=markdown   # Python
license-checker --summary        # Node.js
```

**Check for:**

- [ ] GPL licenses (copyleft - may require source disclosure)
- [ ] Permissive licenses (MIT, Apache, BSD - generally safe)
- [ ] Proprietary/commercial licenses
- [ ] Missing or unclear licenses

### Step 5: Outdated Dependency Check

Identify dependencies with available updates:

```bash
pip list --outdated   # Python
npm outdated          # Node.js
cargo outdated        # Rust
go list -u -m all     # Go
```

### Step 6: Supply Chain Risk Assessment

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

### Step 7: Version Pinning Verification

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

### Step 8: GitHub Action Pinning Review

A CI Action *is* a dependency, so it goes through the same intake ladder. When an Action is added, it MUST be pinned by **full commit SHA**, not by a mutable tag (`@v4`) or branch (`@main`). A tag can be re-pointed at malicious code after review; a SHA cannot.

```yaml
# ❌ Mutable tag — the ref can be moved under you
- uses: actions/checkout@v4

# ✅ Pinned to a full commit SHA (comment records the human-readable version)
- uses: actions/checkout@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v4.2.1
```

This is the **intake gate**: should this Action be added, and is it SHA-pinned as a supply-chain control. The runtime safety of agent-invoking workflows is a separate concern owned by **agentic-actions-auditor** — do not re-audit that here. Both skills reference the same single pinning rationale (pin by immutable digest, never a mutable ref) rather than each restating it.

### Step 9: External-Script Execution Review

Flag install steps that pipe a remote script straight into an interpreter. Treat an unvetted remote install script as an **unvetted dependency** — you are executing code you never reviewed, fetched at build time from a URL that can change.

```bash anti-pattern
# ❌ Piping a remote script to a shell — no review, no pin, mutable source
curl -fsSL https://example.test/install.sh | sh
wget -qO- https://example.test/setup | bash

# ✅ Fetch, inspect, pin by checksum, then run explicitly
curl -fsSL -o install.sh https://example.test/install.sh
sha256sum -c install.sh.sha256   # verify against a known-good digest
less install.sh                  # human review
sh ./install.sh
```

This skill *audits* the install pattern. For *authoring* a safe replacement script, use **safe-shell-script-author**.

### Step 10: Public-Skill / Public-Source Intake Gate

When a dependency, Action, or skill is **inspired by or pulled from a public source** (a blog, a public repo, another team's skill):

- Record a source-inspiration intake per the repo `AGENTS.md` §4.3 and reference it in the PR.
- **Never copy scripts, prompt bodies, or full skill bodies wholesale.** Wholesale copy is a prompt-injection and supply-chain vector — a public script can carry hidden instructions or malicious steps.
- Use the public source as *inspiration only*; re-author to fit this project after review.

### Step 11: Generate SBOM (Software Bill of Materials)

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

- [ ] Pre-add decision ladder walked (native → stdlib → reuse → justify → review → reject)
- [ ] OSV.dev and GHSA advisory checks run; typosquatting ruled out
- [ ] All vulnerabilities identified
- [ ] Severity assessed (Critical/High/Medium/Low)
- [ ] License compatibility verified
- [ ] Outdated dependencies flagged
- [ ] GitHub Actions pinned by full commit SHA (no mutable tags)
- [ ] External-script (`curl | sh`) install patterns flagged
- [ ] Public-source inspiration intake recorded; nothing copied wholesale
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

### Example 4: Unpinned GitHub Action

**Finding:**

- Workflow uses `actions/checkout@v4` (a mutable tag).
- A moved tag could point at malicious code after review.

**Recommendation:** pin by full commit SHA and record the version in a comment:
`actions/checkout@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v4.2.1`.

### Example 5: External-Script Install (curl | sh)

**Finding:**

- Install step runs `curl -fsSL https://example.test/install.sh | sh`.
- Remote code is executed unreviewed and the URL is a mutable source — an unvetted dependency.

**Recommendation:** fetch, verify a known checksum, human-review, then run explicitly. Or vendor a reviewed, pinned copy.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Too many false positives | Dev dependencies flagged | Exclude dev dependencies from production scans |
| No fix available | Vulnerability in unmaintained package | Find alternative or apply workaround |
| Breaking changes in update | Major version upgrade | Review changelog, test thoroughly |
| Transitive vulnerability | Dependency of dependency | Update parent package or use overrides |

## Related Patterns

- [secure-code-review](../secure-code-review/SKILL.md) - Review code for security issues
- [agentic-actions-auditor](../agentic-actions-auditor/SKILL.md) - Runtime safety of agent-invoking CI workflows (this skill covers the Action *intake* question)
- [safe-shell-script-author](../safe-shell-script-author/SKILL.md) - Authoring safe shell scripts (this skill *audits* install patterns)
- For supply chain controls, see [agentic-coding-playbook SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)

## References

- [OSV.dev — Open Source Vulnerabilities](https://osv.dev/)
- [GitHub Advisory Database (GHSA)](https://github.com/advisories)
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
- [Snyk Vulnerability Database](https://security.snyk.io/)
- [National Vulnerability Database](https://nvd.nist.gov/)
- [CycloneDX SBOM Standard](https://cyclonedx.org/)
- [NIST SP 800-218 (SSDF)](https://csrc.nist.gov/pubs/sp/800/218/final)
