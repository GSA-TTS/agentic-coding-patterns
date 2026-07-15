"""Tests for validate_sensitive_terms.py"""

from scripts.validate_sensitive_terms import (
    is_safe_context,
    is_tier2_allowlisted,
    scan_file,
    should_scan_file,
)


class TestShouldScanFile:
    """Tests for should_scan_file function."""

    def test_scannable_markdown(self, tmp_path):
        """Test that .md files are scannable."""
        file_path = tmp_path / "test.md"
        file_path.write_text("content")
        assert should_scan_file(file_path) is True

    def test_scannable_python(self, tmp_path):
        """Test that .py files are scannable."""
        file_path = tmp_path / "test.py"
        file_path.write_text("content")
        assert should_scan_file(file_path) is True

    def test_scannable_yaml(self, tmp_path):
        """Test that .yaml files are scannable."""
        file_path = tmp_path / "test.yaml"
        file_path.write_text("content")
        assert should_scan_file(file_path) is True

    def test_non_scannable_extension(self, tmp_path):
        """Test that .jpg files are not scannable."""
        file_path = tmp_path / "test.jpg"
        file_path.write_text("content")
        assert should_scan_file(file_path) is False

    def test_skip_git_directory(self, tmp_path):
        """Test that .git files are skipped."""
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        file_path = git_dir / "config"
        file_path.write_text("content")
        assert should_scan_file(file_path) is False

    def test_skip_pycache(self, tmp_path):
        """Test that __pycache__ files are skipped."""
        cache_dir = tmp_path / "__pycache__"
        cache_dir.mkdir()
        file_path = cache_dir / "test.pyc"
        file_path.write_text("content")
        assert should_scan_file(file_path) is False


class TestIsTier2Allowlisted:
    """Tests for is_tier2_allowlisted function."""

    def test_security_md_allowlisted(self, tmp_path):
        """Test that SECURITY.md is allowlisted for Tier 2 terms."""
        file_path = tmp_path / "SECURITY.md"
        assert is_tier2_allowlisted(file_path) is True

    def test_agents_md_allowlisted(self, tmp_path):
        """Test that AGENTS.md is allowlisted for Tier 2 terms."""
        file_path = tmp_path / "AGENTS.md"
        assert is_tier2_allowlisted(file_path) is True

    def test_security_directory_allowlisted(self, tmp_path):
        """Test that files in security/ directory are allowlisted."""
        security_dir = tmp_path / "security"
        security_dir.mkdir()
        file_path = security_dir / "policy.md"
        assert is_tier2_allowlisted(file_path) is True

    def test_regular_file_not_allowlisted(self, tmp_path):
        """Test that regular files are not allowlisted."""
        file_path = tmp_path / "README.md"
        assert is_tier2_allowlisted(file_path) is False

    def test_nested_security_directory(self, tmp_path):
        """Test that nested security paths are allowlisted."""
        nested_dir = tmp_path / "docs" / "security"
        nested_dir.mkdir(parents=True)
        file_path = nested_dir / "guidelines.md"
        assert is_tier2_allowlisted(file_path) is True


class TestIsSafeContext:
    """Tests for is_safe_context function."""

    def test_frontmatter_prohibited_content(self):
        """Test that prohibited_content arrays are safe."""
        line = "    prohibited_content:"
        assert is_safe_context(line) is True

    def test_yaml_array_item(self):
        """Test that YAML array items are safe."""
        line = '  - "Real PII"'
        assert is_safe_context(line) is True

    def test_negative_marker(self):
        """Test that ❌ markers are safe."""
        line = "❌ CUI"
        assert is_safe_context(line) is True

    def test_numbered_list_no(self):
        """Test that numbered 'No' lists are safe."""
        line = "4. No secrets, PII, or CUI"
        assert is_safe_context(line) is True

    def test_bullet_prohibited_marker(self):
        """Test that bullet with ❌ is safe."""
        line = "  - ❌ PII"
        assert is_safe_context(line) is True

    def test_markdown_table(self):
        """Test that markdown table rows are safe."""
        line = "| Type | Contains CUI | Status |"
        assert is_safe_context(line) is True

    def test_checklist_item(self):
        """Test that checklist items are safe."""
        line = "- [ ] No PII included"
        assert is_safe_context(line) is True

    def test_prohibited_list_bullet(self):
        """Test that prohibited item bullets are safe."""
        line = "  - customer data"
        assert is_safe_context(line) is True

    def test_bullet_no_pattern(self):
        """Test that bullet lists starting with 'No' are safe."""
        line = "- No CUI allowed in this section"
        assert is_safe_context(line) is True

    def test_must_not_include(self):
        """Test that 'must not include' patterns are safe."""
        line = "Patterns must not include any PII"
        assert is_safe_context(line) is True

    def test_unsafe_context(self):
        """Test that actual violations are not safe."""
        line = "Here is some actual CUI information"
        assert is_safe_context(line) is False


