"""Tests for github-enterprise-kit/scripts/verify (the template's verifier).

The verifier runs the kit's startup step on the host and, opt-in, probes a live
GHES repository from a sandbox. These tests pin three properties:

1. Isolation: the startup step runs with an explicit Git environment in a
   non-repository working directory. Canary credential helpers and askpass
   programs (repository-local and inherited through the environment) must never
   run, and the verifier proves its own canaries would fire without isolation.
2. Probe discipline: the anonymous and authenticated probes ask the SAME query,
   statuses are preserved, and anything that does not prove authentication is
   UNVERIFIED (exit 3), never PASS.
3. Input handling: the live selectors are validated and reach the guest only as
   arguments to fixed code, never as shell source.

The sandbox is faked: a stand-in `acq` runs the guest command locally with a
`git`/`curl`/`gh` shim first on PATH, and the `git ls-remote` shim delegates to
real Git against a local bare repository. No network, no real token, no live GHES.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "integrations/isolation/acq-kits/examples/github-enterprise-kit"
HOST = "ghe.example.org"
REPO = "own/repo"

REAL_GIT = shutil.which("git")
pytestmark = pytest.mark.skipif(REAL_GIT is None or shutil.which("sh") is None, reason="needs git and sh")

FAKE_ACQ = r"""#!/bin/sh
# Stand-in for acq. `exec NAME -- CMD ARGS...` runs CMD locally with the guest
# shims first on PATH; every exec's argv is appended to $GHE_FAKE_ACQ_LOG.
case "$1" in
  kit|secret|create|rm) exit 0 ;;
  exec)
    shift 3
    { for a in "$@"; do printf '%s\n' "$a"; done; printf '%s\n' '-----'; } >> "$GHE_FAKE_ACQ_LOG"
    PATH="$GHE_FAKE_SHIMS:$PATH" exec "$@"
    ;;
esac
exit 0
"""

FAKE_GIT = r"""#!/bin/sh
real="$GHE_FAKE_REAL_GIT"
anon=0
if [ "${1:-}" = "-c" ] && [ "${2:-}" = "credential.helper=" ]; then anon=1; shift 2; fi
case "${1:-}" in
  config) echo '!f() { :; }; f'; exit 0 ;;
  ls-remote) shift ;;
  *) exec "$real" "$@" ;;
esac
if [ "${1:-}" = "--get-url" ]; then
  h="${2#git@}"; echo "https://${h%%:*}/${h#*:}"; exit 0
fi
url="$1"; shift
echo "anon=$anon url=$url args=$*" >> "$GHE_FAKE_LS_LOG"
deny_auth() { echo "fatal: could not read Username for '$url': terminal prompts disabled" >&2; exit 128; }
case "$GHE_FAKE_SCENARIO:$anon" in
  private:1) deny_auth ;;
  private404:1) echo "remote: Repository not found." >&2; echo "fatal: repository '$url' not found" >&2; exit 128 ;;
  authrefused:*) echo "fatal: Authentication failed for '$url'" >&2; exit 128 ;;
  authrefused-403:*) echo "fatal: unable to access '$url': The requested URL returned error: 403" >&2; exit 128 ;;
  transport:*) echo "fatal: unable to access '$url': Could not resolve host: nowhere" >&2; exit 128 ;;
  anontransport:1) echo "fatal: unable to access '$url': Failed to connect to nowhere port 443" >&2; exit 128 ;;
  notfound:0) echo "fatal: repository '$url' not found" >&2; exit 128 ;;
