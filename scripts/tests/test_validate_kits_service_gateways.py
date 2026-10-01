"""Tests for the hybrid/v1 serviceGateways vocabulary.

`serviceGateways` declares kit-provided, acq-managed service gateways without
baking backend routing details into the neutral kit schema. v1 uses kit-local
Compose files only, names the Compose service to expose, and injects the
resolved gateway URL into the sandbox/agent environment through expose.env. The
validator enforces path locality, blocks Compose escape primitives and local-file
indirection, requires explicit ports when the named Compose service is ambiguous,
and emits floating-image warnings.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "schemas" / "kit-hybrid-v1.schema.json"
VALIDATOR_PATH = ROOT / "integrations" / "isolation" / "acq-kits" / "validate-kits.py"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _load_validate_kit():
    spec = importlib.util.spec_from_file_location("validate_kits", VALIDATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.validate_kit


def _base(**extra) -> dict:
    d = {
        "schemaVersion": "hybrid/v1",
        "kind": "mixin",
        "name": "t",
        "displayName": "T",
        "description": "d",
    }
    d.update(extra)
    return d


def _gateway(**extra) -> dict:
    gateway = {
        "name": "demo-gateway",
        "runtime": {"compose": {"files": ["compose.yaml"], "service": "gateway"}},
        "interface": {"protocol": "http"},
        "expose": {"env": {"WEB_GATEWAY_URL": "url"}},
    }
    gateway.update(extra)
    return gateway


def _write_kit(kit_dir: Path, spec_yaml: str, compose_yaml: str | None = None) -> Path:
    kit_dir.mkdir(parents=True, exist_ok=True)
    (kit_dir / "README.md").write_text("# t\n")
    if compose_yaml is not None:
        (kit_dir / "compose.yaml").write_text(compose_yaml)
    (kit_dir / "spec.yaml").write_text(spec_yaml)
    return kit_dir


class TestServiceGatewaysSchema:
    def test_absent_service_gateways_still_valid(self):
        jsonschema.validate(instance=_base(), schema=_load_schema())

    def test_minimal_valid_gateway_accepted(self):
        jsonschema.validate(instance=_base(serviceGateways=[_gateway()]), schema=_load_schema())

    def test_expose_env_accepted(self):
        inst = _base(serviceGateways=[_gateway(interface={"protocol": "http", "port": 8080})])
        jsonschema.validate(instance=inst, schema=_load_schema())

    def test_compose_env_rejected_as_non_contract_field(self):
        inst = _base(
            serviceGateways=[
                _gateway(
                    runtime={"compose": {"files": ["compose.yaml"], "service": "gateway", "env": {"MODE": "dev"}}},
                    interface={"protocol": "http", "port": 8080},
                )
            ]
        )
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_compose_service_required(self):
        inst = _base(serviceGateways=[_gateway(runtime={"compose": {"files": ["compose.yaml"]}})])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    @pytest.mark.parametrize("bad", ["/workspace/compose.yaml", "../compose.yaml", "compose.json"])
    def test_bad_compose_path_rejected(self, bad):
        inst = _base(serviceGateways=[_gateway(runtime={"compose": {"files": [bad], "service": "gateway"}})])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_backend_routing_fields_rejected(self):
        inst = _base(serviceGateways=[_gateway(interface={"protocol": "http", "port": 8080, "hostIp": "127.0.0.1"})])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())

    def test_expose_value_must_be_url_token(self):
        inst = _base(serviceGateways=[_gateway(expose={"env": {"WEB_GATEWAY_URL": "http://127.0.0.1:8080"}})])
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=inst, schema=_load_schema())


class TestServiceGatewaysValidator:
    def test_single_compose_port_allows_omitted_interface_port(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "gatewaykit",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: gatewaykit\n"
            "displayName: Gateway\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n    expose: [8080]\n",
        )
        errors, warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors
        assert warnings == [], warnings

    def test_multiple_exposed_compose_ports_require_interface_port(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "ambiguous",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: ambiguous\n"
            "displayName: Ambiguous\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n    expose: [8080, 9090]\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("interface.port is required" in e and "2 candidate ports" in e for e in errors), errors

    def test_rejects_host_published_ports_on_any_gateway_compose_service(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "hostports",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: hostports\n"
            "displayName: Host Ports\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "      port: 8080\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n"
            "  gateway:\n"
            "    image: ghcr.io/example/gateway:1.0.0\n"
            "    expose: [8080]\n"
            "  metrics:\n"
            "    image: ghcr.io/example/metrics:1.0.0\n"
            "    ports:\n"
            "      - '9090:9090'\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("service 'metrics' declares ports" in e for e in errors), errors

    def test_missing_compose_service_is_error(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "missingservice",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: missingservice\n"
            "displayName: Missing Service\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n  other:\n    image: ghcr.io/example/other:1.0.0\n    expose: [8080]\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("runtime.compose.service 'gateway'" in e and "not found" in e for e in errors), errors

    def test_named_service_with_no_ports_requires_interface_port(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "noports",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: noports\n"
            "displayName: No Ports\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("service 'gateway' exposes 0 candidate ports" in e for e in errors), errors

    def test_explicit_interface_port_allows_ambiguous_compose_ports(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "explicit",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: explicit\n"
            "displayName: Explicit\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "      port: 8080\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n    expose: [8080, 9090]\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors

    def test_rejects_empty_compose_files(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "emptyfiles",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: emptyfiles\n"
            "displayName: Empty Files\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: []\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "      port: 8080\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            None,
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("runtime.compose.files must list at least one file" in e for e in errors), errors

    def test_rejects_missing_nonlocal_and_privileged_compose(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badgateway",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badgateway\n"
            "displayName: Bad\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [missing.yaml, ../outside.yaml, compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "      port: 8080\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            "services:\n"
            "  gateway:\n"
            "    image: ghcr.io/example/gateway:1.0.0\n"
            "    privileged: true\n"
            "    expose: [8080]\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("not found: missing.yaml" in e for e in errors), errors
        assert any("must be a relative kit-local" in e for e in errors), errors
        assert any("privileged: true" in e for e in errors), errors

    @pytest.mark.parametrize(
        ("compose_yaml", "expected"),
        [
            (
                "include: [../outside.yaml]\n"
                "services:\n"
                "  gateway:\n"
                "    image: ghcr.io/example/gateway:1.0.0\n"
                "    expose: [8080]\n",
                "include:",
            ),
            (
                "services:\n"
                "  gateway:\n"
                "    image: ghcr.io/example/gateway:1.0.0\n"
                "    expose: [8080]\n"
                "    extends:\n"
                "      file: ../base.yaml\n"
                "      service: base\n",
                "extends.file",
            ),
        ],
    )
    def test_rejects_compose_file_indirection(self, tmp_path, compose_yaml, expected):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "indirection",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: indirection\n"
            "displayName: Indirection\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            compose_yaml,
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any(expected in e for e in errors), errors

    @pytest.mark.parametrize(
        ("snippet", "expected"),
        [
            ("    volumes: ['/var/run/docker.sock:/var/run/docker.sock']\n", "Docker socket"),
            ("    volumes: ['/:/host:ro']\n", "host path mount"),
            ("    volumes: ['${HOST_ROOT:-/}:/host:ro']\n", "Compose interpolation"),
            ("    network_mode: host\n", "network_mode: host"),
            ("    network_mode: ${GW_NETWORK_MODE:-host}\n", "Compose interpolation"),
            ("    pid: host\n", "pid: host"),
            ("    userns_mode: host\n", "userns_mode: host"),
            ("    ipc: host\n", "ipc: host"),
            ("    cgroup: host\n", "cgroup: host"),
            ("    cap_add: [SYS_ADMIN]\n", "cap_add"),
            ("    security_opt: ['apparmor:unconfined']\n", "security_opt"),
            ("    devices: ['/dev/kvm:/dev/kvm']\n", "devices"),
            ("    build: .\n", "build"),
        ],
    )
    def test_rejects_compose_escape_primitives(self, tmp_path, snippet, expected):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "escape",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: escape\n"
            "displayName: Escape\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "      port: 8080\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            f"services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n    expose: [8080]\n{snippet}",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any(expected in e for e in errors), errors

    @pytest.mark.parametrize(
        ("compose_yaml", "expected"),
        [
            (
                "services:\n"
                "  gateway:\n"
                "    image: ghcr.io/example/gateway:1.0.0\n"
                "    expose: [8080]\n"
                "    env_file: /tmp/host.env\n",
                "env_file",
            ),
            (
                "services:\n"
                "  gateway:\n"
                "    image: ghcr.io/example/gateway:1.0.0\n"
                "    expose: [8080]\n"
                "    secrets: [host_secret]\n"
                "secrets:\n"
                "  host_secret:\n"
                "    file: /tmp/host-secret\n",
                "secret 'host_secret' declares file",
            ),
            (
                "services:\n"
                "  gateway:\n"
                "    image: ghcr.io/example/gateway:1.0.0\n"
                "    expose: [8080]\n"
                "    configs: [host_config]\n"
                "configs:\n"
                "  host_config:\n"
                "    file: /tmp/host-config\n",
                "config 'host_config' declares file",
            ),
        ],
    )
    def test_rejects_compose_local_file_references(self, tmp_path, compose_yaml, expected):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "filerefs",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: filerefs\n"
            "displayName: File Refs\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: http\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            compose_yaml,
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any(expected in e for e in errors), errors

    @pytest.mark.parametrize("image", ["redis", "redis:latest"])
    def test_warns_on_floating_image_tags(self, tmp_path, image):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "floating",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: floating\n"
            "displayName: Floating\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: tcp\n"
            "      port: 6379\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            f"services:\n  gateway:\n    image: {image}\n    expose: [6379]\n",
        )
        errors, warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors
        assert any("floating image tag" in w and image in w for w in warnings), warnings

    def test_accepts_digest_pinned_image_without_warning(self, tmp_path):
        validate_kit = _load_validate_kit()
        image = "ghcr.io/example/gateway@sha256:" + "a" * 64
        kit = _write_kit(
            tmp_path / "digest",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: digest\n"
            "displayName: Digest\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: tcp\n"
            "      port: 6379\n"
            "    expose:\n"
            "      env:\n"
            "        WEB_GATEWAY_URL: url\n",
            f"services:\n  gateway:\n    image: {image}\n    expose: [6379]\n",
        )
        errors, warnings = validate_kit(kit, _load_schema())
        assert errors == [], errors
        assert warnings == [], warnings

    def test_rejects_bad_expose_env(self, tmp_path):
        validate_kit = _load_validate_kit()
        kit = _write_kit(
            tmp_path / "badenv",
            "schemaVersion: hybrid/v1\n"
            "kind: mixin\n"
            "name: badenv\n"
            "displayName: Bad Env\n"
            "description: d\n"
            "serviceGateways:\n"
            "  - name: demo-gateway\n"
            "    runtime:\n"
            "      compose:\n"
            "        files: [compose.yaml]\n"
            "        service: gateway\n"
            "    interface:\n"
            "      protocol: tcp\n"
            "      port: 6379\n"
            "    expose:\n"
            "      env:\n"
            "        BAD-NAME: url\n"
            "        WEB_GATEWAY_URL: literal\n",
            "services:\n  gateway:\n    image: ghcr.io/example/gateway:1.0.0\n    expose: [6379]\n",
        )
        errors, _warnings = validate_kit(kit, _load_schema())
        assert any("expose.env: invalid env var name 'BAD-NAME'" in e for e in errors), errors
        assert any("expose.env['WEB_GATEWAY_URL']" in e and "'url'" in e for e in errors), errors
