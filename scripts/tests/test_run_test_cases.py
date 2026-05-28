#!/usr/bin/env python3
"""
Tests for run_test_cases.py test runner.
"""

# Import the module we're testing
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from run_test_cases import (
    find_test_case_files,
    load_test_cases,
    run_assertion,
    run_assertion_contains,
    run_assertion_has_pattern,
    run_assertion_has_sections,
    run_assertion_no_prohibited,
    run_assertion_not_contains,
    run_test_case,
    run_test_suite,
)


class TestLoadTestCases:
    """Tests for loading test case files."""

    def test_load_valid_yaml(self, tmp_path):
        """Test loading a valid test-cases.yml file."""
        test_file = tmp_path / "test-cases.yml"
        test_file.write_text(
            """
suite:
  pattern_id: test-pattern
  pattern_version: "1.0.0"
  description: "Test suite"

test_cases:
  - id: test-1
    name: "Test 1"
    input:
      type: literal
      content: "Test content"
    assertions:
      - type: contains
        pattern: "Test"
"""
        )

        data = load_test_cases(test_file)
        assert data is not None
        assert data["suite"]["pattern_id"] == "test-pattern"
        assert len(data["test_cases"]) == 1

    def test_load_invalid_yaml(self, tmp_path):
        """Test loading an invalid YAML file."""
        test_file = tmp_path / "test-cases.yml"
        test_file.write_text("invalid: yaml: content:\n  - [bad")

        data = load_test_cases(test_file)
        assert data is None

    def test_load_nonexistent_file(self):
        """Test loading a file that doesn't exist."""
        data = load_test_cases(Path("/nonexistent/file.yml"))
        assert data is None


class TestFindTestCaseFiles:
    """Tests for discovering test case files."""

    def test_find_all_test_files(self, tmp_path):
        """Test finding all test-cases.yml files."""
        # Create test structure
        (tmp_path / "skill1" / "tests").mkdir(parents=True)
        (tmp_path / "skill2" / "tests").mkdir(parents=True)

        file1 = tmp_path / "skill1" / "tests" / "test-cases.yml"
        file2 = tmp_path / "skill2" / "tests" / "test-cases.yml"

        for f in [file1, file2]:
            f.write_text(
                """
suite:
  pattern_id: test
  pattern_version: "1.0.0"
  description: "Test"
test_cases: []
"""
            )

        files = find_test_case_files(tmp_path)
        assert len(files) == 2

    def test_find_specific_pattern(self, tmp_path):
        """Test finding test files for specific pattern."""
        (tmp_path / "skill1" / "tests").mkdir(parents=True)
        (tmp_path / "skill2" / "tests").mkdir(parents=True)

        file1 = tmp_path / "skill1" / "tests" / "test-cases.yml"
        file2 = tmp_path / "skill2" / "tests" / "test-cases.yml"

        file1.write_text(
            """
suite:
  pattern_id: pattern-one
  pattern_version: "1.0.0"
  description: "Test"
test_cases: []
"""
        )

        file2.write_text(
            """
suite:
  pattern_id: pattern-two
  pattern_version: "1.0.0"
  description: "Test"
test_cases: []
"""
        )

        files = find_test_case_files(tmp_path, pattern_id="pattern-one")
        assert len(files) == 1
        assert "skill1" in str(files[0])


class TestAssertionContains:
    """Tests for 'contains' assertion."""

    def test_contains_found(self):
        """Test contains assertion when pattern is found."""
        passed, error = run_assertion_contains("Hello world", "Hello")
        assert passed is True
        assert error is None

    def test_contains_not_found(self):
        """Test contains assertion when pattern is not found."""
        passed, error = run_assertion_contains("Hello world", "Goodbye")
        assert passed is False
        assert "Expected pattern" in error

    def test_contains_min_count(self):
        """Test contains assertion with min_count."""
        passed, _ = run_assertion_contains("foo bar foo baz", "foo", min_count=2)
        assert passed is True

        passed, error = run_assertion_contains("foo bar", "foo", min_count=2)
        assert passed is False
        assert "at least 2 time(s)" in error

    def test_contains_case_insensitive(self):
        """Test case-insensitive contains assertion."""
        passed, _ = run_assertion_contains("Hello World", "hello", case_sensitive=False)
        assert passed is True

        passed, _ = run_assertion_contains("Hello World", "hello", case_sensitive=True)
        assert passed is False


class TestAssertionNotContains:
    """Tests for 'not_contains' assertion."""

    def test_not_contains_success(self):
        """Test not_contains when pattern is absent."""
        passed, error = run_assertion_not_contains("Hello world", "Goodbye")
        assert passed is True
        assert error is None

    def test_not_contains_failure(self):
        """Test not_contains when pattern is present."""
        passed, error = run_assertion_not_contains("Hello world", "Hello")
        assert passed is False
        assert "should not be present" in error

    def test_not_contains_case_insensitive(self):
        """Test case-insensitive not_contains."""
        passed, _ = run_assertion_not_contains("Hello World", "hello", case_sensitive=False)
        assert passed is False


