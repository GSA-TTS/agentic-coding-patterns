---
id: uswds-form-flow
version: "1.0.0"
title: "USWDS Accessible Form Flow"
type: skill
description: "Generate accessible multi-step forms using USWDS patterns with proper validation, error handling, and Section 508 compliance"

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
      - "Generated Form HTML"
      - "Validation Rules"
      - "Accessibility Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "frontend"
  - "compliance"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "create form"
  - "form flow"
  - "multi-step form"
  - "application form"
  - "intake form"

tags:
  - "frontend"
  - "uswds"
  - "forms"
  - "accessibility"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Generate accessible forms for federal services"
    - "Create multi-step form flows"
    - "Build form validation patterns"
  exclusions:
    - "Not for PRA compliance determination"
    - "Does not replace user testing"
    - "Does not generate backend processing logic"

collection: digital-service
routing:
  task_types:
    - "author"
    - "render"
  input_artifacts:
    - "artifact-brief"
  output_artifacts:
    - "form"
    - "source-code"
  prefer_when:
    - "the request is to build a (multi-step) form"
  aliases:
    - "uswds form"
    - "accessible form"
    - "multi-step form"
---

# Skill: USWDS Accessible Form Flow

Generate accessible multi-step forms using USWDS components with proper labels, validation, error handling, and keyboard navigation. Produces draft forms for human review and accessibility testing.

## When to Use

- Creating application or intake forms for federal services
- Building multi-step enrollment or registration flows
- Designing forms that collect personal information
- User asks "create a form" or "build an application"

## Prerequisites

- Understanding of the form's purpose and required fields
- Knowledge of which fields are required vs. optional
- Content for labels, help text, and error messages
- Awareness of PRA (Paperwork Reduction Act) requirements if applicable

## Procedure

### Step 1: Map Form Structure

Before generating, identify:

- [ ] Form purpose (application, enrollment, feedback, etc.)
- [ ] Required fields vs. optional fields
- [ ] Logical grouping of related fields
- [ ] Number of steps for multi-step flows
- [ ] Validation rules for each field

Group fields into logical sections:

| Section | Common Fields |
|---------|---------------|
| Personal Info | Name, date of birth, SSN (last 4) |
| Contact Info | Email, phone, address |
| Eligibility | Status questions, yes/no toggles |
| Documents | File uploads, reference numbers |
| Review | Summary, certification checkbox |

### Step 2: Generate Form HTML

Use USWDS form components with proper structure:

```html
<form class="usa-form usa-form--large" action="/submit" method="post">
  <fieldset class="usa-fieldset">
    <legend class="usa-legend usa-legend--large">Section Title</legend>

    <!-- Text input with label -->
    <label class="usa-label" for="first-name">
      First name <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
    </label>
    <input class="usa-input" id="first-name" name="first-name" type="text" required>

    <!-- Input with help text -->
    <label class="usa-label" for="ssn">
      Social Security Number (last 4 digits)
    </label>
    <span class="usa-hint" id="ssn-hint">For example: 1234</span>
    <input class="usa-input usa-input--medium" id="ssn" name="ssn"
           type="text" pattern="[0-9]{4}" aria-describedby="ssn-hint">
  </fieldset>
</form>
```

### Step 3: Implement Multi-Step Flow

For multi-step forms, use USWDS Step Indicator:

```html
<div class="usa-step-indicator" aria-label="progress">
  <ol class="usa-step-indicator__segments">
    <li class="usa-step-indicator__segment usa-step-indicator__segment--complete">
      <span class="usa-step-indicator__segment-label">Personal Info <span class="usa-sr-only">completed</span></span>
    </li>
    <li class="usa-step-indicator__segment usa-step-indicator__segment--current" aria-current="step">
      <span class="usa-step-indicator__segment-label">Contact Info</span>
    </li>
    <li class="usa-step-indicator__segment">
      <span class="usa-step-indicator__segment-label">Review <span class="usa-sr-only">not completed</span></span>
    </li>
  </ol>
  <div class="usa-step-indicator__header">
    <h2 class="usa-step-indicator__heading">
      <span class="usa-step-indicator__heading-counter">
        <span class="usa-sr-only">Step</span>
        <span class="usa-step-indicator__current-step">2</span>
        <span class="usa-step-indicator__total-steps">of 3</span>
      </span>
      <span class="usa-step-indicator__heading-text">Contact Information</span>
    </h2>
  </div>
</div>
```

### Step 4: Add Validation and Error Handling

Include error message patterns:

