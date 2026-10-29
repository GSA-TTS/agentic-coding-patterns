"""Tests for the provider input contract schemas:
  - integrations/isolation/schemas/acq-provider-facts.schema.json
  - integrations/isolation/schemas/acq-neutral-model-catalog.schema.json

Verifies:
  - Valid USAi fixture validates as an ordinary provider instance.
  - Valid fictitious acme-ai fixture validates without USAi-specific fields.
  - Strict validation of feed-controlled strings: providerId slug, keyEnv charset,
    URL patterns, and apiProtocol enum membership.
  - Malformed URLs, unsafe feed-controlled strings, unknown required fields,
    and unsupported apiProtocol values fail closed.
  - Duplicate model IDs are detected by the validator (not just by the schema,
    since JSON Schema draft-2020-12 uniqueItems only checks structural equality).
  - Model catalog carries no routing or credential fields.
  - Recommendations reference only model IDs that exist in models[].
  - maxItems on models[] prevents resource exhaustion.
"""

from __future__ import annotations

import errno
import functools
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import jsonschema
import pytest
import validate_provider_input_contract as validator
from validate_provider_input_contract import (
    ContractError,
    load_json,
    split_discovered_bundles,
    validate_bundle,
    validate_catalog,
)

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS_DIR = ROOT / "integrations" / "isolation" / "schemas"
FIXTURES_DIR = SCHEMAS_DIR / "fixtures"

FACTS_SCHEMA_PATH = SCHEMAS_DIR / "acq-provider-facts.schema.json"
CATALOG_SCHEMA_PATH = SCHEMAS_DIR / "acq-neutral-model-catalog.schema.json"
BUNDLE_SCHEMA_PATH = SCHEMAS_DIR / "acq-provider-input-bundle.schema.json"
BUNDLE_V2_SCHEMA_PATH = SCHEMAS_DIR / "acq-provider-input-bundle-v2.schema.json"
VALIDATOR_PATH = ROOT / "scripts" / "validate_provider_input_contract.py"


@functools.cache
def _symlink_skip_reason() -> str | None:
    """Return None if this host can create symlinks, else the reason it cannot.

    Probed once by attempting a real symlink in a temporary directory: the
    unprivileged Windows default is ``WinError 1314``, and a filesystem without
    symlink support raises NotImplementedError. Any other failure is a genuine
    problem and is re-raised rather than silently turning into a skip.
    """
    with tempfile.TemporaryDirectory() as probe_dir:
        target = Path(probe_dir) / "target"
        link = Path(probe_dir) / "link"
        target.write_text("symlink capability probe\n")
        try:
            link.symlink_to(target)
        except NotImplementedError as error:
            return f"this platform cannot create symlinks: {error}"
        except OSError as error:
            privilege_missing = getattr(error, "winerror", None) == 1314
            unsupported = error.errno in {errno.EPERM, errno.EACCES, errno.ENOSYS, errno.ENOTSUP}
            if not (privilege_missing or unsupported):
                raise
            return (
                "creating symlinks requires SeCreateSymbolicLinkPrivilege on Windows "
                "(enable Developer Mode or run elevated) or a symlink-capable filesystem "
                f"on this host: {error}"
            )
        if not link.is_symlink():
            return "this host reported success but did not create a symlink"
    return None


def requires_symlink_support(test):
    """Skip a test only when the OS/account genuinely cannot create symlinks.

    The symlink tests assert a real containment boundary, so they must run
    wherever a link can be made — including a Windows CI runner with Developer
    Mode enabled — rather than being skipped by platform name.
    """
    reason = _symlink_skip_reason()
    if reason is None:
        return test
    return pytest.mark.skip(reason=reason)(test)


def _normalizer_argv(script_path: Path) -> list[str]:
    """Return the argv that launches a normalizer the way the runtime does.

    A POSIX host can execute a shebang script directly, but Windows' CreateProcess
    cannot: it only loads PE images, so running the file itself fails with
    ``WinError 193``. Name the interpreter explicitly instead — ``node`` for .mjs
    and the current interpreter for .py — so the test exercises the normalizer's
    behaviour rather than the host's script-launching support.
    """
    suffix = script_path.suffix.lower()
    if suffix == ".py":
        interpreter = sys.executable
    elif suffix == ".mjs":
        interpreter = shutil.which("node")
        if interpreter is None:
            pytest.skip("node is not installed, so .mjs normalizers cannot be launched")
    else:
        raise AssertionError(f"no interpreter is known for normalizer suffix {suffix!r}")
    return [interpreter, str(script_path)]


def _bundle(relative: str) -> dict:
    return _load_fixture(relative)


def _load_schema(path: Path) -> dict:
    return json.loads(path.read_text())


def _load_fixture(relative: str) -> dict:
    return json.loads((FIXTURES_DIR / relative).read_text())


def _validate(instance: dict, schema: dict) -> None:
    """Raise jsonschema.ValidationError on failure."""
    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    jsonschema.validate(instance, schema)


def _validate_recommendations(catalog: dict) -> list[str]:
    """Return a list of validation error strings for recommendation references.

    JSON Schema cannot express 'value must reference models[].id'; this helper
    implements that constraint so tests can assert on it.
    """
    errors: list[str] = []
    recs = catalog.get("recommendations")
    if recs is None:
        return errors
    model_ids = {m["id"] for m in catalog.get("models", [])}
    for role, model_id in recs.items():
        if model_id not in model_ids:
            errors.append(f"recommendations.{role}='{model_id}' is not in models[]")
    return errors


def _check_no_duplicate_ids(catalog: dict) -> list[str]:
    """Return a list of duplicate id strings from a catalog's models[].

    JSON Schema uniqueItems compares structural equality; for string ids a
    case-sensitive string comparison is the correct check.
    """
    seen: set[str] = set()
    duplicates: list[str] = []
    for model in catalog.get("models", []):
        mid = model.get("id")
        if mid in seen:
            duplicates.append(mid)
        seen.add(mid)
    return duplicates


