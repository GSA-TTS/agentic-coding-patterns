---
id: uswds-landing-page
version: "1.0.0"
title: "USWDS Service Landing Page"
type: skill
description: "Generate service landing pages using USWDS hero, card, and content patterns for federal digital services"

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
      - "Generated Page HTML"
      - "Content Sections"
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
  - "landing page"
  - "service page"
  - "home page"
  - "marketing page"

tags:
  - "frontend"
  - "uswds"
  - "landing-page"
  - "hero"

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
    - "Build homepage layouts"
  exclusions:
    - "Not for complex web applications"
    - "Does not replace content strategy"

collection: digital-service
routing:
  task_types:
    - "author"
    - "render"
  input_artifacts:
    - "artifact-brief"
  output_artifacts:
    - "landing-page"
    - "source-code"
  prefer_when:
    - "the request is to build a marketing/landing/service page"
  aliases:
    - "uswds landing"
    - "service page"
    - "hero page"
---

# Skill: USWDS Service Landing Page

Generate USWDS-aligned landing pages with hero sections, feature cards, and clear calls to action for federal digital services. Produces draft pages for human review before deployment.

## When to Use

- Creating a new service landing page
- Building a marketing or informational homepage
- Designing a service overview page
- User asks "create a landing page" or "build a homepage"

## Prerequisites

- Service name and brief description
- Primary call-to-action (e.g., "Apply now", "Learn more")
- 3-4 key features or benefits to highlight
- Target audience understanding

## Procedure

### Step 1: Define Page Purpose

Before generating, confirm:

- [ ] Service name and tagline
- [ ] Primary action users should take
- [ ] 3-4 key features or benefits
- [ ] Target audience
- [ ] Secondary actions (if any)

### Step 2: Generate Hero Section

The hero is the first thing users see:

```html
<section class="usa-hero" aria-label="Introduction">
  <div class="grid-container">
    <div class="usa-hero__callout">
      <h1 class="usa-hero__heading">
        <span class="usa-hero__heading--alt">Service Name:</span>
        Clear Value Proposition
      </h1>
      <p>Brief description of what this service does and who it helps. Keep this to 1-2 sentences.</p>
      <a class="usa-button" href="/apply">Get Started</a>
    </div>
  </div>
</section>
```

### Step 3: Add Feature Cards

Highlight key features with card components:

```html
<section class="usa-section">
  <div class="grid-container">
    <h2 class="font-heading-xl margin-y-0">Why Use This Service</h2>

    <ul class="usa-card-group">
      <li class="usa-card tablet:grid-col-4">
        <div class="usa-card__container">
          <div class="usa-card__header">
            <h3 class="usa-card__heading">Feature One</h3>
          </div>
          <div class="usa-card__body">
            <p>Brief description of this feature and its benefit to users.</p>
          </div>
        </div>
      </li>

      <li class="usa-card tablet:grid-col-4">
        <div class="usa-card__container">
          <div class="usa-card__header">
            <h3 class="usa-card__heading">Feature Two</h3>
          </div>
          <div class="usa-card__body">
            <p>Brief description of this feature and its benefit to users.</p>
          </div>
        </div>
      </li>

      <li class="usa-card tablet:grid-col-4">
        <div class="usa-card__container">
          <div class="usa-card__header">
            <h3 class="usa-card__heading">Feature Three</h3>
          </div>
          <div class="usa-card__body">
            <p>Brief description of this feature and its benefit to users.</p>
          </div>
        </div>
      </li>
    </ul>
  </div>
</section>
```

### Step 4: Add Process Section

Show users how to get started:

```html
<section class="usa-section usa-section--light">
  <div class="grid-container">
    <h2 class="font-heading-xl margin-top-0">How It Works</h2>

    <ol class="usa-process-list">
      <li class="usa-process-list__item">
        <h3 class="usa-process-list__heading">Step One</h3>
        <p class="margin-top-05">Description of what happens in this step.</p>
      </li>
      <li class="usa-process-list__item">
        <h3 class="usa-process-list__heading">Step Two</h3>
        <p class="margin-top-05">Description of what happens in this step.</p>
      </li>
      <li class="usa-process-list__item">
        <h3 class="usa-process-list__heading">Step Three</h3>
        <p class="margin-top-05">Description of what happens in this step.</p>
      </li>
    </ol>
  </div>
</section>
```

