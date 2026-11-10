"""Regression tests for Node entrypoint guards and fixture line endings.

Two Windows-only failure modes are covered here.

1. A ``main()`` guard written as::

       if (import.meta.url === `file://${process.argv[1]}`) { main(); }

   never fires on Windows. ``process.argv[1]`` is ``C:\\...``, so the template
   produces ``file://C:\\...`` while ``import.meta.url`` is ``file:///C:/...``
   (three slashes, forward slashes). The script exits 0 having done nothing and
   writes no output -- a silent no-op, which is worse than a crash because
   nothing downstream notices. Comparing URL against URL fixes that spelling but
   not the underlying mistake: ``import.meta.url`` names the module file Node
   resolved while ``process.argv[1]`` keeps the typed path, so a launch through a
   symlink, a directory junction, or a differently-cased path on a
   case-insensitive filesystem still disagrees. Both sides are therefore resolved
   to their real path before comparing::

       realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))

2. A fixture normalizer that calls ``Path.write_text(...)`` writes CRLF on
   Windows, so its output stops matching the LF-only committed snapshot byte
   for byte even though the JSON is identical. The fix is ``newline="\\n"`` at
   the write site; the byte-exact assertion is never relaxed.

Every test runs on every platform. On Linux and macOS they are cheap invariants;
on Windows they are the actual regression detectors, because that is where both
defects change observable behaviour.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

NORMALIZE_CATALOG = ROOT / "integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs"
RENDER_PROVIDER_CONFIG = (
    ROOT / "integrations/isolation/acq-kits/opencode/files/home/opencode-config/render-provider-config.mjs"
)
ASSERT_DAEMON_CONFIG = ROOT / "integrations/isolation/acq-kits/paseo/files/home/paseo-assert-daemon-config.mjs"
BUILD_CATALOG = ROOT / "integrations/providers/usai/scripts/build-catalog.mjs"

BASE_OPENCODE_CONFIG = ROOT / "integrations/isolation/acq-kits/opencode/files/home/opencode-config/base-config.jsonc"
USAI_CATALOG = ROOT / "integrations/providers/usai/catalog.json"
MODELS_LIST = ROOT / "integrations/providers/usai/tests/fixtures/models-list.json"
MODELS_DEV = ROOT / "integrations/providers/usai/tests/fixtures/models-dev.json"
FIXTURES_DIR = ROOT / "integrations/isolation/schemas/fixtures"

# Entrypoints that must run when invoked as a script through the interpreter.
# `node <file>` is used deliberately: on Windows a `#!/usr/bin/env node` shebang
# is not honoured, so exec'ing the file directly would test the shell, not the
# guard.
ENTRYPOINTS = {
    "normalize-catalog": NORMALIZE_CATALOG,
    "render-provider-config": RENDER_PROVIDER_CONFIG,
    "paseo-assert-daemon-config": ASSERT_DAEMON_CONFIG,
    "build-catalog": BUILD_CATALOG,
}

# The non-portable guard, in its template-literal and string-concat spellings.
NON_PORTABLE_GUARD = re.compile(r"""file://\$\{\s*process\.argv\[1\]\s*\}|["']file://["']\s*\+\s*process\.argv\[1\]""")


def _node() -> str:
    """Return the Node interpreter, skipping (not failing) when it is absent."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed; this suite is exercised in CI where node is available")
    return node


def _run_node(script: Path, *args: object) -> subprocess.CompletedProcess:
    """Run a Node entrypoint as a script, the way a user or unit would."""
    return subprocess.run(  # noqa: S603 - fixed interpreter, no shell, repo-local script
        [_node(), str(script), *(str(arg) for arg in args)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _write_json(path: Path, payload: object) -> Path:
    """Write JSON with LF endings and no BOM, matching POSIX fixtures."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path


def _symlink_skip_reason() -> str | None:
    """Return why this host cannot create symlinks, or None when it can.

    Probing beats guessing: a non-elevated Windows account without Developer Mode
    raises ``WinError 1314`` while a Developer-Mode runner succeeds, and some
    filesystems refuse symlinks on every platform.
    """
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory, "target")
        link = Path(directory, "link")
        target.write_text("x", encoding="utf-8")
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError) as error:
            return (
                "creating symlinks requires SeCreateSymbolicLinkPrivilege on Windows "
                "(enable Developer Mode or run elevated) or a symlink-capable filesystem "
                f"on this host: {error}"
            )
    return None