def _check_no_credential_fields(catalog: dict) -> list[str]:
    """Return routing/credential fields that MUST NOT appear in a catalog."""
    forbidden = {"host", "baseUrl", "modelsUrl", "keyEnv", "apiKey", "apiKeyEnv", "gateway"}
    errors: list[str] = []
    for key in forbidden:
        if key in catalog:
            errors.append(f"catalog must not carry routing/credential field '{key}'")
    for model in catalog.get("models", []):
        for key in forbidden:
            if key in model:
                errors.append(f"models[id={model.get('id')!r}] must not carry '{key}'")
    return errors


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def facts_schema() -> dict:
    return _load_schema(FACTS_SCHEMA_PATH)


@pytest.fixture()
def catalog_schema() -> dict:
    return _load_schema(CATALOG_SCHEMA_PATH)


@pytest.fixture()
def usai_facts() -> dict:
    return _load_fixture("usai/facts.json")


@pytest.fixture()
def usai_snapshot() -> dict:
    return _load_fixture("usai/snapshot.json")


@pytest.fixture()
def acme_facts() -> dict:
    return _load_fixture("acme-ai/facts.json")


@pytest.fixture()
def acme_snapshot() -> dict:
    return _load_fixture("acme-ai/snapshot.json")


# ---------------------------------------------------------------------------
# Schema file integrity
# ---------------------------------------------------------------------------


def test_schemas_are_valid_json_schema_2020_12():
    """Both schema files are self-consistent against draft 2020-12."""
    for path in [FACTS_SCHEMA_PATH, CATALOG_SCHEMA_PATH, BUNDLE_SCHEMA_PATH, BUNDLE_V2_SCHEMA_PATH]:
        schema = _load_schema(path)
        validator_cls = jsonschema.validators.validator_for(schema)
        validator_cls.check_schema(schema)


def test_v1_bundle_remains_valid():
    """Consumers can continue validating released fixed-root v1 bundles."""
    _validate(
        {
            "schemaVersion": "acq-provider-input-bundle/v1",
            "providerId": "acme-ai",
            "factsPath": "facts.json",
            "normalizerPath": "normalize.py",
            "snapshotPath": "snapshot.json",
            "projectedPath": "/var/lib/acq/host/models/providers/acme-ai",
            "credentialEnvNames": ["ACME_AI_API_KEY"],
        },
        _load_schema(BUNDLE_SCHEMA_PATH),
    )


def test_v1_schema_rejects_v2_bundle():
    """The released v1 schema remains a v1-only public contract."""
    with pytest.raises(jsonschema.ValidationError):
        _validate(_bundle("acme-ai/bundle.json"), _load_schema(BUNDLE_SCHEMA_PATH))


