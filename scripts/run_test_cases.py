#!/usr/bin/env python3
"""
Test runner for pattern test-cases.yml files.

Discovers and runs test cases defined in patterns to validate
that skills, prompts, and workflows produce expected output.

Usage:
    python scripts/run_test_cases.py [--root PATH] [--verbose] [--pattern PATTERN_ID]
"""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class TestResult:
    """Result of a single test case execution."""

    test_id: str
    name: str
    passed: bool
    errors: list[str]


@dataclass
class SuiteResult:
    """Result of a test suite execution."""

    pattern_id: str
    file_path: Path
    total: int
    passed: int
    failed: int
    test_results: list[TestResult]


def load_test_cases(file_path: Path) -> dict[str, Any] | None:
    """Load and parse a test-cases.yml file."""
    try:
        with open(file_path) as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        print(f"ERROR: Invalid YAML in {file_path}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR: Failed to read {file_path}: {e}", file=sys.stderr)
        return None


def find_test_case_files(root: Path, pattern_id: str | None = None) -> list[Path]:
    """Find all test-cases.yml files in the repository."""
    files = list(root.glob("**/tests/test-cases.yml"))

    if pattern_id:
        # Filter to specific pattern
        filtered = []
        for file_path in files:
            test_data = load_test_cases(file_path)
            if test_data and test_data.get("suite", {}).get("pattern_id") == pattern_id:
                filtered.append(file_path)
        return filtered

    return sorted(files)


def run_assertion_contains(
    output: str, pattern: str, min_count: int = 1, case_sensitive: bool = True
) -> tuple[bool, str | None]:
    """
    Run 'contains' assertion.

    Args:
        output: The output text to check
        pattern: The pattern to search for
        min_count: Minimum number of occurrences required
        case_sensitive: Whether to do case-sensitive matching

    Returns:
        (passed, error_message)
    """
    search_output = output if case_sensitive else output.lower()
    search_pattern = pattern if case_sensitive else pattern.lower()

    count = search_output.count(search_pattern)

    if count >= min_count:
        return True, None

    return (
        False,
        f"Expected pattern '{pattern}' at least {min_count} time(s), found {count}",
    )


def run_assertion_not_contains(
    output: str, pattern: str, case_sensitive: bool = True
) -> tuple[bool, str | None]:
    """
    Run 'not_contains' assertion.

    Args:
        output: The output text to check
        pattern: The pattern that should not be present
        case_sensitive: Whether to do case-sensitive matching

    Returns:
        (passed, error_message)
    """
    search_output = output if case_sensitive else output.lower()
    search_pattern = pattern if case_sensitive else pattern.lower()

    if search_pattern not in search_output:
        return True, None

    return False, f"Pattern '{pattern}' should not be present but was found"


def run_assertion_has_sections(output: str, sections: list[str]) -> tuple[bool, str | None]:
    """
    Run 'has_sections' assertion.

    Checks that output contains the required markdown sections (headings).

    Args:
        output: The output text to check
        sections: List of required section headings

    Returns:
        (passed, error_message)
    """
    missing_sections = []
    for section in sections:
        # Check for markdown heading patterns: # Section, ## Section, etc.
        pattern = rf"^#+\s+{re.escape(section)}\s*$"
        if not re.search(pattern, output, re.MULTILINE):
            missing_sections.append(section)

    if not missing_sections:
        return True, None

    return False, f"Missing required sections: {', '.join(missing_sections)}"


def run_assertion_has_pattern(
    output: str, patterns: list[str], minimum_count: int = 1
) -> tuple[bool, str | None]:
    """
    Run 'has_pattern' assertion.

    Checks that output matches regex patterns.

    Args:
        output: The output text to check
        patterns: List of regex patterns
        minimum_count: Minimum total matches across all patterns

    Returns:
        (passed, error_message)
    """
    total_matches = 0
    for pattern in patterns:
        matches = len(re.findall(pattern, output))
        total_matches += matches

    if total_matches >= minimum_count:
        return True, None

    return (
        False,
        f"Expected at least {minimum_count} pattern match(es), found {total_matches}",
    )


def run_assertion_no_prohibited(output: str, patterns: list[str]) -> tuple[bool, str | None]:
    """
    Run 'no_prohibited' assertion.

    Checks that output does not contain prohibited patterns.

    Args:
        output: The output text to check
        patterns: List of prohibited patterns

    Returns:
        (passed, error_message)
    """
    found_patterns = []
    for pattern in patterns:
        if re.search(pattern, output):
            found_patterns.append(pattern)

    if not found_patterns:
        return True, None

    return False, f"Found prohibited patterns: {', '.join(found_patterns)}"