# ---------------------------------------------------------------------------
# Static guard: the non-portable idiom must not reappear anywhere
# ---------------------------------------------------------------------------


def test_no_source_file_uses_the_non_portable_argv1_guard():
    """`file://${process.argv[1]}` is a silent no-op on Windows; keep it out."""
    offenders = []
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in {".mjs", ".cjs", ".js", ".mts", ".cts"} or not path.is_file():
            continue
        if {".git", "node_modules"} & set(path.parts):
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            if NON_PORTABLE_GUARD.search(line):
                offenders.append(f"{path.relative_to(ROOT).as_posix()}:{lineno}: {line.strip()}")
    assert offenders == [], (
        "non-portable entrypoint guard(s) found (use pathToFileURL(resolve(argv[1])).href):\n" + "\n".join(offenders)
    )


@pytest.mark.parametrize("name", sorted(ENTRYPOINTS))
def test_entrypoint_guard_canonicalizes_both_sides(name):
    """The guard must compare real paths, so a symlinked launch still runs main()."""
    source = ENTRYPOINTS[name].read_text(encoding="utf-8")
    assert "isMainModule()" in source, f"{name} does not guard on isMainModule()"
    assert "realpathSync(path.resolve(process.argv[1]))" in source, (
        f"{name} compares process.argv[1] without resolving symlinks"
    )
    assert "realpathSync(fileURLToPath(import.meta.url))" in source, (
        f"{name} compares import.meta.url without resolving symlinks"
    )


# ---------------------------------------------------------------------------
# Behavioural guards: invoking the script must actually do the work
# ---------------------------------------------------------------------------


def test_normalize_catalog_entrypoint_writes_its_output(tmp_path):
    """`normalize-catalog.mjs <args>` must emit the neutral catalog, not exit 0 silently."""
    out = tmp_path / "catalog.json"
    result = _run_node(NORMALIZE_CATALOG, "--source", USAI_CATALOG, "--out", out)

    assert out.exists(), f"entrypoint exited {result.returncode} without writing {out}; stderr={result.stderr!r}"
    assert result.returncode == 0, result.stderr
    assert "Wrote" in result.stdout
    catalog = json.loads(out.read_text(encoding="utf-8"))
    assert catalog["schemaVersion"] == "acq-neutral-model-catalog/v1"
    assert catalog["providerId"] == "usai"
    assert catalog["models"], "normalized catalog has no models"


def test_build_catalog_entrypoint_runs_drift_check(tmp_path):
    """`build-catalog.mjs --check` must report honestly, never exit silently."""
    out = tmp_path / "catalog.json"
    source = ["--models-url", MODELS_LIST, "--models-dev", MODELS_DEV]

    built = _run_node(BUILD_CATALOG, *source, "--out", out)
    assert built.returncode == 0, built.stderr
    assert out.exists(), f"build exited {built.returncode} without writing {out}; stderr={built.stderr!r}"

    fresh = _run_node(BUILD_CATALOG, "--check", *source, "--out", out)
    assert fresh.stdout.strip() or fresh.stderr.strip(), "entrypoint exited silently"
    assert fresh.returncode == 0, fresh.stderr
    assert "up to date" in fresh.stdout

    # A substantive change must be caught, which is what makes --check worth
    # running: a detector that only ever says "up to date" proves nothing.
    catalog = json.loads(out.read_text(encoding="utf-8"))
    catalog["gateway"]["host"] = "example.invalid"
    out.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8", newline="\n")

    drifted = _run_node(BUILD_CATALOG, "--check", *source, "--out", out)
    assert drifted.returncode == 1, (
        f"--check accepted a drifted catalog (exit {drifted.returncode}, stdout={drifted.stdout!r})"
    )
    assert "drifted" in drifted.stderr