class TestAssertionHasSections:
    """Tests for 'has_sections' assertion."""

    def test_has_sections_all_present(self):
        """Test has_sections when all sections are present."""
        content = """
# First Section

Some content

## Second Section

More content

### Third Section

Even more
"""
        passed, error = run_assertion_has_sections(content, ["First Section", "Second Section", "Third Section"])
        assert passed is True
        assert error is None

    def test_has_sections_missing(self):
        """Test has_sections when sections are missing."""
        content = """
# First Section

Content
"""
        passed, error = run_assertion_has_sections(content, ["First Section", "Second Section"])
        assert passed is False
        assert "Missing required sections" in error
        assert "Second Section" in error

    def test_has_sections_various_levels(self):
        """Test has_sections with different heading levels."""
        content = """
# H1 Section
## H2 Section
### H3 Section
#### H4 Section
"""
        passed, _ = run_assertion_has_sections(content, ["H1 Section", "H2 Section", "H3 Section", "H4 Section"])
        assert passed is True


class TestAssertionHasPattern:
    """Tests for 'has_pattern' assertion."""

    def test_has_pattern_found(self):
        """Test has_pattern when patterns are found."""
        content = "Email: test@example.com and another@test.org"
        passed, error = run_assertion_has_pattern(content, [r"\w+@\w+\.\w+"], minimum_count=2)
        assert passed is True
        assert error is None

    def test_has_pattern_insufficient_matches(self):
        """Test has_pattern when not enough matches."""
        content = "Only one match here: test@example.com"
        passed, error = run_assertion_has_pattern(content, [r"\w+@\w+\.\w+"], minimum_count=2)
        assert passed is False
        assert "Expected at least 2" in error

    def test_has_pattern_multiple_patterns(self):
        """Test has_pattern with multiple patterns."""
        content = "(Source: OWASP) and Verify: this claim"
        passed, _ = run_assertion_has_pattern(content, [r"\(Source:", r"Verify:"], minimum_count=2)
        assert passed is True


class TestAssertionNoProhibited:
    """Tests for 'no_prohibited' assertion."""

    def test_no_prohibited_clean(self):
        """Test no_prohibited when no patterns are found."""
        content = "This is clean content with no issues."
        passed, error = run_assertion_no_prohibited(content, [r"password=", r"api_key=", r"secret="])
        assert passed is True
        assert error is None

    def test_no_prohibited_found(self):
        """Test no_prohibited when prohibited patterns are found."""
        content = "Config: api_key=12345 and password=secret"
        passed, error = run_assertion_no_prohibited(content, [r"password=", r"api_key="])
        assert passed is False
        assert "prohibited patterns" in error
        assert "api_key=" in error


class TestRunAssertion:
    """Tests for the main run_assertion function."""

    def test_run_assertion_contains(self):
        """Test run_assertion dispatches to contains."""
        assertion = {"type": "contains", "pattern": "test"}
        passed, _ = run_assertion(assertion, "this is a test")
        assert passed is True

    def test_run_assertion_not_contains(self):
        """Test run_assertion dispatches to not_contains."""
        assertion = {"type": "not_contains", "pattern": "forbidden"}
        passed, _ = run_assertion(assertion, "clean content")
        assert passed is True

    def test_run_assertion_unknown_type(self):
        """Test run_assertion with unknown assertion type."""
        assertion = {"type": "unknown_type"}
        passed, error = run_assertion(assertion, "content")
        assert passed is False
        assert "Unknown assertion type" in error

    def test_run_assertion_readability_max_passes(self):
        """Test run_assertion with readability_max check that passes."""
        # Simple content should have low grade level (easy to read)
        assertion = {"type": "readability_max", "max_grade": 12}
        passed, error = run_assertion(assertion, "The cat sat on the mat. It was a nice day.")
        assert passed is True
        assert error is None

    def test_run_assertion_readability_max_fails(self):
        """Test run_assertion with readability_max check that fails."""
        # Complex content with long words and sentences
        assertion = {"type": "readability_max", "max_grade": 1}
        complex_text = """
        The implementation of sophisticated algorithmic methodologies necessitates
        comprehensive understanding of computational complexity theory and its
        multifaceted implications for software architecture optimization.
        """
        passed, error = run_assertion(assertion, complex_text)
        assert passed is False
        assert "exceeds maximum" in error