class TestScanFile:
    """Tests for scan_file function."""

    def test_detects_private_key(self, tmp_path):
        """Test detection of private keys (Tier 1)."""
        file_path = tmp_path / "key.pem"
        file_path.write_text("-----BEGIN PRIVATE KEY-----")

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier1_matches) > 0
        assert any("Private key" in desc for _, desc, _ in tier1_matches)

    def test_tier2_term_in_regular_file(self, tmp_path):
        """Test detection of CUI in unsafe context (Tier 2)."""
        file_path = tmp_path / "doc.md"
        file_path.write_text("Actual CUI content here.")

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier2_matches) > 0
        assert any("CUI" in desc or "Controlled" in desc for _, desc, _ in tier2_matches)

    def test_tier2_term_in_security_md_skipped(self, tmp_path):
        """Test that CUI in SECURITY.md is skipped (allowlisted)."""
        file_path = tmp_path / "SECURITY.md"
        file_path.write_text("This repo must not contain CUI content.")

        tier1_matches, tier2_matches = scan_file(file_path)

        # SECURITY.md is allowlisted for Tier 2 terms
        assert len(tier2_matches) == 0

    def test_tier2_term_in_security_md_strict_mode(self, tmp_path):
        """Test that CUI in SECURITY.md is flagged in strict mode."""
        file_path = tmp_path / "SECURITY.md"
        # Use text that doesn't match safe context patterns
        file_path.write_text("Actual CUI data appears here in this file.")

        tier1_matches, tier2_matches = scan_file(file_path, strict=True)

        # In strict mode, even allowlisted files are checked
        assert len(tier2_matches) > 0

    def test_skips_cui_in_safe_context(self, tmp_path):
        """Test that CUI in safe context is skipped."""
        file_path = tmp_path / "doc.md"
        file_path.write_text('  - "CUI"')

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier1_matches) == 0
        assert len(tier2_matches) == 0

    def test_skips_pii_in_frontmatter(self, tmp_path):
        """Test that PII in frontmatter is skipped."""
        file_path = tmp_path / "skill.md"
        content = """---
prohibited_content:
  - "PII"
  - "CUI"
---"""
        file_path.write_text(content)

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier1_matches) == 0
        assert len(tier2_matches) == 0

    def test_handles_read_error(self, tmp_path):
        """Test graceful handling of read errors."""
        file_path = tmp_path / "nonexistent.md"

        tier1_matches, tier2_matches = scan_file(file_path)

        assert tier1_matches == []
        assert tier2_matches == []

    def test_clean_file(self, tmp_path):
        """Test that clean files return no matches."""
        file_path = tmp_path / "clean.md"
        file_path.write_text("# Clean File\n\nNo sensitive content here.")

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier1_matches) == 0
        assert len(tier2_matches) == 0

    def test_returns_line_numbers_with_private_key(self, tmp_path):
        """Test that line numbers are returned correctly."""
        file_path = tmp_path / "key.pem"
        content = """# Line 1
-----BEGIN PRIVATE KEY-----
# Line 3"""
        file_path.write_text(content)

        tier1_matches, tier2_matches = scan_file(file_path)

        assert len(tier1_matches) > 0
        line_num, _, _ = tier1_matches[0]
        assert line_num == 2

    def test_tier1_always_blocking(self, tmp_path):
        """Test that Tier 1 patterns are detected even in allowlisted files."""
        file_path = tmp_path / "SECURITY.md"
        file_path.write_text("-----BEGIN PRIVATE KEY-----")

        tier1_matches, tier2_matches = scan_file(file_path)

        # Private keys should be detected even in SECURITY.md
        assert len(tier1_matches) > 0

    def test_hardcoded_password_still_flagged(self, tmp_path):
        """A literal hardcoded password value is still a blocking Tier 1 match."""
        file_path = tmp_path / "app.sh"
        file_path.write_text('password="hunter2hardcoded"\n')

        tier1_matches, _ = scan_file(file_path)

        assert any("password" in desc.lower() for _, desc, _ in tier1_matches)

    def test_runtime_password_assignment_not_flagged(self, tmp_path):
        """Assigning a secret from a command substitution / var ref is not hardcoding.

        These read the value at runtime (they don't embed a literal), so flagging
        them is a false positive. Covers the openchamber kit's
        OPENCODE_SERVER_PASSWORD="$(cat ...)" style.
        """
        file_path = tmp_path / "startup.sh"
        file_path.write_text(
            'OPENCODE_SERVER_PASSWORD="$(cat "$PW_FILE")"\n'
            'PASSWORD="$PW"\n'
            "password=${SOME_VAR}\n"
            "password=`cat /run/secret`\n"
        )

        tier1_matches, _ = scan_file(file_path)

        assert tier1_matches == [], f"unexpected matches: {tier1_matches}"
