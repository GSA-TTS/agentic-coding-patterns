"""Offline tests for the cloud-gov kit's `scripts/setup-service-account`.

Nothing here contacts cloud.gov, sbx, or acq. A stub `cf` (stateful, in a temp
dir), `acq`, and `sbx` sit first on PATH and record argv, the NAMES of CF_*
environment variables, and the CF_HOME value. The stub holds a canary service-key
username/password and a canary token. After every run the tests scan stdout,
stderr, every recorded argv, and every file the script wrote (HOME, the working
directory, TMPDIR) for the canaries in raw, base64, and hex forms.

What they do NOT prove: that real `cf`/`sbx`/`acq` behave like the stubs. The
script is documented as untested against the real services; the stubs encode the
same assumptions the script labels untested (service-key JSON shape, `cf auth`
reading CF_USERNAME/CF_PASSWORD from the environment, CF_HOME isolation).
"""

from __future__ import annotations

import base64
import json
import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "integrations" / "isolation" / "acq-kits" / "cloud-gov"
SCRIPT = KIT / "scripts" / "setup-service-account"
VERIFY = KIT / "scripts" / "verify"
BASH = "/bin/bash"

CANARY_USER = "svc-user-CANARY-7f3a91"
CANARY_PASS = "pw-CANARY-Zx9q2Lm4"  # noqa: S105 - synthetic canary, not a credential
CANARY_TOKEN = "CANARYTOKEN.abc123.sig456"  # noqa: S105 - synthetic canary
OWN_TOKEN = "USEROWNTOKEN.zzz.yyy"  # noqa: S105 - synthetic canary

CF_STUB = r"""#!/usr/bin/env python3
import json, os, sys
state = os.environ["STUB_DIR"]
args = sys.argv[1:]
rec = {"argv": ["cf"] + args,
       "env": sorted(k for k in os.environ if k.startswith("CF_")),
       "cf_home": os.environ.get("CF_HOME")}
with open(os.path.join(state, "calls.jsonl"), "a") as f:
    f.write(json.dumps(rec) + "\n")
USER, PW, TOKEN = os.environ["STUB_USER"], os.environ["STUB_PASS"], os.environ["STUB_TOKEN"]
cmd = args[0] if args else ""
inst_dir = os.path.join(state, "instances")
keys_dir = os.path.join(state, "keys")
os.makedirs(inst_dir, exist_ok=True)
os.makedirs(keys_dir, exist_ok=True)
home = os.environ.get("CF_HOME")

def inst_path(n): return os.path.join(inst_dir, n)

if cmd == "api":
    if len(args) == 1:
        print("api endpoint:   " + os.environ.get("STUB_ENDPOINT", "https://api.fr.cloud.gov"))
        print("api version:    3.1")
    else:
        if home:
            os.makedirs(home, exist_ok=True)
    sys.exit(0)
if cmd == "target":
    if os.environ.get("STUB_NO_TARGET"):
        print("FAILED"); sys.exit(1)
    print("api endpoint:   https://api.fr.cloud.gov")
    print("user:           someone@example.gov")
    print("org:            demo-org")
    print("space:          demo-space")
    sys.exit(0)
if cmd == "service":
    p = inst_path(args[1])
    if not os.path.exists(p):
        print("Service instance %s not found" % args[1]); sys.exit(1)
    off, plan = open(p).read().split()
    print("name:            " + args[1])
    print("offering:        " + off)
    print("plan:            " + plan)
    sys.exit(0)
if cmd == "create-service":
    open(inst_path(args[3]), "w").write(args[1] + " " + args[2])
    sys.exit(0)
if cmd == "service-keys":
    print("Getting keys for service instance %s as someone@example.gov..." % args[1])
    print("\nname")
    d = os.path.join(keys_dir, args[1])
    for k in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        print(k)
    sys.exit(0)
if cmd == "create-service-key":
    d = os.path.join(keys_dir, args[1]); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, args[2]), "w").write("k")
    sys.exit(0)
if cmd == "delete-service-key":
    p = os.path.join(keys_dir, args[1], args[2])
    if os.path.exists(p): os.remove(p)
    sys.exit(0)
if cmd == "service-key":
    print("Getting service key %s for service instance %s as someone@example.gov...\n" % (args[2], args[1]))
    print(json.dumps({"credentials": {"username": USER, "password": PW}}))
    sys.exit(0)
if cmd == "auth":
    if os.environ.get("STUB_AUTH_FAIL"): print("Credentials were rejected"); sys.exit(1)
    via_env = os.environ.get("CF_USERNAME") == USER and os.environ.get("CF_PASSWORD") == PW and len(args) == 1
    via_argv = args[1:] == [USER, PW]  # accepted on purpose, so a leak is caught by the scans, not by a stub refusal
    if not (via_env or via_argv):
        print("FAILED"); sys.exit(1)
    open(os.path.join(home, ".session"), "w").write("session-ok")
    sys.exit(0)
if cmd == "oauth-token":
    if home and os.path.exists(os.path.join(home, ".session")):
        print("bearer " + TOKEN)
    else:
        print("bearer " + os.environ["STUB_OWN_TOKEN"])
    sys.exit(0)
print("unexpected cf command: " + " ".join(args), file=sys.stderr); sys.exit(9)
"""