def run_assertion(assertion: dict[str, Any], output: str) -> tuple[bool, str | None]:
    """
    Run a single assertion against output.

    Args:
        assertion: Assertion configuration dict
        output: The output text to validate

    Returns:
        (passed, error_message)
    """
    assertion_type = assertion.get("type")

    if assertion_type == "contains":
        return run_assertion_contains(
            output,
            assertion["pattern"],
            assertion.get("min_count", 1),
            assertion.get("case_sensitive", True),
        )

    elif assertion_type == "not_contains":
        return run_assertion_not_contains(
            output, assertion["pattern"], assertion.get("case_sensitive", True)
        )

    elif assertion_type == "has_sections":
        return run_assertion_has_sections(output, assertion["sections"])

    elif assertion_type == "has_pattern":
        return run_assertion_has_pattern(
            output, assertion["patterns"], assertion.get("minimum_count", 1)
        )

    elif assertion_type == "no_prohibited":
        return run_assertion_no_prohibited(output, assertion["patterns"])

    elif assertion_type == "readability_max":
        # TODO: Implement readability checking (requires textstat library)
        return False, f"Assertion type '{assertion_type}' not yet implemented"

    else:
        return False, f"Unknown assertion type: {assertion_type}"


def run_test_case(test_case: dict[str, Any]) -> TestResult:
    """
    Run a single test case.

    Args:
        test_case: Test case configuration dict

    Returns:
        TestResult with pass/fail status and errors
    """
    test_id = test_case.get("id", "unknown")
    name = test_case.get("name", "Unnamed test")
    errors: list[str] = []

    # Get input
    input_config = test_case.get("input", {})
    input_type = input_config.get("type")

    if input_type == "literal":
        output = input_config.get("content", "")
    elif input_type == "file_path":
        # TODO: Implement file path input loading
        errors.append("Input type 'file_path' not yet implemented")
        return TestResult(test_id=test_id, name=name, passed=False, errors=errors)
    else:
        errors.append(f"Unknown input type: {input_type}")
        return TestResult(test_id=test_id, name=name, passed=False, errors=errors)

    # Run assertions
    assertions = test_case.get("assertions", [])
    for idx, assertion in enumerate(assertions):
        passed, error = run_assertion(assertion, output)
        if not passed:
            errors.append(f"Assertion {idx + 1}: {error}")

    return TestResult(
        test_id=test_id, name=name, passed=len(errors) == 0, errors=errors
    )


def run_test_suite(file_path: Path, verbose: bool = False) -> SuiteResult:
    """
    Run all test cases in a test suite file.

    Args:
        file_path: Path to test-cases.yml file
        verbose: Whether to print verbose output

    Returns:
        SuiteResult with aggregated test results
    """
    test_data = load_test_cases(file_path)
    if not test_data:
        return SuiteResult(
            pattern_id="unknown",
            file_path=file_path,
            total=0,
            passed=0,
            failed=1,
            test_results=[],
        )

    # Extract suite info
    suite = test_data.get("suite", {})
    pattern_id = suite.get("pattern_id", "unknown")

    # Run test cases
    test_cases = test_data.get("test_cases", [])
    results: list[TestResult] = []

    if verbose:
        print(f"\n{'='*70}")
        print(f"Running test suite: {pattern_id}")
        print(f"File: {file_path}")
        print(f"{'='*70}")

    for test_case in test_cases:
        result = run_test_case(test_case)
        results.append(result)

        if verbose:
            status = "✓ PASS" if result.passed else "✗ FAIL"
            print(f"\n{status}: {result.name} ({result.test_id})")
            if result.errors:
                for error in result.errors:
                    print(f"  ERROR: {error}")

    # Aggregate results
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)

    return SuiteResult(
        pattern_id=pattern_id,
        file_path=file_path,
        total=len(results),
        passed=passed,
        failed=failed,
        test_results=results,
    )


def print_summary(suite_results: list[SuiteResult]) -> None:
    """Print test execution summary."""
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    total_suites = len(suite_results)
    total_tests = sum(r.total for r in suite_results)
    total_passed = sum(r.passed for r in suite_results)
    total_failed = sum(r.failed for r in suite_results)

    for result in suite_results:
        status = "✓" if result.failed == 0 else "✗"
        print(
            f"{status} {result.pattern_id}: {result.passed}/{result.total} passed"
        )

    print("-" * 70)
    print(f"Suites:  {total_suites}")
    print(f"Tests:   {total_tests}")
    print(f"Passed:  {total_passed}")
    print(f"Failed:  {total_failed}")
    print("=" * 70)


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Run test cases for patterns",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Repository root (default: current directory)",
    )
    parser.add_argument(
        "--pattern",
        type=str,
        help="Run tests for specific pattern ID only",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose output with per-test details",
    )
    args = parser.parse_args()

    # Find test case files
    test_files = find_test_case_files(args.root, args.pattern)

    if not test_files:
        if args.pattern:
            print(
                f"No test-cases.yml files found for pattern: {args.pattern}",
                file=sys.stderr,
            )
        else:
            print("No test-cases.yml files found in repository", file=sys.stderr)
        return 1

    # Run test suites
    suite_results: list[SuiteResult] = []
    for test_file in test_files:
        result = run_test_suite(test_file, verbose=args.verbose)
        suite_results.append(result)

    # Print summary
    print_summary(suite_results)

    # Return exit code
    total_failed = sum(r.failed for r in suite_results)
    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
