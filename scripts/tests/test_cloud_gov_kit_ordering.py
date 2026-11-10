"""Offline regression tests for the cloud-gov kit's CF CLI install and auth guard.

What these tests DO cover:
  - the CF CLI fetch is a non-fatal `startup` command run as the agent user, not
    an `install`-phase command (which runs at create time, before any CA kit's
    startup step);
  - the install script's SHA-256 verification, against real fixture bytes, with a
    changed-byte negative control (the script is copied with its pinned digests
    rewritten to the fixture's real digest, because the real upstream tarball is
    not available offline);
  - composed startup against a fixture: the zscaler kit's REAL startup command
    and the cloud-gov install wrapper, run in that order, install `cf` on a
    simulated TLS-intercepting network (`curl` exits 60 until the fixture trust
    bundle contains the CA), and run in the reverse order they do not;
  - the auth script makes no filesystem change when the injected value is bad.

What they do NOT cover:
  - that acq actually runs the bundle's startup commands in kit order (the
    harness here orders them itself);
  - the pinned digests against the real upstream tarballs;
  - post-install integrity (`~/.local/bin/cf` is agent-writable by design).

The live check is `scripts/verify` with RUN_ACQ=1 ACQ_BACKEND=sbx on an
intercepted network (no CA_KIT: the global bundle already supplies the CA kit);
CI cannot nest sandboxes.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import tarfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
KITS = ROOT / "integrations" / "isolation" / "acq-kits"
KIT = KITS / "cloud-gov"
CA_KIT = KITS / "zscaler-ca-certificate"
INSTALL = KIT / "files" / "home" / "cloud-gov-install-cf-cli.sh"
AUTH = KIT / "files" / "home" / "cloud-gov-configure-cf-auth.sh"
SYSTEM_PATH = "/usr/bin:/bin"


def _spec() -> dict:
    return yaml.safe_load((KIT / "spec.yaml").read_text())


def _refs_install_script(cmd: dict) -> bool:
    return "cloud-gov-install-cf-cli.sh" in " ".join(cmd["command"])


def _install_cmd() -> dict:
    cmds = [c for c in _spec()["commands"] if _refs_install_script(c)]
    assert len(cmds) == 1
    return cmds[0]


def _stub(path: Path, body: str) -> None:
    path.write_text("#!/bin/sh\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def test_cf_fetch_is_not_in_install_phase():
    for cmd in _spec()["commands"]:
        if cmd.get("phase") == "install":
            assert not _refs_install_script(cmd), "network fetch must not run at create time"


def test_cf_fetch_runs_in_startup_as_agent_and_is_non_fatal():
    cmd = _install_cmd()
    assert cmd["phase"] == "startup"
    assert cmd["user"] == "1000"
    body = " ".join(cmd["command"])
    assert "WARNING: cf CLI is not installed" in body and body.rstrip().endswith("exit 0")


def test_install_is_first_startup_command():
    startup = [c for c in _spec()["commands"] if c.get("phase") == "startup"]
    assert _refs_install_script(startup[0])


def test_ca_kit_trusts_in_startup_so_cf_fetch_must_follow_it():
    ca = yaml.safe_load((CA_KIT / "spec.yaml").read_text())
    assert {c.get("phase") for c in ca["commands"]} == {"startup"}
    assert ca["backend_shortcuts"]["msb"]["trust_host_cas"] is True


def test_pinned_digests_are_well_formed_and_distinct():
    text = INSTALL.read_text()
    digests = re.findall(r'^CF_CLI_SHA256_\w+="([0-9a-f]+)"$', text, re.M)
    assert len(digests) == 2
    assert all(len(d) == 64 for d in digests) and len(set(digests)) == 2


class Fixture:
    def __init__(self, tmp_path: Path):
        if Path("/usr/bin/cf").exists() or Path("/bin/cf").exists():
            pytest.skip("host has a real cf on PATH")
        self.root = tmp_path
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        self.home = tmp_path / "home"
        self.home.mkdir()
        self.ca_src = tmp_path / "agent-home"  # stands in for /home/agent
        self.ca_src.mkdir()
        self.ca_dir = tmp_path / "ca-certificates"  # stands in for /usr/local/share/ca-certificates
        self.ca_dir.mkdir()
        self.bundle = tmp_path / "ca-bundle.crt"

        payload = tmp_path / "cf8"
        payload.write_text("#!/bin/sh\necho 'cf version 8.19.0-fixture'\n")
        payload.chmod(0o755)
        self.tgz = tmp_path / "cf.tgz"
        with tarfile.open(self.tgz, "w:gz") as t:
            t.add(payload, arcname="cf8")
        self.digest = hashlib.sha256(self.tgz.read_bytes()).hexdigest()

        # The real CA cert from the zscaler kit: the fixture "trusts" the proxy
        # only once update-ca-certificates has folded this file into the bundle.
        self.ca_pem = (CA_KIT / "files" / "home" / "zscaler-ca.crt").read_text()
        marker = self.ca_pem.splitlines()[1]
        self.serve = tmp_path / "serve.tgz"
        self.serve.write_bytes(self.tgz.read_bytes())

        _stub(
            self.bin / "curl",
            f'''grep -qF "{marker}" "{self.bundle}" 2>/dev/null || {{
  echo "curl: (60) SSL certificate problem: unable to get local issuer certificate" >&2
  exit 60
}}
out=""
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
cp "{self.serve}" "$out"
''',
        )
        _stub(self.bin / "uname", "echo x86_64\n")
        _stub(
            self.bin / "update-ca-certificates",
            f'cat "{self.ca_dir}"/*.crt > "{self.bundle}"\n',
        )
        (self.ca_src / "zscaler-ca.crt").write_text(self.ca_pem)

        # Copy of the production install script with BOTH pinned digests replaced
        # by the fixture's real digest, so sha256sum runs for real on real bytes.
        text = INSTALL.read_text()
        rewritten = re.sub(r'^(CF_CLI_SHA256_\w+=)"[0-9a-f]+"$', rf'\1"{self.digest}"', text, flags=re.M)
        assert rewritten != text, "pinned digest lines not found; update this fixture"
        self.install = tmp_path / "cloud-gov-install-cf-cli.sh"
        self.install.write_text(rewritten)

        self.env = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:{SYSTEM_PATH}",
            "TMPDIR": str(tmp_path),
        }

    @property
    def cf(self) -> Path:
        return self.home / ".local" / "bin" / "cf"

    def run_install(self, **extra_env):
        return subprocess.run(
            ["/bin/sh", str(self.install)],
            env={**self.env, **extra_env},
            capture_output=True,
            text=True,
            timeout=30,
        )

    def run_ca_kit_startup(self):
        """Run the zscaler kit's real startup command, paths pointed at the fixture."""
        ca = yaml.safe_load((CA_KIT / "spec.yaml").read_text())
        cmd = next(c for c in ca["commands"] if c["phase"] == "startup")["command"]
        script = cmd[2]
        assert "/home/agent/zscaler-ca.crt" in script and "update-ca-certificates" in script
        script = script.replace("/home/agent/zscaler-ca.crt", str(self.ca_src / "zscaler-ca.crt"))
        assert "/usr/local/share/ca-certificates/" in script
        script = script.replace("/usr/local/share/ca-certificates/", f"{self.ca_dir}/")
        assert "/usr/local/share" not in script, "fixture must never touch the real CA dir"
        return subprocess.run([cmd[0], cmd[1], script], env=self.env, capture_output=True, text=True, timeout=30)

    def run_cloud_gov_wrapper(self):
        """Run the real cloud-gov install wrapper argv, script path pointed at the fixture."""
        cmd = _install_cmd()["command"]
        script = cmd[2].replace("/home/agent/cloud-gov-install-cf-cli.sh", str(self.install))
        assert str(self.install) in script
        return subprocess.run([cmd[0], cmd[1], script], env=self.env, capture_output=True, text=True, timeout=30)


