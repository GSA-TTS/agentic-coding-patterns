"""Regression tests for the cloud-gov kit's CF CLI fetch ordering.

The CF CLI download is HTTPS. On a network that intercepts TLS, the CA-trust kit
(zscaler-ca-certificate) installs its CA in a startup step. A `phase: install`
fetch runs at create time, before that CA is trusted, so curl exits 60 and the
whole sandbox create fails. These tests lock in that the fetch runs in a startup
phase (after CA trust in kit order), is non-fatal, and behaves correctly with a
simulated intercepted network (curl fails with exit 60 until the CA is trusted).

The live path (a real intercepted host) is exercised by the kit's
`scripts/verify` with RUN_ACQ=1 ACQ_BACKEND=sbx (no CA_KIT: the global bundle
already supplies the CA kit); CI cannot nest sandboxes.
"""

from __future__ import annotations

import os
import stat
import subprocess
import tarfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "integrations" / "isolation" / "acq-kits" / "cloud-gov"
CA_KIT = ROOT / "integrations" / "isolation" / "acq-kits" / "zscaler-ca-certificate"
INSTALL = KIT / "files" / "home" / "cloud-gov-install-cf-cli.sh"
CF_X86_SHA = "98268ab3134bb3a1c97ffce797b4e6d35590a82e006cd098ad7a29f0a5cae7d8"


def _spec() -> dict:
    return yaml.safe_load((KIT / "spec.yaml").read_text())


def _refs_install_script(cmd: dict) -> bool:
    return "cloud-gov-install-cf-cli.sh" in " ".join(cmd["command"])


def test_cf_fetch_is_not_in_install_phase():
    for cmd in _spec()["commands"]:
        if cmd.get("phase") == "install":
            assert not _refs_install_script(cmd), "network fetch must not run at create time"


def test_cf_fetch_runs_in_startup_as_agent_and_is_non_fatal():
    cmds = [c for c in _spec()["commands"] if _refs_install_script(c)]
    assert len(cmds) == 1
    cmd = cmds[0]
    assert cmd["phase"] == "startup"
    assert cmd["user"] == "1000"
    body = " ".join(cmd["command"])
    assert "WARNING: cf CLI is not installed" in body and body.rstrip().endswith("exit 0")


def test_install_precedes_auth_configure_in_startup():
    startup = [c for c in _spec()["commands"] if c.get("phase") == "startup"]
    names = [("install" if _refs_install_script(c) else "other") for c in startup]
    assert names[0] == "install"


def _stub(path: Path, body: str) -> None:
    path.write_text("#!/bin/sh\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


@pytest.fixture
def intercepted(tmp_path):
    """A fake host: curl exits 60 unless the CA marker file exists."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    ca_marker = tmp_path / "ca-trusted"
    if Path("/usr/bin/cf").exists() or Path("/bin/cf").exists():
        pytest.skip("host has a real cf on PATH")

    payload = tmp_path / "payload"
    payload.mkdir()
    fake_cf = payload / "cf8"
    fake_cf.write_text("#!/bin/sh\necho 'cf version 8.19.0-test'\n")
    fake_cf.chmod(0o755)
    tgz = tmp_path / "cf.tgz"
    with tarfile.open(tgz, "w:gz") as t:
        t.add(fake_cf, arcname="cf8")

    _stub(
        bin_dir / "curl",
        f'''[ -e "{ca_marker}" ] || {{ echo "curl: (60) SSL certificate problem" >&2; exit 60; }}
out=""
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
cp "{tgz}" "$out"
''',
    )
    _stub(bin_dir / "uname", "echo x86_64\n")
    _stub(bin_dir / "sha256sum", f'echo "${{FAKE_SHA:-{CF_X86_SHA}}}  $1"\n')
    # `command -v cf` must not find a real cf on the host.
    env = {
        "HOME": str(home),
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "TMPDIR": str(tmp_path),
    }
    return env, home, ca_marker


def _run(env):
    return subprocess.run(["/bin/sh", str(INSTALL)], env=env, capture_output=True, text=True, timeout=30)


def test_untrusted_chain_fails_with_actionable_message_and_installs_nothing(intercepted):
    env, home, _ = intercepted
    res = _run(env)
    assert res.returncode != 0
    assert "(curl exit 60)" in res.stderr and "CA-trust kit" in res.stderr
    assert not (home / ".local" / "bin" / "cf").exists()


def test_install_succeeds_once_ca_is_trusted(intercepted):
    env, home, ca_marker = intercepted
    ca_marker.write_text("")
    res = _run(env)
    assert res.returncode == 0, res.stderr
    cf = home / ".local" / "bin" / "cf"
    assert cf.exists() and os.access(cf, os.X_OK)


def test_sha_mismatch_refuses_install_once_ca_is_trusted(intercepted):
    env, home, ca_marker = intercepted
    ca_marker.write_text("")
    res = _run({**env, "FAKE_SHA": "0" * 64})
    assert res.returncode != 0
    assert "SHA-256 mismatch" in res.stderr
    assert not (home / ".local" / "bin" / "cf").exists()


def test_ca_kit_trusts_in_startup_so_cf_fetch_must_follow_it():
    ca = yaml.safe_load((CA_KIT / "spec.yaml").read_text())
    assert {c.get("phase") for c in ca["commands"]} == {"startup"}
    assert ca["backend_shortcuts"]["msb"]["trust_host_cas"] is True


def test_startup_wrapper_swallows_failure_on_untrusted_network(intercepted):
    env, home, _ = intercepted
    wrapper = next(c for c in _spec()["commands"] if _refs_install_script(c))["command"]
    # Run the real wrapper argv with the install script path pointed at the repo copy.
    script = wrapper[2].replace("/home/agent/cloud-gov-install-cf-cli.sh", str(INSTALL))
    res = subprocess.run([wrapper[0], wrapper[1], script], env=env, capture_output=True, text=True, timeout=30)
    assert res.returncode == 0
    assert "WARNING: cf CLI is not installed" in res.stderr
