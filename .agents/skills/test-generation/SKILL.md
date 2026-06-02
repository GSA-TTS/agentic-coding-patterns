---
id: test-generation
version: "1.0.0"
title: "Test Case Generation"
type: skill
description: "Generate unit tests, identify edge cases, and analyze test coverage gaps"

status: experimental
owners:
  - "@community"

primary_personas:
  - developers
  - testers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Generated Tests"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "testing"
  - "unit tests"
  - "test coverage"
  - "TDD"
  - "edge cases"

tags:
  - "testing"
  - "quality"
  - "tdd"
  - "coverage"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Generate unit tests for functions/methods"
    - "Identify edge cases and boundary conditions"
    - "Analyze test coverage gaps"
    - "Create regression tests for bugs"
  exclusions:
    - "Not for integration/e2e test generation"
    - "Not for performance/load testing"
    - "Not for manual test case writing"
---

# Skill: Test Case Generation

Generate comprehensive unit tests, identify edge cases, and analyze test coverage to improve code quality.

## When to Use

- Writing tests for new features
- Improving test coverage
- Creating regression tests after bugs
- TDD (Test-Driven Development) workflow
- User asks "write tests for this function" or "what edge cases am I missing?"

## Prerequisites

- Access to source code
- Testing framework installed (pytest, jest, go test, cargo test, etc.)
- Understanding of the code being tested
- (Optional) Code coverage tool

## Procedure

### Step 1: Understand the Code

Analyze the function/method to test:

- **Purpose:** What does it do?
- **Inputs:** What parameters does it accept?
- **Outputs:** What does it return?
- **Side effects:** Does it modify state, call APIs, write files?
- **Error conditions:** What can go wrong?

### Step 2: Identify Test Categories

**Happy path:**

- Normal, expected inputs
- Typical use cases

**Edge cases:**

- Boundary values (min/max, empty, null)
- Special characters in strings
- Zero, negative numbers
- Very large inputs

**Error cases:**

- Invalid inputs
- Missing required parameters
- Type mismatches
- External failures (network, disk, etc.)

### Step 3: Write Test Cases

Follow the **Arrange-Act-Assert** pattern:

**Python (pytest):**

```python
def test_function_name_describes_what_is_tested():
    # Arrange: Set up test data
    input_data = create_test_input()
    expected_output = calculate_expected()

    # Act: Call the function
    actual_output = function_under_test(input_data)

    # Assert: Verify the result
    assert actual_output == expected_output
```

**JavaScript (Jest):**

```javascript
describe('functionUnderTest', () => {
  it('should return expected result for valid input', () => {
    // Arrange
    const input = { value: 42 };
    const expected = { result: 84 };

    // Act
    const actual = functionUnderTest(input);

    // Assert
    expect(actual).toEqual(expected);
  });
});
```

### Step 4: Test Edge Cases

Generate tests for boundary conditions:

```python
# Testing a function that validates age
def test_validate_age_minimum_boundary():
    assert validate_age(0) == True  # Edge case: minimum

def test_validate_age_below_minimum():
    assert validate_age(-1) == False  # Below boundary

def test_validate_age_maximum_boundary():
    assert validate_age(150) == True  # Edge case: maximum

def test_validate_age_above_maximum():
    assert validate_age(151) == False  # Above boundary

def test_validate_age_empty_string():
    with pytest.raises(TypeError):  # Type error
        validate_age("")

def test_validate_age_none():
    with pytest.raises(TypeError):  # Null case
        validate_age(None)
```

### Step 5: Mock External Dependencies

Isolate the code under test:

**Python:**

```python
from unittest.mock import Mock, patch

def test_fetch_user_data():
    # Mock the API call
    with patch('requests.get') as mock_get:
        mock_get.return_value.json.return_value = {'user': 'test'}

        result = fetch_user_data(123)

        assert result['user'] == 'test'
        mock_get.assert_called_once_with('/users/123')
```

**JavaScript:**

```javascript
jest.mock('./api');
import { fetchUser } from './api';

test('processes user data correctly', async () => {
  // Mock API response
  fetchUser.mockResolvedValue({ id: 1, name: 'Test' });

  const result = await processUser(1);

  expect(result.name).toBe('Test');
  expect(fetchUser).toHaveBeenCalledWith(1);
});
```

### Step 6: Test Error Handling

Verify the code fails gracefully:

```python
def test_divide_by_zero_raises_error():
    with pytest.raises(ZeroDivisionError):
        divide(10, 0)

def test_invalid_input_returns_error_message():
    result = process_data({'invalid': 'data'})
    assert result['error'] == 'Invalid input format'
```

### Step 7: Analyze Coverage

Identify untested code paths:

**Python:**

```bash
pytest --cov=mymodule --cov-report=html
# Open htmlcov/index.html to see coverage report
```

**JavaScript:**

```bash
jest --coverage
# Check coverage/lcov-report/index.html
```

**Look for:**

- Uncovered branches (if/else paths)
- Exception handlers not tested
- Edge cases missed

## Verification

After generating tests:

- [ ] All tests pass
- [ ] Happy path covered
- [ ] Edge cases tested
- [ ] Error cases handled
- [ ] Coverage improved (aim for >80% for critical code)
- [ ] Tests are deterministic (no flaky tests)
- [ ] Tests run quickly (unit tests <1s each)

## Examples

### Example 1: String Validation Function

**Code:**

```python
def is_valid_email(email):
    if not email or '@' not in email:
        return False
    parts = email.split('@')
    return len(parts) == 2 and all(parts)
```

**Generated Tests:**

```python
def test_valid_email():
    assert is_valid_email('user@example.com') == True

def test_empty_string():
    assert is_valid_email('') == False

def test_none_input():
    assert is_valid_email(None) == False

def test_missing_at_sign():
    assert is_valid_email('userexample.com') == False

def test_multiple_at_signs():
    assert is_valid_email('user@@example.com') == False

def test_empty_local_part():
    assert is_valid_email('@example.com') == False

def test_empty_domain():
    assert is_valid_email('user@') == False
```

### Example 2: Edge Case Identification

**Function:** `calculate_discount(price, percentage)`

**Edge cases to test:**

- Price = 0
- Price < 0 (should error)
- Percentage = 0
- Percentage = 100 (free)
- Percentage > 100 (should error)
- Percentage < 0 (should error)
- Very large price (overflow?)
- Floating point precision (0.1 + 0.2 != 0.3)

### Example 3: Regression Test

**Bug:** Function crashes when input list is empty

**Regression test:**

```python
def test_process_empty_list_does_not_crash():
    # This would have failed before the bug fix
    result = process_items([])
    assert result == []  # Or appropriate empty result
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Flaky tests | Timing, randomness, external state | Use mocks, fix seeds, isolate tests |
| Slow tests | Real I/O, large data | Mock external calls, use smaller fixtures |
| Low coverage | Missing edge cases | Review code paths, add boundary tests |
| Tests too complex | Testing too much at once | Split into smaller, focused tests |

## Related Patterns

- [secure-code-review](../secure-code-review/SKILL.md) - Review generated tests for security issues
- [documentation-review](../documentation-review/SKILL.md) - Verify test names are descriptive

## References

- [pytest documentation](https://docs.pytest.org/)
- [Jest documentation](https://jestjs.io/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Test-Driven Development by Kent Beck](https://www.oreilly.com/library/view/test-driven-development/0321146530/)
