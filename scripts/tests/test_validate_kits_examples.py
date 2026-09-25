"""Tests for the `acq-kits/examples/` templates container.

`integrations/isolation/acq-kits/examples/<name>/` holds copy-and-rename kit
TEMPLATES (see isolation ADR 0005). A template is schema-validated exactly like
a kit (spec, files[].source resolution, env names, README) but it is NOT a kit
acq applies, so it is exempt from the `kits.yaml` registry cross-check — and it
must stay out of the registry. These tests lock in that contract end to end
through `main()`, which is what CI and pre-commit run.
"""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "schemas" / "kit-hybrid-v1.schema.json"
VALIDATOR_PATH = ROOT / "integrations" / "isolation" / "acq-kits" / "validate-kits.py"

MINIMAL_SPEC = "schemaVersion: hybrid/v1\nkind: mixin\nname: {name}\ndisplayName: T\ndescription: d\n"


def _load_main():
    spec = importlib.util.spec_from_file_location("validate_kits", VALIDATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.main


def _write_kit(kit_dir: Path, spec_yaml: str) -> Path:
    kit_dir.mkdir(parents=True, exist_ok=True)
    (kit_dir / "README.md").write_text("# t\n")
    (kit_dir / "spec.yaml").write_text(spec_yaml)
    return kit_dir


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal repo root: the real schema, one registered kit, one template."""
    (tmp_path / "schemas").mkdir()
    shutil.copy(SCHEMA_PATH, tmp_path / "schemas" / "kit-hybrid-v1.schema.json")
    kits = tmp_path / "integrations" / "isolation" / "acq-kits"
    _write_kit(kits / "kit-a", MINIMAL_SPEC.format(name="kit-a"))
    _write_kit(kits / "examples" / "tpl-a", MINIMAL_SPEC.format(name="tpl-a"))
    (kits / "kits.yaml").write_text("schemaVersion: acq-kits-registry/v1\nkits:\n  kit-a:\n    backends: [sbx]\n")
    return tmp_path


def _kits_dir(repo: Path) -> Path:
    return repo / "integrations" / "isolation" / "acq-kits"


class TestExamplesContainer:
    def test_examples_dir_is_a_container_not_a_kit(self, repo, capsys):
        # Before the exemption, `examples/` itself was walked as a kit and
        # failed on its missing spec.yaml.
        assert _load_main()(["--root", str(repo)]) == 0
        err = capsys.readouterr().err
        assert "examples: missing spec.yaml" not in err

    def test_template_is_exempt_from_registry_cross_check(self, repo, capsys):
        # tpl-a is not in kits.yaml and that is correct — no "missing registry
        # entry" error.
        assert _load_main()(["--root", str(repo)]) == 0
        assert "missing registry entry for kit 'tpl-a'" not in capsys.readouterr().err

    def test_template_is_reported_as_validated(self, repo, capsys):
        assert _load_main()(["--root", str(repo)]) == 0
        out = capsys.readouterr().out
        assert "OK  examples/tpl-a" in out

    def test_template_listed_in_registry_is_an_error(self, repo, capsys):
        # Templates are not applied by acq; listing one in the registry is a
        # contradiction the validator must reject.
        (_kits_dir(repo) / "kits.yaml").write_text(
            "schemaVersion: acq-kits-registry/v1\nkits:\n  kit-a:\n    backends: [sbx]\n  tpl-a:\n    backends: [sbx]\n"
        )
        assert _load_main()(["--root", str(repo)]) == 1
        assert "registry lists unknown kit 'tpl-a'" in capsys.readouterr().err

    def test_template_schema_error_fails_the_run(self, repo, capsys):
        _write_kit(_kits_dir(repo) / "examples" / "tpl-bad", "schemaVersion: hybrid/v1\nkind: mixin\nname: tpl-bad\n")
        assert _load_main()(["--root", str(repo)]) == 1
        assert "examples/tpl-bad: schema:" in capsys.readouterr().err

    def test_template_missing_source_fails_the_run(self, repo, capsys):
        _write_kit(
            _kits_dir(repo) / "examples" / "tpl-src",
            MINIMAL_SPEC.format(name="tpl-src")
            + 'files:\n  - path: /home/agent/x\n    mode: "0644"\n    source: files/home/x\n',
        )
        assert _load_main()(["--root", str(repo)]) == 1
        assert "examples/tpl-src: files[].source not found: files/home/x" in capsys.readouterr().err

    def test_template_without_readme_fails_the_run(self, repo, capsys):
        d = _kits_dir(repo) / "examples" / "tpl-noreadme"
        d.mkdir(parents=True)
        (d / "spec.yaml").write_text(MINIMAL_SPEC.format(name="tpl-noreadme"))
        assert _load_main()(["--root", str(repo)]) == 1
        assert "examples/tpl-noreadme: missing README.md" in capsys.readouterr().err

    def test_stray_file_under_examples_is_ignored(self, repo):
        # A README.md describing the container is not a template.
        (_kits_dir(repo) / "examples" / "README.md").write_text("# templates\n")
        assert _load_main()(["--root", str(repo)]) == 0

    @pytest.mark.parametrize("name", ["__pycache__", ".pytest_cache"])
    def test_tool_droppings_under_examples_are_ignored(self, repo, capsys, name):
        (_kits_dir(repo) / "examples" / name).mkdir()
        assert _load_main()(["--root", str(repo)]) == 0
        assert name not in capsys.readouterr().err

    def test_templates_are_validated_when_no_kit_dirs_exist(self, repo, capsys):
        # The "no kits found" short-circuit must not skip a templates-only tree.
        shutil.rmtree(_kits_dir(repo) / "kit-a")
        (_kits_dir(repo) / "kits.yaml").write_text("schemaVersion: acq-kits-registry/v1\nkits: {}\n")
        _write_kit(_kits_dir(repo) / "examples" / "tpl-bad", "schemaVersion: hybrid/v1\nkind: mixin\nname: tpl-bad\n")
        assert _load_main()(["--root", str(repo)]) == 1
        captured = capsys.readouterr()
        assert "OK  examples/tpl-a" in captured.out
        assert "examples/tpl-bad: schema:" in captured.err

    def test_absent_examples_dir_is_fine(self, repo):
        shutil.rmtree(_kits_dir(repo) / "examples")
        assert _load_main()(["--root", str(repo)]) == 0
