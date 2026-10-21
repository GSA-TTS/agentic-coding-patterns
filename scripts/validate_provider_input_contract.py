"""Validate host-time provider input bundles before they are projected to guests."""

from __future__ import annotations

import ipaddress
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "integrations" / "isolation" / "schemas"
PROJECTED_ROOT = "/var/lib/acq/host/models/providers"
HOST_CREDENTIAL_BINDINGS = SCHEMAS / "provider-credential-bindings.json"


class ContractError(ValueError):
    """A provider input bundle is not safe to materialize."""


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ContractError(f"{path}: cannot read JSON: {error}") from error


def validate_schema(instance: dict, schema_name: str, label: str) -> None:
    schema = load_json(SCHEMAS / schema_name)
    validator = jsonschema.validators.validator_for(schema)(schema, format_checker=jsonschema.FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
    if errors:
        raise ContractError(f"{label}: {errors[0].message}")


def reject_unsafe_host(host: str, label: str) -> None:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return
    raise ContractError(f"{label}: IP address literals are not permitted")


def reject_url_ip_literal(host: str, label: str) -> None:
    """Reject URL-parser IPv4 spellings that are not accepted by ipaddress."""

    def is_url_number(component: str) -> bool:
        lower = component.lower()
        if lower.startswith("0x"):
            return len(component) > 2 and all(character in "0123456789abcdef" for character in lower[2:])
        if len(component) > 1 and component.startswith("0"):
            return all(character in "01234567" for character in component[1:])
        return component.isdecimal()

    labels = host.rstrip(".").split(".")
    if host.endswith(".") or all(is_url_number(component) for component in labels):
        raise ContractError(f"{label}: IP address literals are not permitted")


def validate_url(value: str, host: str, label: str) -> None:
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise ContractError(f"{label}: has an invalid port") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or port not in (None, 443)
    ):
        raise ContractError(f"{label}: must be an HTTPS URL without credentials or a fragment")
    if parsed.hostname.lower() != host.lower():
        raise ContractError(f"{label}: hostname must equal facts.host")
    if any(character.isspace() for character in value):
        raise ContractError(f"{label}: must not contain whitespace")
    reject_unsafe_host(parsed.hostname, label)
    reject_url_ip_literal(parsed.hostname, label)


def validate_catalog(catalog: dict, provider_id: str, label: str) -> None:
    validate_schema(catalog, "acq-neutral-model-catalog.schema.json", label)
    if catalog["providerId"] != provider_id:
        raise ContractError(f"{label}: providerId must equal facts.providerId")
    ids = [model["id"] for model in catalog["models"]]
    duplicates = sorted({model_id for model_id in ids if ids.count(model_id) > 1})
    if duplicates:
        raise ContractError(f"{label}: duplicate model IDs: {', '.join(duplicates)}")
    for role, model_id in catalog.get("recommendations", {}).items():
        if model_id not in ids:
            raise ContractError(f"{label}: recommendations.{role} does not reference models[].id")


def validate_relative_path(value: str, label: str) -> None:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or value in {"", "."}:
        raise ContractError(f"{label}: must be a non-empty kit-relative path without traversal")


def reject_symlink_components(package_root: Path, relative: str, label: str) -> None:
    current = package_root
    for part in Path(relative).parts:
        current /= part
        if current.is_symlink():
            raise ContractError(f"{label}: path components must not be symlinks")