BACKEND_STUB = r"""#!/bin/sh
echo "NAME $*" >> "$STUB_DIR/backend.log"
case "$*" in
  *"secret set "*) cat > "$STUB_DIR/backend.stdin" ;;
esac
[ -n "${STUB_BACKEND_FAIL:-}" ] && exit 1
exit 0
"""


class Env:
    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.stub = tmp / "stub"
        self.home = tmp / "home"
        self.work = tmp / "work"
        self.tmpdir = tmp / "tmpdir"
        self.bin = tmp / "bin"
        for d in (self.stub, self.home, self.work, self.tmpdir, self.bin):
            d.mkdir()
        cf = self.bin / "cf"
        cf.write_text(CF_STUB)
        cf.chmod(0o755)
        for name in ("acq", "sbx"):
            p = self.bin / name
            p.write_text(BACKEND_STUB.replace("NAME", name))
            p.chmod(0o755)
        self.cf_home = self.home / ".cf-cloud-gov-agent" / "cloud-gov-agent-box1-auditor"

    def run(
        self,
        *args: str,
        extra_env: dict | None = None,
        stdin: str | None = "",
        script: Path = SCRIPT,
        bash_flags: tuple[str, ...] = (),
    ):
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "HOME": str(self.home),
            "TMPDIR": str(self.tmpdir),
            "STUB_DIR": str(self.stub),
            "STUB_USER": CANARY_USER,
            "STUB_PASS": CANARY_PASS,
            "STUB_TOKEN": CANARY_TOKEN,
            "STUB_OWN_TOKEN": OWN_TOKEN,
        }
        env.update(extra_env or {})
        return subprocess.run(
            [BASH, *bash_flags, str(script), *args],
            env=env,
            cwd=self.work,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def cf_calls(self) -> list[dict]:
        p = self.stub / "calls.jsonl"
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def cf_verbs(self) -> list[str]:
        return [c["argv"][1] for c in self.cf_calls() if len(c["argv"]) > 1]

    def backend_calls(self) -> list[str]:
        p = self.stub / "backend.log"
        return p.read_text().splitlines() if p.exists() else []

    def seed_instance(self, name: str, offering: str = "cloud-gov-service-account", plan: str = "space-auditor"):
        d = self.stub / "instances"
        d.mkdir(exist_ok=True)
        (d / name).write_text(f"{offering} {plan}")

    def key_files(self, inst: str) -> list[str]:
        d = self.stub / "keys" / inst
        return sorted(p.name for p in d.iterdir()) if d.is_dir() else []


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


def _forms(value: str) -> list[str]:
    raw = value.encode()
    return [value, base64.b64encode(raw).decode().rstrip("="), raw.hex(), raw.hex().upper()]


def _written_files(env: Env) -> list[Path]:
    out = []
    for base in (env.home, env.work, env.tmpdir):
        for p in base.rglob("*"):
            if p.is_file() or p.is_symlink():
                out.append(p)
    return out


def assert_no_credentials(env: Env, res: subprocess.CompletedProcess, *, token_allowed_in_backend_stdin=True):
    """No canary (raw/base64/hex) in output, in any recorded argv, or in any file the script wrote."""
    secrets = [CANARY_USER, CANARY_PASS, CANARY_TOKEN, OWN_TOKEN]
    streams = {"stdout": res.stdout, "stderr": res.stderr}
    for i, c in enumerate(env.cf_calls()):
        streams[f"cf argv {i}"] = " ".join(c["argv"])
    for line in env.backend_calls():
        streams["backend argv"] = streams.get("backend argv", "") + line + "\n"
    for p in _written_files(env):
        try:
            streams[f"file {p}"] = p.read_bytes().decode("latin-1")
        except OSError:
            continue
    for name, text in streams.items():
        for secret in secrets:
            for form in _forms(secret):
                assert form not in text, f"{secret!r} ({form!r}) leaked into {name}"
    # The only sanctioned place for the token: the backend's stdin (msb) - never the password.
    stdin = env.stub / "backend.stdin"
    if stdin.exists():
        body = stdin.read_text()
        assert CANARY_PASS not in body and CANARY_USER not in body
        if token_allowed_in_backend_stdin:
            assert body.strip() == "bearer " + CANARY_TOKEN


BASE = ("--backend", "msb", "--sandbox", "box1", "--yes")


def test_msb_scoped_happy_path_binds_token_from_stdin_with_no_leaks(env):
    res = env.run(*BASE)
    assert res.returncode == 0, res.stderr
    assert_no_credentials(env, res)
    assert env.backend_calls() == ["acq secret set box1 cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN"]
    assert (env.stub / "backend.stdin").read_text().strip() == "bearer " + CANARY_TOKEN
    assert env.key_files("cloud-gov-agent-box1-auditor") == ["cloud-gov-agent-box1-auditor-key"]
    assert "cloud-gov-agent-box1-auditor" in res.stdout and str(env.cf_home) in res.stdout
    assert "CLOUD_GOV_VERIFY_CF_HOME=" in res.stdout and "--rotate" in res.stdout


def test_default_plan_is_auditor_and_deployer_is_opt_in(env):
    res = env.run(*BASE)
    assert res.returncode == 0
    create = [c["argv"] for c in env.cf_calls() if c["argv"][1] == "create-service"]
    assert create == [
        ["cf", "create-service", "cloud-gov-service-account", "space-auditor", "cloud-gov-agent-box1-auditor"]
    ]


def test_deployer_plan_requires_the_flag_and_warns(env):
    res = env.run(*BASE, "--plan", "space-deployer", "--dry-run")
    assert res.returncode == 0
    assert "space-deployer" in res.stdout and "can change apps" in res.stdout
    res = env.run(*BASE, "--plan", "space-admin")
    assert res.returncode == 2


def test_cf_home_is_private_outside_workdir_and_holds_no_credential(env):
    res = env.run(*BASE)
    assert res.returncode == 0
    mode = stat.S_IMODE(env.cf_home.stat().st_mode)
    assert mode == 0o700, oct(mode)
    assert not str(env.cf_home.resolve()).startswith(str(env.work.resolve()))
    assert_no_credentials(env, res)


def test_cf_home_inside_the_working_directory_is_refused(env):
    res = env.run(*BASE, "--cf-home", str(env.work / "agent-home"))
    assert res.returncode == 3
    assert "working directory" in res.stderr
    assert not {"create-service", "create-service-key", "auth"} & set(env.cf_verbs())
    assert not (env.work / "agent-home").exists()


def test_cf_home_inside_a_git_work_tree_is_refused(env):
    subprocess.run(["git", "init", "-q"], cwd=env.work, check=True)
    res = env.run(*BASE, "--cf-home", str(env.work.parent / "elsewhere"), "--dry-run")
    assert res.returncode == 0  # outside the repo: fine
    (env.tmp / "elsewhere").mkdir(exist_ok=True)
    res = env.run(*BASE, "--cf-home", str(env.work / "sub" / "home"))
    assert res.returncode == 3


def test_all_auth_and_token_calls_use_the_private_cf_home_never_the_users_session(env):
    res = env.run(*BASE)
    assert res.returncode == 0
    for c in env.cf_calls():
        verb = c["argv"][1] if len(c["argv"]) > 1 else ""
        if verb in ("auth", "oauth-token"):
            assert c["cf_home"] == str(env.cf_home.resolve()), c
        if verb in ("login", "logout"):
            raise AssertionError(f"script must not touch the user's login: {c}")
    # The user's token is never what gets bound.
    assert OWN_TOKEN not in (env.stub / "backend.stdin").read_text()


def test_password_reaches_cf_auth_only_through_its_environment(env):
    res = env.run(*BASE)
    assert res.returncode == 0
    auths = [c for c in env.cf_calls() if c["argv"][1:2] == ["auth"]]
    assert len(auths) == 1
    assert auths[0]["argv"] == ["cf", "auth"]
    assert "CF_PASSWORD" in auths[0]["env"] and "CF_USERNAME" in auths[0]["env"]
    for c in env.cf_calls():
        if c["argv"][1:2] != ["auth"]:
            assert "CF_PASSWORD" not in c["env"] and "CF_USERNAME" not in c["env"], c
            assert "CF_TRACE" not in c["env"]


def test_cf_trace_in_the_callers_environment_is_not_passed_on(env):
    res = env.run(*BASE, extra_env={"CF_TRACE": "true", "CF_USERNAME": "x", "CF_PASSWORD": "y"})
    assert res.returncode == 0
    for c in env.cf_calls():
        assert "CF_TRACE" not in c["env"]
        if c["argv"][1:2] != ["auth"]:
            assert "CF_PASSWORD" not in c["env"]


def test_sbx_wrapper_contains_no_credential_and_is_private(env):
    res = env.run("--backend", "sbx", "--sandbox", "box1", "--yes")
    assert res.returncode == 0, res.stderr
    wrapper = env.cf_home / "oauth-token-wrapper"
    assert wrapper.is_file()
    assert stat.S_IMODE(wrapper.stat().st_mode) == 0o700
    text = wrapper.read_text()
    assert str(env.cf_home.resolve()) in text and "oauth-token" in text
    assert os.path.isabs(re.search(r"exec '([^']+)'", text).group(1))
    assert_no_credentials(env, res, token_allowed_in_backend_stdin=False)
    assert env.backend_calls() == [
        "sbx secret set-custom --sandbox box1 --host api.fr.cloud.gov --env CF_OAUTH_TOKEN "
        f"--command {wrapper.resolve()}"
    ]
    assert not (env.stub / "backend.stdin").exists()
    assert not list(env.cf_home.glob(".wrapper.*"))


def test_dry_run_runs_nothing_mutating(env):
    res = env.run(*BASE, "--dry-run")
    assert res.returncode == 0
    assert "Dry run" in res.stdout
    assert set(env.cf_verbs()) <= {"api", "target", "service", "service-keys"}
    assert env.backend_calls() == []
    assert not env.cf_home.exists()
    assert_no_credentials(env, res)


def test_rerun_without_rotate_creates_no_second_key(env):
    first = env.run(*BASE)
    assert first.returncode == 0
    keys_after_first = env.key_files("cloud-gov-agent-box1-auditor")
    (env.stub / "calls.jsonl").unlink()
    again = env.run(*BASE)
    assert again.returncode == 0, again.stderr
    assert "create-service-key" not in env.cf_verbs()
    assert "delete-service-key" not in env.cf_verbs()
    assert "create-service" not in env.cf_verbs()
    assert env.key_files("cloud-gov-agent-box1-auditor") == keys_after_first
    assert_no_credentials(env, again)


def test_rotate_deletes_then_recreates_then_rebinds(env):
    assert env.run(*BASE).returncode == 0
    (env.stub / "calls.jsonl").unlink()
    (env.stub / "backend.log").unlink()
    res = env.run(*BASE, "--rotate")
    assert res.returncode == 0, res.stderr
    verbs = env.cf_verbs()
    assert verbs.index("delete-service-key") < verbs.index("create-service-key") < verbs.index("auth")
    assert verbs.count("delete-service-key") == 1 and verbs.count("create-service-key") == 1
    assert len(env.backend_calls()) == 1
    assert env.key_files("cloud-gov-agent-box1-auditor") == ["cloud-gov-agent-box1-auditor-key"]
    assert_no_credentials(env, res)


@pytest.mark.parametrize(
    ("offering", "plan"),
    [("some-other-service", "space-auditor"), ("cloud-gov-service-account", "space-deployer")],
)
def test_existing_instance_of_the_wrong_service_or_plan_stops(env, offering, plan):
    env.seed_instance("cloud-gov-agent-box1-auditor", offering, plan)
    res = env.run(*BASE)
    assert res.returncode == 3
    assert "choose another --name" in res.stderr
    assert not {"create-service", "create-service-key", "delete-service-key", "auth"} & set(env.cf_verbs())
    assert env.backend_calls() == []


def test_existing_instance_of_the_right_service_and_plan_is_reused(env):
    env.seed_instance("mine", "cloud-gov-service-account", "space-auditor")
    res = env.run(*BASE, "--name", "mine")
    assert res.returncode == 0, res.stderr
    assert "create-service" not in env.cf_verbs()
    assert env.key_files("mine") == ["mine-key"]


def test_global_requires_the_explicit_flag_and_prints_the_warning(env):
    res = env.run("--backend", "msb", "--yes")
    assert res.returncode == 2 and "--global" in res.stderr
    assert env.cf_calls() == [] and env.backend_calls() == []

    res = env.run("--backend", "msb", "--global", "--yes", extra_env={})
    assert res.returncode == 0, res.stderr
    assert "WARNING" in res.stdout and "EVERY sandbox" in res.stdout
    assert env.backend_calls() == ["acq secret set -g cloud-gov --host api.fr.cloud.gov --env CF_OAUTH_TOKEN"]


def test_global_and_sandbox_together_is_a_usage_error(env):
    res = env.run("--backend", "msb", "--global", "--sandbox", "box1", "--yes")
    assert res.returncode == 2
    assert env.cf_calls() == []


def test_sandbox_scope_reaches_the_backend_command(env):
    res = env.run("--backend", "sbx", "--sandbox", "my-box", "--yes")
    assert res.returncode == 0, res.stderr
    assert "--sandbox my-box" in env.backend_calls()[0]


@pytest.mark.parametrize("backend", ["docker", "SBX", ""])
def test_unsupported_or_missing_backend_fails_closed(env, backend):
    args = ["--sandbox", "box1", "--yes"] + (["--backend", backend] if backend else [])
    res = env.run(*args)
    assert res.returncode == 2
    assert env.cf_calls() == [] and env.backend_calls() == []


def test_backend_can_come_from_acq_backend_env(env):
    res = env.run("--sandbox", "box1", "--yes", extra_env={"ACQ_BACKEND": "msb"})
    assert res.returncode == 0, res.stderr
    assert env.backend_calls()[0].startswith("acq secret set box1")


def test_failed_cf_auth_leaves_no_state_and_binds_nothing(env):
    res = env.run(*BASE, extra_env={"STUB_AUTH_FAIL": "1"})
    assert res.returncode == 5
    assert "nothing bound" in res.stderr
    assert env.backend_calls() == []
    assert not env.cf_home.exists()
    assert env.key_files("cloud-gov-agent-box1-auditor") == []
    assert "oauth-token" not in env.cf_verbs()
    assert_no_credentials(env, res)


def test_failed_cf_auth_does_not_remove_a_preexisting_cf_home_or_key(env):
    assert env.run(*BASE).returncode == 0
    (env.cf_home / ".session").unlink()
    res = env.run(*BASE, extra_env={"STUB_AUTH_FAIL": "1"})
    assert res.returncode == 5
    assert env.cf_home.is_dir(), "a CF_HOME this run did not create must not be removed"
    assert env.key_files("cloud-gov-agent-box1-auditor") == ["cloud-gov-agent-box1-auditor-key"]


def test_backend_bind_failure_reports_what_exists_and_keeps_no_secret(env):
    res = env.run(*BASE, extra_env={"STUB_BACKEND_FAIL": "1"})
    assert res.returncode == 5
    assert "nothing is bound" in res.stderr
    assert_no_credentials(env, res, token_allowed_in_backend_stdin=False)


def test_unreadable_service_key_shape_fails_without_echoing_it(env, monkeypatch):
    stub = env.bin / "cf"
    stub.write_text(
        stub.read_text().replace(
            'print(json.dumps({"credentials": {"username": USER, "password": PW}}))', 'print("not json " + PW)'
        )
    )
    res = env.run(*BASE)
    assert res.returncode == 5
    assert "UNTESTED" in res.stderr
    assert_no_credentials(env, res)


def test_requires_confirmation_without_yes_and_a_terminal(env):
    res = env.run("--backend", "msb", "--sandbox", "box1")
    assert res.returncode == 4
    assert "create-service" not in env.cf_verbs()
    assert env.backend_calls() == []


def test_wrong_cloud_foundry_endpoint_is_refused(env):
    res = env.run(*BASE, extra_env={"STUB_ENDPOINT": "https://api.fr.cloud.gov.example.net"})
    assert res.returncode == 3
    assert set(env.cf_verbs()) == {"api"}


def test_no_target_is_refused_before_any_change(env):
    res = env.run(*BASE, extra_env={"STUB_NO_TARGET": "1"})
    assert res.returncode == 3
    assert "create-service" not in env.cf_verbs()


def test_existing_nonempty_unowned_cf_home_is_refused(env):
    env.cf_home.mkdir(parents=True)
    env.cf_home.chmod(0o700)
    (env.cf_home / "something").write_text("x")
    res = env.run(*BASE)
    assert res.returncode == 3
    assert "create-service" not in env.cf_verbs()


def test_existing_cf_home_with_loose_mode_is_refused(env):
    assert env.run(*BASE).returncode == 0
    env.cf_home.chmod(0o755)
    res = env.run(*BASE)
    assert res.returncode == 3
    assert "0700" in res.stderr


def test_no_temp_files_left_behind(env):
    for args in (BASE, (*BASE, "--dry-run"), ("--backend", "sbx", "--sandbox", "box1", "--yes")):
        assert env.run(*args).returncode == 0
    assert list(env.tmpdir.iterdir()) == []
    assert not list(env.cf_home.glob(".wrapper.*"))


def test_help_documents_exit_codes_and_untested_claims_without_running_anything(env):
    res = env.run("--help")
    assert res.returncode == 0
    for needle in ("Exit codes", "UNTESTED", "CF_USERNAME", "ISSO", "--rotate", "--dry-run", "--global"):
        assert needle in res.stdout
    assert env.cf_calls() == []


def test_unknown_option_is_a_usage_error(env):
    assert env.run("--frobnicate").returncode == 2


def test_script_is_executable_and_parses():
    assert os.access(SCRIPT, os.X_OK)
    subprocess.run([BASH, "-n", str(SCRIPT)], check=True)


# ---- scripts/verify: the host control can read the service-account CF_HOME -------------


def _host_control(tmp_path: Path, cf_home: str | None):
    bindir = tmp_path / "vbin"
    bindir.mkdir()
    log = tmp_path / "vcalls.log"
    cf = bindir / "cf"
    cf.write_text(
        '#!/bin/sh\necho "cf $* HOME=${CF_HOME:-unset}" >> "' + str(log) + '"\n'
        'case "$1" in api) echo "api endpoint:   https://api.fr.cloud.gov" ;; '
        'oauth-token) echo "bearer ${CF_HOME:+SERVICE}${CF_HOME:-OWN}" ;; esac\n'
    )
    cf.chmod(0o755)
    curl = bindir / "curl"
    curl.write_text('#!/bin/sh\ncat >> "' + str(log) + '"\nprintf 200\n')
    curl.chmod(0o755)
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(tmp_path)}
    if cf_home is not None:
        env["CLOUD_GOV_VERIFY_CF_HOME"] = cf_home
    script = f'CLOUD_GOV_VERIFY_LIB_ONLY=1 . "{VERIFY}"; host_control; echo "status=$host_status"'
    res = subprocess.run([BASH, "-c", script], env=env, capture_output=True, text=True, timeout=30)
    return res, log.read_text() if log.exists() else ""


