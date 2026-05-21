#!/usr/bin/env python3
"""
Scan for sensitive terms that should not be in public repositories.

This is a lightweight hygiene check, NOT a real secret scanner.
Use dedicated tools (gitleaks, truffleHog) for production secret scanning.

Usage:
    python scripts/validate_sensitive_terms.py [--root PATH]
"""

import argparse
import re
import sys
from pathlib import Path

# Patterns to flag (NOT comprehensive - use real scanners for production)
SENSITIVE_PATTERNS = [
    # Keys and credentials
    (r"BEGIN.*PRIVATE KEY", "Private key detected"),
    (r"AWS_SECRET_ACCESS_KEY", "AWS secret key"),
    (r"AWS_ACCESS_KEY_ID", "AWS access key"),
    (r"(?:password|passwd|pwd)\s*=\s*['\"]?[^'\"\\s]{8,}", "Hardcoded password"),
    (r"(?:api_key|apikey)\s*=\s*['\"]?[^'\"\\s]{16,}", "API key"),
    (r"(?:token|auth_token)\s*=\s*['\"]?[^'\"\\s]{16,}", "Auth token"),
    (r"secret\s*=\s*['\"]?[^'\"\\s]{16,}", "Secret value"),
    # Sensitive content markers (detected in scan_file with context checking)
    (r"\.gov\s+internal-only", "Internal-only government content"),
    (r"\bCUI\b", "Controlled Unclassified Information marker"),
    (r"\bPII\b", "Personally Identifiable Information marker"),
    (r"customer\s+data", "Customer data reference"),
    (r"do\s+not\s+distribute", "Distribution restriction marker"),
]

# File extensions to scan
SCANNABLE_EXTENSIONS = {".md", ".py", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".txt", ".sh"}

# Paths to skip
SKIP_PATHS = {
    ".git",
    "__pycache__",
    "venv",
    "env",
    ".venv",
    "node_modules",
    "tests",
    "docs",
    ".github",
}


def should_scan_file(path: Path) -> bool:
    """Check if file should be scanned."""
    if path.suffix not in SCANNABLE_EXTENSIONS:
        return False

    return all(skip not in path.parts for skip in SKIP_PATHS)


def is_safe_context(line: str) -> bool:
    """Check if line is in a safe context (documentation, frontmatter, negative examples)."""
    line_lower = line.lower().strip()

    # YAML frontmatter arrays (prohibited_content lists)
    if "prohibited_content" in line_lower:
        return True

    # Quoted lists in YAML arrays (e.g., - "Real PII")
    if re.match(r'^\s*-\s*["\'].*["\']', line):
        return True

    # Negative documentation patterns (what NOT to include)
    safe_patterns = [
        r"^\s*\d+\.\s+no ",  # Numbered lists: "4. No secrets, PII, or CUI"
        r"^no ",  # Direct negation
        r"^❌ ",  # Prohibited marker
        r"^\s*-\s*❌",  # Bullet with prohibited marker
        r"do not include",  # Instruction to avoid
        r"never include",  # Strong negation
        r"never allow",  # Strong prohibition
        r"prohibited",  # Prohibited content lists
        r"^\|\s*\w+",  # Markdown table cells (all table rows)
        r"minimum prohibited content",  # Documentation of prohibited items
        r"^\s*-\s*\[ \]",  # Checklist items
        r"^\s*-\s+(customer data|cui,|pii,)",  # Bullet lists of prohibited items
        r"\(r\".*\"",  # Regex pattern definitions (code)
        r"^\s*(#|if|r\")",  # Python comments, conditionals, raw strings (code)
        r"actual user data",  # Documentation about what not to use
        r"data breach.*exposure",  # Security incident examples
        r"(personally identifiable information)",  # Full phrase explanation
    ]

    return any(re.search(pattern, line_lower) for pattern in safe_patterns)


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    """Scan file for sensitive patterns. Returns list of (line_num, pattern_desc, line_content)."""
    matches = []

    try:
        content = path.read_text()
    except Exception:
        return matches

    for line_num, line in enumerate(content.splitlines(), start=1):
        # Skip lines in safe contexts
        if is_safe_context(line):
            continue

        for pattern, description in SENSITIVE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                matches.append((line_num, description, line.strip()))

    return matches


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan for sensitive terms")
    parser.add_argument(
        "--root", type=Path, default=Path.cwd(), help="Repository root (default: current directory)"
    )
    args = parser.parse_args()

    root = args.root
    total_issues = 0

    # Scan all files
    for path in root.rglob("*"):
        if not path.is_file() or not should_scan_file(path):
            continue

        matches = scan_file(path)
        if matches:
            rel_path = path.relative_to(root)
            print(f"\n✗ {rel_path}")
            for line_num, description, line_content in matches:
                print(f"  Line {line_num}: {description}")
                print(f"    {line_content[:100]}")
                total_issues += 1

    # Summary
    if total_issues == 0:
        print("✓ No sensitive terms detected")
        return 0
    else:
        print(f"\n{total_issues} potential issue(s) found")
        print("\nNOTE: This is a lightweight hygiene check.")
        print("Use gitleaks or truffleHog for production secret scanning.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
