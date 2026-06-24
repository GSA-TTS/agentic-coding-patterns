---
id: uswds-prototype
version: "1.0.0"
title: "USWDS Front-End Prototype"
type: skill
description: "Generate USWDS-aligned front-end prototypes with semantic HTML, accessible structure, and federal design patterns"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - designers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Generated HTML"
      - "Accessibility Notes"
      - "Human Review Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "External CDN Links"
      - "Agency-Specific Branding"

categories:
  - "frontend"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "create page"
  - "build prototype"
  - "uswds"
  - "federal website"
  - "government page"

tags:
  - "frontend"
  - "uswds"
  - "prototype"
  - "html"
  - "accessibility"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Generate static HTML prototypes for federal services"
    - "Create USWDS-aligned page structures"
    - "Build accessible component layouts"
    - "Mock up user interfaces before implementation"
  exclusions:
    - "Not for production deployment without review"
    - "Not for complex web applications"
    - "Does not replace design system documentation"
    - "Does not provide final accessibility certification"
---

# Skill: USWDS Front-End Prototype

Generate USWDS-aligned front-end prototypes with semantic HTML, accessible heading structure, and federal design patterns. Produces draft artifacts for human review before deployment.

## When to Use

- Creating a new page for a federal digital service
- Prototyping a user interface before full implementation
- Building static HTML mockups for stakeholder review
- Generating accessible page structures
- User asks "create a page for..." or "build a prototype..."

## Prerequisites

- Understanding of the target audience and purpose
- Content or placeholder text for the page
- Any specific USWDS components needed
- Accessibility requirements for the context

## Procedure

### Step 1: Clarify Requirements

Before generating, confirm:

- [ ] Page purpose (informational, transactional, navigational)
- [ ] Target audience
- [ ] Primary content or message
- [ ] Required USWDS components (header, footer, cards, alerts, etc.)
- [ ] Any specific accessibility concerns

### Step 2: Generate Page Structure

Create semantic HTML with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Page Title] | [Service Name]</title>
  <!-- USWDS CSS would be linked here in production -->
</head>
<body>
  <a class="usa-skipnav" href="#main-content">Skip to main content</a>

  <header class="usa-header usa-header--basic">
    <!-- Header content -->
  </header>

  <main id="main-content">
    <div class="grid-container">
      <!-- Page content -->
    </div>
  </main>

  <footer class="usa-footer">
    <!-- Footer content -->
  </footer>
</body>
</html>
```

### Step 3: Apply USWDS Patterns

Use appropriate USWDS components:

| Need | USWDS Component |
|------|-----------------|
| Page header | `usa-header` |
| Navigation | `usa-nav` |
| Alerts/notices | `usa-alert` |
| Cards | `usa-card` |
| Forms | `usa-form` with `usa-input`, `usa-select`, etc. |
| Buttons | `usa-button` |
| Footer | `usa-footer` |

### Step 4: Ensure Accessibility

Every generated page MUST include:

- [ ] Skip navigation link (`<a class="usa-skipnav">`)
- [ ] Proper `lang` attribute on `<html>`
- [ ] Single `<h1>` as page title
- [ ] Logical heading hierarchy (h1 → h2 → h3)
- [ ] Landmark elements (`<main>`, `<nav>`, `<header>`, `<footer>`)
- [ ] Descriptive link text (no "click here")
- [ ] Form labels associated with inputs
- [ ] Alt text for images (or `alt=""` for decorative)

### Step 5: Add Human Review Comments

Insert HTML comments for decisions requiring human input:

```html
<!-- HUMAN REVIEW: Verify this heading matches the approved page title -->
<h1>Service Name</h1>

<!-- HUMAN REVIEW: Replace placeholder content with approved copy -->
<p>Description of the service goes here.</p>

<!-- HUMAN REVIEW: Confirm link destinations are correct -->
<a href="/apply">Apply now</a>
```

### Step 6: Generate Output

Produce the complete artifact with:

1. **Generated HTML** — The complete page markup
2. **Accessibility Notes** — Key accessibility features included
3. **Human Review Checklist** — Items requiring human verification

## Verification

After generating, verify with automated tools and manual checks:

### Automated Validation

```bash
# HTML structure validation
npx html-validate output.html

