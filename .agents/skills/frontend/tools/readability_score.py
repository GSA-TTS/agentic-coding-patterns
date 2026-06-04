#!/usr/bin/env python3
"""Minimal readability scoring tool for federal plain language compliance.

Extracted from cloud-gov/style-management-service (CC0 public domain).
Provides Flesch-Kincaid Grade Level and Reading Ease scoring with
federal plain language thresholds.

Dependencies: textstat (pip install textstat)

Usage:
    python3 readability_score.py content.md
    python3 readability_score.py --json content.md
    python3 readability_score.py --threshold 8 content.md
    cat content.md | python3 readability_score.py -

Federal Plain Language Targets:
    - Flesch-Kincaid Grade: ≤8 (8th grade reading level)
    - Flesch Reading Ease: ≥60 (higher = easier)
    - Average Sentence Length: 15-20 words
    - Passive Voice: <10%
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Required dependency
try:
    import textstat
except ImportError:
    sys.stderr.write(
        "Error: textstat is not installed.\n"
        "Install with: pip install textstat\n"
    )
    sys.exit(1)

# ---------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------

FEDERAL_THRESHOLDS = {
    "max_grade": 8,      # PlainLanguage.gov target
    "min_ease": 60,      # Higher = more readable
    "max_sentence_avg": 20,
    "max_passive_pct": 10,
}

# Patterns for markdown stripping
YAML_FRONT_MATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL | re.MULTILINE)
CODE_FENCE_RE = re.compile(r"```.*?\n.*?\n```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`]+`")
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
TABLE_ROW_RE = re.compile(r"^\s*\|.+\|\s*$", re.MULTILINE)

# Passive voice detection (simplified)
PASSIVE_RE = re.compile(
    r"\b(is|are|was|were|be|been|being|am)\s+\w*ed\b", re.IGNORECASE
)

# ---------------------------------------------------------------------
# Text Processing
# ---------------------------------------------------------------------


def strip_markdown(text: str) -> str:
    """Remove markdown formatting for readability analysis.
    
    Strips YAML front matter, code blocks, inline code, HTML comments,
    images, links (keeping text), headings, emphasis, and tables.
    """
    text = re.sub(YAML_FRONT_MATTER_RE, "", text)
    text = re.sub(HTML_COMMENT_RE, "", text)
    text = re.sub(CODE_FENCE_RE, "", text)
    text = re.sub(INLINE_CODE_RE, "", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)  # keep alt text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)   # keep link text
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_]{1,3}", "", text)
    text = re.sub(r">+\s?", "", text)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(TABLE_ROW_RE, "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------


def score_text(text: str) -> dict[str, Any]:
    """Compute readability metrics for text.
    
    Returns:
        Dictionary with metrics:
        - fk_grade: Flesch-Kincaid Grade Level
        - reading_ease: Flesch Reading Ease (0-100, higher=easier)
        - sentences: Total sentence count
        - words: Total word count
        - avg_sentence_len: Average words per sentence
        - passive_pct: Estimated passive voice percentage
    """
    sentence_count = max(int(textstat.sentence_count(text)), 1)
    word_count = int(textstat.lexicon_count(text, removepunct=True))
    
    # Passive voice estimation
    sentences = text.replace("?", ".").replace("!", ".").split(".")
    passive_count = sum(1 for s in sentences if PASSIVE_RE.search(s))
    passive_pct = round((passive_count / max(len(sentences), 1)) * 100, 1)
    
    return {
        "fk_grade": round(float(textstat.flesch_kincaid_grade(text)), 1),
        "reading_ease": round(float(textstat.flesch_reading_ease(text)), 1),
        "sentences": sentence_count,
        "words": word_count,
        "avg_sentence_len": round(word_count / sentence_count, 1),
        "passive_pct": passive_pct,
    }


def check_thresholds(
    metrics: dict[str, Any],
    max_grade: float = FEDERAL_THRESHOLDS["max_grade"],
    min_ease: float = FEDERAL_THRESHOLDS["min_ease"],
) -> dict[str, Any]:
    """Check metrics against federal plain language thresholds.
    
    Returns:
        Dictionary with pass/fail status and details.
    """
    issues = []
    
    if metrics["fk_grade"] > max_grade:
        issues.append(
            f"Grade level {metrics['fk_grade']} exceeds {max_grade} target"
        )
    
    if metrics["reading_ease"] < min_ease:
        issues.append(
            f"Reading ease {metrics['reading_ease']} below {min_ease} target"
        )
    
    if metrics["avg_sentence_len"] > FEDERAL_THRESHOLDS["max_sentence_avg"]:
        issues.append(
            f"Avg sentence length {metrics['avg_sentence_len']} exceeds 20 words"
        )
    
    if metrics["passive_pct"] > FEDERAL_THRESHOLDS["max_passive_pct"]:
        issues.append(
            f"Passive voice {metrics['passive_pct']}% exceeds 10% target"
        )
    
    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "thresholds": {
            "max_grade": max_grade,
            "min_ease": min_ease,
            "max_sentence_avg": FEDERAL_THRESHOLDS["max_sentence_avg"],
            "max_passive_pct": FEDERAL_THRESHOLDS["max_passive_pct"],
        }
    }


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check readability against federal plain language standards"
    )
    parser.add_argument(
        "file",
        help="Markdown file to analyze (use '-' for stdin)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=FEDERAL_THRESHOLDS["max_grade"],
        help=f"Max grade level (default: {FEDERAL_THRESHOLDS['max_grade']})"
    )
    parser.add_argument(
        "--min-ease",
        type=float,
        default=FEDERAL_THRESHOLDS["min_ease"],
        help=f"Min reading ease (default: {FEDERAL_THRESHOLDS['min_ease']})"
    )
    
    args = parser.parse_args()
    
    # Read input
    if args.file == "-":
        text = sys.stdin.read()
    else:
        path = Path(args.file)
        if not path.exists():
            sys.stderr.write(f"Error: File not found: {args.file}\n")
            return 1
        text = path.read_text(encoding="utf-8")
    
    # Process
    clean_text = strip_markdown(text)
    if len(clean_text.split()) < 10:
        sys.stderr.write("Warning: Very short text may produce unreliable scores\n")
    
    metrics = score_text(clean_text)
    result = check_thresholds(metrics, args.threshold, args.min_ease)
    
    # Output
    if args.json:
        output = {
            "file": args.file,
            "metrics": metrics,
            "evaluation": result,
        }
        print(json.dumps(output, indent=2))
    else:
        print(f"Readability Analysis: {args.file}")
        print("-" * 50)
        print(f"  Flesch-Kincaid Grade: {metrics['fk_grade']}")
        print(f"  Flesch Reading Ease:  {metrics['reading_ease']}")
        print(f"  Sentences:            {metrics['sentences']}")
        print(f"  Words:                {metrics['words']}")
        print(f"  Avg Sentence Length:  {metrics['avg_sentence_len']}")
        print(f"  Passive Voice:        {metrics['passive_pct']}%")
        print("-" * 50)
        
        if result["passed"]:
            print("✓ PASSED: Meets federal plain language targets")
        else:
            print("✗ FAILED: Does not meet targets")
            for issue in result["issues"]:
                print(f"  - {issue}")
    
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())
