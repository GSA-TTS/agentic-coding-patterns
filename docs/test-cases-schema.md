---
title: "test-cases.yml Schema"
description: "Schema documentation for pattern test case validation files"
status: experimental
last_updated: "2026-05-26"
audience: ["developers", "contributors"]
keywords: ["testing", "validation", "schema"]
---

# test-cases.yml Schema

## Overview

The `tests/test-cases.yml` file provides automated validation for skills, prompts, and workflows. It defines test cases that verify patterns produce expected output.

**Based on:** DSD repository pattern (26 examples)

## File Location

```
skills/your-skill/
├── SKILL.md
└── tests/
    └── test-cases.yml
```

## Schema Structure

### Top Level

```yaml
suite:
  pattern_id: string              # REQUIRED - matches pattern id
  pattern_version: string         # REQUIRED - semver version
  description: string             # REQUIRED - describes test suite

test_cases:                       # REQUIRED - array of test cases
  - id: string                    # REQUIRED - unique test identifier
    name: string                  # REQUIRED - human-readable name
    description: string           # OPTIONAL - explains test purpose
    input:                        # REQUIRED - test input
      type: string                # REQUIRED - "literal" or "file_path"
      content: string             # REQUIRED for literal - input text
    assertions:                   # REQUIRED - array of assertions
      - type: string              # REQUIRED - assertion type
        # ... assertion-specific fields
```

## Suite Section

```yaml
suite:
  pattern_id: secure-code-review
  pattern_version: "1.0.0"
  description: "Tests for secure code review pattern"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern_id` | string | YES | Must match pattern frontmatter id |
| `pattern_version` | string | YES | Semantic version of pattern |
| `description` | string | YES | Human-readable test suite description |

## Test Cases Section

Each test case validates a specific behavior:

```yaml
test_cases:
  - id: sql-injection-detection
    name: "Detects SQL injection vulnerability"
    description: "Verifies pattern identifies SQL injection patterns"
    input:
      type: literal
      content: |
        query = "SELECT * FROM users WHERE id = " + user_input
    assertions:
      - type: contains
        pattern: "SQL injection"
        min_count: 1
```

### Test Case Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | YES | Unique identifier (kebab-case) |
| `name` | string | YES | Human-readable name |
| `description` | string | NO | Explains test purpose |
| `input` | object | YES | Test input configuration |
| `assertions` | array | YES | List of assertions to validate |

## Input Types

### Literal Input

Use for inline test content:

```yaml
input:
  type: literal
  content: |
    Multi-line content here
    Can span multiple lines
```

### File Path Input

Use to load input from a file:

```yaml
input:
  type: file_path
  path: tests/fixtures/sample-code.py
```

## Assertion Types

### `contains`

Asserts output contains a specific pattern:

```yaml
assertions:
  - type: contains
    pattern: "expected text"
    min_count: 1              # OPTIONAL - default 1
    case_sensitive: false     # OPTIONAL - default true
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `pattern` | string | YES | - | Text pattern to find |
| `min_count` | integer | NO | 1 | Minimum occurrences |
| `case_sensitive` | boolean | NO | true | Case-sensitive matching |

### `not_contains`

Asserts output does NOT contain a pattern:

```yaml
assertions:
  - type: not_contains
    pattern: "prohibited text"
    case_sensitive: false
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `pattern` | string | YES | - | Pattern that must not appear |
| `case_sensitive` | boolean | NO | true | Case-sensitive matching |

### `has_sections`

Asserts output contains required sections (Markdown headings):

```yaml
assertions:
  - type: has_sections
    sections:
      - "Summary"
      - "Background"
      - "Action Required"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sections` | array[string] | YES | List of required heading texts |

### `has_pattern`

Asserts output matches regex patterns:

```yaml
assertions:
  - type: has_pattern
    patterns:
      - "(Source:"
      - "Verify:"
    minimum_count: 2
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `patterns` | array[string] | YES | - | List of regex patterns |
| `minimum_count` | integer | NO | 1 | Minimum matches across all patterns |

### `no_prohibited`

Asserts output does not contain prohibited patterns:

```yaml
assertions:
  - type: no_prohibited
    patterns:
      - "API_KEY="
      - "password="
      - "secret="
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `patterns` | array[string] | YES | List of prohibited patterns |