def test_verify_host_control_uses_the_service_account_cf_home_when_given(tmp_path):
    home = tmp_path / "sa"
    home.mkdir()
    res, log = _host_control(tmp_path, str(home))
    assert "status=200" in res.stdout
    assert f"cf oauth-token HOME={home}" in log and f"cf api HOME={home}" in log
    assert "bearer OWN" not in log


def test_verify_host_control_without_the_variable_uses_the_users_session(tmp_path):
    res, log = _host_control(tmp_path, None)
    assert "HOME=unset" in log


@pytest.mark.parametrize("bad", ["relative/path", "/nonexistent/cf-home"])
def test_verify_host_control_with_a_bad_cf_home_sends_nothing(tmp_path, bad):
    res, log = _host_control(tmp_path, bad)
    assert "oauth-token" not in log and "bearer" not in log
    assert res.stdout.strip().endswith("status=")


@pytest.mark.parametrize("mode", ["bash -x", "SHELLOPTS=xtrace"])
def test_xtrace_cannot_print_the_token_or_password(env, mode):
    flags = ("-x",) if mode == "bash -x" else ()
    extra = {} if mode == "bash -x" else {"SHELLOPTS": "xtrace"}
    res = env.run(*BASE, bash_flags=flags, extra_env=extra)
    assert res.returncode == 0, res.stderr
    assert_no_credentials(env, res)


def test_rerun_adopts_an_existing_empty_private_cf_home_and_never_deletes_it(env):
    env.cf_home.mkdir(parents=True)
    env.cf_home.chmod(0o700)
    assert env.run(*BASE).returncode == 0
    assert (env.cf_home / ".cloud-gov-acq-kit-service-account").exists()
    assert env.run(*BASE, "--rotate").returncode == 0
    assert env.run(*BASE, extra_env={"STUB_AUTH_FAIL": "1"}).returncode == 5
    assert env.cf_home.is_dir()


def test_failure_creating_cf_home_still_deletes_the_key_this_run_created(env):
    env.cf_home.parent.mkdir(parents=True)
    env.cf_home.parent.chmod(0o500)
    try:
        res = env.run(*BASE)
    finally:
        env.cf_home.parent.chmod(0o700)
    assert res.returncode != 0
    assert env.key_files("cloud-gov-agent-box1-auditor") == []
    assert env.backend_calls() == []