def test_v2_schema_rejects_v1_bundle():
    """Version 2 has its own schema identity and rejects legacy fields."""
    v1_bundle = {
        "schemaVersion": "acq-provider-input-bundle/v1",
        "providerId": "acme-ai",
        "factsPath": "facts.json",
        "normalizerPath": "normalize.py",
        "snapshotPath": "snapshot.json",
        "projectedPath": "/var/lib/acq/host/models/providers/acme-ai",
        "credentialEnvNames": ["ACME_AI_API_KEY"],
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(v1_bundle, _load_schema(BUNDLE_V2_SCHEMA_PATH))


def test_v2_bundle_path_agrees_with_provider_id():
    """The provider-relative location has one canonical provider-id segment."""
    for fixture_name, provider_id in [("usai", "usai"), ("acme-ai", "acme-ai")]:
        bundle = _bundle(f"{fixture_name}/bundle.json")
        assert bundle["schemaVersion"] == "acq-provider-input-bundle/v2"
        assert bundle["providerPath"] == f"models/providers/{provider_id}"
        _validate(bundle, _load_schema(BUNDLE_V2_SCHEMA_PATH))


@pytest.mark.parametrize(
    "provider_path",
    ["/models/providers/acme-ai", "models/../providers/acme-ai", ".", "models/providers/."],
)
def test_v2_bundle_rejects_unsafe_provider_path(provider_path):
    """v2 paths are stable relative layout names, never consumer-controlled paths."""
    bundle = _bundle("acme-ai/bundle.json")
    bundle["providerPath"] = provider_path
    with pytest.raises(jsonschema.ValidationError):
        _validate(bundle, _load_schema(BUNDLE_V2_SCHEMA_PATH))


def test_runtime_validator_accepts_v1_bundle(tmp_path):
    """Released v1 bundles continue to pass all host-time artifact checks."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    bundle["schemaVersion"] = "acq-provider-input-bundle/v1"
    bundle["projectedPath"] = "/var/lib/acq/host/models/providers/acme-ai"
    del bundle["providerPath"]
    bundle_path.write_text(json.dumps(bundle))
    validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.parametrize(
    "field,value",
    [("projectedPath", "/var/lib/acq/other/providers/acme-ai"), ("providerPath", "models/providers/other")],
)
def test_runtime_validator_rejects_noncanonical_bundle_path(tmp_path, field, value):
    """The host validator enforces canonical paths that JSON Schema cannot cross-check."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    if field == "projectedPath":
        bundle["schemaVersion"] = "acq-provider-input-bundle/v1"
        bundle["projectedPath"] = value
        del bundle["providerPath"]
    else:
        bundle[field] = value
    bundle_path.write_text(json.dumps(bundle))
    with pytest.raises(ContractError):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


def test_runtime_validator_rejects_unknown_bundle_version(tmp_path):
    """A materializer fails closed rather than guessing an unknown bundle contract."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    bundle["schemaVersion"] = "acq-provider-input-bundle/v3"
    bundle_path.write_text(json.dumps(bundle))
    with pytest.raises(ContractError, match="unsupported bundle schemaVersion"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


def test_validator_cli_accepts_explicit_external_bundle(tmp_path):
    """A host materializer can invoke the released validator outside its checkout."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    command = [
        "python3",
        str(VALIDATOR_PATH),
        "--schema-dir",
        str(SCHEMAS_DIR),
        "--credential-bindings",
        str(SCHEMAS_DIR / "provider-credential-bindings.json"),
        "--bundle",
        str(bundle_dir / "bundle.json"),
    ]

    result = subprocess.run(command, text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr
    assert "validated 1 bundle(s)" in result.stdout

    bundle = json.loads((bundle_dir / "bundle.json").read_text())
    bundle["providerPath"] = "models/providers/other-provider"
    (bundle_dir / "bundle.json").write_text(json.dumps(bundle))
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    assert result.returncode == 1
    assert "providerPath must be models/providers/acme-ai" in result.stderr


def test_validator_cli_rejects_duplicate_explicit_provider_ids(tmp_path):
    """Repeated explicit bundles share one provider-ID uniqueness set."""
    first = tmp_path / "first"
    second = tmp_path / "second"
    shutil.copytree(FIXTURES_DIR / "acme-ai", first)
    shutil.copytree(FIXTURES_DIR / "acme-ai", second)
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(SCHEMAS_DIR / "provider-credential-bindings.json"),
            "--bundle",
            str(first / "bundle.json"),
            "--bundle",
            str(second / "bundle.json"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "duplicate providerId 'acme-ai'" in result.stderr


def test_validator_cli_explicit_mode_skips_repository_discovery(tmp_path):
    """An explicit external bundle is the complete requested validation set."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(SCHEMAS_DIR / "provider-credential-bindings.json"),
            "--bundle",
            str(bundle_dir / "bundle.json"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0
    assert "validated 1 bundle(s)" in result.stdout


def test_validator_cli_rejects_malformed_credential_bindings(tmp_path):
    """Backend-owned binding data fails closed with a concise diagnostic."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bindings = tmp_path / "bindings.json"
    bindings.write_text('{"providers": []}')
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(bindings),
            "--bundle",
            str(bundle_dir / "bundle.json"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "providers must be an object" in result.stderr
    assert "Traceback" not in result.stderr


def test_split_discovered_bundles_classifies_fixtures_vs_kits():
    """Discovery classification is path-based, not separator-string-based."""
    fixture = FIXTURES_DIR / "usai" / "bundle.json"
    kit = ROOT / "integrations" / "isolation" / "acq-kits" / "usai-provider" / "provider-input.json"
    fixture_bundles, kit_bundles = split_discovered_bundles([fixture, kit])
    assert fixture_bundles == [fixture]
    assert kit_bundles == [kit]


def test_validator_cli_discovery_mode_validates_repository():
    """Discovery mode (no --bundle) separates fixtures from kits, so the shared
    `usai` providerId across the fixture and the usai-provider kit is not a
    duplicate. Regression for the Windows path-separator bug."""
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(SCHEMAS_DIR / "provider-credential-bindings.json"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "duplicate providerId" not in result.stderr


# ---------------------------------------------------------------------------
# Valid fixture round-trips
# ---------------------------------------------------------------------------


def test_usai_facts_validates(facts_schema, usai_facts):
    """USAi facts.json validates as an ordinary acq-provider-facts/v1 instance."""
    _validate(usai_facts, facts_schema)


def test_usai_snapshot_validates(catalog_schema, usai_snapshot):
    """USAi snapshot.json validates as acq-neutral-model-catalog/v1."""
    _validate(usai_snapshot, catalog_schema)


def test_acme_facts_validates(facts_schema, acme_facts):
    """Fictitious acme-ai facts.json validates without any USAi-specific fields."""
    _validate(acme_facts, facts_schema)


def test_acme_snapshot_validates(catalog_schema, acme_snapshot):
    """Fictitious acme-ai snapshot.json validates as acq-neutral-model-catalog/v1."""
    _validate(acme_snapshot, catalog_schema)


def test_acme_provider_has_no_usai_fields(acme_facts):
    """acme-ai fixture must not contain any USAi-specific identifiers."""
    text = json.dumps(acme_facts)
    assert "usai" not in text.lower(), "acme-ai fixture must not reference usai"
    assert "gsa.usai.gov" not in text, "acme-ai fixture must not reference usai host"


def test_usai_facts_is_not_special_cased(facts_schema, usai_facts, acme_facts):
    """Both providers validate against the same schema — no provider-specific branches."""
    # Both must validate cleanly
    _validate(usai_facts, facts_schema)
    _validate(acme_facts, facts_schema)
    # Schema must have a single schemaVersion const (not a provider-specific enum)
    sv_prop = facts_schema["properties"]["schemaVersion"]
    assert sv_prop.get("const") == "acq-provider-facts/v1"


# ---------------------------------------------------------------------------
# acq-provider-facts/v1 — strict providerId slug validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_id",
    [
        # path traversal
        "../etc/passwd",
        "../../secret",
        # absolute path
        "/var/lib/acq/evil",
        # spaces / control chars
        "usai provider",
        "usai\x00provider",
        "usai\nprovider",
        # trailing newline — the $ anchor in ECMAScript/Python re matches before \n;
        # the (?![\s\S]) lookahead in our pattern closes this bypass
        "usai\n",
        # uppercase
        "USAI",
        "Usai",
        # underscores
        "usai_provider",
        # leading/trailing hyphens
        "-usai",
        "usai-",
        # dots
        "usai.provider",
        # too long (33 chars)
        "a" * 33,
        # empty
        "",
        # only hyphens
        "---",
    ],
)
def test_facts_rejects_bad_provider_id(facts_schema, bad_id):
    """Invalid providerId values MUST fail schema validation (fail closed)."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": bad_id,
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


@pytest.mark.parametrize(
    "good_id",
    [
        "usai",
        "acme-ai",
        "my-provider",
        "p2",
        "a",
        "a1",
        "z",
        "x" * 32,  # max 32 chars
        "0provider",  # starts with digit — allowed by schema
    ],
)
def test_facts_accepts_valid_provider_id(facts_schema, good_id):
    """Valid providerId slugs MUST pass schema validation."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": good_id,
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    _validate(instance, facts_schema)


# ---------------------------------------------------------------------------
# acq-provider-facts/v1 — keyEnv charset validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_env",
    [
        # lowercase
        "usai_api_key",
        # leading digit
        "1_API_KEY",
        # spaces
        "USAI API KEY",
        # dollar sign (injection risk)
        "$USAI_API_KEY",
        # empty
        "",
        # too long (129 chars)
        "A" * 129,
        # trailing line terminators — $ in Python re and ECMA regex matches before \n;
        # the pattern now uses (?![\s\S]) to close this bypass
        "KEY\n",
        "KEY\r",
        "KEY\r\n",
    ],
)
def test_facts_rejects_bad_key_env(facts_schema, bad_env):
    """Invalid keyEnv values MUST fail schema validation."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": bad_env,
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


@pytest.mark.parametrize(
    "good_env",
    [
        "USAI_API_KEY",
        "ACME_AI_API_KEY",
        "X",
        "KEY",
        "A1B2C3",
        "A_B_C",
    ],
)
def test_facts_accepts_valid_key_env(facts_schema, good_env):
    """Valid keyEnv values MUST pass schema validation."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": good_env,
    }
    _validate(instance, facts_schema)


# ---------------------------------------------------------------------------
# acq-provider-facts/v1 — URL scheme enforcement (https:// required)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_url_field,bad_url",
    [
        ("baseUrl", "http://api.example.com/v1"),
        ("baseUrl", "ftp://api.example.com/v1"),
        ("baseUrl", "//api.example.com/v1"),
        ("modelsUrl", "http://api.example.com/v1/models"),
        ("modelsUrl", "javascript:alert(1)"),
        ("modelsUrl", "data:text/plain,hello"),
    ],
)
def test_facts_rejects_non_https_urls(facts_schema, bad_url_field, bad_url):
    """baseUrl and modelsUrl MUST start with https://."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    instance[bad_url_field] = bad_url
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


# ---------------------------------------------------------------------------
# acq-provider-facts/v1 — missing required fields fail closed
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "missing_field",
    [
        "schemaVersion",
        "providerId",
        "apiProtocol",
        "host",
        "baseUrl",
        "modelsUrl",
        "keyEnv",
    ],
)
def test_facts_rejects_missing_required_field(facts_schema, missing_field):
    """A missing required field MUST fail validation (fail closed)."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    del instance[missing_field]
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


