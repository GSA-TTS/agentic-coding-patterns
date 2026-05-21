---
id: test-pattern
version: "1.0.0"
title: "Test Pattern"
type: invalid_type
status: experimental
owners:
  - "@community"
primary_personas:
  - developers
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
    prohibited_content:
      - "Secrets"
quality_gates:
  readability_max_grade: 10
  citations_required: false
---

# Invalid Schema

This file has frontmatter that violates the schema (invalid type).