class TestRunTestCase:
    """Tests for running individual test cases."""

    def test_run_test_case_passing(self):
        """Test running a test case that passes."""
        test_case = {
            "id": "test-1",
            "name": "Test 1",
            "input": {"type": "literal", "content": "Hello world"},
            "assertions": [{"type": "contains", "pattern": "Hello"}],
        }

        result = run_test_case(test_case)
        assert result.passed is True
        assert result.test_id == "test-1"
        assert len(result.errors) == 0

    def test_run_test_case_failing(self):
        """Test running a test case that fails."""
        test_case = {
            "id": "test-2",
            "name": "Test 2",
            "input": {"type": "literal", "content": "Hello world"},
            "assertions": [{"type": "contains", "pattern": "Goodbye"}],
        }

        result = run_test_case(test_case)
        assert result.passed is False
        assert len(result.errors) == 1
        assert "Expected pattern" in result.errors[0]

    def test_run_test_case_multiple_assertions(self):
        """Test running a test case with multiple assertions."""
        test_case = {
            "id": "test-3",
            "name": "Test 3",
            "input": {"type": "literal", "content": "Hello world"},
            "assertions": [
                {"type": "contains", "pattern": "Hello"},
                {"type": "contains", "pattern": "world"},
                {"type": "not_contains", "pattern": "Goodbye"},
            ],
        }

        result = run_test_case(test_case)
        assert result.passed is True
        assert len(result.errors) == 0

    def test_run_test_case_file_path_valid(self, tmp_path):
        """Test file_path input type with valid file."""
        # Create test file
        test_content = "Hello from file"
        input_file = tmp_path / "input.txt"
        input_file.write_text(test_content)

        # Create test-cases.yml in same directory
        test_file = tmp_path / "test-cases.yml"

        test_case = {
            "id": "test-4",
            "name": "Test 4",
            "input": {"type": "file_path", "path": "input.txt"},
            "assertions": [{"type": "contains", "pattern": "Hello"}],
        }

        result = run_test_case(test_case, test_file_path=test_file)
        assert result.passed is True
        assert len(result.errors) == 0

    def test_run_test_case_file_path_missing_file(self, tmp_path):
        """Test file_path input type with missing file."""
        test_file = tmp_path / "test-cases.yml"

        test_case = {
            "id": "test-5",
            "name": "Test 5",
            "input": {"type": "file_path", "path": "nonexistent.txt"},
            "assertions": [],
        }

        result = run_test_case(test_case, test_file_path=test_file)
        assert result.passed is False
        assert "not found" in result.errors[0]

    def test_run_test_case_file_path_no_path_field(self, tmp_path):
        """Test file_path input type without path field."""
        test_file = tmp_path / "test-cases.yml"

        test_case = {
            "id": "test-6",
            "name": "Test 6",
            "input": {"type": "file_path"},
            "assertions": [],
        }

        result = run_test_case(test_case, test_file_path=test_file)
        assert result.passed is False
        assert "requires 'path' field" in result.errors[0]

    def test_run_test_case_file_path_relative_resolution(self, tmp_path):
        """Test file_path resolves relative to test-cases.yml."""
        # Create nested structure
        test_dir = tmp_path / "tests"
        fixtures_dir = test_dir / "fixtures"
        fixtures_dir.mkdir(parents=True)

        # Create fixture file
        fixture_file = fixtures_dir / "data.txt"
        fixture_file.write_text("Fixture content")

        # Create test-cases.yml
        test_file = test_dir / "test-cases.yml"

        test_case = {
            "id": "test-7",
            "name": "Test 7",
            "input": {"type": "file_path", "path": "fixtures/data.txt"},
            "assertions": [{"type": "contains", "pattern": "Fixture"}],
        }

        result = run_test_case(test_case, test_file_path=test_file)
        assert result.passed is True
        assert len(result.errors) == 0


class TestRunTestSuite:
    """Tests for running complete test suites."""

    def test_run_test_suite_all_passing(self, tmp_path):
        """Test running a suite where all tests pass."""
        test_file = tmp_path / "test-cases.yml"
        test_file.write_text(
            """
suite:
  pattern_id: test-pattern
  pattern_version: "1.0.0"
  description: "Test suite"

test_cases:
  - id: test-1
    name: "Test 1"
    input:
      type: literal
      content: "Hello world"
    assertions:
      - type: contains
        pattern: "Hello"
  
  - id: test-2
    name: "Test 2"
    input:
      type: literal
      content: "Goodbye world"
    assertions:
      - type: contains
        pattern: "Goodbye"
"""
        )

        result = run_test_suite(test_file, verbose=False)
        assert result.pattern_id == "test-pattern"
        assert result.total == 2
        assert result.passed == 2
        assert result.failed == 0

    def test_run_test_suite_mixed_results(self, tmp_path):
        """Test running a suite with mixed pass/fail."""
        test_file = tmp_path / "test-cases.yml"
        test_file.write_text(
            """
suite:
  pattern_id: test-pattern
  pattern_version: "1.0.0"
  description: "Test suite"

test_cases:
  - id: test-pass
    name: "Passing test"
    input:
      type: literal
      content: "Hello world"
    assertions:
      - type: contains
        pattern: "Hello"
  
  - id: test-fail
    name: "Failing test"
    input:
      type: literal
      content: "Hello world"
    assertions:
      - type: contains
        pattern: "Nonexistent"
"""
        )

        result = run_test_suite(test_file, verbose=False)
        assert result.total == 2
        assert result.passed == 1
        assert result.failed == 1

    def test_run_test_suite_invalid_file(self, tmp_path):
        """Test running a suite with invalid YAML."""
        test_file = tmp_path / "test-cases.yml"
        test_file.write_text("invalid: yaml: [")

        result = run_test_suite(test_file, verbose=False)
        assert result.pattern_id == "unknown"
        assert result.failed == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