def test_facts_rejects_wrong_schema_version(facts_schema):
    """Wrong schemaVersion MUST fail (const constraint)."""
    instance = {
        "schemaVersion": "acq-provider-facts/v2",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


def test_facts_rejects_additional_properties(facts_schema):
    """Additional properties MUST be rejected (additionalProperties: false)."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
        "openCodeModel": "some-model",  # harness-native field must be rejected
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


# ---------------------------------------------------------------------------
# acq-provider-facts/v1 — apiProtocol closed-enum enforcement
# ---------------------------------------------------------------------------


def test_facts_accepts_supported_api_protocol(facts_schema):
    """The protocol proven by this milestone passes schema validation."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": "openai-compatible",
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    _validate(instance, facts_schema)


@pytest.mark.parametrize(
    "bad_protocol",
    [
        # completely unknown value
        "unknown-protocol",
        # harness-native vocabulary — must not be accepted
        "opencode",
        "cursor",
        # empty string
        "",
        # case variants of a valid enum value (enum is case-sensitive)
        "OpenAI-Compatible",
        "OPENAI-COMPATIBLE",
        "Anthropic",
        "ANTHROPIC",
        # trailing line terminators — close the $ anchor bypass, same as other fields
        "openai-compatible\n",
        "openai-compatible\r",
        "openai-compatible\r\n",
        # null (wrong type)
        None,
        # integer (wrong type)
        42,
        # executable / injection-attempt strings
        "require('fs')",
        "import('evil')",
        "exec(cmd)",
    ],
)
def test_facts_rejects_invalid_api_protocol(facts_schema, bad_protocol):
    """Unsupported apiProtocol values MUST fail schema validation."""
    instance = {
        "schemaVersion": "acq-provider-facts/v1",
        "providerId": "usai",
        "apiProtocol": bad_protocol,
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


def test_facts_api_protocol_is_bounded_string(facts_schema):
    """apiProtocol is declarative data constrained by a closed vocabulary."""
    protocol_prop = facts_schema["properties"]["apiProtocol"]
    assert protocol_prop["type"] == "string"
    assert protocol_prop["enum"] == ["openai-compatible"]


def test_facts_api_protocol_usai_uses_openai_compatible(usai_facts):
    """USAi declares its wire protocol independently of its provider ID."""
    assert usai_facts.get("apiProtocol") == "openai-compatible", (
        "USAi speaks the OpenAI-compatible REST API; facts must reflect that"
    )


def test_facts_api_protocol_acme_is_provider_independent(acme_facts):
    """A second provider ID can use the same protocol without special casing."""
    assert acme_facts.get("apiProtocol") == "openai-compatible", (
        "acme-ai fixture must declare the protocol independently of providerId"
    )


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — model id charset validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_model_id",
    [
        "",
        # control characters
        "model\x00id",
        "model\nid",
        "model\rid",
        "model\x1bid",
        "model\x7fid",
        # Unicode line/paragraph separators
        "model\u2028id",
        "model\u2029id",
        # trailing line terminators — $ matches before \n in Python re and ECMA regex;
        # the pattern uses (?![\s\S]) to close this bypass across all identifiers
        "model-a\n",
        "model-a\r",
        "model-a\r\n",
        # too long
        "m" * 129,
    ],
)
def test_catalog_rejects_bad_model_id(catalog_schema, bad_model_id):
    """Invalid model ids MUST fail schema validation."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": bad_model_id}],
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — catalog must not carry routing/credential fields
# ---------------------------------------------------------------------------


def test_catalog_no_routing_fields(catalog_schema):
    """additionalProperties: false prevents routing/credential fields at the top level."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [],
        "host": "api.gsa.usai.gov",  # MUST be rejected
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


def test_catalog_no_key_env_at_top_level(catalog_schema):
    """keyEnv MUST NOT appear at the top level of a catalog."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [],
        "keyEnv": "USAI_API_KEY",  # MUST be rejected
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


def test_catalog_no_gateway_block(catalog_schema):
    """The gateway block (from usai-model-catalog/v1) MUST NOT appear in the neutral catalog."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [],
        "gateway": {  # MUST be rejected — this is usai-model-catalog/v1 vocabulary
            "host": "api.gsa.usai.gov",
            "baseUrl": "https://api.gsa.usai.gov/api/v1",
            "api": "openai-completions",
            "apiKeyEnv": "USAI_API_KEY",
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


def test_usai_snapshot_no_credential_fields(usai_snapshot):
    """USAi shipped snapshot carries no routing or credential fields."""
    errors = _check_no_credential_fields(usai_snapshot)
    assert errors == [], "\n".join(errors)


def test_acme_snapshot_no_credential_fields(acme_snapshot):
    """acme-ai shipped snapshot carries no routing or credential fields."""
    errors = _check_no_credential_fields(acme_snapshot)
    assert errors == [], "\n".join(errors)


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — duplicate model ID detection
# ---------------------------------------------------------------------------


def test_catalog_duplicate_model_ids_are_detected():
    """Duplicate model ids in models[] MUST be flagged by the validator helper."""
    catalog = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [
            {"id": "model-a"},
            {"id": "model-b"},
            {"id": "model-a"},  # duplicate
        ],
    }
    duplicates = _check_no_duplicate_ids(catalog)
    assert duplicates == ["model-a"]


def test_runtime_validator_rejects_duplicate_model_ids():
    """The host-time validator, not only a test helper, rejects duplicate IDs."""
    with pytest.raises(ContractError, match="duplicate model IDs"):
        validate_catalog(
            {
                "schemaVersion": "acq-neutral-model-catalog/v1",
                "providerId": "acme-ai",
                "models": [{"id": "model-a"}, {"id": "model-a"}],
            },
            "acme-ai",
            "test catalog",
        )


def test_catalog_no_duplicate_model_ids_in_usai_snapshot(usai_snapshot):
    """USAi shipped snapshot must not have duplicate model IDs."""
    duplicates = _check_no_duplicate_ids(usai_snapshot)
    assert duplicates == [], f"Duplicate model ids in usai snapshot: {duplicates}"


def test_catalog_no_duplicate_model_ids_in_acme_snapshot(acme_snapshot):
    """acme-ai shipped snapshot must not have duplicate model IDs."""
    duplicates = _check_no_duplicate_ids(acme_snapshot)
    assert duplicates == [], f"Duplicate model ids in acme-ai snapshot: {duplicates}"


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — maxItems (resource exhaustion guard)
# ---------------------------------------------------------------------------


def test_catalog_rejects_too_many_models(catalog_schema):
    """models[] exceeding maxItems MUST fail validation (resource exhaustion guard)."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": f"model-{i}"} for i in range(501)],
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


def test_catalog_accepts_empty_models(catalog_schema):
    """An empty models[] is valid — a provider legitimately exposing no models."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [],
    }
    _validate(instance, catalog_schema)


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — recommendations are advisory and reference-checked
# ---------------------------------------------------------------------------


