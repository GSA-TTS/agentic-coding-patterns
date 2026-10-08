from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "integrations/isolation/acq-kits/oci-engine/files/home/oci-engine-vfs-fallback.sh"


def _fake_podman(fake_bin: Path, podman_log: Path) -> None:
    podman = fake_bin / "podman"
    podman.write_text(
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$PODMAN_LOG"\nexit 0\n',
        encoding="utf-8",
    )
    podman.chmod(0o755)


def test_vfs_fallback_skips_build_when_timeout_is_unavailable(tmp_path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    podman_log = tmp_path / "podman.log"
    _fake_podman(fake_bin, podman_log)

    env = os.environ.copy()
    env.update(
        {
            "HOME": str(tmp_path / "home"),
            "PATH": str(fake_bin),
            "PODMAN_LOG": str(podman_log),
        }
    )

    result = subprocess.run(["/bin/sh", str(SCRIPT)], env=env, text=True, capture_output=True, check=False)

    assert result.returncode == 0
    assert "timeout command unavailable" in result.stderr
    assert not podman_log.exists()


@pytest.mark.parametrize("timeout_value", ["", "0", "00", "000", "abc"])
def test_vfs_fallback_rejects_invalid_timeout_values(tmp_path, timeout_value):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    podman_log = tmp_path / "podman.log"
    timeout_log = tmp_path / "timeout.log"
    _fake_podman(fake_bin, podman_log)
    timeout = fake_bin / "timeout"
    timeout.write_text(
        '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$TIMEOUT_LOG"\nshift\nexec "$@"\n',
        encoding="utf-8",
    )
    timeout.chmod(0o755)

    env = os.environ.copy()
    env.update(
        {
            "HOME": str(tmp_path / "home"),
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "PODMAN_LOG": str(podman_log),
            "TIMEOUT_LOG": str(timeout_log),
            "OCI_ENGINE_SELFTEST_TIMEOUT": timeout_value,
        }
    )

    result = subprocess.run(["/bin/sh", str(SCRIPT)], env=env, text=True, capture_output=True, check=False)

    assert result.returncode == 0
    assert timeout_log.read_text(encoding="utf-8").splitlines() == ["120"]
    assert "build -q -t oci-engine-selftest:local" in podman_log.read_text(encoding="utf-8")
