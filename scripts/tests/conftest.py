"""Shared pytest fixtures for agentic-coding-patterns tests.

This module consolidates common test fixtures to reduce code duplication
across test files. See issue #66 for the refactoring rationale.

Fixtures provided:
- temp_repo: Temporary repository with skills and agents directories
- write_md: Factory for markdown files with frontmatter
- write_file: Factory for files with dedented content
- write_yaml: Factory for YAML files
- make_skill: Factory for skill directories with SKILL.md
- make_agent: Factory for agent directories with AGENTS.md
"""

import textwrap

import pytest
import yaml

# ── Repository structure fixtures ──────────────────────────────────────────


@pytest.fixture
def temp_repo(tmp_path):
    """Create temporary repository structure with basic pattern directories.

    Creates:
    - skills/
    - agents/
    - prompts/
    - workflows/
    - lessons-learned/

    Usage:
        def test_patterns(self, temp_repo):
            skill_dir = temp_repo / "skills" / "my-skill"
            skill_dir.mkdir(parents=True)
    """
    for dir_name in ["skills", "agents", "prompts", "workflows", "lessons-learned"]:
        (tmp_path / dir_name).mkdir()
    return tmp_path


# ── File writer factories ──────────────────────────────────────────────────


@pytest.fixture
def write_md(tmp_path):
    """Factory to write markdown files with YAML frontmatter.

    Usage:
        def test_markdown(self, write_md):
            path = write_md("skills/test/SKILL.md",
                           id="test",
                           title="Test Skill",
                           type="skill",
                           status="experimental")
    """

    def _write(
        filename,
        *,
        id=None,
        title="Test",
        type="skill",
        status="experimental",
        content="# Content\n",
        **extra_fm,
    ):
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)

        fm = {"title": title, "type": type, "status": status}
        if id is not None:
            fm["id"] = id
        fm.update(extra_fm)

        fm_text = yaml.dump(fm, default_flow_style=False, sort_keys=False)
        full_content = f"---\n{fm_text}---\n\n{content}"

        path.write_text(full_content)
        return path

    return _write


@pytest.fixture
def write_file(tmp_path):
    """Factory to write files with dedented content.

    Usage:
        def test_file(self, write_file):
            path = write_file("config.yaml", '''
                key: value
                nested:
                  item: 1
            ''')
    """

    def _write(filename, content):
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip())
        return path

    return _write


@pytest.fixture
def write_yaml(tmp_path):
    """Factory to write YAML files from Python dicts.

    Usage:
        def test_yaml(self, write_yaml):
            path = write_yaml("INDEX.yaml", {"skills": [], "agents": []})
    """

    def _write(filename, data):
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))
        return path

    return _write


# ── Pattern directory factories ────────────────────────────────────────────


@pytest.fixture
def make_skill(tmp_path):
    """Factory to create skill directories with SKILL.md.

    Usage:
        def test_skill(self, make_skill):
            skill_dir = make_skill("my-skill",
                                   title="My Skill",
                                   status="canonical")
            assert (skill_dir / "SKILL.md").exists()
    """

    def _make(
        name,
        *,
        id=None,
        title=None,
        status="experimental",
        description=None,
        content="# Skill content\n",
        **extra_fm,
    ):
        skill_dir = tmp_path / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)

        fm = {
            "id": id or name,
            "title": title or f"{name.replace('-', ' ').title()} Skill",
            "type": "skill",
            "status": status,
        }
        if description:
            fm["description"] = description
        fm.update(extra_fm)

        fm_text = yaml.dump(fm, default_flow_style=False, sort_keys=False)
        skill_content = f"---\n{fm_text}---\n\n{content}"

        (skill_dir / "SKILL.md").write_text(skill_content)
        return skill_dir

    return _make


@pytest.fixture
def make_agent(tmp_path):
    """Factory to create agent directories with AGENTS.md.

    Usage:
        def test_agent(self, make_agent):
            agent_dir = make_agent("my-agent", title="My Agent")
            assert (agent_dir / "AGENTS.md").exists()
    """

    def _make(
        name,
        *,
        id=None,
        title=None,
        status="experimental",
        description=None,
        content="# Agent content\n",
        **extra_fm,
    ):
        agent_dir = tmp_path / "agents" / name
        agent_dir.mkdir(parents=True, exist_ok=True)

        fm = {
            "id": id or name,
            "title": title or f"{name.replace('-', ' ').title()} Agent",
            "type": "agent",
            "status": status,
        }
        if description:
            fm["description"] = description
        fm.update(extra_fm)

        fm_text = yaml.dump(fm, default_flow_style=False, sort_keys=False)
        agent_content = f"---\n{fm_text}---\n\n{content}"

        (agent_dir / "AGENTS.md").write_text(agent_content)
        return agent_dir

    return _make


# ── Test case fixtures ─────────────────────────────────────────────────────


@pytest.fixture
def make_test_suite(tmp_path):
    """Factory to create test suite YAML files for run_test_cases.py.

    Usage:
        def test_runner(self, make_test_suite):
            suite_path = make_test_suite(
                pattern_id="my-pattern",
                test_cases=[
                    {"id": "test-1", "name": "Test 1", "input": "...", ...}
                ]
            )
    """

    def _make(
        filename="test-cases.yml",
        *,
        pattern_id="test-pattern",
        pattern_version="1.0.0",
        description="Test suite",
        test_cases=None,
    ):
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)

        suite = {
            "suite": {
                "pattern_id": pattern_id,
                "pattern_version": pattern_version,
                "description": description,
            },
            "test_cases": test_cases or [],
        }

        path.write_text(yaml.dump(suite, default_flow_style=False, sort_keys=False))
        return path

    return _make
