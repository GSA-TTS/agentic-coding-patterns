"""Tests for files[].readonly (quickstart ADR-0035 trusted startup code).

A consumer that supports `readonly: true` (acq msb) stages the file on a
host-authoritative read-only mount and rewrites any commands[] argv element that
equals the file's path. These tests lock in:

  - the schema accepts a boolean `readonly` and rejects other types;
  - the validator rejects a readonly file with no source or no whole-token
    command reference (the flag would be inert);
  - the shipped root-run startup scripts declare it, and every root startup
    command still works when a consumer ignores the flag (backward compat);
  - the root scripts are exercised for real (tmp-rooted /bin/sh runs): the two
    argv tokens are classified together and fail closed, the grant script
    re-validates the helper it sources, and the install script tolerates a
    read-only (unstaged) layout;
  - files the kit or user must modify at runtime are NOT marked.
"""

from __future__ import annotations

import importlib.util
import json
import stat
import subprocess
from pathlib import Path

import jsonschema
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
KITS = ROOT / "integrations" / "isolation" / "acq-kits"
SCHEMA = json.loads((ROOT / "schemas" / "kit-hybrid-v1.schema.json").read_text())


def _validator():
    spec = importlib.util.spec_from_file_location("validate_kits", KITS / "validate-kits.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.validate_kit


def _load(kit: str) -> dict:
    return yaml.safe_load((KITS / kit / "spec.yaml").read_text())


def _readonly_paths(spec: dict) -> set[str]:
    return {f["path"] for f in spec.get("files", []) if f.get("readonly") is True}


# Root-run startup code that must be readonly, per kit.
EXPECTED_READONLY = {
    "oci-engine": {
        "/home/agent/oci-engine-grant-devs.sh",
        "/home/agent/oci-engine-config/oci-engine-storage-driver.sh",
    },
}


@pytest.mark.parametrize("kit", sorted(EXPECTED_READONLY))
def test_root_startup_files_are_readonly(kit):
    assert _readonly_paths(_load(kit)) == EXPECTED_READONLY[kit]


@pytest.mark.parametrize("kit", ["opendesign", "zscaler-ca-certificate"])
def test_kits_without_a_root_owned_fallback_declare_no_readonly_files(kit):
    # opendesign: its root startup command runs no kit file. zscaler: the cert is
    # staged at start (initFiles), nothing publishes a root-owned copy at create,
    # and msb skips the path via trust_host_cas; a consumer that ignores the flag
    # would hand root the agent-writable path, and failing closed would drop the
    # cert install. So the flag stays off (see the kit README).
    assert _readonly_paths(_load(kit)) == set()


def test_zscaler_startup_still_installs_the_cert_from_its_staged_path():
    spec = _load("zscaler-ca-certificate")
    (cmd,) = [c for c in spec["commands"] if c["phase"] == "startup" and c["user"] == "0"]
    body = cmd["command"][2]
    assert body.count("install -m 0644") == 1
    assert "/home/agent/zscaler-ca.crt" in body
    assert "phase" in spec["files"][0] and spec["files"][0]["phase"] == "initFiles"


def test_oci_engine_files_that_run_as_agent_or_are_copied_are_not_readonly():
    ro = _readonly_paths(_load("oci-engine"))
    for path in (
        "/home/agent/oci-engine-install.sh",  # published by an inline command that copies it by path
        "/home/agent/oci-engine-vfs-fallback.sh",  # agent-run, not root code
        "/home/agent/oci-engine-config/docker",  # copied by path from install
        "/home/agent/oci-engine-config/01-acq-shortnames.conf",  # copied by path from install
    ):
        assert path not in ro


def test_oci_readonly_files_are_whole_argv_tokens_of_a_root_startup_command():
    spec = _load("oci-engine")
    for path in _readonly_paths(spec):
        users = [c for c in spec["commands"] if c["phase"] == "startup" and path in c["command"]]
        assert users, f"{path} is not passed as a whole argv token to a startup command"
        assert all(c["user"] == "0" for c in users)


OCI_KIT = KITS / "oci-engine"
GRANT = OCI_KIT / "files/home/oci-engine-grant-devs.sh"
INSTALL = OCI_KIT / "files/home/oci-engine-install.sh"
MOUNT = "/var/lib/acq/host/kit-files"
TRUSTED = "/usr/local/lib/acq/oci-engine"


def _reroot(text: str, root: Path, extra: dict[str, str] | None = None) -> str:
    """Point every absolute guest path in a script at a tmp tree (longest first)."""
    table = {
        MOUNT: f"{root}/mount",
        TRUSTED: f"{root}/trusted",
        "/usr/local/lib/acq": f"{root}/lib-acq",
        "/usr/local/bin": f"{root}/bin-local",
        "/etc/containers": f"{root}/etc-containers",
        "/var/lib/acq": f"{root}/var-acq",
        "/home/agent": f"{root}/home-agent",
        "/dev/net": f"{root}/dev/net",
        "/dev/fuse": f"{root}/dev/fuse",
    }
    table.update(extra or {})
    for old in sorted(table, key=len, reverse=True):
        text = text.replace(old, table[old])
    return text


def _shim_bin(root: Path, **cmds: str) -> Path:
    bindir = root / "shims"
    bindir.mkdir(exist_ok=True)
    for name, body in cmds.items():
        f = bindir / name
        f.write_text("#!/bin/sh\n" + body + "\n")
        f.chmod(f.stat().st_mode | stat.S_IXUSR)
    return bindir


def _sh(script_text: str, root: Path, args: list[str], shims: Path):
    script = root / "script.sh"
    script.write_text(script_text)
    env = {"PATH": f"{shims}:/usr/bin:/bin", "HOME": str(root)}
    return subprocess.run(
        ["/bin/sh", str(script), *args], text=True, capture_output=True, check=False, env=env, cwd=root
    )


def _startup_body() -> str:
    cmds = [c for c in _load("oci-engine")["commands"] if c["phase"] == "startup" and c["user"] == "0"]
    assert len(cmds) == 1
    return cmds[0]["command"][2]


def _run_oci_startup(tmp_path, grant_arg, helper_arg, *, publish_trusted=True):
    """Run the oci-engine root startup body with its guest paths re-rooted."""
    (tmp_path / "trusted").mkdir()
    (tmp_path / "mount").mkdir()
    if publish_trusted:
        (tmp_path / "trusted" / "oci-engine-grant-devs.sh").write_text('echo "ran TRUSTED grant helper=$1"\n')
    (tmp_path / "mount" / "grant.1").write_text('echo "ran MOUNT grant helper=$1"\n')
    (tmp_path / "mount" / "helper.2").write_text("# helper\n")
    # Agent-writable files that exist in a real sandbox. If the command ever ran
    # or sourced one as root, "ran AGENT" would show in stdout.
    (tmp_path / "home-agent" / "oci-engine-config").mkdir(parents=True)
    (tmp_path / "home-agent" / "oci-engine-grant-devs.sh").write_text('echo "ran AGENT grant helper=$1"\n')
    (tmp_path / "home-agent" / "oci-engine-config" / "oci-engine-storage-driver.sh").write_text("# agent helper\n")
    body = _reroot(_startup_body(), tmp_path)
    fix = lambda a: a.replace("@MOUNT@", f"{tmp_path}/mount").replace("@HOME@", f"{tmp_path}/home-agent")  # noqa: E731
    shims = _shim_bin(tmp_path)
    script = tmp_path / "startup.sh"
    script.write_text(body)
    return subprocess.run(
        ["/bin/sh", "-c", body, "oci-engine-startup", fix(grant_arg), fix(helper_arg)],
        text=True,
        capture_output=True,
        check=False,
        env={"PATH": f"{shims}:/usr/bin:/bin"},
    )


HOME_GRANT = "@HOME@/oci-engine-grant-devs.sh"
HOME_HELPER = "@HOME@/oci-engine-config/oci-engine-storage-driver.sh"


def _assert_refused(result, tmp_path):
    """Fail closed: non-zero, loud stderr, and nothing ran as root."""
    assert result.returncode != 0
    assert "ERROR" in result.stderr
    assert "NOT applied" in result.stderr
    assert "ran " not in result.stdout
    assert "AGENT" not in result.stdout


def test_oci_startup_runs_mount_script_and_passes_the_mount_helper(tmp_path):
    result = _run_oci_startup(tmp_path, "@MOUNT@/grant.1", "@MOUNT@/helper.2")
    assert result.returncode == 0
    assert f"ran MOUNT grant helper={tmp_path}/mount/helper.2" in result.stdout


def test_oci_startup_legacy_agent_home_tokens_use_the_root_owned_copy(tmp_path):
    # A consumer that ignores `readonly` (or made no selection) leaves the
    # /home/agent tokens. That legacy case keeps the root-owned fallback.
    result = _run_oci_startup(tmp_path, HOME_GRANT, HOME_HELPER)
    assert result.returncode == 0
    assert f"ran TRUSTED grant helper={tmp_path}/trusted/oci-engine-storage-driver.sh" in result.stdout
    assert "home-agent" not in result.stdout


def test_oci_startup_legacy_without_a_published_copy_warns_and_exits_zero(tmp_path):
    # Install fell soft or the base had its own engine: nothing to run, as before.
    result = _run_oci_startup(tmp_path, HOME_GRANT, HOME_HELPER, publish_trusted=False)
    assert result.returncode == 0
    assert "WARNING" in result.stderr
    assert "NOT applied" in result.stderr
    assert result.stdout == ""


def test_oci_startup_fails_closed_when_the_selected_mount_grant_is_missing(tmp_path):
    # The mount was selected but the file is gone. A root-owned copy IS published
    # here and must NOT be used.
    result = _run_oci_startup(tmp_path, "@MOUNT@/missing.9", "@MOUNT@/helper.2")
    _assert_refused(result, tmp_path)
    assert "grant script is missing" in result.stderr


def test_oci_startup_fails_closed_when_the_selected_mount_helper_is_missing(tmp_path):
    result = _run_oci_startup(tmp_path, "@MOUNT@/grant.1", "@MOUNT@/missing.9")
    _assert_refused(result, tmp_path)
    assert "storage helper is missing" in result.stderr


def test_oci_startup_fails_closed_when_both_selected_mount_files_are_missing(tmp_path):
    result = _run_oci_startup(tmp_path, "@MOUNT@/missing.8", "@MOUNT@/missing.9")
    _assert_refused(result, tmp_path)


def test_oci_startup_fails_closed_without_a_published_copy_too(tmp_path):
    result = _run_oci_startup(tmp_path, "@MOUNT@/missing.9", "@MOUNT@/helper.2", publish_trusted=False)
    _assert_refused(result, tmp_path)


@pytest.mark.parametrize(
    ("grant", "helper"),
    [
        ("@MOUNT@/grant.1", HOME_HELPER),  # grant selected, helper not
        (HOME_GRANT, "@MOUNT@/helper.2"),  # helper selected, grant not
        ("@MOUNT@/missing.9", HOME_HELPER),
        (HOME_GRANT, "@MOUNT@/missing.9"),
    ],
)
def test_oci_startup_refuses_a_mixed_selection(tmp_path, grant, helper):
    # One token on the mount and one still an agent path: a partial selection must
    # never fall back to a root-owned copy or run the agent path.
    result = _run_oci_startup(tmp_path, grant, helper)
    _assert_refused(result, tmp_path)
    assert "home-agent" not in result.stdout


@pytest.mark.parametrize(
    "bad",
    [
        "@MOUNT@/../home-agent/x.sh",
        "@MOUNT@-evil/grant.1",
        "@MOUNT@/",
        "/opt/elsewhere.sh",
        "relative.sh",
        "",
        "@HOME@/../etc/x.sh",
    ],
)
def test_oci_startup_refuses_unrecognized_tokens(tmp_path, bad):
    result = _run_oci_startup(tmp_path, bad, bad)
    _assert_refused(result, tmp_path)


def _run_grant(tmp_path, helper_arg, *, publish_trusted_helper=True):
    """Run oci-engine-grant-devs.sh with a shim podman and a stub helper."""
    root = tmp_path
    for d in ("trusted", "mount", "home-agent/oci-engine-config", "dev"):
        (root / d).mkdir(parents=True, exist_ok=True)
    stub = 'oci_engine_write_storage_conf() { echo "SOURCED $0:$STUB_ID"; }\n'
    if publish_trusted_helper:
        (root / "trusted/oci-engine-storage-driver.sh").write_text(stub.replace("$STUB_ID", "trusted"))
    (root / "mount/helper.2").write_text(stub.replace("$STUB_ID", "mount"))
    (root / "home-agent/oci-engine-config/oci-engine-storage-driver.sh").write_text(stub.replace("$STUB_ID", "AGENT"))
    shims = _shim_bin(root, podman="exit 0", chown="exit 0", chmod="exit 0")
    text = _reroot(GRANT.read_text(), root)
    args = [] if helper_arg is None else [helper_arg.replace("@ROOT@", str(root))]
    return _sh(text, root, args, shims)


def test_grant_script_sources_the_mount_helper(tmp_path):
    r = _run_grant(tmp_path, "@ROOT@/mount/helper.2")
    assert r.returncode == 0, r.stderr
    assert ":mount" in r.stdout


def test_grant_script_sources_the_trusted_copy_by_default(tmp_path):
    r = _run_grant(tmp_path, None)
    assert r.returncode == 0, r.stderr
    assert ":trusted" in r.stdout


def test_grant_script_accepts_an_explicit_trusted_path_for_the_legacy_layout(tmp_path):
    r = _run_grant(tmp_path, "@ROOT@/trusted/oci-engine-storage-driver.sh")
    assert r.returncode == 0, r.stderr
    assert ":trusted" in r.stdout


def test_grant_script_fails_closed_when_the_selected_mount_helper_is_missing(tmp_path):
    # A root-owned copy exists and must not be substituted.
    r = _run_grant(tmp_path, "@ROOT@/mount/missing.9")
    assert r.returncode != 0
    assert "missing" in r.stderr
    assert "SOURCED" not in r.stdout


@pytest.mark.parametrize(
    "bad",
    [
        "@ROOT@/home-agent/oci-engine-config/oci-engine-storage-driver.sh",
        "@ROOT@/mount/../home-agent/oci-engine-config/oci-engine-storage-driver.sh",
        "/etc/passwd",
        "",
    ],
)
def test_grant_script_refuses_a_helper_outside_the_allowlist(tmp_path, bad):
    r = _run_grant(tmp_path, bad)
    assert r.returncode != 0
    assert "refusing" in r.stderr
    assert "SOURCED" not in r.stdout


def _run_install(tmp_path, *, stage_helper, stage_grant, mount_present):
    root = tmp_path
    for d in ("home-agent/oci-engine-config", "etc-containers", "var-acq", "bin-local", "lib-acq"):
        (root / d).mkdir(parents=True, exist_ok=True)
    if stage_helper:
        (root / "home-agent/oci-engine-config/oci-engine-storage-driver.sh").write_text(
            'oci_engine_write_storage_conf() { echo "storage conf written"; }\n'
        )
    if stage_grant:
        (root / "home-agent/oci-engine-grant-devs.sh").write_text("echo grant\n")
    if mount_present:
        (root / "mount").mkdir()
    shims = _shim_bin(root, podman="exit 0", docker="exit 1", chown="exit 0", date="echo now")
    text = _reroot(INSTALL.read_text(), root)
    return _sh(text, root, [], shims), root


def test_install_publishes_staged_copies_when_the_consumer_ignored_readonly(tmp_path):
    r, root = _run_install(tmp_path, stage_helper=True, stage_grant=True, mount_present=False)
    assert r.returncode == 0, r.stderr
    assert (root / "lib-acq/oci-engine/oci-engine-storage-driver.sh").is_file()
    assert (root / "lib-acq/oci-engine/oci-engine-grant-devs.sh").is_file()
    assert "storage conf written" in r.stdout
    assert (root / "var-acq/oci-engine-ready").is_file()
    assert "WARNING" not in r.stderr


def test_install_still_configures_when_readonly_files_are_not_staged(tmp_path):
    # A consumer that honored `readonly` never copies the two files under
    # /home/agent; the install step must carry on, not bail out early.
    r, root = _run_install(tmp_path, stage_helper=False, stage_grant=False, mount_present=True)
    assert r.returncode == 0, r.stderr
    assert not (root / "lib-acq/oci-engine/oci-engine-grant-devs.sh").exists()
    assert (root / "var-acq/oci-engine-ready").is_file()
    assert (root / "etc-containers/registries.conf.d/00-acq-docker-first.conf").is_file()
    assert "NOT grant devices" not in r.stderr


def test_install_warns_loudly_when_files_are_neither_staged_nor_mounted(tmp_path):
    r, root = _run_install(tmp_path, stage_helper=False, stage_grant=False, mount_present=False)
    assert r.returncode == 0, r.stderr
    assert "will NOT grant devices" in r.stderr
    assert (root / "var-acq/oci-engine-ready").is_file()


def test_shipped_kits_pass_validator():
    validate = _validator()
    for kit in ("oci-engine", "zscaler-ca-certificate", "opendesign"):
        errors, _ = validate(KITS / kit, SCHEMA)
        assert errors == []


def _spec(files, commands):
    return {
        "schemaVersion": "hybrid/v1",
        "kind": "mixin",
        "name": "ro-test",
        "displayName": "RO Test",
        "description": "readonly validator fixture",
        "files": files,
        "commands": commands,
    }


def _write_kit(tmp_path, spec):
    kit = tmp_path / "ro-test"
    (kit / "files").mkdir(parents=True)
    (kit / "files" / "x.sh").write_text("echo hi\n")
    (kit / "README.md").write_text("# ro-test\n")
    (kit / "spec.yaml").write_text(yaml.safe_dump(spec))
    return kit


def _file(**kw):
    return {"path": "/home/agent/x.sh", "mode": "0755", "source": "files/x.sh", **kw}


def _cmd(*argv):
    return {"phase": "startup", "user": "0", "command": list(argv)}


def test_validator_accepts_readonly_file_passed_as_whole_token(tmp_path):
    kit = _write_kit(tmp_path, _spec([_file(readonly=True)], [_cmd("sh", "/home/agent/x.sh")]))
    errors, _ = _validator()(kit, SCHEMA)
    assert errors == []


def test_validator_rejects_readonly_without_whole_token_reference(tmp_path):
    kit = _write_kit(tmp_path, _spec([_file(readonly=True)], [_cmd("sh", "-c", "sh /home/agent/x.sh")]))
    errors, _ = _validator()(kit, SCHEMA)
    assert any("no commands[] argv element" in e for e in errors)


def test_validator_rejects_readonly_inline_content(tmp_path):
    f = {"path": "/home/agent/x.sh", "mode": "0755", "content": "echo hi\n", "readonly": True}
    kit = _write_kit(tmp_path, _spec([f], [_cmd("sh", "/home/agent/x.sh")]))
    errors, _ = _validator()(kit, SCHEMA)
    assert any("requires a source" in e for e in errors)


def test_schema_rejects_non_boolean_readonly(tmp_path):
    spec = _spec([_file(readonly="true")], [_cmd("sh", "/home/agent/x.sh")])
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=spec, schema=SCHEMA)


