"""Regression tests for Git-index executable-mode validation."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
import validate_executable_modes as validator

ROOT = Path(__file__).resolve().parents[2]


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.invalid")
    _git(tmp_path, "config", "user.name", "Test")
    return tmp_path


def _add(repo: Path, name: str, mode: int = 0o644) -> Path:
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/env python3\nprint('ran')\n", encoding="utf-8")
    path.chmod(mode)
    _git(repo, "add", name)
    return path


def test_rejects_index_644_even_when_the_shared_mount_reports_755(tmp_path):
    repo = _repo(tmp_path)
    _add(repo, "tool.py", 0o755)
    _git(repo, "update-index", "--chmod=-x", "tool.py")

    with pytest.raises(validator.ExecutableModeError, match=r"expected 100755 stage 0; found 100644 stage 0"):
        validator.validate_executable_modes(repo, {"tool.py"})


def test_accepts_index_755_when_disk_mode_is_644_and_interpreter_executes(tmp_path):
    repo = _repo(tmp_path)
    tool = _add(repo, "tool.py")
    _git(repo, "update-index", "--chmod=+x", "tool.py")
    tool.chmod(0o644)

    validator.validate_executable_modes(repo, {"tool.py"})
    result = subprocess.run([sys.executable, str(tool)], check=True, capture_output=True, text=True)
    assert result.stdout == "ran\n"
    if os.name == "posix":  # Native Windows has no POSIX permission bits to assert.
        assert stat.S_IMODE(tool.stat().st_mode) == 0o644


def test_rejects_missing_and_untracked_paths(tmp_path):
    repo = _repo(tmp_path)
    _add(repo, "tracked.py")
    (repo / "untracked.py").write_text("#!/bin/sh\n", encoding="utf-8")

    with pytest.raises(validator.ExecutableModeError) as error:
        validator.validate_executable_modes(repo, {"missing.py", "untracked.py"})

    assert "missing.py (not tracked; add it to Git)" in str(error.value)
    assert "untracked.py (not tracked; add it to Git)" in str(error.value)


def test_rejects_unmerged_index_entries(tmp_path):
    repo = _repo(tmp_path)
    tool = _add(repo, "tool.py", 0o755)
    blob = subprocess.run(
        ["git", "-C", str(repo), "hash-object", "-w", str(tool)], check=True, capture_output=True, text=True
    ).stdout.strip()
    # Replace the normal stage-0 entry with a stage-1 entry to model a conflict.
    _git(repo, "update-index", "--force-remove", "tool.py")
    subprocess.run(
        ["git", "-C", str(repo), "update-index", "--index-info"],
        input=f"100755 {blob} 1\ttool.py\n",
        check=True,
        capture_output=True,
        text=True,
    )

    with pytest.raises(validator.ExecutableModeError, match=r"100755 stage 1"):
        validator.validate_executable_modes(repo, {"tool.py"})


def test_reports_git_errors(tmp_path):
    outside_repo = tmp_path / "not-a-repo"
    outside_repo.mkdir()

    with pytest.raises(validator.ExecutableModeError, match="git ls-files --stage failed"):
        validator.git_index_modes(outside_repo)


def _kit_repo(tmp_path: Path) -> Path:
    repo = _repo(tmp_path)
    kit = "integrations/isolation/acq-kits/example"
    spec = "files:\n  - {source: files/home/run.sh, mode: '0755'}\n  - {source: files/home/data.txt, mode: '0644'}\n"
    for name in (
        "files/home/run.sh",
        "files/home/data.txt",
        "scripts/verify-resources",
        "scripts/interpreter-only.py",
    ):
        _add(repo, f"{kit}/{name}")
    _add(repo, f"{kit}/scripts/verify")
    spec_path = repo / kit / "spec.yaml"
    spec_path.write_text(spec, encoding="utf-8")
    _add(repo, "integrations/providers/example/normalize.mjs")
    manifest = repo / "integrations/providers/example/provider-input.json"
    manifest.write_text('{"normalizerPath": "normalize.mjs"}', encoding="utf-8")
    _git(repo, "add", ".")
    return repo


KIT = "integrations/isolation/acq-kits/example"
EXPECTED_KIT_PATHS = {
    f"{KIT}/files/home/run.sh",
    f"{KIT}/scripts/verify-resources",
    f"{KIT}/scripts/verify",
    "integrations/providers/example/normalize.mjs",
}


def test_discovers_guest_payloads_normalizers_and_verify_entrypoints(tmp_path):
    repo = _kit_repo(tmp_path)

    assert validator.discover_executable_paths(repo) == EXPECTED_KIT_PATHS


def test_default_discovery_keeps_staged_verify_when_working_tree_copy_is_deleted(tmp_path):
    repo = _kit_repo(tmp_path)
    _git(repo, "update-index", "--chmod=-x", f"{KIT}/scripts/verify")
    (repo / KIT / "scripts/verify").unlink()

    assert f"{KIT}/scripts/verify" in validator.discover_executable_paths(repo)
    with pytest.raises(validator.ExecutableModeError, match=r"scripts/verify \(expected 100755 stage 0; found 100644"):
        validator.validate_executable_modes(repo)


def test_default_discovery_uses_staged_spec_not_unstaged_edit(tmp_path):
    repo = _kit_repo(tmp_path)
    (repo / KIT / "spec.yaml").write_text("files: []\n", encoding="utf-8")

    assert f"{KIT}/files/home/run.sh" in validator.discover_executable_paths(repo)


def test_default_discovery_uses_staged_manifest_not_unstaged_deletion(tmp_path):
    repo = _kit_repo(tmp_path)
    (repo / "integrations/providers/example/provider-input.json").unlink()

    assert "integrations/providers/example/normalize.mjs" in validator.discover_executable_paths(repo)


def test_default_discovery_ignores_unstaged_new_files(tmp_path):
    repo = _kit_repo(tmp_path)
    (repo / KIT / "scripts/detach-probe").write_text("", encoding="utf-8")

    assert validator.discover_executable_paths(repo) == EXPECTED_KIT_PATHS


def test_unmerged_spec_fails_closed(tmp_path):
    repo = _kit_repo(tmp_path)
    spec = f"{KIT}/spec.yaml"
    blob = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", f":{spec}"], check=True, capture_output=True, text=True
    ).stdout.strip()
    _git(repo, "update-index", "--force-remove", spec)
    subprocess.run(
        ["git", "-C", str(repo), "update-index", "--index-info"],
        input=f"100644 {blob} 1\t{spec}\n",
        check=True,
        capture_output=True,
        text=True,
    )

    with pytest.raises(validator.ExecutableModeError, match="unmerged"):
        validator.discover_executable_paths(repo)


def test_full_ci_reuses_the_validate_target():
    """The advertised full check must not bypass the mode gate without pre-commit."""
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    ci_body = makefile.split("ci:", 1)[1].split("\nclean:", 1)[0]
    assert "$(MAKE) --no-print-directory validate" in ci_body
