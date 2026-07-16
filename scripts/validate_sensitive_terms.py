#!/usr/bin/env python3
"""
Scan for sensitive terms that should not be in public repositories.

This is a lightweight hygiene check, NOT a real secret scanner.
Use dedicated tools (gitleaks, truffleHog) for production secret scanning.

Two-tier validation:
- Tier 1 (BLOCKING): High-confidence secrets (API keys, credentials, private keys)
- Tier 2 (WARNING): Documentation terms (CUI, PII, customer data) that may appear
  legitimately in security documentation but warrant human review

Usage:
    python scripts/validate_sensitive_terms.py [--root PATH] [--strict]
"""

import argparse
import re
import sys
from pathlib import Path

# Tier 1: High-confidence secrets - these BLOCK commits
TIER1_PATTERNS = [
    (r"BEGIN.*PRIVATE KEY", "Private key detected"),
    (r"AWS_SECRET_ACCESS_KEY", "AWS secret key"),
    (r"AWS_ACCESS_KEY_ID", "AWS access key"),
    # Assignment patterns. The negative lookahead skips values that are ONLY a
    # shell command substitution ($(...), `...`) or variable reference
    # (${VAR}, $VAR) — those read a secret at runtime, they don't hardcode one,
    # and flagging them produces false positives on legitimate scripts. The
    # lookahead matches the specific var-ref / cmd-sub SHAPES:
    #   ${...  |  $(...  |  $<letter|underscore>...  |  `...
    # NOT merely a leading $/backtick. A literal secret that happens to start
    # with $ followed by a digit (e.g. password="$3cr3tLiteral") is a valid
    # shell literal (not a var ref) and is STILL flagged.
    (r"(?:password|passwd|pwd)\s*=\s*['\"]?(?!\$\{|\$\(|\$[A-Za-z_]|`)[^'\"\\s]{8,}", "Hardcoded password"),
    (r"(?:api_key|apikey)\s*=\s*['\"]?(?!\$\{|\$\(|\$[A-Za-z_]|`)[^'\"\\s]{16,}", "API key"),
    (r"(?:token|auth_token)\s*=\s*['\"]?(?!\$\{|\$\(|\$[A-Za-z_]|`)[^'\"\\s]{16,}", "Auth token"),
    (r"secret\s*=\s*['\"]?(?!\$\{|\$\(|\$[A-Za-z_]|`)[^'\"\\s]{16,}", "Secret value"),
    (r"\.gov\s+internal-only", "Internal-only government content"),
    (r"do\s+not\s+distribute", "Distribution restriction marker"),
]

# Tier 2: Documentation terms - these WARN but don't block (unless --strict)
# These terms commonly appear in security documentation explaining what NOT to include
TIER2_PATTERNS = [
    (r"\bCUI\b", "Controlled Unclassified Information marker"),
    (r"\bPII\b", "Personally Identifiable Information marker"),
    (r"customer\s+data", "Customer data reference"),
]

# Legacy combined list for backward compatibility
SENSITIVE_PATTERNS = TIER1_PATTERNS + TIER2_PATTERNS

# File extensions to scan
SCANNABLE_EXTENSIONS = {".md", ".py", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".txt", ".sh"}

# Paths to skip entirely
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
    "scripts",  # Validation scripts reference terms they detect
}

# Files where Tier 2 terms are ALWAYS safe (security policy documentation)
# These files exist to document what sensitive content looks like
TIER2_ALLOWLIST_FILES = {
    "SECURITY.md",
    "AGENTS.md",
}

# Paths where Tier 2 terms are ALWAYS safe (security-focused directories)
TIER2_ALLOWLIST_PATHS = {
    "security",
    "compliance",
    "policies",
}


def should_scan_file(path: Path) -> bool:
    """Check if file should be scanned."""
    if path.suffix not in SCANNABLE_EXTENSIONS:
        return False

    return all(skip not in path.parts for skip in SKIP_PATHS)


