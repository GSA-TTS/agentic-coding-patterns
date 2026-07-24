"""Tests for validate_frontmatter.py"""

import json
from pathlib import Path

import pytest

from scripts.validate_frontmatter import (
    check_routing_taxonomy,
    check_security_governance,
    extract_frontmatter,
    find_pattern_files,
    load_schema,
    load_taxonomy,
    validate_file,
)


@pytest.fixture
def temp_repo(tmp_path):
    """Create temporary repository structure."""
    # Create schemas directory
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir()

    # Create minimal schema
    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "required": ["id", "title", "type", "status"],
        "properties": {
            "id": {"type": "string"},
            "title": {"type": "string"},
            "type": {"type": "string"},
            "status": {"type": "string", "enum": ["experimental", "recommended", "deprecated"]},
        },
    }
    (schemas_dir / "skill.schema.json").write_text(json.dumps(schema))

    return tmp_path


@pytest.fixture
def valid_skill_content():
    """Valid SKILL.md frontmatter content."""
    return """---
id: test-skill
title: Test Skill
type: skill
status: experimental
---

# Test Skill

Content here.
"""


@pytest.fixture
def invalid_yaml_content():
    """Invalid YAML in frontmatter."""
    return """---
id: test-skill
title: Test Skill
  invalid: yaml: structure
---

Content.
"""


@pytest.fixture
def missing_frontmatter_content():
    """Content without frontmatter."""
    return """# Test Skill

No frontmatter here.
"""


@pytest.fixture
def invalid_schema_content():
    """Frontmatter that violates schema."""
    return """---
id: test-skill
title: Test Skill
type: skill
status: invalid_status
---

Content.
"""


class TestExtractFrontmatter:
    """Tests for extract_frontmatter function."""

    def test_valid_frontmatter(self, valid_skill_content):
        """Test extraction of valid frontmatter."""
        result = extract_frontmatter(valid_skill_content)

        assert result is not None
        assert result["id"] == "test-skill"
        assert result["title"] == "Test Skill"
        assert result["type"] == "skill"
        assert result["status"] == "experimental"

    def test_missing_frontmatter(self, missing_frontmatter_content):
        """Test handling of missing frontmatter."""
        result = extract_frontmatter(missing_frontmatter_content)
        assert result is None

    def test_invalid_yaml(self, invalid_yaml_content):
        """Test handling of invalid YAML."""
        result = extract_frontmatter(invalid_yaml_content)
        assert result is None

    def test_malformed_markers(self):
        """Test handling of malformed frontmatter markers."""
        content = "---\nid: test\n# Missing closing marker"
        result = extract_frontmatter(content)
        assert result is None


class TestLoadSchema:
    """Tests for load_schema function."""

    def test_load_valid_schema(self, temp_repo):
        """Test loading a valid schema file."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        assert schema is not None
        assert schema["type"] == "object"
        assert "id" in schema["required"]

    def test_missing_schema_file(self, tmp_path):
        """Test handling of missing schema file."""
        schema_path = tmp_path / "nonexistent.json"

        with pytest.raises(FileNotFoundError):
            load_schema(schema_path)


class TestFindPatternFiles:
    """Tests for find_pattern_files function."""

    def test_find_skill_files(self, tmp_path):
        """Test finding SKILL.md files."""
        (tmp_path / "skills" / "test").mkdir(parents=True)
        (tmp_path / "skills" / "test" / "SKILL.md").write_text("content")

        files = find_pattern_files(tmp_path)

        assert len(files) == 1
        assert files[0].name == "SKILL.md"

    def test_find_agents_files(self, tmp_path):
        """Test finding AGENTS.md files."""
        (tmp_path / "agents" / "test").mkdir(parents=True)
        (tmp_path / "agents" / "test" / "AGENTS.md").write_text("content")

        files = find_pattern_files(tmp_path)

        assert len(files) == 1
        assert files[0].name == "AGENTS.md"

    def test_returns_sorted_list(self, tmp_path):
        """Test that results are sorted."""
        (tmp_path / "skills" / "beta").mkdir(parents=True)
        (tmp_path / "skills" / "alpha").mkdir(parents=True)
        (tmp_path / "skills" / "beta" / "SKILL.md").write_text("content")
        (tmp_path / "skills" / "alpha" / "SKILL.md").write_text("content")

        files = find_pattern_files(tmp_path)

        assert len(files) == 2
        assert "alpha" in str(files[0])
        assert "beta" in str(files[1])

    def test_empty_directory(self, tmp_path):
        """Test behavior with empty directory."""
        files = find_pattern_files(tmp_path)
        assert files == []


class TestValidateFile:
    """Tests for validate_file function."""

    def test_valid_file_passes(self, temp_repo, valid_skill_content):
        """Test that valid file passes validation."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        file_path = temp_repo / "test.md"
        file_path.write_text(valid_skill_content)

        success, errors, _warnings = validate_file(file_path, schema)

        assert success is True
        assert errors == []

    def test_missing_required_fields(self, temp_repo):
        """Test that missing required fields fail validation."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        content = """---
