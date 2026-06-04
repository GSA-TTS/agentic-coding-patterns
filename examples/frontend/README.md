# Frontend Skills Examples

This directory contains sample inputs and expected outputs for the frontend skills pack. Use these examples to:

- Understand what each skill produces
- Test skill implementations
- Validate deterministic tool integration

## Directory Structure

```
examples/frontend/
├── README.md                          # This file
├── uswds-prototype/
│   ├── input-brief.md                 # Sample project brief
│   └── expected-output.html           # Expected HTML prototype
├── accessibility-review/
│   ├── sample-page.html               # Page with known issues
│   └── expected-report.md             # Expected review output
├── plain-language-review/
│   ├── complex-content.md             # Content needing simplification
│   └── expected-review.md             # Expected analysis
└── uswds-form-flow/
    ├── form-requirements.md           # Form specification
    └── expected-form.html             # Expected form HTML
```

## Using These Examples

### Testing Readability

```bash
# Run readability check on plain language example
python3 ../.agents/skills/frontend/tools/readability_score.py \
  plain-language-review/complex-content.md

# Expected: Grade level > 12 (needs simplification)
```

### Testing HTML Validation

```bash
# Validate expected output
npx html-validate uswds-prototype/expected-output.html

# Expected: No errors (valid HTML)
```

### Testing Accessibility

```bash
# Check accessibility of sample page
npx axe accessibility-review/sample-page.html --exit

# Expected: Reports known issues for training
```

## Example Quality Standards

All examples in this directory should:

1. **Be self-contained** — No external dependencies
2. **Be deterministic** — Same input always produces same output
3. **Include comments** — Explain what each example demonstrates
4. **Pass validation** — Expected outputs should pass their respective tools
5. **Use placeholder content** — No real PII, secrets, or internal URLs

## Contributing Examples

When adding new examples:

1. Create a subdirectory matching the skill name
2. Include both input and expected output files
3. Add a brief comment at the top of each file explaining its purpose
4. Verify examples pass the CI workflow (`frontend-skills-qa.yml`)
5. Update this README with the new example

## Related

- [Frontend Skills README](../../.agents/skills/frontend/README.md)
- [Deterministic Tools](../../.agents/skills/frontend/tools/README.md)
- [CI Workflow](../../.github/workflows/frontend-skills-qa.yml)
