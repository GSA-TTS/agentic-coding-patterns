"""Tests for the provider input contract schemas:
  - integrations/isolation/schemas/acq-provider-facts.schema.json
  - integrations/isolation/schemas/acq-neutral-model-catalog.schema.json

Verifies:
  - Valid USAi fixture validates as an ordinary provider instance.
  - Valid fictitious acme-ai fixture validates without USAi-specific fields.
  - Strict validation of feed-controlled strings: providerId slug, keyEnv charset,
    URL patterns.
  - Malformed URLs, unsafe feed-controlled strings, and unknown required fields
    fail closed.
  - Duplicate model IDs are detected by the validator (not just by the schema,
    since JSON Schema draft-2020-12 uniqueItems only checks structural equality).
  - Model catalog carries no routing or credential fields.
  - Recommendations reference only model IDs that exist in models[].
  - maxItems on models[] prevents resource exhaustion.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import jsonschema
import pytest
from validate_provider_input_contract import ContractError, load_json, validate_bundle, validate_catalog

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS_DIR = ROOT / "integrations" / "isolation" / "schemas"
FIXTURES_DIR = SCHEMAS_DIR / "fixtures"

FACTS_SCHEMA_PATH = SCHEMAS_DIR / "acq-provider-facts.schema.json"
CATALOG_SCHEMA_PATH = SCHEMAS_DIR / "acq-neutral-model-catalog.schema.json"
BUNDLE_SCHEMA_PATH = SCHEMAS_DIR / "acq-provider-input-bundle.schema.json"


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
    for path in [FACTS_SCHEMA_PATH, CATALOG_SCHEMA_PATH, BUNDLE_SCHEMA_PATH]:
        schema = _load_schema(path)
        validator_cls = jsonschema.validators.validator_for(schema)
        validator_cls.check_schema(schema)


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
        "host": "api.example.com",
        "baseUrl": "https://api.example.com/v1",
        "modelsUrl": "https://api.example.com/v1/models",
        "keyEnv": "EXAMPLE_API_KEY",
        "openCodeModel": "some-model",  # harness-native field must be rejected
    }
    with pytest.raises(jsonschema.ValidationError):
        _validate(instance, facts_schema)


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
    subprocess.run(
        ["node", str(script_path), "--out", str(output_path)],
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


def test_runtime_validator_rejects_artifact_symlink(tmp_path):
    """Package-relative artifact names cannot escape through a symlink."""
    bundle_dir = tmp_path / "provider"
    shutil.copytree(FIXTURES_DIR / "acme-ai", bundle_dir)
    (bundle_dir / "facts.json").unlink()
    (bundle_dir / "facts.json").symlink_to(ROOT / "README.md")
    with pytest.raises(ContractError, match="regular files inside"):
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
