"""Tests for generate_index.py"""


import pytest

from scripts.generate_index import extract_frontmatter, find_patterns, generate_index


@pytest.fixture
def temp_repo(tmp_path):
    """Create temporary repository structure with patterns."""
    # Create skills directory with valid pattern
    skills_dir = tmp_path / "skills" / "test-skill"
    skills_dir.mkdir(parents=True)

    skill_content = """---
id: test-skill
title: Test Skill
type: skill
status: experimental
---

# Test Skill
"""
    (skills_dir / "SKILL.md").write_text(skill_content)

    # Create agents directory with valid pattern
    agents_dir = tmp_path / "agents" / "test-agent"
    agents_dir.mkdir(parents=True)

    agent_content = """---
id: test-agent
title: Test Agent
type: agent
status: experimental
---

# Test Agent
"""
    (agents_dir / "AGENTS.md").write_text(agent_content)

    return tmp_path


class TestExtractFrontmatter:
    """Tests for extract_frontmatter function."""

    def test_valid_frontmatter(self):
        """Test extraction of valid frontmatter."""
        content = """---
id: test
title: Test
type: skill
status: experimental
---

Content.
"""
        result = extract_frontmatter(content)

        assert result is not None
        assert result["id"] == "test"
        assert result["title"] == "Test"

    def test_missing_frontmatter(self):
        """Test handling of missing frontmatter."""
        content = "# No frontmatter\n\nContent."
        result = extract_frontmatter(content)
        assert result is None

    def test_invalid_yaml(self):
        """Test handling of invalid YAML."""
        content = """---
invalid: yaml: structure:
---

Content.
"""
        result = extract_frontmatter(content)
        assert result is None


class TestFindPatterns:
    """Tests for find_patterns function."""

    def test_finds_skills(self, temp_repo):
        """Test that skills are found."""
        patterns = find_patterns(temp_repo)

        assert "skills" in patterns
        assert len(patterns["skills"]) == 1
        assert patterns["skills"][0]["id"] == "test-skill"

    def test_finds_agents(self, temp_repo):
        """Test that agents are found."""
        patterns = find_patterns(temp_repo)

        assert "agents" in patterns
        assert len(patterns["agents"]) == 1
        assert patterns["agents"][0]["id"] == "test-agent"

    def test_handles_missing_directory(self, tmp_path):
        """Test graceful handling of missing directories."""
        patterns = find_patterns(tmp_path)

        assert patterns["skills"] == []
        assert patterns["prompts"] == []

    def test_handles_invalid_frontmatter(self, tmp_path):
        """Test handling of files with invalid frontmatter."""
        skills_dir = tmp_path / "skills" / "bad"
        skills_dir.mkdir(parents=True)
        (skills_dir / "SKILL.md").write_text("No frontmatter")

        patterns = find_patterns(tmp_path)

        # Should not crash, just skip the file
        assert patterns["skills"] == []


class TestGenerateIndex:
    """Tests for generate_index function."""

    def test_generates_valid_structure(self, temp_repo):
        """Test that valid INDEX structure is generated."""
        index = generate_index(temp_repo)

        assert index["schema_version"] == "1.0"
        assert "repo" in index
        assert "description" in index
        assert "patterns" in index

    def test_counts_patterns_correctly(self, temp_repo):
        """Test that pattern counts are correct."""
        index = generate_index(temp_repo)

        patterns = index["patterns"]
        assert len(patterns["skills"]) == 1
        assert len(patterns["agents"]) == 1

    def test_extracts_metadata(self, temp_repo):
        """Test that metadata is extracted correctly."""
        index = generate_index(temp_repo)

        skill = index["patterns"]["skills"][0]
        assert skill["id"] == "test-skill"
        assert skill["title"] == "Test Skill"
        assert skill["type"] == "skill"
        assert skill["status"] == "experimental"

    def test_empty_repository(self, tmp_path):
        """Test handling of empty repository."""
        index = generate_index(tmp_path)

        assert index["schema_version"] == "1.0"
        assert all(len(patterns) == 0 for patterns in index["patterns"].values())