@pytest.fixture
def fx(tmp_path):
    return Fixture(tmp_path)


def test_untrusted_chain_fails_with_actionable_message_and_installs_nothing(fx):
    res = fx.run_install()
    assert res.returncode != 0
    assert "(curl exit 60)" in res.stderr and "CA-trust kit" in res.stderr
    assert not fx.cf.exists()


def test_real_digest_of_fixture_bytes_installs(fx):
    fx.run_ca_kit_startup()
    res = fx.run_install()
    assert res.returncode == 0, res.stderr
    assert fx.cf.exists() and os.access(fx.cf, os.X_OK)


def test_changed_byte_in_archive_is_refused(fx):
    fx.run_ca_kit_startup()
    tampered = bytearray(fx.tgz.read_bytes())
    tampered[-1] ^= 0xFF
    fx.serve.write_bytes(bytes(tampered))
    assert hashlib.sha256(bytes(tampered)).hexdigest() != fx.digest
    res = fx.run_install()
    assert res.returncode != 0
    assert "SHA-256 mismatch" in res.stderr
    assert not fx.cf.exists()


def test_ca_kit_then_cloud_gov_startup_installs_cf(fx):
    ca = fx.run_ca_kit_startup()
    assert ca.returncode == 0, ca.stderr
    res = fx.run_cloud_gov_wrapper()
    assert res.returncode == 0, res.stderr
    assert fx.cf.exists() and os.access(fx.cf, os.X_OK)