def test_render_provider_config_entrypoint_writes_global_config(tmp_path):
    """`render-provider-config.mjs <args>` must render OpenCode config from provider inputs."""
    provider_root = tmp_path / "provider-input"
    provider_dir = provider_root / "models" / "providers" / "usai"
    provider_dir.mkdir(parents=True)
    for name in ("facts.json", "snapshot.json"):
        (provider_dir / name).write_bytes((FIXTURES_DIR / "usai" / name).read_bytes())
    global_dir = tmp_path / "opencode-global"

    result = _run_node(
        RENDER_PROVIDER_CONFIG,
        "--provider-root",
        provider_root,
        "--global-dir",
        global_dir,
        "--base-config",
        BASE_OPENCODE_CONFIG,
    )

    rendered = global_dir / "opencode.jsonc"
    assert rendered.exists(), (
        f"entrypoint exited {result.returncode} without rendering config; stderr={result.stderr!r}"
    )
    text = rendered.read_text(encoding="utf-8")
    assert '"usai"' in text
    assert "api.gsa.usai.gov" in text

    # The renderer must succeed. The single tolerated exception is a separate,
    # documented Windows defect: `fsync` on a directory handle returns EPERM, and
    # by then the rendered file has already been renamed into place. The match is
    # deliberately narrow -- exact platform, exact message -- so any other
    # non-zero exit fails here instead of hiding behind "there was a diagnostic".
    windows_directory_fsync_eperm = (
        sys.platform == "win32" and result.stderr.strip() == "opencode-config: EPERM: operation not permitted, fsync"
    )
    assert result.returncode == 0 or windows_directory_fsync_eperm, (
        f"renderer exited {result.returncode}; stderr={result.stderr!r}"
    )


def test_paseo_assert_daemon_config_entrypoint_fails_closed(tmp_path):
    """`paseo-assert-daemon-config.mjs <args>` must enforce the daemon contract."""
    paseo_home = tmp_path / "paseo-home"
    _write_json(paseo_home / "config.json", {"daemon": {"listen": "127.0.0.1:1"}})

    rejected = _run_node(ASSERT_DAEMON_CONFIG, "--paseo-home", paseo_home, "--listen", "127.0.0.1:6767")
    assert rejected.returncode == 1, (
        f"unsafe config was accepted (exit {rejected.returncode}, stdout={rejected.stdout!r}); "
        "the guard did not fire, so main() never ran"
    )
    assert "missing required daemon settings" in rejected.stderr

    _write_json(
        paseo_home / "config.json",
        {
            "daemon": {"listen": "127.0.0.1:6767", "relay": {"enabled": False}},
            "features": {"webUi": {"enabled": True}},
        },
    )
    accepted = _run_node(ASSERT_DAEMON_CONFIG, "--paseo-home", paseo_home, "--listen", "127.0.0.1:6767")
    assert accepted.returncode == 0, accepted.stderr
    assert accepted.stderr == ""


def test_paseo_assert_daemon_config_fails_closed_when_launched_through_a_symlink(tmp_path):
    """A symlinked launch must still run the guard; skipping it would fail open.

    ``import.meta.url`` names the module file Node resolved, while
    ``process.argv[1]`` is the path that was typed. Comparing them without
    resolving both therefore never matches through a link, and the guard exits 0
    having asserted nothing -- the one outcome a fail-closed check cannot have.
    """
    reason = _symlink_skip_reason()
    if reason:
        pytest.skip(reason)

    link = tmp_path / "assert-daemon-config.mjs"
    link.symlink_to(ASSERT_DAEMON_CONFIG)

    missing_home = tmp_path / "no-such-paseo-home"
    result = _run_node(link, "--paseo-home", missing_home, "--listen", "127.0.0.1:6767")

    assert result.returncode == 1, (
        f"symlinked invocation exited {result.returncode} (stdout={result.stdout!r}, stderr={result.stderr!r}); "
        "the guard did not fire, so a launcher that reaches it through a link fails open"
    )
    assert "cannot read required daemon config" in result.stderr


# ---------------------------------------------------------------------------
# Fixture normalizers must produce LF on every platform
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("fixture_name", ["usai", "acme-ai"])
def test_fixture_normalizer_emits_lf_only_bytes(tmp_path, fixture_name):
    """The normalizer output must match its committed snapshot byte for byte."""
    fixture_dir = FIXTURES_DIR / fixture_name
    out = tmp_path / f"{fixture_name}-catalog.json"

    result = subprocess.run(  # noqa: S603 - fixed interpreter, no shell, repo-local script
        [
            sys.executable,
            str(fixture_dir / "normalize.py"),
            "--source",
            str(fixture_dir / "source.json"),
            "--out",
            str(out),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert result.returncode == 0, result.stderr
    produced = out.read_bytes()
    snapshot = (fixture_dir / "snapshot.json").read_bytes()
    assert produced.count(b"\r") == 0, f"{fixture_name} normalizer emitted CR bytes (CRLF line endings)"
    assert produced == snapshot, f"{fixture_name} normalizer output diverged from its committed snapshot"