def _write_raw_kit(tmp_path, spec_text):
    kit = tmp_path / "ro-test"
    (kit / "files").mkdir(parents=True)
    (kit / "files" / "x.sh").write_text("echo hi\n")
    (kit / "README.md").write_text("# ro-test\n")
    (kit / "spec.yaml").write_text(spec_text)
    return kit


_RAW_TAIL = 'commands:\n  - phase: startup\n    user: "0"\n    command:\n      - sh\n      - /home/agent/x.sh\n'

_RAW_HEAD = (
    'schemaVersion: "hybrid/v1"\nkind: mixin\nname: ro-test\ndisplayName: RO\ndescription: d\n'
    'files:\n  - path: /home/agent/x.sh\n    mode: "0755"\n    source: files/x.sh\n'
)


@pytest.mark.parametrize("value", ["yes", "on", "1", "True", '"true"'])
def test_validator_rejects_readonly_spelled_other_than_literal_true(tmp_path, value):
    text = _RAW_HEAD + f"    readonly: {value}\n" + _RAW_TAIL
    errors, _ = _validator()(_write_raw_kit(tmp_path, text), SCHEMA)
    assert any("literal true or false" in e for e in errors), errors


def test_validator_accepts_literal_true_with_trailing_comment(tmp_path):
    text = _RAW_HEAD + "    readonly: true  # root code\n" + _RAW_TAIL
    errors, _ = _validator()(_write_raw_kit(tmp_path, text), SCHEMA)
    assert errors == []


def test_validator_rejects_flow_style_command_lists(tmp_path):
    text = (
        _RAW_HEAD
        + '    readonly: true\ncommands:\n  - phase: startup\n    user: "0"\n    command: [sh, /home/agent/x.sh]\n'
    )
    errors, _ = _validator()(_write_raw_kit(tmp_path, text), SCHEMA)
    assert any("flow-style" in e for e in errors), errors


def test_grant_script_keeps_the_mode_the_spec_declares():
    declared = next(
        f["mode"] for f in _load("oci-engine")["files"] if f["path"] == "/home/agent/oci-engine-grant-devs.sh"
    )
    assert declared == "0755"
    assert stat.S_IMODE(GRANT.stat().st_mode) == 0o755
