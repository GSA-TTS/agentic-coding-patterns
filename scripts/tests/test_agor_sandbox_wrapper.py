"""Regression tests for the Agor acq sandbox wrapper."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / "integrations/orchestrators/agor/sandbox-wrapper-acq.sh"
INSTALLER = ROOT / "integrations/isolation/acq-kits/agor-daemon-egress/files/home/agor-executor-install.sh"


def _fake_acq(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    acq = bin_dir / "acq"
    acq.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "printf '%s\\n' \"$*\" >> \"${ACQ_LOG:?}\"\n"
        "for arg in \"$@\"; do\n"
        "  if [[ \"$arg\" == \"exec\" ]]; then cat > \"${ACQ_STDIN:?}\"; break; fi\n"
        "done\n",
        encoding="utf-8",
    )
    acq.chmod(0o755)
    return bin_dir


def _run_wrapper(tmp_path: Path, cwd: Path, *, env: dict[str, str] | None = None, dry_run: bool = True):
    if shutil.which("jq") is None:
        pytest.skip("jq is required by sandbox-wrapper-acq.sh")

    run_env = os.environ.copy()
    run_env.update(
        {
            "PATH": f"{_fake_acq(tmp_path)}:{run_env['PATH']}",
            "ACQ_LOG": str(tmp_path / "acq.log"),
            "ACQ_STDIN": str(tmp_path / "acq.stdin"),
            "AGOR_DATA_HOME": str(tmp_path / "agor-data"),
            "AGOR_SANDBOX_DRY_RUN": "1" if dry_run else "0",
        }
    )
    if env:
        run_env.update(env)

    payload = {"params": {"cwd": str(cwd)}, "daemonUrl": "http://localhost:3030"}
    return subprocess.run(
        [str(WRAPPER), "abcdef123456"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=run_env,
        check=False,
    )


def _managed_clone(tmp_path: Path) -> Path:
    clone = tmp_path / "agor-data/worktrees/clone"
    (clone / ".git").mkdir(parents=True)
    return clone


def _local_clone(tmp_path: Path) -> Path:
    clone = tmp_path / "local-clone"
    (clone / ".git").mkdir(parents=True)
    return clone


def _managed_worktree(tmp_path: Path, *, main_under_worktrees_segment: bool = False) -> tuple[Path, Path]:
    if main_under_worktrees_segment:
        main = tmp_path / "agor-data/worktrees/history/repos/project"
    else:
        main = tmp_path / "agor-data/repos/project"
    main_git = main / ".git"
    worktree = tmp_path / "agor-data/worktrees/wt1"
    (main_git / "worktrees/wt1").mkdir(parents=True)
    worktree.mkdir(parents=True)
    (worktree / ".git").write_text(f"gitdir: {main_git}/worktrees/wt1\n", encoding="utf-8")
    return worktree, main_git


def test_clone_mode_refuses_arbitrary_host_clone(tmp_path: Path):
    result = _run_wrapper(tmp_path, _local_clone(tmp_path))

    assert result.returncode == 5
    assert "refusing to mount a non-Agor-managed clone" in result.stderr


def test_clone_mode_allows_agor_managed_clone(tmp_path: Path):
    clone = _managed_clone(tmp_path)
    result = _run_wrapper(tmp_path, clone)

    assert result.returncode == 0, result.stderr
    assert f"[dry-run] mounts:        {clone}" in result.stdout
    assert "--kit" not in result.stdout


def test_worktree_mode_uses_last_git_worktrees_suffix(tmp_path: Path):
    worktree, main_git = _managed_worktree(tmp_path, main_under_worktrees_segment=True)
    result = _run_wrapper(tmp_path, worktree)

    assert result.returncode == 0, result.stderr
    mounts_line = result.stdout.split("[dry-run] mounts:", 1)[1].splitlines()[0].split()
    assert mounts_line == [str(worktree), str(main_git)]
    assert str(tmp_path / "agor-data") not in mounts_line


def test_worktree_mode_refuses_unmanaged_worktree_even_with_managed_main(tmp_path: Path):
    _, main_git = _managed_worktree(tmp_path)
    worktree = tmp_path / "local-worktree"
    worktree.mkdir()
    (worktree / ".git").write_text(f"gitdir: {main_git}/worktrees/wt1\n", encoding="utf-8")

    result = _run_wrapper(tmp_path, worktree)

    assert result.returncode == 5
    assert "refusing to mount a non-Agor-managed worktree" in result.stderr


def test_sbx_backend_sets_backend_arg_and_daemon_alias(tmp_path: Path):
    clone = _managed_clone(tmp_path)
    result = _run_wrapper(tmp_path, clone, env={"AGOR_ACQ_BACKEND": "sbx"}, dry_run=False)

    assert result.returncode == 0, result.stderr
    acq_log = (tmp_path / "acq.log").read_text(encoding="utf-8")
    rewritten = json.loads((tmp_path / "acq.stdin").read_text(encoding="utf-8"))
    assert "--backend sbx create shell" in acq_log
    assert rewritten["daemonUrl"] == "http://host.docker.internal:3030"


def test_invalid_backend_fails_closed_before_mounting(tmp_path: Path):
    clone = _managed_clone(tmp_path)
    result = _run_wrapper(tmp_path, clone, env={"AGOR_ACQ_BACKEND": "docker"})

    assert result.returncode == 2
    assert "unsupported AGOR_ACQ_BACKEND" in result.stderr


def _fake_npm(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "npm-bin"
    npm_root = tmp_path / "npm-root"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text(
        "#!/usr/bin/env sh\n"
        "set -u\n"
        "if [ \"${1:-}\" = \"root\" ] && [ \"${2:-}\" = \"-g\" ]; then\n"
        "  printf '%s\\n' \"${NPM_ROOT:?}\"\n"
        "  exit 0\n"
        "fi\n"
        "printf '%s\\n' \"$*\" >> \"${NPM_LOG:?}\"\n"
        "mkdir -p \"${NPM_ROOT:?}/agor-live/dist/executor\"\n"
        "printf 'console.log(\\\"executor\\\")\\n' > \"${NPM_ROOT:?}/agor-live/dist/executor/cli.js\"\n",
        encoding="utf-8",
    )
    npm.chmod(0o755)
    return bin_dir


def _run_installer(tmp_path: Path, *, env: dict[str, str] | None = None):
    run_env = os.environ.copy()
    run_env.update(
        {
            "PATH": f"{_fake_npm(tmp_path)}:{run_env['PATH']}",
            "NPM_ROOT": str(tmp_path / "npm-root"),
            "NPM_LOG": str(tmp_path / "npm.log"),
            "AGOR_EXECUTOR_BIN": str(tmp_path / "agor-executor"),
        }
    )
    if env:
        run_env.update(env)
    return subprocess.run(
        ["sh", str(INSTALLER)],
        text=True,
        capture_output=True,
        env=run_env,
        check=False,
    )


def test_installer_defaults_to_pinned_version_and_ignores_npm_scripts(tmp_path: Path):
    result = _run_installer(tmp_path)

    assert result.returncode == 0, result.stderr
    npm_log = (tmp_path / "npm.log").read_text(encoding="utf-8")
    assert "install -g --no-fund --ignore-scripts agor-live@0.26.8" in npm_log
    assert (tmp_path / "agor-executor").is_file()


def test_installer_warns_when_latest_is_explicitly_selected(tmp_path: Path):
    result = _run_installer(tmp_path, env={"AGOR_EXECUTOR_VERSION": "latest"})

    assert result.returncode == 0
    assert "AGOR_EXECUTOR_VERSION=latest is an explicit reproducibility opt-out" in result.stderr
    assert "agor-live@latest" in (tmp_path / "npm.log").read_text(encoding="utf-8")


def test_installer_rewrites_stale_shim_instead_of_trusting_substring_match(tmp_path: Path):
    npm_root = tmp_path / "npm-root"
    cli_path = npm_root / "agor-live/dist/executor/cli.js"
    cli_path.parent.mkdir(parents=True)
    cli_path.write_text("console.log('executor')\n", encoding="utf-8")
    shim = tmp_path / "agor-executor"
    shim.write_text(f"#!/bin/sh\n# stale but mentions {cli_path}\nexit 99\n", encoding="utf-8")
    shim.chmod(0o755)

    result = _run_installer(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "stale agor-executor shim" in result.stderr
    assert shim.read_text(encoding="utf-8") == f'#!/bin/sh\nexec node "{cli_path}" "$@"\n'
