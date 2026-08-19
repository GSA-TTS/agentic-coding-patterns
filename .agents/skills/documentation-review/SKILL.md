---
id: documentation-review
version: "1.0.0"
title: "Documentation Review"
type: skill
description: "Review documentation for quality, accuracy, completeness, and accessibility"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - documentation

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

categories:
  - "documentation"
  - "review"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "documentation"
  - "docs review"
  - "technical writing"
  - "plain language"

tags:
  - "documentation"
  - "quality"
  - "plain-language"
  - "accessibility"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review documentation for quality and accuracy"
    - "Check plain language compliance"
    - "Verify completeness"
    - "Identify stale content"
  exclusions:
    - "Not for copyediting or style guide enforcement"
    - "Not for translation review"

collection: content
routing:
  task_types:
    - "review"
    - "analyze"
  input_artifacts:
    - "documentation"
  output_artifacts:
    - "qa-report"
  prefer_when:
    - "the concern is correctness, completeness, stale commands, broken links, or usability of docs"
  avoid_when:
    - "the concern is specifically wording/readability for a public audience"
  delegates:
    - pattern: plain-language-review
      when: "the concern is specifically plain-language readability for a public audience"
  aliases:
    - "docs review"
    - "stale commands"
    - "broken links"
    - "doc quality check"
---

# Skill: Documentation Review

Review technical documentation to ensure quality, accuracy, accessibility, and usability.

## When to Use

- Reviewing documentation pull requests
- Conducting documentation audits
- Preparing for documentation releases
- Ensuring plain language compliance
- User asks "review this documentation" or "check the docs"

## Prerequisites

- Access to documentation files
- Understanding of the documented system/feature
- Familiarity with plain language principles
- (Optional) Access to automated checks (link checkers, readability tools)

## Procedure

### Step 1: Completeness Check

Verify all required sections are present:

- [ ] Title and summary
- [ ] Purpose/overview
- [ ] Prerequisites
- [ ] Step-by-step instructions (for how-to guides)
- [ ] Examples
- [ ] Troubleshooting common issues
- [ ] Related content links

**Missing sections indicate:**

- Incomplete documentation
- Gaps in user guidance

### Step 2: Accuracy Verification

Cross-check documentation against implementation:

- [ ] Code examples run without errors
- [ ] Commands produce expected output
- [ ] API endpoints match actual implementation
- [ ] Screenshots reflect current UI
- [ ] Version numbers are correct
- [ ] Feature flags/availability documented

**Test critical paths:**

```bash
# Run commands from docs to verify they work
command-from-docs --option value
# Expected output should match documentation
```

### Step 3: Plain Language Check

Assess readability (target: Grade 8-10 for technical docs):

- [ ] Short sentences (average ≤20 words)
- [ ] Active voice preferred over passive
- [ ] Technical jargon defined on first use
- [ ] Acronyms spelled out initially
- [ ] Concrete examples over abstract explanations

**Tools:**

- Flesch-Kincaid readability score
- Hemingway Editor
- Vale (automated style/readability linter)

**Example transformation:**

```markdown
# ❌ Complex (Grade 14)
"The utilization of parameterized queries is necessitated by the requirement to mitigate SQL injection vulnerabilities."

# ✅ Plain (Grade 8)
"Use parameterized queries to prevent SQL injection attacks."
```

### Step 4: Accessibility Review

Check WCAG 2.2 Level AA considerations:

- [ ] Headings in logical order (H1 → H2 → H3, no skips)
- [ ] Alt text for all images
- [ ] Link text is descriptive (not "click here")
- [ ] Tables have headers
- [ ] Color not sole means of conveying information
- [ ] Code blocks have language tags for syntax highlighting

### Step 5: Link Validation

Check all links:

- [ ] Internal links point to existing pages/sections
- [ ] External links are not broken (HTTP 200 response)
- [ ] Links use HTTPS where available
- [ ] Anchor links (#section) resolve correctly

**Automated check:**

```bash
# Example with markdown-link-check
markdown-link-check docs/**/*.md
```

### Step 6: Staleness Detection

Identify outdated content:

- [ ] "Last updated" date is recent
- [ ] Deprecated features flagged clearly
- [ ] Version-specific content labeled
- [ ] References to old products/tools updated
- [ ] TODO or FIXME comments addressed

**Red flags:**

- References to versions >2 years old
- Screenshots with old UI
- Broken links to moved resources
- Features marked "coming soon" that shipped

### Step 7: Structure and Navigation

- [ ] Consistent formatting throughout
- [ ] Table of contents for long documents
- [ ] Breadcrumbs or navigation aids
- [ ] Related content linked appropriately
- [ ] Frontmatter/metadata complete

## Verification

After review, confirm:

- [ ] All required sections present
- [ ] Code examples tested and working
- [ ] Readability at appropriate level
- [ ] Accessibility issues identified/fixed
- [ ] Links validated
- [ ] Stale content flagged
- [ ] Findings documented with specific line references

## Examples

### Example 1: Readability Improvement

**Before (Grade 13):**

```markdown
The implementation necessitates the utilization of environment variables for configuration management purposes, thereby facilitating the separation of configuration from codebase.
```

**After (Grade 8):**

```markdown
Use environment variables to configure the app. This keeps configuration separate from your code.
```

### Example 2: Broken Link Detection

**Finding:**

```markdown
See [API docs](https://old-domain.com/api) for details.
```

**Issue:** Link returns 404
**Recommendation:** Update to current URL or archive reference

### Example 3: Missing Context

**Before:**

```markdown
## Installation

Run `npm install` to install dependencies.
```

**Improved:**

```markdown
## Installation

**Prerequisites:** Node.js 18+ and npm 8+

Install project dependencies:

\`\`\`bash
npm install
\`\`\`

This installs packages listed in `package.json`.
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Readability score too high | Technical jargon, long sentences | Simplify language, break into shorter sentences |
| Broken links | Moved/deleted pages | Update or remove links |
| Unclear instructions | Missing context or steps | Add prerequisites, intermediate steps |
| Outdated screenshots | UI changed | Regenerate screenshots or remove |

## Related Patterns

- [test-generation](../test-generation/SKILL.md) - Test documentation examples
- For federal plain language requirements, see [agentic-coding-playbook CODING_PRACTICES.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)

## References

- [Plain Writing Act of 2010 (govinfo)](https://www.govinfo.gov/app/details/PLAW-111publ274)
- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [Diátaxis documentation framework](https://diataxis.fr/)
- [Write the Docs](https://www.writethedocs.org/)