### Step 5: Add FAQ or Support Section

Address common questions:

```html
<section class="usa-section">
  <div class="grid-container">
    <h2 class="font-heading-xl margin-top-0">Frequently Asked Questions</h2>

    <div class="usa-accordion usa-accordion--bordered">
      <h3 class="usa-accordion__heading">
        <button type="button" class="usa-accordion__button" aria-expanded="false" aria-controls="faq-1">
          Question one goes here?
        </button>
      </h3>
      <div id="faq-1" class="usa-accordion__content usa-prose" hidden>
        <p>Answer to the question.</p>
      </div>

      <h3 class="usa-accordion__heading">
        <button type="button" class="usa-accordion__button" aria-expanded="false" aria-controls="faq-2">
          Question two goes here?
        </button>
      </h3>
      <div id="faq-2" class="usa-accordion__content usa-prose" hidden>
        <p>Answer to the question.</p>
      </div>
    </div>
  </div>
</section>
```

### Step 6: Generate Complete Page

Combine all sections:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Name | Agency Name</title>
  <!-- USWDS CSS would be linked here -->
</head>
<body>
  <a class="usa-skipnav" href="#main-content">Skip to main content</a>

  <!-- Banner -->
  <section class="usa-banner" aria-label="Official website of the United States government">
    <!-- Official government banner content -->
  </section>

  <!-- Header -->
  <header class="usa-header usa-header--basic">
    <!-- Navigation -->
  </header>

  <main id="main-content">
    <!-- Hero Section -->
    <!-- Feature Cards -->
    <!-- Process Steps -->
    <!-- FAQ Section -->
  </main>

  <!-- Footer -->
  <footer class="usa-footer usa-footer--slim">
    <!-- Footer content -->
  </footer>