### `readability_max`

Asserts output meets readability requirements:

```yaml
assertions:
  - type: readability_max
    grade: 8
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `grade` | integer | YES | Maximum Flesch-Kincaid grade level |

**Note:** Requires text analysis library (textstat or similar)

## Complete Examples

### Example 1: Basic Pattern Validation

```yaml
suite:
  pattern_id: plain-language-writer
  pattern_version: "1.0.0"
  description: "Tests for plain language writing pattern"

test_cases:
  - id: grade-level-check
    name: "Output meets grade 8 readability"
    input:
      type: literal
      content: |
        The quick brown fox jumps over the lazy dog.
        This is a simple sentence.
    assertions:
      - type: readability_max
        grade: 8
      
  - id: no-jargon
    name: "No corporate jargon present"
    input:
      type: literal
      content: |
        We will work together to complete the project.
    assertions:
      - type: not_contains
        pattern: "leverage"
        case_sensitive: false
      - type: not_contains
        pattern: "synergies"
        case_sensitive: false
```

### Example 2: Security Pattern

```yaml
suite:
  pattern_id: secure-code-review
  pattern_version: "1.0.0"
  description: "Tests for secure code review pattern"

test_cases:
  - id: sql-injection-detection
    name: "Detects SQL injection"
    input:
      type: literal
      content: |
        query = "SELECT * FROM users WHERE id = " + user_input
    assertions:
      - type: contains
        pattern: "SQL injection"
      - type: contains
        pattern: "parameterized"

  - id: no-hardcoded-secrets
    name: "Flags hardcoded credentials"
    input:
      type: literal
      content: |
        api_key = "sk-1234567890abcdef"
    assertions:
      - type: contains
        pattern: "hardcoded credential"
      - type: contains
        pattern: "environment variable"
```

### Example 3: Documentation Pattern

```yaml
suite:
  pattern_id: api-documentation
  pattern_version: "1.0.0"
  description: "Tests for API documentation pattern"

test_cases:
  - id: required-sections
    name: "Has all required documentation sections"
    input:
      type: literal
      content: |
        # API Documentation
        
        ## Overview
        API description here.
        
        ## Authentication
        Auth details here.
        
        ## Endpoints
        Endpoint list here.
        
        ## Examples
        Example usage here.
    assertions:
      - type: has_sections
        sections:
          - "Overview"
          - "Authentication"
          - "Endpoints"
          - "Examples"

  - id: has-code-examples
    name: "Contains code examples"
    input:
      type: file_path
      path: tests/fixtures/api-doc.md
    assertions:
      - type: contains
        pattern: "```"
        min_count: 2
```

## Test Runner Usage

```bash
# Run all test cases
python scripts/run_test_cases.py

# Run tests for specific pattern
python scripts/run_test_cases.py skills/your-skill/tests/test-cases.yml

# Verbose output
python scripts/run_test_cases.py --verbose

# Generate test report
python scripts/run_test_cases.py --report
```

## Integration with CI

```yaml
# .github/workflows/test.yml
- name: Run pattern test cases
  run: python scripts/run_test_cases.py
```

## Best Practices

### 1. Test IDs

Use descriptive kebab-case IDs:
- ✅ `sql-injection-detection`
- ✅ `readability-grade-8`
- ❌ `test1`
- ❌ `test_case_2`

### 2. Input Types

Use `literal` for short examples, `file_path` for longer fixtures:

```yaml
# Good - short example
input:
  type: literal
  content: "Short test input"

# Good - long example
input:
  type: file_path
  path: tests/fixtures/long-document.md
```

### 3. Assertion Specificity

Be specific with assertions:

```yaml
# Good - specific
- type: contains
  pattern: "SQL injection vulnerability detected"
  
# Less helpful - too generic
- type: contains
  pattern: "vulnerability"
```

### 4. Multiple Assertions

Test multiple aspects per test case:

```yaml
assertions:
  - type: contains
    pattern: "security issue"
  - type: has_sections
    sections: ["Summary", "Remediation"]
  - type: not_contains
    pattern: "false positive"
```

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-05-26 | 0.1.0 | Initial schema documentation |

## References

- DSD repository: 26 test-cases.yml examples
- Issue #52: Skill test runner implementation
- `CONTRIBUTING.md`: Test case contribution guidelines