def test_cloud_gov_before_ca_kit_does_not_install_and_stays_non_fatal(fx):
    res = fx.run_cloud_gov_wrapper()
    assert res.returncode == 0, "the wrapper must not fail sandbox start"
    assert "WARNING: cf CLI is not installed" in res.stderr
    assert not fx.cf.exists()
    fx.run_ca_kit_startup()
    assert fx.run_cloud_gov_wrapper().returncode == 0
    assert fx.cf.exists(), "the idempotent step retries successfully once CA trust exists"


@pytest.mark.parametrize(
    "token",
    [
        "bearer TOKEN_HEADER.TOKEN_BODY.TOKEN_SIGNATURE",
        "bearerTOKENMATERIAL",
        "BearerTOKENMATERIAL",
        "TOKEN_HEADER.TOKEN_BODY.TOKEN_SIGNATURE",
        "not-a-placeholder",
        "acq_placeholder_abc\tdef",
    ],
)
def test_auth_script_rejects_bad_token_before_any_side_effect(tmp_path, token):
    home = tmp_path / "home"
    home.mkdir()
    res = subprocess.run(
        ["/bin/sh", str(AUTH)],
        env={"HOME": str(home), "PATH": SYSTEM_PATH, "CF_OAUTH_TOKEN": token},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode != 0
    assert list(home.iterdir()) == [], "no ~/.cf (or anything else) before validation passes"
    assert token not in res.stderr


def test_auth_script_accepts_known_placeholder_shape_and_then_creates_config_dir(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    res = subprocess.run(
        ["/bin/sh", str(AUTH)],
        env={
            "HOME": str(home),
            "PATH": SYSTEM_PATH,
            "CF_OAUTH_TOKEN": "acq_placeholder_abcdefghijklmnopqrstuvwxyz012345",
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode == 0, res.stderr
    assert (home / ".cf").is_dir()


VERIFY = KIT / "scripts" / "verify"
BASH = "/bin/bash"


def _verify_stubs(tmp_path: Path, cf_api_out: str, cf_api_rc: int = 0):
    """Stub cf/curl/acq/sbx that record every call; return (bin dir, call log)."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "calls.log"
    _stub(
        bindir / "cf",
        f'echo "cf $*" >> "{log}"\n'
        'case "$1" in\n'
        f"  api) printf '%s\\n' '{cf_api_out}'; exit {cf_api_rc} ;;\n"
        "  oauth-token) echo 'bearer HOSTTOKEN' ;;\n"
        "esac\n",
    )
    _stub(bindir / "curl", f'echo "curl $*" >> "{log}"; cat >> "{log}"; printf 200\n')
    for name in ("acq", "sbx"):
        _stub(bindir / name, f'echo "{name} $*" >> "{log}"; exit 1\n')
    return bindir, log


def _run_host_control(tmp_path: Path, cf_api_out: str, cf_api_rc: int = 0) -> str:
    bindir, log = _verify_stubs(tmp_path, cf_api_out, cf_api_rc)
    script = f'CLOUD_GOV_VERIFY_LIB_ONLY=1 . "{VERIFY}"; host_control; echo "status=$host_status"'
    res = subprocess.run(
        [BASH, "-c", script],
        env={"PATH": f"{bindir}:{SYSTEM_PATH}", "HOME": str(tmp_path)},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode == 0, res.stderr
    return res.stdout + (log.read_text() if log.exists() else "")


def test_host_control_sends_token_only_for_exact_cloud_gov_endpoint(tmp_path):
    out = _run_host_control(tmp_path, "api endpoint:   https://api.fr.cloud.gov")
    assert "cf oauth-token" in out
    assert "curl " in out and "status=200" in out


@pytest.mark.parametrize(
    "cf_api_out,cf_api_rc",
    [
        ("api endpoint:   https://api.fr.cloud.gov.example.net", 0),
        ("api endpoint:   https://evil.example/api.fr.cloud.gov", 0),
        ("api endpoint:   https://xapi.fr.cloud.gov", 0),
        ("api endpoint:   http://api.fr.cloud.gov", 0),
        ("api endpoint:   https://api.fr.cloud.gov\napi endpoint:   https://other.example", 0),
        ("api endpoint:   https://api.fr.cloud.gov", 1),
        ("No api endpoint set.", 0),
    ],
)
def test_host_control_rejects_lookalike_and_failed_lookups(tmp_path, cf_api_out, cf_api_rc):
    out = _run_host_control(tmp_path, cf_api_out, cf_api_rc)
    assert "cf oauth-token" not in out
    assert "curl " not in out
    assert "status=\n" in out or out.rstrip().endswith("status=")


def _run_live_verify(tmp_path: Path, backend: str | None):
    bindir, log = _verify_stubs(tmp_path, "api endpoint:   https://api.fr.cloud.gov")
    env = {
        "PATH": f"{bindir}:{SYSTEM_PATH}:/usr/local/bin",
        "HOME": str(tmp_path),
        "RUN_ACQ": "1",
        "TMPDIR": str(tmp_path),
    }
    if backend:
        env["ACQ_BACKEND"] = backend
    res = subprocess.run([BASH, str(VERIFY)], env=env, capture_output=True, text=True, timeout=120)
    return res, (log.read_text() if log.exists() else "")


def test_live_verify_requires_explicit_backend_before_any_secret_check(tmp_path):
    res, calls = _run_live_verify(tmp_path, None)
    assert res.returncode == 2
    assert "ACQ_BACKEND" in res.stderr
    assert "secret" not in calls and "create" not in calls


def test_live_verify_sbx_checks_the_sbx_store_not_acq(tmp_path):
    res, calls = _run_live_verify(tmp_path, "sbx")
    assert res.returncode != 0
    assert "sbx secret ls" in calls
    assert "acq secret has" not in calls
    assert "sbx secret set-custom" in res.stderr


def test_live_verify_msb_checks_the_acq_store_not_sbx(tmp_path):
    res, calls = _run_live_verify(tmp_path, "msb")
    assert res.returncode != 0
    assert "acq secret has" in calls
    assert "sbx " not in calls
    assert "acq secret set" in res.stderr


def test_verify_script_is_executable():
    assert os.access(VERIFY, os.X_OK)


def test_lib_only_env_is_refused_when_executed(tmp_path):
    res = subprocess.run(
        [BASH, str(VERIFY)],
        env={"PATH": SYSTEM_PATH, "HOME": str(tmp_path), "CLOUD_GOV_VERIFY_LIB_ONLY": "1"},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode == 2
