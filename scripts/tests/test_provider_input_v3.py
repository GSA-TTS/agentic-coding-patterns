"""Offline checks for the additive, data-only provider bundle contract."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import jsonschema
import pytest
from validate_provider_input_contract import ContractError, load_json, main, validate_bundle

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "integrations/isolation/schemas"
FIXTURES = SCHEMAS / "fixtures"
BINDINGS = {"usai": "USAI_API_KEY", "acme-ai": "ACME_AI_API_KEY"}


def write_json(path: Path, document: dict) -> None:
    path.write_text(json.dumps(document))


def make_bundle(directory: Path, provider: str = "usai", version: int = 3) -> Path:
    """Reuse reviewed JSON fixtures without copying or running provider code for v3."""
    directory.mkdir()
    for name in ("facts.json", "snapshot.json"):
        shutil.copyfile(FIXTURES / provider / name, directory / name)
    bundle = load_json(FIXTURES / provider / "bundle.json")
    bundle["schemaVersion"] = f"acq-provider-input-bundle/v{version}"
    if version == 3:
        del bundle["normalizerPath"]
        bundle["discovery"] = {"adapter": "usai-openai-list/v1"}
    else:
        shutil.copy2(FIXTURES / provider / bundle["normalizerPath"], directory / bundle["normalizerPath"])
    path = directory / "bundle.json"
    write_json(path, bundle)
    return path


def test_v3_schema_is_valid():
    schema = load_json(SCHEMAS / "acq-provider-input-bundle-v3.schema.json")
    jsonschema.Draft202012Validator.check_schema(schema)


def test_v3_accepts_data_without_normalizer(tmp_path):
    path = make_bundle(tmp_path / "provider")
    assert {entry.name for entry in path.parent.iterdir()} == {"bundle.json", "facts.json", "snapshot.json"}
    validate_bundle(path, BINDINGS)


def test_v2_still_accepts_executable_normalizer(tmp_path):
    validate_bundle(make_bundle(tmp_path / "provider", "acme-ai", 2), BINDINGS)


@pytest.mark.parametrize("version", [1, 2])
def test_legacy_versions_still_require_executable_normalizer(tmp_path, version):
    path = make_bundle(tmp_path / "provider", "acme-ai", 2)
    bundle = load_json(path)
    if version == 1:
        bundle["schemaVersion"] = "acq-provider-input-bundle/v1"
        bundle["projectedPath"] = "/var/lib/acq/host/models/providers/acme-ai"
        del bundle["providerPath"]
        write_json(path, bundle)
    (path.parent / bundle["normalizerPath"]).chmod(0o644)
    with pytest.raises(ContractError, match="executable"):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("discovery", [{}, None, "usai-openai-list/v1", {"adapter": "unknown/v1"}])
def test_v3_rejects_invalid_discovery(tmp_path, discovery):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    bundle["discovery"] = discovery
    write_json(path, bundle)
    with pytest.raises(ContractError):
        validate_bundle(path, BINDINGS)


def test_v3_requires_inline_discovery(tmp_path):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    del bundle["discovery"]
    write_json(path, bundle)
    with pytest.raises(ContractError, match="discovery"):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("field", ["normalizerPath", "mapping", "import", "command", "discoveryPath"])
def test_v3_rejects_extra_execution_fields(tmp_path, nested, field):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    target = bundle["discovery"] if nested else bundle
    target[field] = "untrusted.py"
    write_json(path, bundle)
    with pytest.raises(ContractError, match="Additional properties"):
        validate_bundle(path, BINDINGS)


def test_v3_rejects_adapter_for_another_provider(tmp_path):
    path = make_bundle(tmp_path / "provider", "acme-ai")
    with pytest.raises(ContractError, match="requires providerId usai"):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("field", ["factsPath", "snapshotPath"])
@pytest.mark.parametrize("value", ["../outside.json", "/outside.json", "./facts.json", "dir\\facts.json"])
def test_v3_rejects_unsafe_artifact_paths(tmp_path, field, value):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    bundle[field] = value
    write_json(path, bundle)
    with pytest.raises(ContractError):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("field", ["factsPath", "snapshotPath"])
@pytest.mark.parametrize("kind", ["symlink", "parent-symlink", "missing", "directory"])
def test_v3_requires_regular_artifacts_without_symlinks(tmp_path, field, kind):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    artifact = path.parent / bundle[field]
    if kind == "parent-symlink":
        (path.parent / "linked").symlink_to(path.parent, target_is_directory=True)
        bundle[field] = f"linked/{bundle[field]}"
        write_json(path, bundle)
    else:
        original = artifact.read_bytes()
        artifact.unlink()
        if kind == "symlink":
            target = tmp_path / "outside.json"
            target.write_bytes(original)
            artifact.symlink_to(target)
        elif kind == "directory":
            artifact.mkdir()
    with pytest.raises(ContractError, match="symlinks|regular files"):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("kind", ["wrong-owner", "undeclared", "unknown-owner"])
def test_v3_rejects_credential_mismatch(tmp_path, kind):
    path = make_bundle(tmp_path / "provider")
    bindings = BINDINGS
    if kind == "wrong-owner":
        facts_path = path.parent / "facts.json"
        facts = load_json(facts_path)
        facts["keyEnv"] = "ACME_AI_API_KEY"
        write_json(facts_path, facts)
    elif kind == "undeclared":
        bundle = load_json(path)
        bundle["credentialEnvNames"] = ["ACME_AI_API_KEY"]
        write_json(path, bundle)
    else:
        bindings = {}
    with pytest.raises(ContractError, match="credential"):
        validate_bundle(path, bindings)


@pytest.mark.parametrize("field", ["baseUrl", "modelsUrl"])
@pytest.mark.parametrize(
    "url",
    ["https://other.example.com/models", "http://api.gsa.usai.gov/models", "https://api.gsa.usai.gov:444/models"],
)
def test_v3_retains_same_host_https_checks(tmp_path, field, url):
    path = make_bundle(tmp_path / "provider")
    facts_path = path.parent / "facts.json"
    facts = load_json(facts_path)
    facts[field] = url
    write_json(facts_path, facts)
    with pytest.raises(ContractError):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("artifact", ["facts.json", "snapshot.json"])
def test_v3_validates_artifact_schemas(tmp_path, artifact):
    path = make_bundle(tmp_path / "provider")
    write_json(path.parent / artifact, {"schemaVersion": "unknown/v1"})
    with pytest.raises(ContractError):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("artifact", ["facts.json", "snapshot.json"])
def test_v3_cross_checks_artifact_provider_identity(tmp_path, artifact):
    path = make_bundle(tmp_path / "provider")
    document = load_json(path.parent / artifact)
    document["providerId"] = "acme-ai"
    write_json(path.parent / artifact, document)
    with pytest.raises(ContractError, match="providerId must equal"):
        validate_bundle(path, BINDINGS)


def test_v3_rejects_noncanonical_provider_path(tmp_path):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    bundle["providerPath"] = "models/providers/other"
    write_json(path, bundle)
    with pytest.raises(ContractError, match="providerPath must be"):
        validate_bundle(path, BINDINGS)


@pytest.mark.parametrize("second_version", [2, 3])
def test_v3_cli_rejects_duplicate_provider_ids(tmp_path, capsys, second_version):
    first = make_bundle(tmp_path / "first")
    second = make_bundle(tmp_path / "second", version=second_version)
    assert main(["--bundle", str(first), "--bundle", str(second)]) == 1
    assert "duplicate providerId 'usai'" in capsys.readouterr().err


def test_unknown_future_version_is_rejected(tmp_path):
    path = make_bundle(tmp_path / "provider")
    bundle = load_json(path)
    bundle["schemaVersion"] = "acq-provider-input-bundle/v999"
    write_json(path, bundle)
    with pytest.raises(ContractError, match="unsupported bundle schemaVersion"):
        validate_bundle(path, BINDINGS)
