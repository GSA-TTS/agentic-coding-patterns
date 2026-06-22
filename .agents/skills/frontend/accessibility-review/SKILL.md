---
id: accessibility-review
version: "1.0.0"
title: "Federal Accessibility Review"
type: skill
description: "Review front-end artifacts for Section 508 and WCAG 2.1 AA compliance with specific checks for federal digital services"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - designers
  - qa-testers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Accessibility Issues Found"
      - "Priority Recommendations"
      - "Human Review Required"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Absolute compliance certifications"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "review accessibility"
  - "check 508"
  - "wcag"
  - "a11y"
  - "accessibility audit"

tags:
  - "frontend"
  - "accessibility"
  - "section508"
  - "wcag"
  - "review"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review HTML pages for accessibility issues"
    - "Identify Section 508 compliance gaps"
    - "Check WCAG 2.1 AA conformance"
    - "Provide actionable accessibility recommendations"
  exclusions:
    - "Not a replacement for manual accessibility testing"
    - "Not a legal certification of compliance"
    - "Does not replace screen reader testing"
    - "Does not assess cognitive accessibility fully"
---

# Skill: Federal Accessibility Review

Review front-end artifacts (HTML, CSS, or rendered pages) for Section 508 and WCAG 2.1 AA compliance. Identifies common accessibility issues and provides prioritized recommendations for federal digital services.

## When to Use

- Reviewing a page or component before deployment
- Conducting accessibility audits on existing pages
- Validating that a prototype meets federal accessibility standards
- User asks "check accessibility" or "is this 508 compliant?"
- Before submitting for formal accessibility testing

## Prerequisites

- HTML source code or rendered page to review
- Understanding of the page's purpose and target audience
- Access to referenced CSS or JavaScript (if applicable)

## Procedure

### Step 1: Gather Review Targets

Identify what needs review:

- [ ] HTML source code
- [ ] Rendered page (screenshot or live URL)
- [ ] CSS styles affecting visibility or contrast
- [ ] JavaScript interactions

### Step 2: Run Automated Accessibility Checks

Use deterministic tools to identify accessibility issues automatically:

#### Option A: axe-core CLI (Recommended for HTML)

```bash
# Install
npm install -g @axe-core/cli

# Run on HTML file
axe output.html --exit

# Run on URL with Chrome
axe https://example.gov --exit

# JSON output for CI
axe output.html --dir results/ --reporter json
```

**Exit Codes:** 0 = no violations, 1 = violations found

#### Option B: Lighthouse Accessibility Audit

```bash
# Install
npm install -g lighthouse

# Run accessibility audit only
lighthouse https://example.gov --only-categories=accessibility --output=json --output-path=./a11y-report.json

# View score (0-100)
cat a11y-report.json | jq '.categories.accessibility.score * 100'
```

#### Option C: pa11y (Good for CI Pipelines)

```bash
# Install
npm install -g pa11y

# Run with WCAG 2.1 AA standard
pa11y --standard WCAG2AA output.html

# JSON output
pa11y --reporter json output.html > a11y-results.json
```

#### Option D: Vale Accessibility Rules

```bash
# With cloud-gov/style-management-service
vale --config profiles/federal.vale.ini content.md
```

Vale checks for:
- Color-alone meaning (WCAG 1.4.1)
- Flashing content warnings (WCAG 2.3.1)
- Link text quality (WCAG 2.4.4)
- Image descriptions (WCAG 1.4.5)
- Mouse-only interaction warnings (WCAG 2.1.1)

### Step 3: Manual Checks (Cannot Be Automated)

Check for common issues that require human judgment:

#### Heading Hierarchy

- [ ] Single `<h1>` element exists
- [ ] Headings follow logical order (h1 → h2 → h3, no skips)
- [ ] Headings describe section content

#### Keyboard Navigation

- [ ] All interactive elements are keyboard accessible
- [ ] Tab order is logical
- [ ] Focus indicators are visible
- [ ] No keyboard traps exist

#### Form Accessibility

- [ ] All form inputs have associated `<label>` elements
- [ ] Labels use `for` attribute or wrap inputs
- [ ] Required fields are marked (not just with `*`)
- [ ] Error messages are associated with inputs (`aria-describedby`)
- [ ] Fieldsets group related inputs with `<legend>`

#### Images and Media

- [ ] All `<img>` elements have `alt` attributes
- [ ] Decorative images use `alt=""`
- [ ] Complex images have extended descriptions
- [ ] No information conveyed by image alone

#### Semantic HTML

- [ ] Proper landmark elements used (`<main>`, `<nav>`, `<header>`, `<footer>`)
- [ ] Lists use `<ul>`, `<ol>`, or `<dl>` (not styled `<div>`)
- [ ] Tables use `<th>` with `scope` attribute
- [ ] Buttons are `<button>` elements (not styled `<div>` or `<a>`)

#### Links

- [ ] Link text is descriptive (no "click here")
- [ ] Links to external sites or documents are indicated
- [ ] Links have `:focus` styles
- [ ] `target="_blank"` includes warning text

#### Color and Contrast

- [ ] Text color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large)
- [ ] Information is not conveyed by color alone
- [ ] Focus indicators have 3:1 contrast with background

#### ARIA Usage

- [ ] ARIA attributes are used correctly (or not at all)
- [ ] `role` attributes supplement, not replace, semantic HTML
- [ ] `aria-label` or `aria-labelledby` provide accessible names
- [ ] Dynamic content updates use `aria-live` regions

