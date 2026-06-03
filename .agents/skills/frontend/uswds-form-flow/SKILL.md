---
id: uswds-form-flow
version: "1.0.0"
title: "USWDS Accessible Form Flow"
type: skill
description: "Generate accessible multi-step forms using USWDS patterns with proper validation, error handling, and Section 508 compliance"

status: experimental
owners:
  - "@community"

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

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "create form"
  - "form flow"
  - "multi-step form"
  - "application form"

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
---

# Skill: USWDS Accessible Form Flow

Generate accessible multi-step forms using USWDS components with proper labels, validation, error handling, and keyboard navigation.

## When to Use

- Creating application or intake forms
- Building multi-step flows
- User asks "create a form" or "build an application"

## Procedure

### Step 1: Map Form Structure

Identify required fields and group into logical steps.

### Step 2: Generate Form HTML

Use USWDS form components with proper labels and ARIA attributes.

### Step 3: Add Validation and Error Handling

Include inline validation and error message patterns.

### Step 4: Ensure Accessibility

- All inputs have labels
- Required fields marked clearly
- Error messages associated with inputs
- Keyboard navigation works

## Example

```html
<form class="usa-form">
  <fieldset class="usa-fieldset">
    <legend class="usa-legend">Contact Information</legend>
    
    <label class="usa-label" for="email">
      Email address <abbr title="required" class="usa-hint usa-hint--required">*</abbr>
    </label>
    <input class="usa-input" id="email" name="email" type="email" required>
    
    <label class="usa-label" for="phone">Phone number</label>
    <input class="usa-input" id="phone" name="phone" type="tel">
  </fieldset>
</form>
```

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md)
- [accessibility-review](../accessibility-review/SKILL.md)

## References

- [USWDS Form Components](https://designsystem.digital.gov/components/form/)
- [Section 508 Forms Guidance](https://www.section508.gov/create/web-software/)
