"""Tests for search_patterns.py"""

import json

import pytest
import yaml

from scripts.search_patterns import (
    format_pattern_human,
    format_pattern_json,
    load_index,
    load_pattern_details,
    matches_filters,
    search_patterns,
)


@pytest.fixture
def temp_repo(tmp_path):
    """Create temporary repository with INDEX.yaml and patterns."""
    # Create INDEX.yaml
    index_data = {
        "schema_version": "1.0",
        "repo": "test/repo",
        "description": "Test patterns",
        "patterns": {
            "skills": [
                {
                    "path": "skills/test-skill/SKILL.md",
                    "id": "test-skill",
                    "title": "Test Skill",
                    "type": "skill",
                    "status": "experimental",
                }
            ],
            "prompts": [],
            "agents": [],
            "workflows": [],
            "lessons": [],
        },
    }
    (tmp_path / "INDEX.yaml").write_text(yaml.dump(index_data))

    # Create pattern file with full frontmatter
    skill_dir = tmp_path / "skills" / "test-skill"
    skill_dir.mkdir(parents=True)

    skill_content = """---
id: test-skill
title: Test Skill
type: skill
status: experimental
description: A test skill for unit testing
tags:
  - testing
  - example
primary_personas:
  - developers
portability:
  opencode: true
  cursor: true
  generic_llm: false
---

# Test Skill
"""
    (skill_dir / "SKILL.md").write_text(skill_content)

    return tmp_path


class TestLoadIndex:
    """Tests for load_index function."""

    def test_load_valid_index(self, temp_repo):
        """Test loading valid INDEX.yaml."""
        index = load_index(temp_repo)

        assert index["schema_version"] == "1.0"
        assert "patterns" in index
        assert len(index["patterns"]["skills"]) == 1

    def test_missing_index_exits(self, tmp_path, capsys):
        """Test that missing INDEX.yaml causes exit."""
        with pytest.raises(SystemExit) as exc_info:
            load_index(tmp_path)

        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "INDEX.yaml not found" in captured.err


class TestLoadPatternDetails:
    """Tests for load_pattern_details function."""

    def test_load_valid_pattern(self, temp_repo):
        """Test loading pattern frontmatter."""
        details = load_pattern_details(temp_repo, "skills/test-skill/SKILL.md")

        assert details["id"] == "test-skill"
        assert details["title"] == "Test Skill"
        assert "tags" in details
        assert "testing" in details["tags"]

    def test_missing_file_returns_empty(self, temp_repo):
        """Test that missing file returns empty dict."""
        details = load_pattern_details(temp_repo, "nonexistent.md")
        assert details == {}

    def test_invalid_frontmatter_returns_empty(self, tmp_path):
        """Test that invalid frontmatter returns empty dict."""
        file_path = tmp_path / "test.md"
        file_path.write_text("No frontmatter")

        details = load_pattern_details(tmp_path, "test.md")
        assert details == {}


class TestMatchesFilters:
    """Tests for matches_filters function."""

    def test_no_filters_matches_all(self):
        """Test that no filters matches everything."""
        pattern = {"status": "experimental"}
        details = {}

        result = matches_filters(pattern, details, None, None, None, None, None)
        assert result is True

    def test_status_filter(self):
        """Test filtering by status."""
        pattern = {"status": "experimental"}
        details = {}

        # Match
        assert matches_filters(pattern, details, None, "experimental", None, None, None) is True

        # No match
        assert matches_filters(pattern, details, None, "recommended", None, None, None) is False

    def test_tag_filter(self):
        """Test filtering by tag."""
        pattern = {}
        details = {"tags": ["security", "review"]}

        # Match
        assert matches_filters(pattern, details, "security", None, None, None, None) is True

        # No match
        assert matches_filters(pattern, details, "testing", None, None, None, None) is False

    def test_persona_filter(self):
        """Test filtering by persona."""
        pattern = {}
        details = {"primary_personas": ["developers", "security"]}

        # Match
        assert matches_filters(pattern, details, None, None, "developers", None, None) is True

        # No match
        assert matches_filters(pattern, details, None, None, "testers", None, None) is False

    def test_tool_filter(self):
        """Test filtering by tool portability."""
        pattern = {}
        details = {"portability": {"opencode": True, "cursor": False}}

        # Match
        assert matches_filters(pattern, details, None, None, None, "opencode", None) is True

        # No match (disabled)
        assert matches_filters(pattern, details, None, None, None, "cursor", None) is False

        # No match (not present)
        assert matches_filters(pattern, details, None, None, None, "chatgpt", None) is False

    def test_query_filter_title(self):
        """Test query filter on title."""
        pattern = {"title": "Secure Code Review"}
        details = {}

        # Match
        assert matches_filters(pattern, details, None, None, None, None, "code review") is True

        # No match
        assert matches_filters(pattern, details, None, None, None, None, "testing") is False

    def test_query_filter_description(self):
        """Test query filter on description."""
        pattern = {"title": "Test"}
        details = {"description": "Analyze dependencies for vulnerabilities"}

        # Match in description
        assert matches_filters(pattern, details, None, None, None, None, "vulnerabilities") is True

        # No match
        assert matches_filters(pattern, details, None, None, None, None, "testing") is False

    def test_combined_filters(self):
        """Test multiple filters (AND logic)."""
        pattern = {"status": "experimental"}
        details = {
            "tags": ["security"],
            "primary_personas": ["developers"],
            "portability": {"opencode": True},
        }

        # All match
        result = matches_filters(
            pattern, details, "security", "experimental", "developers", "opencode", None
        )
        assert result is True

        # One doesn't match
        result = matches_filters(
            pattern, details, "testing", "experimental", "developers", "opencode", None
        )
        assert result is False