esac
exec "$real" ls-remote "$GHE_FAKE_REPO_DIR" "$@"
"""

FAKE_CURL = r"""#!/bin/sh
for a in "$@"; do case "$a" in *example.net*) printf 000; exit 0 ;; esac; done
printf 200
"""

FAKE_GH = """#!/bin/sh
[ "$1" = api ] && { echo octocat; exit 0; }
exit 0
"""


def _write(path: Path, text: str) -> Path:
    path.write_text(text)
    path.chmod(0o755)
    return path


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    env = {"PATH": os.environ["PATH"], "HOME": str(cwd), "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}
    return subprocess.run(
        [REAL_GIT, "-c", "user.name=t", "-c", "user.email=t@example.org", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )


def _bare_repo(base: Path, name: str, *, with_branch: bool, unborn_head: bool) -> Path:
    bare = base / f"{name}.git"
    _git("init", "-q", "--bare", str(bare), cwd=base)
    if unborn_head:
        _git("symbolic-ref", "HEAD", "refs/heads/nothere", cwd=bare)
    if with_branch:
        work = base / f"{name}-work"
        _git("init", "-q", str(work), cwd=base)
        _git("commit", "-q", "--allow-empty", "-m", "x", cwd=work)
        _git("push", "-q", str(bare), "HEAD:refs/heads/dev", cwd=work)
    return bare


@pytest.fixture
def env_kit(tmp_path: Path):
    """A copy of the kit (so tests can edit spec.yaml) plus fake-sandbox plumbing."""
    kit = tmp_path / "github-enterprise-kit"
    shutil.copytree(KIT, kit)
    acq_dir = tmp_path / "acqdir"
    shims = tmp_path / "shims"
    acq_dir.mkdir()
    shims.mkdir()
    _write(acq_dir / "acq", FAKE_ACQ)
    _write(shims / "git", FAKE_GIT)
    _write(shims / "curl", FAKE_CURL)
    _write(shims / "gh", FAKE_GH)
    home = tmp_path / "home"
    tmp = tmp_path / "tmp"
    home.mkdir()
    tmp.mkdir()
    base_env = {
        "PATH": os.environ["PATH"],
        "HOME": str(home),
        "TMPDIR": str(tmp),
        "ACQ_DIR": str(acq_dir),
        "GHE_FAKE_SHIMS": str(shims),
        "GHE_FAKE_REAL_GIT": REAL_GIT,
        "GHE_FAKE_ACQ_LOG": str(tmp_path / "acq.log"),
        "GHE_FAKE_LS_LOG": str(tmp_path / "ls.log"),
        "GH_HOST": HOST,
        "GH_ENTERPRISE_TOKEN": "placeholder-not-a-token",
    }
    return {"kit": kit, "env": base_env, "tmp_path": tmp_path}


def run_verify(ctx, *, live: bool = False, cwd: Path | None = None, extra: dict | None = None):
    env = dict(ctx["env"])
    if live:
        env.update({"GHE_VERIFY": "1", "GHE_HOST": HOST})
    env.update(extra or {})
    return subprocess.run(
        ["bash", str(ctx["kit"] / "scripts/verify")],
        cwd=cwd or ctx["tmp_path"],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def live_ls(ctx, scenario: str, repo_dir: Path, **extra):
    env = {"GHE_REPO": REPO, "GHE_FAKE_SCENARIO": scenario, "GHE_FAKE_REPO_DIR": str(repo_dir)}
    env.update(extra)
    return run_verify(ctx, live=True, extra=env)


def ls_lines(out: str) -> list[str]:
    return [ln for ln in out.splitlines() if "git ls-remote https://" in ln]


@pytest.fixture
def repos(tmp_path: Path):
    return {
        "unborn": _bare_repo(tmp_path, "unborn", with_branch=True, unborn_head=True),
        "normal": _bare_repo(tmp_path, "normal", with_branch=True, unborn_head=False),
        "empty": _bare_repo(tmp_path, "empty", with_branch=False, unborn_head=False),
    }


# --------------------------------------------------------------------------- #
# Baseline
# --------------------------------------------------------------------------- #


def test_offline_run_passes_and_marks_live_skipped(env_kit):
    r = run_verify(env_kit)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "SKIP" in r.stdout and "GHE_VERIFY=1" in r.stdout
    assert "canary controls fire" in r.stdout
    assert "no repository-local or inherited credential helper or askpass program ran" in r.stdout


# --------------------------------------------------------------------------- #
# Finding 1: Git isolation
# --------------------------------------------------------------------------- #


def _canary(tmp_path: Path, name: str) -> tuple[Path, Path]:
    log = tmp_path / f"{name}.log"
    prog = _write(tmp_path / name, f'#!/bin/sh\necho {name} >> "{log}"\nexit 1\n')
    return prog, log


def test_repo_local_and_inherited_credential_routing_never_runs(env_kit):
    tmp_path = env_kit["tmp_path"]
    helper, helper_log = _canary(tmp_path, "local-helper")
    askpass, askpass_log = _canary(tmp_path, "inherited-askpass")
    env_helper, env_helper_log = _canary(tmp_path, "env-helper")
    decoy = tmp_path / "decoy-repo"
    _git("init", "-q", str(decoy), cwd=tmp_path)
    _git("config", "--local", "credential.helper", f'!"{helper}"', cwd=decoy)
    _git("config", "--local", "core.askPass", str(askpass), cwd=decoy)
    r = run_verify(
        env_kit,
        cwd=decoy,
        extra={
            "GIT_ASKPASS": str(askpass),
            "SSH_ASKPASS": str(askpass),
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "credential.helper",
            "GIT_CONFIG_VALUE_0": f'!"{env_helper}"',
        },
    )
    assert r.returncode == 0, r.stdout + r.stderr
    for log in (helper_log, askpass_log, env_helper_log):
        assert not log.exists(), f"{log.name} ran:\n{r.stdout}"
    assert "no repository-local or inherited credential helper or askpass program ran" in r.stdout


def test_isolated_run_does_not_touch_the_callers_global_git_config(env_kit):
    r = run_verify(env_kit)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not (Path(env_kit["env"]["HOME"]) / ".gitconfig").exists()


# --------------------------------------------------------------------------- #
# Finding 2: identical queries, preserved statuses, UNVERIFIED on ambiguity
# --------------------------------------------------------------------------- #


def test_counterexample_precondition_unborn_head_differs_by_pattern(repos, tmp_path):
    head = subprocess.run(
        [REAL_GIT, "ls-remote", str(repos["unborn"]), "HEAD"], capture_output=True, text=True, check=True
    )
    allrefs = subprocess.run([REAL_GIT, "ls-remote", str(repos["unborn"])], capture_output=True, text=True, check=True)
    assert head.stdout == ""
    assert "refs/heads/dev" in allrefs.stdout


def test_readable_repo_with_unborn_head_is_not_proof_of_authentication(env_kit, repos):
    r = live_ls(env_kit, "public", repos["unborn"])
    assert r.returncode == 3, r.stdout + r.stderr
    assert "authenticated with only the placeholder" not in r.stdout
    assert "UNVERIFIED" in r.stdout and "readable without credentials" in r.stdout


def test_probes_ask_the_same_query(env_kit, repos):
    live_ls(env_kit, "private", repos["normal"])
    calls = Path(env_kit["env"]["GHE_FAKE_LS_LOG"]).read_text().splitlines()
    assert len(calls) == 2, calls
    auth, anon = calls
    assert auth.startswith("anon=0 ") and anon.startswith("anon=1 ")
    assert auth.split(" ", 1)[1] == anon.split(" ", 1)[1]
    assert "HEAD" not in auth.split("args=")[1]


def test_private_repo_denied_anonymously_and_listed_with_token_passes(env_kit, repos):
    for scenario in ("private", "private404"):
        r = live_ls(env_kit, scenario, repos["normal"])
        assert r.returncode == 0, scenario + r.stdout + r.stderr
        assert "listed refs with only the placeholder" in r.stdout


def test_credentialed_refusal_fails(env_kit, repos):
    for scenario in ("authrefused", "authrefused-403"):
        r = live_ls(env_kit, scenario, repos["normal"])
        assert r.returncode == 1, scenario + r.stdout + r.stderr
        assert "placeholder was not accepted" in r.stdout


def test_credentialed_not_found_fails(env_kit, repos):
    r = live_ls(env_kit, "notfound", repos["normal"])
    assert r.returncode == 1, r.stdout + r.stderr
    assert "not found" in r.stdout


@pytest.mark.parametrize("scenario", ["transport", "anontransport"])
def test_transport_failure_is_unverified_not_pass_or_fail(env_kit, repos, scenario):
    r = live_ls(env_kit, scenario, repos["normal"])
    assert r.returncode == 3, r.stdout + r.stderr
    assert "non-authorization reason" in r.stdout
    assert "FAIL" not in r.stdout
    assert "listed refs with only the placeholder" not in r.stdout


def test_empty_repository_is_unverified(env_kit, repos):
    r = live_ls(env_kit, "private", repos["empty"])
    assert r.returncode == 3, r.stdout + r.stderr
    assert "listed no refs" in r.stdout


def test_missing_repo_selector_skips_the_ls_remote_check(env_kit):
    r = run_verify(env_kit, live=True, extra={"GHE_FAKE_SCENARIO": "private"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "set GHE_REPO=owner/repo" in r.stdout


# --------------------------------------------------------------------------- #
# Finding 3: selector validation; no command source built from input
# --------------------------------------------------------------------------- #

BAD_REPOS = [
    "o/r;touch PWN",
    "o/r$(touch PWN)",
    "o/r`touch PWN`",
    "o/r' ; touch PWN ; '",
    "o/r\ntouch PWN",
    "o/r with space",
    "../r",
    "o/..",
    "o/r/extra",
    "o//r",
    "/o/r",
    "o/",
    "https://evil.example/o/r",
    "o/r?x=y",
    "o/r#frag",
    "o/r|cat",
    "-o/r",
]


@pytest.mark.parametrize("repo", BAD_REPOS)
def test_malformed_repo_selector_is_rejected_before_any_guest_call(env_kit, repos, repo):
    marker = env_kit["tmp_path"] / "PWN"
    r = live_ls(env_kit, "private", repos["normal"], GHE_REPO=repo)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "GHE_REPO is not OWNER/REPO" in r.stdout
    assert not marker.exists() and not (env_kit["tmp_path"] / "PWN").exists()
    assert not Path(env_kit["env"]["GHE_FAKE_ACQ_LOG"]).exists(), "a guest command ran with a rejected selector"


@pytest.mark.parametrize(
    "host",
    [
        "ghe.example.org;touch PWN",
        "https://ghe.example.org",
        "ghe.example.org:8443",
        "ghe.example.org/x",
        "-bad.example",
        "a..b",
        "ghe.example.org\nx",
        "ghe.example.org$(x)",
    ],
)
def test_malformed_live_host_is_rejected_before_any_guest_call(env_kit, repos, host):
    r = run_verify(
        env_kit,
        live=True,
        extra={
            "GHE_HOST": host,
            "GHE_REPO": REPO,
            "GHE_FAKE_SCENARIO": "private",
            "GHE_FAKE_REPO_DIR": str(repos["normal"]),
        },
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert "GHE_HOST is not a plain hostname" in r.stdout
    assert not Path(env_kit["env"]["GHE_FAKE_ACQ_LOG"]).exists()


def test_guest_command_source_never_contains_input(env_kit, repos):
    r = live_ls(env_kit, "private", repos["normal"])
    assert r.returncode == 0, r.stdout + r.stderr
    log = Path(env_kit["env"]["GHE_FAKE_ACQ_LOG"]).read_text()
    records = [rec.strip("\n").split("\n") for rec in log.split("-----\n") if rec.strip()]
    assert records
    saw_repo_as_arg = False
    for rec in records:
        assert rec[:2] == ["sh", "-c"], rec
        code, rest = rec[2], rec[3:]
        assert HOST not in code and REPO not in code, f"input interpolated into guest code: {code!r}"
        assert rest[0] == "sh"
        saw_repo_as_arg = saw_repo_as_arg or REPO in rest
    assert saw_repo_as_arg


def test_spec_with_a_malformed_host_is_not_executed(env_kit):
    spec = env_kit["kit"] / "spec.yaml"
    marker = env_kit["tmp_path"] / "PWN"
    evil = "ghe.example.org;touch${IFS}" + str(marker)
    spec.write_text(spec.read_text().replace("ghe.example.org", evil))
    r = run_verify(env_kit)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "not a plain hostname" in r.stdout
    assert not marker.exists(), "the startup step ran with a malformed host"
    assert "startup step not run" in r.stdout


@pytest.mark.parametrize("service", ["-x", "a\n--x", "a b", "a;b", "a$(x)"])
def test_malformed_secret_service_name_is_rejected(env_kit, repos, service):
    r = live_ls(env_kit, "private", repos["normal"], GHE_SECRET_SERVICE=service)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "GHE_SECRET_SERVICE must be" in r.stdout
    assert not Path(env_kit["env"]["GHE_FAKE_ACQ_LOG"]).exists()