### Step 3: Categorize Issues by Priority

Organize findings:

| Priority | Definition | Examples |
|----------|------------|----------|
| **Critical** | Blocks access for users with disabilities | No alt text, keyboard traps, missing form labels |
| **High** | Significantly impairs usability | Poor contrast, illogical heading order, missing focus |
| **Medium** | Reduces usability but workarounds exist | Non-descriptive links, missing landmark roles |
| **Low** | Best practice violations | Minor ARIA misuse, redundant labels |

### Step 4: Provide Specific Recommendations

For each issue, provide:

1. **What's wrong** — Brief description
2. **Why it matters** — Impact on users
3. **How to fix** — Specific code change

Example:

```markdown
**Issue:** Form input missing label
**Impact:** Screen reader users cannot identify the field's purpose
**Fix:** Add `<label for="email">Email Address</label>` before input
```

### Step 5: Flag Manual Testing Needs

Identify areas requiring human review:

- [ ] Screen reader testing with JAWS/NVDA/VoiceOver
- [ ] Keyboard-only navigation testing
- [ ] Color contrast verification with tools
- [ ] Testing with magnification (200% zoom)
- [ ] Cognitive accessibility assessment

### Step 6: Generate Report

Produce:

1. **Accessibility Issues Found** — Categorized list of issues
2. **Priority Recommendations** — Top 3-5 fixes to address first
3. **Human Review Required** — Tests that require manual validation

## Verification

After review, confirm:

- [ ] All automated checks completed
- [ ] Issues are prioritized by impact
- [ ] Recommendations are specific and actionable
- [ ] Manual testing requirements are identified
- [ ] No false positives (e.g., SVG backgrounds marked as missing alt text)

## Examples

### Example 1: Form Without Labels

**Input HTML:**

```html
<form>
  <input type="text" id="username" placeholder="Username">
  <input type="password" id="password" placeholder="Password">
  <button type="submit">Login</button>
</form>
```

**Accessibility Issues Found:**

| Issue | Priority | Description |
|-------|----------|-------------|
| Missing form labels | **Critical** | Inputs rely on placeholder text, which is not read by all screen readers |
| No error handling | **High** | No mechanism to announce validation errors |

**Priority Recommendations:**

1. Add `<label>` elements for each input:
   ```html
   <label for="username">Username</label>
   <input type="text" id="username">
   ```
2. Use `aria-describedby` for error messages
3. Ensure error messages are announced to screen readers

**Human Review Required:**
- Test with screen reader to confirm labels are announced
- Verify form validation errors are accessible

### Example 2: Poor Color Contrast

**Input:** Blue text `#4A90E2` on white background `#FFFFFF`

**Accessibility Issues Found:**

| Issue | Priority | Description |
|-------|----------|-------------|
| Insufficient contrast | **High** | Text color has 3.2:1 contrast ratio, below WCAG AA requirement (4.5:1) |

**Priority Recommendations:**

1. Darken blue to `#0052A3` for 4.5:1 contrast
2. Or increase font size to 18pt+ for 3:1 requirement
3. Use USWDS color tokens for pre-tested contrast

**Human Review Required:**
- Verify contrast in different lighting conditions
- Test with users who have low vision

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Assume automated tools find all issues | Require manual testing with assistive tech |
| Use placeholders as labels | Use explicit `<label>` elements |
| Hide content with `display: none` for screen readers | Use `aria-hidden="true"` or visually-hidden class |
| Add `role="button"` to `<div>` | Use semantic `<button>` element |
| Rely on color alone for status | Use icons + text + color |
| Claim "this is 508 compliant" | Say "draft reviewed for common issues" |

## Human Review Gate

**Before relying on this review:**

A human MUST:

1. Test with actual screen readers (JAWS, NVDA, VoiceOver)
2. Navigate the page with keyboard only
3. Verify color contrast with tools (WebAIM Contrast Checker)
4. Test at 200% zoom
5. Involve users with disabilities in testing

**This skill identifies common issues; it does not certify compliance.**

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md) — Generate accessible pages from the start
- [plain-language-review](../plain-language-review/SKILL.md) — Improve content clarity (cognitive accessibility)
- [uswds-form-flow](../uswds-form-flow/SKILL.md) — Build accessible forms

## References

- [Section 508 Standards](https://www.section508.gov/)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM WCAG 2 Checklist](https://webaim.org/standards/wcag/checklist)
- [USWDS Accessibility Tests](https://designsystem.digital.gov/documentation/accessibility/)
- [GSA Government-wide Section 508 Assessment](https://www.section508.gov/manage/annual-assessment/)

## Deterministic Tools

| Tool | Purpose | Standard | Install |
|------|---------|----------|---------|
| [axe-core](https://github.com/dequelabs/axe-core) | HTML accessibility testing | WCAG 2.1 AA | `npm i -g @axe-core/cli` |
| [pa11y](https://pa11y.org/) | CI-friendly a11y testing | WCAG 2.1 AA | `npm i -g pa11y` |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Web quality audits | WCAG 2.1 AA | `npm i -g lighthouse` |
| [Vale](https://vale.sh) | Prose accessibility rules | WCAG patterns | `brew install vale` |
| [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) | Color contrast verification | WCAG AA/AAA | Web tool |
| [html-validate](https://html-validate.org/) | Semantic HTML validation | W3C + a11y | `npm i -g html-validate` |
