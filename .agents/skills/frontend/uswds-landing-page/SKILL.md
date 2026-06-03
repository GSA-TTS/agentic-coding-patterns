---
id: uswds-landing-page
version: "1.0.0"
title: "USWDS Service Landing Page"
type: skill
description: "Generate service landing pages using USWDS hero, card, and content patterns for federal digital services"

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
      - "Generated Page HTML"
      - "Content Sections"
      - "Human Review Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "landing page"
  - "service page"
  - "home page"

tags:
  - "frontend"
  - "uswds"
  - "landing-page"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Generate service landing pages"
    - "Create marketing or informational pages"
  exclusions:
    - "Not for complex applications"
---

# Skill: USWDS Service Landing Page

Generate USWDS-aligned landing pages with hero sections, feature cards, and clear calls to action for federal digital services.

## When to Use

- Creating a new service landing page
- Building a marketing or informational page
- User asks "create a landing page"

## Procedure

### Step 1: Define Page Purpose

Identify the service, target audience, and primary action.

### Step 2: Generate Hero Section

Include service name, tagline, and primary CTA.

### Step 3: Add Feature Cards

Highlight 3-4 key features or benefits.

### Step 4: Include Clear Next Steps

Provide obvious paths for users to take action.

## Example

```html
<section class="usa-hero">
  <div class="grid-container">
    <div class="usa-hero__callout">
      <h1 class="usa-hero__heading">Service Name</h1>
      <p>Brief description of what this service does.</p>
      <a class="usa-button" href="/apply">Get Started</a>
    </div>
  </div>
</section>

<section class="grid-container usa-section">
  <div class="grid-row grid-gap">
    <div class="tablet:grid-col-4">
      <h2 class="font-heading-xl margin-top-0">Feature 1</h2>
      <p>Description of feature.</p>
    </div>
  </div>
</section>
```

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md)
- [plain-language-review](../plain-language-review/SKILL.md)

## References

- [USWDS Templates](https://designsystem.digital.gov/templates/)
- [USWDS Hero Component](https://designsystem.digital.gov/components/hero/)