# Accessibility check
npx axe output.html --exit

# If using Vale with USWDS rules
vale --config profiles/uswds.vale.ini output.html
```

### Manual Checklist

- [ ] HTML is valid and well-formed
- [ ] Single `<h1>` element exists
- [ ] Heading levels don't skip (h1 → h3)
- [ ] All interactive elements are keyboard accessible
- [ ] No external CDN links (unless explicitly requested)
- [ ] USWDS class names are used correctly
- [ ] Human review comments are included

## Examples

### Example 1: Simple Informational Page

**Input:** "Create a page explaining how to apply for benefits"

**Output:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>How to Apply | Benefits Service</title>
</head>
<body>
  <a class="usa-skipnav" href="#main-content">Skip to main content</a>

  <header class="usa-header usa-header--basic">
    <div class="usa-nav-container">
      <div class="usa-navbar">
        <div class="usa-logo">
          <!-- HUMAN REVIEW: Add approved logo or service name -->
          <em class="usa-logo__text">Benefits Service</em>
        </div>
      </div>
    </div>
  </header>

  <main id="main-content">
    <div class="grid-container">
      <h1>How to Apply for Benefits</h1>

      <!-- HUMAN REVIEW: Verify eligibility information is accurate -->
      <section>
        <h2>Who Can Apply</h2>
        <p>You may be eligible if you meet the following criteria:</p>
        <ul>
          <li>Criterion 1</li>
          <li>Criterion 2</li>
        </ul>
      </section>

      <section>
        <h2>What You'll Need</h2>
        <ul>
          <li>Document 1</li>
          <li>Document 2</li>
        </ul>
      </section>

      <section>
        <h2>How to Apply</h2>
        <ol>
          <li>Step 1: Gather documents</li>
          <li>Step 2: Complete application</li>
          <li>Step 3: Submit and wait for response</li>
        </ol>

        <!-- HUMAN REVIEW: Verify button destination -->
        <a class="usa-button" href="/apply">Start Your Application</a>
      </section>
    </div>
  </main>

  <footer class="usa-footer usa-footer--slim">
    <div class="grid-container">
      <!-- HUMAN REVIEW: Add approved footer content -->
      <p>Contact: support@example.gov</p>
    </div>
  </footer>
</body>
</html>
```

**Accessibility Notes:**
- Skip link provided for keyboard users
- Logical heading hierarchy (h1 → h2)
- Lists used for related items
- Button has descriptive text

**Human Review Checklist:**
- [ ] Verify service name and branding
- [ ] Confirm eligibility criteria are accurate
- [ ] Validate application link destination
- [ ] Review footer contact information

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Use `<div>` for everything | Use semantic elements (`<main>`, `<section>`, `<article>`) |
| Skip heading levels | Maintain logical hierarchy (h1 → h2 → h3) |
| Use "click here" links | Use descriptive link text |
| Embed external CDN scripts | Reference local USWDS assets |
| Hard-code agency branding | Use placeholders for human review |
| Claim the page is "508 compliant" | Note that human review is required |

## Human Review Gate

**Before using this output:**

A human MUST review and verify:

1. All content is accurate and approved
2. Links point to correct destinations
3. Branding meets agency requirements
4. Accessibility has been validated with automated tools AND manual testing
5. No placeholder content remains in production

**This skill produces drafts, not deployment-ready code.**

## Related Patterns

- [accessibility-review](../accessibility-review/SKILL.md) — Review the generated output
- [plain-language-review](../plain-language-review/SKILL.md) — Improve content clarity
- [uswds-form-flow](../uswds-form-flow/SKILL.md) — For pages with forms

## References

- [USWDS Components](https://designsystem.digital.gov/components/)
- [USWDS Page Templates](https://designsystem.digital.gov/templates/)
- [Section 508 Testing](https://www.section508.gov/test/)

## Deterministic Tools

| Tool | Purpose | Install |
|------|---------|---------|
| [html-validate](https://html-validate.org/) | HTML structure + semantic validation | `npm i -g html-validate` |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility testing | `npm i -g @axe-core/cli` |
| [Vale](https://vale.sh) | USWDS terminology + component rules | `brew install vale` |
| [Nu Html Checker](https://validator.github.io/validator/) | W3C HTML validation | Java or Docker |