id: test-skill
title: Test Skill
---

Content.
"""
        file_path = temp_repo / "test.md"
        file_path.write_text(content)

        success, errors, _warnings = validate_file(file_path, schema)

        assert success is False
        assert len(errors) > 0
        assert "validation failed" in errors[0].lower()

    def test_invalid_schema_value(self, temp_repo, invalid_schema_content):
        """Test that invalid schema values fail validation."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        file_path = temp_repo / "test.md"
        file_path.write_text(invalid_schema_content)

        success, errors, _warnings = validate_file(file_path, schema)

        assert success is False
        assert len(errors) > 0

    def test_file_read_error(self, temp_repo):
        """Test handling of file read errors."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        file_path = temp_repo / "nonexistent.md"

        success, errors, _warnings = validate_file(file_path, schema)

        assert success is False
        assert "failed to read" in errors[0].lower()

    def test_no_frontmatter(self, temp_repo, missing_frontmatter_content):
        """Test handling of files without frontmatter."""
        schema_path = temp_repo / "schemas" / "skill.schema.json"
        schema = load_schema(schema_path)

        file_path = temp_repo / "test.md"
        file_path.write_text(missing_frontmatter_content)

        success, errors, _warnings = validate_file(file_path, schema)

        assert success is False
        assert "no valid yaml frontmatter" in errors[0].lower()


class TestSecurityGovernance:
    """Tests for the categories-gated security-governance rules (#151 + recon S4)."""

    def test_security_category_requires_governance_fields(self, tmp_path):
        """categories:[security] without governance fields => error."""
        fm = {
            "id": "x",
            "categories": ["security", "review"],
            "tags": ["security"],
        }
        errors, warnings = check_security_governance(tmp_path / "x" / "SKILL.md", fm)
        assert errors, "expected an error for missing governance fields"
        assert "security-governance field" in errors[0]
        assert warnings == []

    def test_security_category_with_governance_passes(self, tmp_path):
        """categories:[security] WITH all governance fields => no error/warning."""
        fm = {
            "id": "x",
            "categories": ["security"],
            "risk_tier": "moderate",
            "human_review_required": True,
            "allowed_tools": [],
            "network_policy": "deny",
            "write_policy": "deny",
            "script_policy": "deny",
        }
        errors, warnings = check_security_governance(tmp_path / "x" / "SKILL.md", fm)
        assert errors == []
        assert warnings == []

    def test_s4_heuristic_warns_on_unlabeled_security_skill(self, tmp_path):
        """Security-relevant by tags but not self-labeled => warning, not error."""
        fm = {"id": "x", "categories": ["review"], "tags": ["owasp", "vulnerability"]}
        errors, warnings = check_security_governance(tmp_path / "x" / "SKILL.md", fm)
        assert errors == []
        assert warnings and "does not declare categories: [security]" in warnings[0]

    def test_s4_heuristic_warns_on_security_path(self, tmp_path):
        """Path under a security/ dir segment triggers the heuristic too."""
        fm = {"id": "x", "categories": ["review"], "tags": []}
        errors, warnings = check_security_governance(Path("agents/security-review/AGENTS.md"), fm)
        assert errors == []
        assert warnings and "path:security" in warnings[0]

    def test_non_security_skill_no_warning(self, tmp_path):
        """A genuinely non-security skill is silent."""
        fm = {"id": "x", "categories": ["frontend"], "tags": ["uswds", "html"]}
        errors, warnings = check_security_governance(Path("frontend/uswds-prototype/SKILL.md"), fm)
        assert errors == []
        assert warnings == []


class TestRealSchemaStrictness:
    """Tests against the REAL repo schema (schemas/skill.schema.json), which sets
    additionalProperties: false — so unknown/typo'd keys are rejected, not tolerated."""

    @pytest.fixture
    def real_schema(self):
        repo_root = Path(__file__).resolve().parents[2]
        return load_schema(repo_root / "schemas" / "skill.schema.json")

    def _base(self):
        """A minimal valid skill frontmatter dict."""
        return {
            "id": "x-skill",
            "version": "1.0.0",
            "title": "X Skill",
            "type": "skill",
            "status": "experimental",
            "owners": ["@GSA-TTS/agentic-coding-team"],
            "primary_personas": ["developers"],
            "requires": {"anchors": []},
            "output": {
                "format": "markdown",
                "contract": {
                    "required_sections": ["Summary"],
                    "prohibited_content": ["Secrets"],
                },
            },
            "quality_gates": {"readability_max_grade": 10, "citations_required": False},
        }

    def test_base_is_valid(self, real_schema):
        import jsonschema

        jsonschema.validate(instance=self._base(), schema=real_schema)

    def test_name_field_accepted(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["name"] = "x-skill"
        jsonschema.validate(instance=fm, schema=real_schema)

    def test_unknown_top_level_key_rejected(self, real_schema):
        """A typo'd/unknown top-level key now fails (additionalProperties: false)."""
        import jsonschema

        fm = self._base()
        fm["complaince"] = {"frameworks": ["NIST"]}  # typo of 'compliance'
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)

    def test_unknown_nested_key_rejected(self, real_schema):
        """Unknown key inside a nested object (compliance) is rejected."""
        import jsonschema

        fm = self._base()
        fm["compliance"] = {"nist_control": ["AC-6"]}  # singular typo
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)

    def test_nist_control_pattern_enforced(self, real_schema):
        """A malformed control id fails the ^[A-Z]{2}-\\d+ pattern."""
        import jsonschema

        fm = self._base()
        fm["compliance"] = {"nist_controls": ["not-a-control"]}
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)

    def test_well_formed_nist_control_accepted(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["compliance"] = {"frameworks": ["NIST SP 800-53"], "nist_controls": ["AC-6", "AU-2"]}
        jsonschema.validate(instance=fm, schema=real_schema)

    def test_last_updated_accepted(self, real_schema):
        """AGENTS.md-style last_updated is an allowed field."""
        import jsonschema

        fm = self._base()
        fm["last_updated"] = "2026-07-01"
        jsonschema.validate(instance=fm, schema=real_schema)

    # --- #238: collection + routing schema acceptance -------------------------

    def test_collection_accepted(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["collection"] = "security"
        jsonschema.validate(instance=fm, schema=real_schema)

    def test_collection_unknown_value_rejected(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["collection"] = "not-a-collection"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)

    def test_routing_block_accepted(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["routing"] = {
            "task_types": ["review", "analyze"],
            "input_artifacts": ["source-code"],
            "output_artifacts": ["security-review"],
            "prefer_when": ["asks for vulnerabilities"],
            "avoid_when": ["only about permissions"],
            "delegates": [{"pattern": "least-privilege-review", "when": "permissions minimality"}],
            "aliases": ["vulnerability review"],
            "priority": 50,
        }
        jsonschema.validate(instance=fm, schema=real_schema)

    def test_routing_unknown_subkey_rejected(self, real_schema):
        """routing is additionalProperties:false — a typo'd sub-key is rejected."""
        import jsonschema

        fm = self._base()
        fm["routing"] = {"task_typez": ["review"]}  # typo
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)

    def test_routing_delegate_requires_pattern_and_when(self, real_schema):
        import jsonschema

        fm = self._base()
        fm["routing"] = {"delegates": [{"pattern": "x"}]}  # missing 'when'
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=fm, schema=real_schema)


class TestRoutingTaxonomy:
    """#238: routing.* facet values are cross-checked against schemas/taxonomy.yaml."""

    @pytest.fixture
    def taxonomy(self):
        repo_root = Path(__file__).resolve().parents[2]
        return load_taxonomy(repo_root / "schemas" / "taxonomy.yaml")

    def test_taxonomy_loads(self, taxonomy):
        assert taxonomy is not None
        assert "review" in taxonomy["task_types"]
        assert "source-code" in taxonomy["artifact_types"]

    def test_no_routing_block_is_noop(self, taxonomy):
        assert check_routing_taxonomy({"id": "x"}, taxonomy) == []

    def test_known_facets_pass(self, taxonomy):
        fm = {"routing": {"task_types": ["review"], "output_artifacts": ["security-review"]}}
        assert check_routing_taxonomy(fm, taxonomy) == []

    def test_unknown_task_type_rejected(self, taxonomy):
        fm = {"routing": {"task_types": ["frobnicate"]}}
        errors = check_routing_taxonomy(fm, taxonomy)
        assert errors and "task_types" in errors[0]

    def test_unknown_artifact_rejected(self, taxonomy):
        fm = {"routing": {"output_artifacts": ["hologram"]}}
        errors = check_routing_taxonomy(fm, taxonomy)
        assert errors and "artifact_types" in errors[0]

    def test_absent_taxonomy_skips(self):
        fm = {"routing": {"task_types": ["anything"]}}
        assert check_routing_taxonomy(fm, None) == []


class TestSecurityGateUnaffectedByRouting:
    """Regression (#238): adding a routing block must NOT change the security gate."""

    def test_security_gate_still_fires_with_routing(self):
        fm = {
            "categories": ["security"],
            "routing": {"task_types": ["review"]},
            # deliberately missing the 6 governance fields
        }
        errors, _ = check_security_governance(Path("skills/x/SKILL.md"), fm)
        assert errors and "security-governance field" in errors[0]

    def test_security_gate_passes_with_routing_and_fields(self):
        fm = {
            "categories": ["security"],
            "routing": {"task_types": ["review"]},
            "risk_tier": "moderate",
            "human_review_required": True,
            "allowed_tools": [],
            "network_policy": "deny",
            "write_policy": "deny",
            "script_policy": "deny",
        }
        errors, _ = check_security_governance(Path("skills/x/SKILL.md"), fm)
        assert errors == []