class TestFormatPatternHuman:
    """Tests for format_pattern_human function."""

    def test_basic_formatting(self):
        """Test basic pattern formatting."""
        pattern = {
            "id": "test",
            "title": "Test Pattern",
            "type": "skill",
            "status": "experimental",
            "path": "skills/test/SKILL.md",
        }
        details = {}

        output = format_pattern_human(1, pattern, details)

        assert "[1]" in output
        assert "test" in output
        assert "Test Pattern" in output
        assert "skill" in output
        assert "EXPERIMENTAL" in output

    def test_includes_optional_fields(self):
        """Test that optional fields are included."""
        pattern = {
            "id": "test",
            "title": "Test",
            "type": "skill",
            "status": "experimental",
            "path": "test.md",
        }
        details = {
            "tags": ["security"],
            "primary_personas": ["developers"],
            "portability": {"opencode": True, "cursor": True},
            "description": "Test description",
        }

        output = format_pattern_human(1, pattern, details)

        assert "security" in output
        assert "developers" in output
        assert "opencode" in output
        assert "Test description" in output


class TestFormatPatternJson:
    """Tests for format_pattern_json function."""

    def test_basic_json_format(self):
        """Test basic JSON formatting."""
        pattern = {
            "id": "test",
            "title": "Test",
            "type": "skill",
            "status": "experimental",
            "path": "test.md",
        }
        details = {}

        result = format_pattern_json(pattern, details)

        assert result["id"] == "test"
        assert result["title"] == "Test"
        assert result["type"] == "skill"
        assert result["status"] == "experimental"
        assert result["path"] == "test.md"

    def test_includes_optional_fields(self):
        """Test that optional fields are included in JSON."""
        pattern = {
            "id": "test",
            "title": "Test",
            "type": "skill",
            "status": "experimental",
            "path": "test.md",
        }
        details = {
            "tags": ["security"],
            "primary_personas": ["developers"],
            "portability": {"opencode": True, "cursor": False},
            "description": "Test",
        }

        result = format_pattern_json(pattern, details)

        assert result["tags"] == ["security"]
        assert result["personas"] == ["developers"]
        assert result["portability"] == {"opencode": True}
        assert result["description"] == "Test"


class TestSearchPatterns:
    """Tests for search_patterns function."""

    def test_found_returns_zero(self, temp_repo):
        """Test that finding patterns returns exit code 0."""
        index = load_index(temp_repo)

        exit_code = search_patterns(index, temp_repo, "testing", None, None, None, None, False)

        assert exit_code == 0

    def test_not_found_returns_one(self, temp_repo):
        """Test that no matches returns exit code 1."""
        index = load_index(temp_repo)

        exit_code = search_patterns(index, temp_repo, "nonexistent", None, None, None, None, False)

        assert exit_code == 1

    def test_json_output(self, temp_repo, capsys):
        """Test JSON output format."""
        index = load_index(temp_repo)

        search_patterns(index, temp_repo, "testing", None, None, None, None, True)

        captured = capsys.readouterr()
        result = json.loads(captured.out)

        assert result["count"] == 1
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["id"] == "test-skill"
