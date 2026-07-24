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


class TestCategoryFacet:
    """Tests for the categories facet (issue #151)."""

    def test_facet_includes_full_vocab(self, tmp_path):
        """Every controlled-vocab term appears in the facet, even if unused."""
        from scripts.generate_index import CATEGORY_VOCAB

        index = generate_index(tmp_path)
        assert set(index["categories"].keys()) == set(CATEGORY_VOCAB)
        # Empty repo -> every facet bucket empty.
        assert all(v == [] for v in index["categories"].values())

    def test_facet_maps_categories_to_ids(self, temp_repo):
        """A skill's declared categories show up under the right facet buckets."""
        # temp_repo's skill has no categories by default; add one and rebuild.
        skill = temp_repo / "skills" / "test-skill" / "SKILL.md"
        text = skill.read_text()
        text = text.replace("status: experimental", "status: experimental\ncategories: [security, review]", 1)
        skill.write_text(text)

        index = generate_index(temp_repo)
        assert "test-skill" in index["categories"]["security"]
        assert "test-skill" in index["categories"]["review"]
        assert index["categories"]["frontend"] == []


class TestDeterminism:
    """#243: INDEX generation must be deterministic (rglob order is FS-dependent)."""

    def test_generation_is_idempotent(self, temp_repo):
        import yaml

        first = yaml.dump(generate_index(temp_repo), sort_keys=False, allow_unicode=True)
        second = yaml.dump(generate_index(temp_repo), sort_keys=False, allow_unicode=True)
        assert first == second

    def test_pattern_lists_sorted_by_id(self, tmp_path):
        # Two skills whose FS discovery order is not guaranteed; assert sorted by id.
        for sid in ("zzz-skill", "aaa-skill"):
            d = tmp_path / "skills" / sid
            d.mkdir(parents=True)
            (d / "SKILL.md").write_text(f"---\nid: {sid}\ntitle: {sid}\ntype: skill\nstatus: experimental\n---\n")
        index = generate_index(tmp_path)
        ids = [p["id"] for p in index["patterns"]["skills"]]
        assert ids == sorted(ids)


class TestRoutingFacets:
    """#238: collection + routing reverse facets."""

    def test_reverse_facets_present_and_empty_when_unused(self, temp_repo):
        index = generate_index(temp_repo)
        # New top-level facets exist; empty because temp patterns carry no routing.
        assert index["collections"] == {}
        assert index["task_types"] == {}
        assert index["output_artifacts"] == {}

    def test_collection_and_routing_surface_into_facets(self, tmp_path):
        d = tmp_path / "skills" / "demo"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            "---\n"
            "id: demo\ntitle: Demo\ntype: skill\nstatus: experimental\n"
            "collection: security\n"
            "routing:\n"
            "  task_types: [review]\n"
            "  output_artifacts: [security-review]\n"
            "---\n"
        )
        index = generate_index(tmp_path)
        assert index["collections"]["security"] == ["demo"]
        assert index["task_types"]["review"] == ["demo"]
        assert index["output_artifacts"]["security-review"] == ["demo"]
        # Per-entry projection is present too.
        entry = next(p for p in index["patterns"]["skills"] if p["id"] == "demo")
        assert entry["collection"] == "security"
        assert entry["routing"]["task_types"] == ["review"]
