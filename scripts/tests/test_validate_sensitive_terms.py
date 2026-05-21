"""Tests for validate_sensitive_terms.py"""

from scripts.validate_sensitive_terms import (
    is_safe_context,
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

    def test_unsafe_context(self):
        """Test that actual violations are not safe."""
        line = "Here is some actual CUI information"
        assert is_safe_context(line) is False


class TestScanFile:
    """Tests for scan_file function."""

    def test_detects_private_key(self, tmp_path):
        """Test detection of private keys."""
        file_path = tmp_path / "key.pem"
        file_path.write_text("-----BEGIN PRIVATE KEY-----")

        matches = scan_file(file_path)

        assert len(matches) > 0
        assert any("Private key" in desc for _, desc, _ in matches)

    def test_detects_cui_marker_unsafe(self, tmp_path):
        """Test detection of CUI in unsafe context."""
        file_path = tmp_path / "doc.md"
        file_path.write_text("Actual CUI content here.")

        matches = scan_file(file_path)

        assert len(matches) > 0
        assert any("CUI" in desc or "Controlled" in desc for _, desc, _ in matches)

    def test_skips_cui_in_safe_context(self, tmp_path):
        """Test that CUI in safe context is skipped."""
        file_path = tmp_path / "doc.md"
        file_path.write_text('  - "CUI"')

        matches = scan_file(file_path)

        assert len(matches) == 0

    def test_skips_pii_in_frontmatter(self, tmp_path):
        """Test that PII in frontmatter is skipped."""
        file_path = tmp_path / "skill.md"
        content = """---
prohibited_content:
  - "PII"
  - "CUI"
---"""
        file_path.write_text(content)

        matches = scan_file(file_path)

        assert len(matches) == 0

    def test_handles_read_error(self, tmp_path):
        """Test graceful handling of read errors."""
        file_path = tmp_path / "nonexistent.md"

        matches = scan_file(file_path)

        assert matches == []

    def test_clean_file(self, tmp_path):
        """Test that clean files return no matches."""
        file_path = tmp_path / "clean.md"
        file_path.write_text("# Clean File\n\nNo sensitive content here.")

        matches = scan_file(file_path)

        assert len(matches) == 0

    def test_returns_line_numbers_with_private_key(self, tmp_path):
        """Test that line numbers are returned correctly."""
        file_path = tmp_path / "key.pem"
        content = """# Line 1
-----BEGIN PRIVATE KEY-----
# Line 3"""
        file_path.write_text(content)

        matches = scan_file(file_path)

        assert len(matches) > 0
        line_num, _, _ = matches[0]
        assert line_num == 2