def test_recommendations_reference_check_passes_for_usai_snapshot(usai_snapshot):
    """USAi snapshot recommendations reference only model ids in models[]."""
    errors = _validate_recommendations(usai_snapshot)
    assert errors == [], "\n".join(errors)


def test_recommendations_reference_check_passes_for_acme_snapshot(acme_snapshot):
    """acme-ai snapshot recommendations reference only model ids in models[]."""
    errors = _validate_recommendations(acme_snapshot)
    assert errors == [], "\n".join(errors)


def test_recommendations_with_dangling_ref_are_detected():
    """A recommendation pointing to a non-existent model id MUST be flagged."""
    catalog = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "model-a"}],
        "recommendations": {
            "primary": "model-a",
            "small": "model-does-not-exist",  # dangling
        },
    }
    errors = _validate_recommendations(catalog)
    assert len(errors) == 1
    assert "model-does-not-exist" in errors[0]


def test_runtime_validator_rejects_dangling_recommendation():
    """The host-time validator rejects a recommendation without a model target."""
    with pytest.raises(ContractError, match="does not reference"):
        validate_catalog(
            {
                "schemaVersion": "acq-neutral-model-catalog/v1",
                "providerId": "acme-ai",
                "models": [{"id": "model-a"}],
                "recommendations": {"primary": "missing"},
            },
            "acme-ai",
            "test catalog",
        )


