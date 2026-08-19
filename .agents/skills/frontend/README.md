# Federal Front-End Skills

Skills for generating, reviewing, and improving federal digital service front ends.

> **Status:** Experimental | **License:** CC0-1.0

## Overview

These skills help AI coding agents produce USWDS-aligned, accessible, plain-language front-end artifacts for federal digital services.

**Key principle:** These skills produce **drafts and review aids**, not final compliance determinations. Human review is always required before deployment.

## When to Use

| Skill | Use When |
|-------|----------|
| [uswds-prototype](uswds-prototype/SKILL.md) | Generating new USWDS-aligned pages or components |
| [accessibility-review](accessibility-review/SKILL.md) | Reviewing artifacts for Section 508 accessibility |
| [plain-language-review](plain-language-review/SKILL.md) | Improving federal content for clarity |
| [uswds-form-flow](uswds-form-flow/SKILL.md) | Creating accessible government forms |
| [uswds-landing-page](uswds-landing-page/SKILL.md) | Building service landing pages |
| [federal-service-blueprint](federal-service-blueprint/SKILL.md) | Planning before code generation |

## Design Principles

1. **USWDS-first** — Use U.S. Web Design System components, patterns, and design tokens
2. **Accessible by default** — Meet Section 508 and WCAG 2.1 AA requirements
3. **Plain language** — Follow federal plain language guidelines
4. **Semantic HTML** — Use proper HTML elements before adding framework-specific code
5. **No external CDNs** — Avoid external dependencies unless explicitly requested
6. **Human review required** — Agents produce drafts, humans approve for deployment

## What These Skills Do NOT Provide

- Final Section 508 compliance certification
- Legal determinations about accessibility
- Automatic PRA (Paperwork Reduction Act) compliance
- Privacy impact assessments
- Authority to Operate (ATO) artifacts
- Agency-specific branding decisions

## Output Expectations

All frontend skills produce artifacts that:

- Use semantic HTML elements (`<main>`, `<nav>`, `<article>`, etc.)
- Reference USWDS class names and design tokens
- Include accessible heading hierarchy (h1 → h2 → h3)
- Provide keyboard navigation support
- Include visible focus indicators
- Define form labels and error messages
- Avoid inline styles where possible
- Include comments for human decision points

## Contributing New Skills

To add a new frontend skill:

1. Create a folder under `.agents/skills/frontend/your-skill-name/`
2. Add a `SKILL.md` following the [skill template](../../../templates/skill-template/SKILL.md)
3. Ensure frontmatter validates against `schemas/skill.schema.json`
4. Set `status: experimental` for new skills
5. Include `prohibited_content` in the output contract
6. Add verification checklist and human review gate
7. Run `make validate` before submitting

## References

- [U.S. Web Design System](https://designsystem.digital.gov/)
- [Section508.gov](https://www.section508.gov/)
- [Plain Language (digital.gov)](https://digital.gov/topics/plain-language/)
- [18F Content Guide (GitHub source)](https://github.com/18F/content-guide)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)

## Related Patterns

- [secure-code-review](../secure-code-review/SKILL.md) — For security-focused review
- [documentation-review](../documentation-review/SKILL.md) — For documentation quality