def is_tier2_allowlisted(path: Path) -> bool:
    """Check if file is allowlisted for Tier 2 terms (security documentation)."""
    # Check filename
    if path.name in TIER2_ALLOWLIST_FILES:
        return True

    # Check path components
    return any(allowlist_path in path.parts for allowlist_path in TIER2_ALLOWLIST_PATHS)


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
        r"^\s*-\s+no\s+",  # Bullet lists starting with "No"
        r"must\s+not\s+(include|contain)",  # Prohibition instructions
        r"(avoid|prevent).*sensitive",  # Avoidance guidance
    ]

    return any(re.search(pattern, line_lower) for pattern in safe_patterns)


def scan_file(path: Path, strict: bool = False) -> tuple[list[tuple[int, str, str]], list[tuple[int, str, str]]]:
    """
    Scan file for sensitive patterns.

    Returns:
        tuple of (tier1_matches, tier2_matches)
        Each is a list of (line_num, pattern_desc, line_content)
    """
    tier1_matches = []
    tier2_matches = []

    try:
        content = path.read_text()
    except Exception:
        return tier1_matches, tier2_matches

    is_allowlisted = is_tier2_allowlisted(path)

    for line_num, line in enumerate(content.splitlines(), start=1):
        # Skip lines in safe contexts
        if is_safe_context(line):
            continue

        # Check Tier 1 patterns (always blocking)
        for pattern, description in TIER1_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                tier1_matches.append((line_num, description, line.strip()))

        # Check Tier 2 patterns (warning unless strict mode or not allowlisted)
        if not is_allowlisted or strict:
            for pattern, description in TIER2_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    tier2_matches.append((line_num, description, line.strip()))

    return tier1_matches, tier2_matches


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan for sensitive terms")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Repository root (default: current directory)")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Strict mode: treat Tier 2 warnings as errors (even in allowlisted files)",
    )
    args = parser.parse_args()

    root = args.root
    tier1_total = 0
    tier2_total = 0

    # Scan all files
    for path in root.rglob("*"):
        if not path.is_file() or not should_scan_file(path):
            continue

        tier1_matches, tier2_matches = scan_file(path, strict=args.strict)
        rel_path = path.relative_to(root)

        # Report Tier 1 errors (blocking)
        if tier1_matches:
            print(f"\n✗ {rel_path} (ERRORS - blocking)")
            for line_num, description, line_content in tier1_matches:
                print(f"  Line {line_num}: {description}")
                print(f"    {line_content[:100]}")
                tier1_total += 1

        # Report Tier 2 warnings (non-blocking unless --strict)
        if tier2_matches:
            marker = "ERRORS" if args.strict else "warnings"
            print(f"\n⚠ {rel_path} ({marker} - review recommended)")
            for line_num, description, line_content in tier2_matches:
                print(f"  Line {line_num}: {description}")
                print(f"    {line_content[:100]}")
                tier2_total += 1

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    if tier1_total == 0 and tier2_total == 0:
        print("✓ No sensitive terms detected")
        return 0

    if tier1_total > 0:
        print(f"✗ {tier1_total} Tier 1 error(s) - BLOCKING (secrets/credentials)")

    if tier2_total > 0:
        if args.strict:
            print(f"✗ {tier2_total} Tier 2 error(s) - BLOCKING (--strict mode)")
        else:
            print(f"⚠ {tier2_total} Tier 2 warning(s) - review recommended (CUI/PII/data terms)")
            print("  These may be legitimate in security documentation.")
            print("  Use --strict to treat as errors, or verify they're safe.")

    print("\nNOTE: This is a lightweight hygiene check.")
    print("Use gitleaks or truffleHog for production secret scanning.")

    # Exit code: fail only on Tier 1 errors (or Tier 2 in strict mode)
    if tier1_total > 0:
        return 1
    if args.strict and tier2_total > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