def test_recommendations_are_optional(catalog_schema):
    """Catalogs without a recommendations block MUST still be valid."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "model-a"}],
        # no recommendations
    }
    _validate(instance, catalog_schema)


def test_recommendations_unknown_roles_are_rejected(catalog_schema):
    """Unknown recommendation roles MUST be rejected (additionalProperties: false)."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "model-a"}],
        "recommendations": {
            "primary": "model-a",
            "openCodeModel": "model-a",  # harness-native key — MUST be rejected
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


def test_recommendations_control_chars_are_rejected(catalog_schema):
    """Recommendation values with control characters MUST fail."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "model-a"}],
        "recommendations": {
            "primary": "model-a\x00injected",
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


@pytest.mark.parametrize(
    "bad_rec_value",
    [
        # trailing line terminators — $ matches before \n; (?![\s\S]) closes this
        "model-a\n",
        "model-a\r",
        "model-a\r\n",
        # unicode line/paragraph separators
        "model-a\u2028",
        "model-a\u2029",
        # NUL
        "model-a\x00",
    ],
)
def test_recommendations_line_terminators_are_rejected(catalog_schema, bad_rec_value):
    """Recommendation values with trailing line terminators or line-separator characters MUST fail."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "model-a"}],
        "recommendations": {
            "primary": bad_rec_value,
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — catalog providerId slug validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_id",
    [
        "../etc",
        "/absolute",
        "UPPER",
        "under_score",
        "-leading",
        "trailing-",
        "",
        "a" * 33,
        # trailing newline — $ anchor bypass (same issue as facts schema; both now use (?![\s\S]))
        "usai\n",
    ],
)
def test_catalog_rejects_bad_provider_id(catalog_schema, bad_id):
    """Invalid providerId in catalog MUST fail validation."""
    instance = {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": bad_id,
        "models": [],
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, catalog_schema)


# ---------------------------------------------------------------------------
# acq-neutral-model-catalog/v1 — optional capability metadata
# ---------------------------------------------------------------------------


def _catalog_with_model(model: dict) -> dict:
    return {
        "schemaVersion": "acq-neutral-model-catalog/v1",
        "providerId": "usai",
        "models": [{"id": "m", **model}],
    }


@pytest.mark.parametrize(
    "capabilities",
    [
        {},
        {"reasoning": True},
        {"reasoning": False},
        {"inputModalities": ["text"]},
        {"inputModalities": ["text", "image", "audio", "video", "pdf"]},
        {"reasoning": False, "inputModalities": ["text", "image"]},
    ],
)
def test_catalog_accepts_capability_metadata(catalog_schema, capabilities):
    """Absent (unknown), false/text-only (known), and true/image (known) are all valid."""
    _validate(_catalog_with_model(capabilities), catalog_schema)


@pytest.mark.parametrize(
    "capabilities",
    [
        {"reasoning": "true"},
        {"reasoning": 1},
        {"reasoning": None},
        {"inputModalities": []},
        {"inputModalities": "image"},
        {"inputModalities": ["hologram"]},
        {"inputModalities": ["Image"]},
        {"inputModalities": ["text", "text"]},
        {"inputModalities": [1]},
        {"inputModalities": None},
    ],
)
def test_catalog_rejects_malformed_capability_metadata(catalog_schema, capabilities):
    """Non-boolean reasoning and non-allowlisted/empty/duplicate modalities fail closed."""
    with pytest.raises(jsonschema.ValidationError):
        _validate(_catalog_with_model(capabilities), catalog_schema)


# ---------------------------------------------------------------------------
# Existing shipped snapshot compatibility (usai-provider kit)
# ---------------------------------------------------------------------------


def test_shipped_usai_model_catalog_snapshot_validates(catalog_schema):
    """The shipped usai-provider kit snapshot validates against the new schema."""
    snapshot_path = (
        ROOT
        / "integrations"
        / "isolation"
        / "acq-kits"
        / "usai-provider"
        / "files"
        / "home"
        / "usai-config"
        / "model-catalog-snapshot.json"
    )
    snapshot = json.loads(snapshot_path.read_text())
    _validate(snapshot, catalog_schema)


def test_shipped_usai_snapshot_no_credential_fields():
    """The shipped usai-provider kit snapshot must not carry routing/credential fields."""
    snapshot_path = (
        ROOT
        / "integrations"
        / "isolation"
        / "acq-kits"
        / "usai-provider"
        / "files"
        / "home"
        / "usai-config"
        / "model-catalog-snapshot.json"
    )
    snapshot = json.loads(snapshot_path.read_text())
    errors = _check_no_credential_fields(snapshot)
    assert errors == [], "\n".join(errors)


def test_shipped_usai_snapshot_no_duplicate_ids():
    """The shipped usai-provider kit snapshot must not contain duplicate model IDs."""
    snapshot_path = (
        ROOT
        / "integrations"
        / "isolation"
        / "acq-kits"
        / "usai-provider"
        / "files"
        / "home"
        / "usai-config"
        / "model-catalog-snapshot.json"
    )
    snapshot = json.loads(snapshot_path.read_text())
    duplicates = _check_no_duplicate_ids(snapshot)
    assert duplicates == [], f"Duplicate model ids: {duplicates}"


def test_runtime_validator_accepts_shipped_usai_bundle():
    """The shipped kit declares safe package and projected host/guest paths."""
    validate_bundle(ROOT / "integrations/isolation/acq-kits/usai-provider/provider-input.json")


def test_usai_normalizer_output_satisfies_runtime_contract(tmp_path):
    """The shipped normalizer cannot emit a catalog outside the neutral contract."""
    output_path = tmp_path / "catalog.json"
    script_path = ROOT / "integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs"
    source_path = ROOT / "integrations/providers/usai/catalog.json"
    subprocess.run(
        [*_normalizer_argv(script_path), "--source", str(source_path), "--out", str(output_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    validate_catalog(load_json(output_path), "usai", str(output_path))


def test_runtime_validator_rejects_host_mismatch(tmp_path):
    """Host-time validation rejects a URL whose host differs from provider facts."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    facts_path = bundle_dir / "facts.json"
    facts = json.loads(facts_path.read_text())
    facts["modelsUrl"] = "https://other.example.com/v2/models"
    facts_path.write_text(json.dumps(facts))
    with pytest.raises(ContractError, match="hostname must equal"):
        validate_bundle(bundle_dir / "bundle.json")


def test_runtime_validator_rejects_undeclared_credential_name(tmp_path):
    """A provider may not point facts.keyEnv at a credential it did not declare."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    facts_path = bundle_dir / "facts.json"
    facts = json.loads(facts_path.read_text())
    facts["keyEnv"] = "GITHUB_TOKEN"
    facts_path.write_text(json.dumps(facts))
    with pytest.raises(ContractError, match="host credential binding"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


@requires_symlink_support
def test_runtime_validator_rejects_artifact_symlink(tmp_path):
    """Package-relative artifact names cannot escape through a symlink."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    (bundle_dir / "facts.json").unlink()
    (bundle_dir / "facts.json").symlink_to(ROOT / "README.md")
    with pytest.raises(ContractError, match="path components must not be symlinks"):
        validate_bundle(bundle_dir / "bundle.json")


def test_runtime_validator_rejects_nondefault_https_port(tmp_path):
    """The provider-host contract does not permit an endpoint port override."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    facts_path = bundle_dir / "facts.json"
    facts = json.loads(facts_path.read_text())
    facts["modelsUrl"] = "https://api.acme-ai.example.com:444/v2/models"
    facts_path.write_text(json.dumps(facts))
    with pytest.raises(ContractError, match="HTTPS URL"):
        validate_bundle(bundle_dir / "bundle.json")


def test_runtime_validator_rejects_malformed_port(tmp_path):
    """Malformed URL ports fail as contract errors rather than uncaught exceptions."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    facts_path = bundle_dir / "facts.json"
    facts = json.loads(facts_path.read_text())
    facts["modelsUrl"] = "https://api.acme-ai.example.com:99999/v2/models"
    facts_path.write_text(json.dumps(facts))
    with pytest.raises(ContractError, match="invalid port"):
        validate_bundle(bundle_dir / "bundle.json")


@pytest.mark.parametrize(
    "host",
    ["127.1", "2130706433", "0x7f000001", "127.0x0.0.1", "0177.0.0.1", "127.0.0.1."],
)
def test_runtime_validator_rejects_noncanonical_ip_literals(tmp_path, host):
    """Host validation rejects URL-parser spellings of IPv4 literals."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    facts_path = bundle_dir / "facts.json"
    facts = json.loads(facts_path.read_text())
    facts["host"] = host
    facts["baseUrl"] = f"https://{host}/v2"
    facts["modelsUrl"] = f"https://{host}/v2/models"
    facts_path.write_text(json.dumps(facts))
    with pytest.raises(ContractError):
        validate_bundle(bundle_dir / "bundle.json")


# ---------------------------------------------------------------------------
# credentialEnvNames — facts.keyEnv must be declared in the bundle manifest
# ---------------------------------------------------------------------------


def test_runtime_validator_accepts_keyenv_declared_in_credentials(tmp_path):
    """Positive: facts.keyEnv that appears in credentialEnvNames validates cleanly."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    # The acme-ai fixture already declares ACME_AI_API_KEY in both facts and
    # credentialEnvNames — this is the positive round-trip proof.
    validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


def test_runtime_validator_rejects_keyenv_absent_from_credentials(tmp_path):
    """facts.keyEnv not listed in credentialEnvNames must be rejected."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    # Remove ACME_AI_API_KEY and replace with an unrelated name so the
    # host-credential-binding check still passes but the cross-check fails.
    bundle["credentialEnvNames"] = ["UNRELATED_CREDENTIAL"]
    bundle_path.write_text(json.dumps(bundle))
    with pytest.raises(ContractError, match="credentialEnvNames"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_runtime_validator_rejects_nonstandard_json_constants(tmp_path, constant):
    """Host validation rejects values that strict downstream JSON parsers cannot read."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    snapshot_path = bundle_dir / "snapshot.json"
    snapshot_text = snapshot_path.read_text().replace('"input": 4.0', f'"input": {constant}')
    snapshot_path.write_text(snapshot_text)

    with pytest.raises(ContractError, match="non-standard JSON constant"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


def test_runtime_validator_accepts_keyenv_among_multiple_credentials(tmp_path):
    """facts.keyEnv matching one of several declared credential names is accepted."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    # Declare two credential names; the facts keyEnv matches the second one.
    bundle["credentialEnvNames"] = ["ACME_AI_LEGACY_KEY", "ACME_AI_API_KEY"]
    bundle_path.write_text(json.dumps(bundle))
    validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


# ---------------------------------------------------------------------------
# normalizerPath — executable regular file: POSIX mode bits / Windows launcher
# ---------------------------------------------------------------------------


def _make_bundle_with_normalizer(tmp_path, name, text):
    """Copy the acme-ai fixture and point its bundle at a normalizer named ``name``."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    (bundle_dir / "normalize.py").unlink()
    (bundle_dir / name).write_text(text)
    bundle_path = bundle_dir / "bundle.json"
    bundle = json.loads(bundle_path.read_text())
    bundle["normalizerPath"] = name
    bundle_path.write_text(json.dumps(bundle))
    return bundle_path


@pytest.fixture
def windows_platform(monkeypatch):
    """Exercise the Windows launcher branch on any host through the platform seam."""
    monkeypatch.setattr(validator, "_is_windows", lambda: True)


def test_runtime_validator_rejects_non_executable_normalizer_on_posix(tmp_path):
    """On POSIX, stripping every execute bit (0644) from the normalizer is rejected."""
    if os.name == "nt":
        pytest.skip("POSIX mode bits are not reported on Windows")
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    (bundle_dir / "normalize.py").chmod(0o644)
    with pytest.raises(ContractError, match="executable"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


def test_runtime_validator_ignores_shebang_when_posix_mode_bits_missing(tmp_path):
    """POSIX behavior is unchanged: a valid shebang does not substitute for the exec bit."""
    if os.name == "nt":
        pytest.skip("POSIX mode bits are not reported on Windows")
    bundle_path = _make_bundle_with_normalizer(tmp_path, "normalize.py", "#!/usr/bin/env python3\n")
    (bundle_path.parent / "normalize.py").chmod(0o644)
    with pytest.raises(ContractError, match="executable"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
def test_windows_contract_rejects_regular_file_without_shebang(tmp_path):
    """A regular data file with a runnable extension but no shebang is not a normalizer."""
    bundle_path = _make_bundle_with_normalizer(tmp_path, "normalize.py", "plain data, not a runnable normalizer\n")
    with pytest.raises(ContractError, match="shebang"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
def test_windows_contract_rejects_unrecognized_normalizer_extension(tmp_path):
    """A regular file whose extension has no runnable association is rejected."""
    bundle_path = _make_bundle_with_normalizer(tmp_path, "normalize.txt", "#!/usr/bin/env python3\nprint('x')\n")
    with pytest.raises(ContractError, match="supported launcher extension"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
@pytest.mark.parametrize(
    "suffix,shebang",
    [
        (".py", "#!/usr/bin/env python3\n"),
        (".PY", "#!/usr/bin/env python3\n"),
        (".py", "#!/usr/bin/env\tpython3\n"),
        (".py", "#!/usr/bin/env python3\r\n"),
        (".py", "#!/usr/bin/python\n"),
        (".py", "#!/usr/bin/env py\n"),
        (".py", "#!/usr/bin/env python.exe\n"),
        (".py", "#!/usr/bin/env PYTHON3.EXE\n"),
        (".mjs", "#!/usr/bin/env node\n"),
        (".mjs", "#!/usr/bin/node\n"),
        (".mjs", "#!/usr/bin/env node.exe\n"),
        (".py", "#!/usr/local/bin/python3\n"),
        (".py", "#!python3\n"),
        (".MJS", "#!/usr/bin/env node\n"),
    ],
)
def test_windows_contract_accepts_supported_normalizer(tmp_path, suffix, shebang):
    """An allowed extension with an exactly matching interpreter satisfies the contract."""
    bundle_path = _make_bundle_with_normalizer(tmp_path, f"normalize{suffix}", shebang + "content\n")
    validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
@pytest.mark.parametrize(
    "suffix,shebang",
    [
        (".py", "#!/usr/bin/env python-evil\n"),
        (".py", "#!/usr/bin/env python3-evil\n"),
        (".py", "#!/usr/bin/env pythonw\n"),
        (".py", "#!/usr/bin/env python.exe.evil\n"),
        (".py", "#!/usr/bin/env python.exe.exe\n"),
        (".py", "#!/usr/bin/env pyevil\n"),
        (".py", "#!/usr/bin/env node\n"),
        (".py", "#!/usr/bin/evil/python3-evil\n"),
        (".py", "#!/usr/bin/env python3.12\n"),
        (".py", "#!/tmp/evil/python3\n"),
        (".py", "#!/tmp/evil/env python3\n"),
        (".py", "#!C:\\evil\\python3\n"),
        (".py", "#!/usr/bin/env -S python3\n"),
        (".py", "#!/usr/bin/env python3 -u\n"),
        (".py", "#!/usr/bin/env python3 extra\n"),
        (".py", "#!/usr/bin/env FOO=bar python3\n"),
        (".py", "#!/usr/bin/python3 -u\n"),
        (".mjs", "#!/usr/bin/env node --no-warnings\n"),
        (".mjs", "#!/usr/bin/node --no-warnings\n"),
        (".py", "#!/usr/bin/env evil python3\n"),
        (".py", "#!/usr/bin/env\n"),
        (".py", "#!/python3\n"),
        (".py", "#!/env python3\n"),
        (".py", "#!/usr/bin/env /python3\n"),
        (".py", "#!/usr/bin/ENV python3\n"),
        (".py", " #!/usr/bin/env python3\n"),
        (".py", "\t#!/usr/bin/env python3\n"),
        (".py", "#!/usr/bin/env\u00a0python3\n"),
        (".mjs", "#!/node\n"),
        (".mjs", "#!/usr/bin/env nodeevil\n"),
        (".mjs", "#!/usr/bin/env node.exe.evil\n"),
        (".mjs", "#!/usr/bin/env node-evil\n"),
        (".mjs", "#!/usr/bin/env nodejs\n"),
        (".mjs", "#!/usr/bin/env python3\n"),
        (".mjs", "#!/usr/bin/env evil node\n"),
        (".mjs", "#!/usr/bin/env FOO=bar node\n"),
        (".mjs", "#!/usr/bin/nodeevil\n"),
        (".mjs", "#!/opt/evil/node\n"),
    ],
)
def test_windows_contract_rejects_lookalike_interpreters(tmp_path, suffix, shebang):
    """Prefix, suffix, wrong-language, and indirection spellings are not accepted."""
    bundle_path = _make_bundle_with_normalizer(tmp_path, f"normalize{suffix}", shebang + "content\n")
    with pytest.raises(ContractError, match="shebang"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
def test_windows_contract_ignores_interpreter_beyond_shebang_read_limit(tmp_path):
    """The first line is read only up to a bounded length, so a far-away interpreter is not seen."""
    padded = "#!/usr/bin/env " + " " * 8192 + "python3\n"
    bundle_path = _make_bundle_with_normalizer(tmp_path, "normalize.py", padded)
    with pytest.raises(ContractError, match="shebang"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.usefixtures("windows_platform")
def test_windows_contract_accepts_every_shipped_bundle():
    """Real fixtures and kit bundles satisfy the Windows launcher contract as shipped."""
    bundles = validator.discovered_bundles()
    assert bundles
    for bundle in bundles:
        validate_bundle(bundle, None)


@pytest.mark.usefixtures("windows_platform")
@requires_symlink_support
def test_windows_contract_keeps_symlink_and_inside_root_checks(tmp_path):
    """Windows branch does not relax the symlink and inside-root checks that precede it."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    normalizer_path = bundle_dir / "normalize.py"
    real_path = bundle_dir / "normalize_real.py"
    normalizer_path.rename(real_path)
    normalizer_path.symlink_to(real_path)
    with pytest.raises(ContractError, match="path components must not be symlinks"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


@requires_symlink_support
def test_runtime_validator_rejects_normalizer_symlink(tmp_path):
    """normalizerPath that is a symlink (even to an executable) must be rejected."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    normalizer_path = bundle_dir / "normalize.py"
    real_path = bundle_dir / "normalize_real.py"
    normalizer_path.rename(real_path)
    normalizer_path.symlink_to(real_path)
    with pytest.raises(ContractError, match="path components must not be symlinks"):
        validate_bundle(bundle_dir / "bundle.json", {"acme-ai": "ACME_AI_API_KEY"})


def test_fixture_normalizers_are_directly_invocable(tmp_path):
    """Fixture normalizers transform vendor-shaped source into the exact snapshot."""
    for fixture_name, provider_id in [("usai", "usai"), ("acme-ai", "acme-ai")]:
        fixture_dir = FIXTURES_DIR / fixture_name
        normalizer = fixture_dir / "normalize.py"
        out = tmp_path / f"{fixture_name}-catalog.json"
        result = subprocess.run(
            [*_normalizer_argv(normalizer), "--source", str(fixture_dir / "source.json"), "--out", str(out)],
            check=True,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        catalog = load_json(out)
        validate_catalog(catalog, provider_id, str(out))
        assert out.read_bytes() == (fixture_dir / "snapshot.json").read_bytes()


# ---------------------------------------------------------------------------
# validate_bundle — malformed JSON root type guards
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("root_value", [None, [], "string", 42, True])
def test_runtime_validator_rejects_non_object_root_direct_api(tmp_path, root_value):
    """Direct validate_bundle raises ContractError for non-object JSON roots."""
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(json.dumps(root_value))
    with pytest.raises(ContractError, match="bundle root must be an object"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.parametrize("root_value", [None, [], "string", 42, True])
def test_validator_cli_rejects_non_object_root(tmp_path, root_value):
    """CLI subprocess exits 1 with no Traceback for non-object JSON roots."""
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(json.dumps(root_value))
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(SCHEMAS_DIR / "provider-credential-bindings.json"),
            "--bundle",
            str(bundle_path),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "bundle root must be an object" in result.stderr


@pytest.mark.parametrize("schema_version_value", [None, [], 42, True, {"nested": "object"}])
def test_runtime_validator_rejects_non_string_schema_version_direct_api(tmp_path, schema_version_value):
    """Direct validate_bundle raises ContractError for non-string schemaVersion."""
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(json.dumps({"schemaVersion": schema_version_value}))
    with pytest.raises(ContractError, match="bundle schemaVersion must be a string"):
        validate_bundle(bundle_path, {"acme-ai": "ACME_AI_API_KEY"})


@pytest.mark.parametrize("schema_version_value", [None, [], 42, True, {"nested": "object"}])
def test_validator_cli_rejects_non_string_schema_version(tmp_path, schema_version_value):
    """CLI subprocess exits 1 with no Traceback for non-string schemaVersion."""
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(json.dumps({"schemaVersion": schema_version_value}))
    result = subprocess.run(
        [
            "python3",
            str(VALIDATOR_PATH),
            "--schema-dir",
            str(SCHEMAS_DIR),
            "--credential-bindings",
            str(SCHEMAS_DIR / "provider-credential-bindings.json"),
            "--bundle",
            str(bundle_path),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "bundle schemaVersion must be a string" in result.stderr