```html
<!-- Error state for text input -->
<label class="usa-label usa-label--error" for="email">
  Email address <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
</label>
<span class="usa-error-message" id="email-error" role="alert">
  Enter a valid email address
</span>
<input class="usa-input usa-input--error" id="email" name="email"
       type="email" aria-describedby="email-error" required>

<!-- Error summary at top of form -->
<div class="usa-alert usa-alert--error" role="alert">
  <div class="usa-alert__body">
    <h4 class="usa-alert__heading">There are 2 errors on this page</h4>
    <ul class="usa-list">
      <li><a href="#email">Enter a valid email address</a></li>
      <li><a href="#phone">Enter a valid phone number</a></li>
    </ul>
  </div>
</div>
```

### Step 5: Ensure Accessibility

Every generated form MUST include:

- [ ] All inputs have associated `<label>` elements
- [ ] Required fields use `required` attribute AND visual indicator
- [ ] Help text linked via `aria-describedby`
- [ ] Error messages use `role="alert"` and link to input
- [ ] Fieldsets group related inputs with `<legend>`
- [ ] Step indicator has proper ARIA labels
- [ ] Form can be completed with keyboard only

### Step 6: Generate Output

Produce the complete artifact with:

1. **Generated Form HTML** — Complete form markup
2. **Validation Rules** — Required fields and validation patterns
3. **Accessibility Checklist** — Items verified in the output

## USWDS Form Components Reference

| Component | USWDS Class | When to Use |
|-----------|-------------|-------------|
| Text input | `usa-input` | Short text, names, numbers |
| Textarea | `usa-textarea` | Long text, comments |
| Select | `usa-select` | Dropdown with many options |
| Radio buttons | `usa-radio` | Single choice from few options |
| Checkboxes | `usa-checkbox` | Multiple selections |
| Date picker | `usa-date-picker` | Date selection |
| File input | `usa-file-input` | Document uploads |
| Combo box | `usa-combo-box` | Searchable dropdown |

## Examples

### Example 1: Contact Information Form

**Input:** "Create a contact form with name, email, and message"

**Output:**

```html
<form class="usa-form" action="/contact" method="post">
  <fieldset class="usa-fieldset">
    <legend class="usa-legend">Contact Us</legend>

    <label class="usa-label" for="name">
      Your name <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
    </label>
    <input class="usa-input" id="name" name="name" type="text" required>

    <label class="usa-label" for="email">
      Email address <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
    </label>
    <input class="usa-input" id="email" name="email" type="email" required>

    <label class="usa-label" for="message">
      Message <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
    </label>
    <textarea class="usa-textarea" id="message" name="message" required></textarea>

    <button type="submit" class="usa-button">Send Message</button>
  </fieldset>
</form>
```

### Example 2: Multi-Step Application

**Input:** "Create a 3-step benefits application"

**Structure:**

| Step | Section | Fields |
|------|---------|--------|
| 1 | Personal Info | Name, DOB, SSN (last 4) |
| 2 | Eligibility | Status questions |
| 3 | Review | Summary, certification |

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Use placeholder as label | Always use visible `<label>` |
| Hide required indicator | Use `<abbr title="required">*</abbr>` |
| Put errors only at top | Also highlight the specific field |
| Use color alone for errors | Add text and icons |
| Skip fieldsets for groups | Group related inputs with `<fieldset>` |

## Verification

After generating, verify:

```bash
# HTML validation
npx html-validate output.html

# Accessibility check
npx axe output.html --exit
```

### Manual Checklist

- [ ] All inputs have visible labels
- [ ] Required fields are clearly marked
- [ ] Error messages are descriptive
- [ ] Tab order is logical
- [ ] Form works with keyboard only
- [ ] Screen reader announces all content

## Human Review Gate

**Before using this output:**

A human MUST verify:

1. All field labels match approved content
2. Required vs. optional fields are correct
3. Validation rules match business requirements
4. Error messages are clear and actionable
5. Form has been tested with actual users

**This skill produces drafts, not deployment-ready forms.**

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md) — For page structure
- [accessibility-review](../accessibility-review/SKILL.md) — Review the generated form
- [plain-language-review](../plain-language-review/SKILL.md) — Improve label text

## References

- [USWDS Form Controls](https://designsystem.digital.gov/components/form-controls/)
- [USWDS Form Templates](https://designsystem.digital.gov/templates/form-templates/)
- [USWDS Step Indicator](https://designsystem.digital.gov/components/step-indicator/)
- [Section 508 Software & Websites Guidance](https://www.section508.gov/create/software-websites/)
- [WCAG 1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships)
- [WCAG 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG21/Understanding/error-identification)
- [WCAG 3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions)

## Deterministic Tools

| Tool | Purpose | Install |
|------|---------|---------|
| [html-validate](https://html-validate.org/) | HTML + form validation | `npm i -g html-validate` |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility testing | `npm i -g @axe-core/cli` |
| [pa11y](https://pa11y.org/) | WCAG compliance | `npm i -g pa11y` |
