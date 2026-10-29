"""Schema-level check that the shipped USAi catalog matches its own schema.

The hand-written validateCatalog() in build-catalog.mjs does not enforce
`recommendations` role names, so only a real JSON Schema validator catches
drift between catalog.schema.json and catalog.json.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import jsonschema
import pytest

USAI_DIR = Path(__file__).resolve().parents[2] / "integrations" / "providers" / "usai"
ROLES = {"primary", "small", "compaction", "summary", "title"}


@pytest.fixture(scope="module")
def schema():
    return json.loads((USAI_DIR / "catalog.schema.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def catalog():
    return json.loads((USAI_DIR / "catalog.json").read_text(encoding="utf-8"))


def test_schema_is_valid_2020_12(schema):
    jsonschema.Draft202012Validator.check_schema(schema)


def test_shipped_catalog_validates_against_schema(schema, catalog):
    errors = [e.message for e in jsonschema.Draft202012Validator(schema).iter_errors(catalog)]
    assert errors == []


def test_recommendations_roles_match_renderer_vocabulary(schema):
    assert set(schema["properties"]["recommendations"]["properties"]) == ROLES


def test_recommendations_rejects_unknown_role(schema, catalog):
    mutated = copy.deepcopy(catalog)
    mutated["recommendations"]["not-a-role"] = "claude-sonnet-5"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(mutated, schema)


@pytest.mark.parametrize("role", sorted(ROLES))
def test_recommendations_rejects_empty_role_value(schema, catalog, role):
    mutated = copy.deepcopy(catalog)
    mutated["recommendations"][role] = ""
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(mutated, schema)