</body>
</html>
```

## USWDS Landing Page Components

| Section | Component | Purpose |
|---------|-----------|---------|
| Hero | `usa-hero` | Primary message and CTA |
| Features | `usa-card-group` | Highlight benefits |
| Process | `usa-process-list` | Show steps |
| FAQ | `usa-accordion` | Answer questions |
| CTA | `usa-button` | Drive action |
| Testimonials | `usa-card` (media variant) | Social proof |

## Examples

### Example 1: Benefits Service Landing Page

**Input:** "Create a landing page for a federal benefits application service"

**Output:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apply for Benefits | Benefits Service</title>
</head>
<body>
  <a class="usa-skipnav" href="#main-content">Skip to main content</a>

  <header class="usa-header usa-header--basic">
    <div class="usa-nav-container">
      <div class="usa-navbar">
        <div class="usa-logo">
          <!-- HUMAN REVIEW: Add approved logo -->
          <em class="usa-logo__text">Benefits Service</em>
        </div>
      </div>
    </div>
  </header>

  <main id="main-content">
    <!-- Hero -->
    <section class="usa-hero" aria-label="Introduction">
      <div class="grid-container">
        <div class="usa-hero__callout">
          <h1 class="usa-hero__heading">
            <span class="usa-hero__heading--alt">Benefits Service:</span>
            Apply for the support you deserve
          </h1>
          <p>Check your eligibility and apply for federal benefits in minutes.</p>
          <a class="usa-button" href="/eligibility">Check Eligibility</a>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="usa-section">
      <div class="grid-container">
        <h2 class="font-heading-xl margin-y-0">Why Use This Service</h2>

        <ul class="usa-card-group">
          <li class="usa-card tablet:grid-col-4">
            <div class="usa-card__container">
              <div class="usa-card__header">
                <h3 class="usa-card__heading">Quick Eligibility Check</h3>
              </div>
              <div class="usa-card__body">
                <p>Answer a few questions to see if you qualify in under 5 minutes.</p>
              </div>
            </div>
          </li>

          <li class="usa-card tablet:grid-col-4">
            <div class="usa-card__container">
              <div class="usa-card__header">
                <h3 class="usa-card__heading">Secure Application</h3>
              </div>
              <div class="usa-card__body">
                <p>Your information is protected with federal security standards.</p>
              </div>
            </div>
          </li>

          <li class="usa-card tablet:grid-col-4">
            <div class="usa-card__container">
              <div class="usa-card__header">
                <h3 class="usa-card__heading">Track Your Status</h3>
              </div>
              <div class="usa-card__body">
                <p>Check your application status online anytime.</p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Process -->
    <section class="usa-section usa-section--light">
      <div class="grid-container">
        <h2 class="font-heading-xl margin-top-0">How to Apply</h2>

        <ol class="usa-process-list">
          <li class="usa-process-list__item">
            <h3 class="usa-process-list__heading">Check your eligibility</h3>
            <p class="margin-top-05">Answer a few questions to see if you qualify.</p>
          </li>
          <li class="usa-process-list__item">
            <h3 class="usa-process-list__heading">Gather your documents</h3>
            <p class="margin-top-05">You'll need ID, income information, and proof of residence.</p>
          </li>
          <li class="usa-process-list__item">
            <h3 class="usa-process-list__heading">Submit your application</h3>
            <p class="margin-top-05">Complete the online form and upload your documents.</p>
          </li>
        </ol>

        <a class="usa-button usa-button--big" href="/apply">Start Your Application</a>
      </div>
    </section>
  </main>

  <footer class="usa-footer usa-footer--slim">
    <div class="grid-container">
      <!-- HUMAN REVIEW: Add approved footer content -->
      <p>Contact: benefits@example.gov</p>
    </div>
  </footer>
</body>
</html>
```

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Multiple competing CTAs | One clear primary action |
| Wall of text in hero | Keep to 1-2 sentences |
| Generic feature names | Specific, benefit-focused headings |
| Missing skip link | Always include for accessibility |
| External CDN images | Use placeholder or local assets |

## Verification

After generating, verify:

```bash
# HTML validation
npx html-validate output.html

# Accessibility check
npx axe output.html --exit

# Readability check
python3 tools/readability_score.py output.html
```

### Manual Checklist

- [ ] Single clear call-to-action in hero
- [ ] Logical heading hierarchy (h1 → h2 → h3)
- [ ] Skip link present
- [ ] All images have alt text
- [ ] Cards have equal content length
- [ ] Process steps are clear and actionable

## Human Review Gate

**Before using this output:**

A human MUST verify:

1. Service name and branding are approved
2. All content is accurate and approved
3. CTAs link to correct destinations
4. Page has been tested on mobile devices
5. Accessibility validated with real users

**This skill produces drafts, not deployment-ready pages.**

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md) — General page structure
- [plain-language-review](../plain-language-review/SKILL.md) — Improve content clarity
- [accessibility-review](../accessibility-review/SKILL.md) — Review accessibility

## References

- [USWDS Landing Page Template](https://designsystem.digital.gov/templates/landing-page/)
- [USWDS Hero Component](https://designsystem.digital.gov/components/hero/)
- [USWDS Card Component](https://designsystem.digital.gov/components/card/)
- [USWDS Process List](https://designsystem.digital.gov/components/process-list/)
- [USWDS Accordion](https://designsystem.digital.gov/components/accordion/)

## Deterministic Tools

| Tool | Purpose | Install |
|------|---------|---------|
| [html-validate](https://html-validate.org/) | HTML structure validation | `npm i -g html-validate` |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility testing | `npm i -g @axe-core/cli` |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Performance and SEO | `npm i -g lighthouse` |
| [readability_score.py](../tools/readability_score.py) | Content readability | `pip install textstat` |