def validate_bundle(
    bundle_path: Path,
    credential_bindings: dict[str, str] | None = None,
    seen_provider_ids: set[str] | None = None,
) -> None:
    if credential_bindings is None:
        credential_bindings = load_json(HOST_CREDENTIAL_BINDINGS)["providers"]
    bundle = load_json(bundle_path)
    validate_schema(bundle, "acq-provider-input-bundle.schema.json", str(bundle_path))
    package_root = bundle_path.parent
    resolved_package_root = package_root.resolve()
    for field in ("factsPath", "snapshotPath", "normalizerPath"):
        validate_relative_path(bundle[field], f"{bundle_path}: {field}")
        reject_symlink_components(package_root, bundle[field], f"{bundle_path}: {field}")
    facts_path = package_root / bundle["factsPath"]
    snapshot_path = package_root / bundle["snapshotPath"]
    normalizer_path = package_root / bundle["normalizerPath"]
    for path in (facts_path, snapshot_path, normalizer_path):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(resolved_package_root):
            raise ContractError(f"{bundle_path}: declared artifact paths must be regular files inside the provider kit")
    if not facts_path.is_file() or not snapshot_path.is_file() or not normalizer_path.is_file():
        raise ContractError(f"{bundle_path}: declared artifact paths must be regular files")
    if not normalizer_path.stat().st_mode & 0o111:
        raise ContractError(f"{bundle_path}: normalizerPath must be an executable file")
    if not os.access(normalizer_path, os.X_OK):
        raise ContractError(f"{bundle_path}: normalizerPath is not executable by the validator")
    facts = load_json(facts_path)
    validate_schema(facts, "acq-provider-facts.schema.json", str(facts_path))
    provider_id = facts["providerId"]
    if bundle["providerId"] != provider_id:
        raise ContractError(f"{bundle_path}: providerId must equal facts.providerId")
    spec_path = package_root / "spec.yaml"
    if spec_path.is_file():
        spec = yaml.safe_load(spec_path.read_text())
        allowed_hosts = set(spec.get("caps", {}).get("network", {}).get("allow", []))
    else:
        allowed_hosts = {facts["host"]}
    if credential_bindings is not None and credential_bindings.get(provider_id) != facts["keyEnv"]:
        raise ContractError(f"{bundle_path}: facts.keyEnv must match the host credential binding")
    if facts["keyEnv"] not in bundle["credentialEnvNames"]:
        raise ContractError(
            f"{bundle_path}: facts.keyEnv '{facts['keyEnv']}' must be declared in bundle credentialEnvNames"
        )
    if seen_provider_ids is not None:
        if provider_id in seen_provider_ids:
            raise ContractError(f"{bundle_path}: duplicate providerId '{provider_id}'")
        seen_provider_ids.add(provider_id)
    reject_unsafe_host(facts["host"], str(facts_path))
    if facts["host"] not in allowed_hosts:
        raise ContractError(f"{bundle_path}: facts.host must be in the kit network allowlist")
    validate_url(facts["baseUrl"], facts["host"], f"{facts_path}: baseUrl")
    validate_url(facts["modelsUrl"], facts["host"], f"{facts_path}: modelsUrl")
    validate_catalog(load_json(snapshot_path), provider_id, str(snapshot_path))
    expected_projection = f"{PROJECTED_ROOT}/{provider_id}"
    if bundle["projectedPath"] != expected_projection:
        raise ContractError(f"{bundle_path}: projectedPath must be {expected_projection}")


def discovered_bundles() -> list[Path]:
    return sorted((SCHEMAS / "fixtures").glob("*/bundle.json")) + sorted(
        ROOT.glob("integrations/isolation/acq-kits/*/provider-input.json")
    )


def main() -> int:
    bundles = discovered_bundles()
    if not bundles:
        print("provider input contract: no bundles discovered", file=sys.stderr)
        return 1
    try:
        credential_bindings = load_json(HOST_CREDENTIAL_BINDINGS)["providers"]
        fixture_bundles = [bundle for bundle in bundles if "/schemas/fixtures/" in str(bundle)]
        kit_bundles = [bundle for bundle in bundles if bundle not in fixture_bundles]
        for bundle in fixture_bundles:
            validate_bundle(bundle, credential_bindings)
        seen_provider_ids: set[str] = set()
        for bundle in kit_bundles:
            validate_bundle(bundle, credential_bindings, seen_provider_ids)
    except ContractError as error:
        print(f"provider input contract: {error}", file=sys.stderr)
        return 1
    print(f"provider input contract: validated {len(bundles)} bundle(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
