#!/usr/bin/env python3
"""Validate neutral acq kit specs (schemaVersion: hybrid/v1).

Checks each integrations/isolation/acq-kits/<kit>/spec.yaml against
schemas/kit-hybrid-v1.schema.json and enforces the cross-field rules the
JSON Schema cannot express on its own:

  - every files[].source resolves to an existing file under the kit dir
  - every backend_shortcuts / backend_extras key is a known backend
  - every environment[] key is a valid POSIX env var NAME, and its value is a
    plain string (defense-in-depth over the schema pattern: env vars reach the
    guest environment and possibly a shell, so a bad name is reported explicitly
    rather than only failing the schema's additionalProperties rule)
  - every serviceGateways[].runtime.compose.files[] entry is kit-local, exists,
    and stays under the kit directory
  - service-gateway Compose files do not declare container escape primitives
    (host networking/namespaces, privileged/capability/device grants, broad host
    mounts, Docker socket mounts, unconfined security options, or local builds)
  - service-gateway Compose files do not use include: or extends.file to pull in
    uninspected Compose content
  - serviceGateways[].runtime.compose.service names an existing Compose service
  - serviceGateways[].interface.port is present unless that named Compose service
    exposes a single unambiguous service port
  - serviceGateways[].expose.env maps valid env var names to the resolved URL
    token (`url`)
  - a README.md exists (parity note lives there)

It also emits WARN-level advisories (non-fatal by default) for likely re-home
regressions and review signals the schema can't catch:

  - a commands[] argv that references a kit-provided script/payload path
    (a /home/... .sh / .mjs / .py / .crt) that no files[] entry drops
  - a service-gateway Compose image that is untagged or uses the floating
    `latest` tag.

Usage:
    python integrations/isolation/acq-kits/validate-kits.py [--root .]
                                                            [--strict]

Exit status is non-zero if any kit has ERRORS. With --strict, WARN advisories
also fail the run. No network, no sandbox — this is the backend-agnostic gate;
live per-backend verification is each kit's scripts/verify.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import jsonschema
import yaml

KNOWN_BACKENDS = {"sbx", "msb", "ppp"}

# Env var NAME must be a POSIX-portable identifier. Env values reach the guest
# environment and possibly a shell; the schema enforces this via patternProperties,
# but we ALSO check it here so a bad name is reported with a clear message at the
# gate (the maintainer of quickstart#202 wants field-level validation here).
#
# NOTE: only the NAME is validated. The VALUE is intentionally NOT sanitized or
# shell-escaped here (it may legitimately contain newlines or shell
# metacharacters). Safety is guaranteed *downstream, by construction*: backends
# MUST pass each value as argv / native env (msb `exec -e NAME=value`; sbx's
# native `environment.variables` block) and MUST NOT interpolate a value into a
# shell string. A new backend adapter must uphold this — do not assume this gate
# sanitized the value.
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Safe charset for a kit-dropped absolute path (#225). Adapters may interpolate
# files[].path into a shell command, so disallow anything that could break out
# of quoting or introduce a metacharacter — only absolute paths of
# alphanumerics and . _ / - are permitted. Mirrors the schema's path pattern.
_SAFE_PATH_RE = re.compile(r"^/[A-Za-z0-9._/-]+$")

# Safe charset for a publishedPorts[].name label. Mirrors the schema's name
# pattern: alphanumerics . _ - only, 1-64 chars. A name may be surfaced by a
# backend adapter (labels, generated primitives), so keep it metacharacter-free.
_PORT_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# Valid transport protocols for a published port (mirrors the schema enum).
_PORT_PROTOCOLS = {"tcp", "udp"}

# Portable byte-size grammar for a volumes[].size (integer or decimal + optional
# bare k/m/g/t/p unit: "20G", "512m", "1.5G"). Mirrors the schema's size
# pattern. Deliberately NO b/ib suffixes ("256MB", "2gib"): sbx's
# units.RAMInBytes accepts them but msb's size parser rejects them (verified on
# msb 0.6.12), so the neutral grammar is the INTERSECTION of the two. A
# volumes[].path reuses _SAFE_PATH_RE above — same charset rule as files[].path
# (#225).
_VOL_SIZE_RE = re.compile(r"^[0-9]+(\.[0-9]+)?[kKmMgGtTpP]?$")

# A size that parses but is zero ("0", "0G", "0.0"). The schema pattern alone
# cannot express non-zero cleanly, so the validator rejects it here.
_VOL_SIZE_ZERO_RE = re.compile(r"^0+(\.0+)?[kKmMgGtTpP]?$")

# Valid backing-storage types for a volume (mirrors the schema enum).
_VOL_TYPES = {"", "tmpfs"}

# serviceGateways[].runtime.compose.files[] are relative kit-local YAML files.
# Keep the path grammar shell/YAML-safe and reject absolute, parent-traversal,
# workspace-referenced, or backend-specific locations in validate_kit.
_COMPOSE_FILE_RE = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9._/-]+\.ya?ml$")

# serviceGateways[].runtime.compose.service names a Compose service.
_COMPOSE_SERVICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")

# serviceGateways[].interface.protocol values (mirrors the schema enum).
_GATEWAY_PROTOCOLS = {"http", "https", "tcp"}

# Docker/OCI image references without an explicit tag or digest, or with the
# floating latest tag, should be reviewed. This is a warning rather than a schema
# error because private registries and local development tags vary.
_DIGEST_RE = re.compile(r"@[A-Za-z0-9_+.-]+:[A-Fa-f0-9]{32,}$")

# Extensions that indicate a kit-provided payload/script a command expects to
# have been dropped by files[] (as opposed to a base-image binary, a runtime-
# generated file, or a system destination path).
_PAYLOAD_SUFFIXES = (".sh", ".mjs", ".py", ".crt", ".pem", ".cjs", ".js")
# In-guest absolute paths the kit itself owns (agent home / config). We only
# flag missing drops under these roots to avoid false positives on system
# destinations like /usr/local/share/ca-certificates/… (a copy TARGET) or
# base-image binaries on PATH.
_KIT_OWNED_ROOTS = ("/home/",)
# Token → absolute-path finder: matches kit-owned absolute paths ending in a
# payload suffix, wherever they appear in an argv element (incl. inside sh -c).
_PATH_RE = re.compile(r"/home/[A-Za-z0-9._/-]+?(?:" + "|".join(re.escape(s) for s in _PAYLOAD_SUFFIXES) + r")\b")


def _referenced_payload_paths(commands: list) -> set[str]:
    """Kit-owned payload paths referenced anywhere in commands[] argv."""
    found: set[str] = set()
    for c in commands or []:
        for token in c.get("command", []) or []:
            if not isinstance(token, str):
                continue
            found.update(_PATH_RE.findall(token))
    return found


def _is_valid_port(value: object) -> bool:
    """A port is an integer in 1..65535. A bool is not a valid port here."""
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 65535


def _compose_services(compose_doc: object) -> dict:
    """Return the services mapping from a Compose document, or an empty mapping."""
    if not isinstance(compose_doc, dict):
        return {}
    services = compose_doc.get("services")
    return services if isinstance(services, dict) else {}


def _compose_service_candidate_ports(compose_doc: object, service_name: str) -> set[int]:
    """Return internal service ports exposed by one named Compose service."""
    service = _compose_services(compose_doc).get(service_name)
    if not isinstance(service, dict):
        return set()
    ports: set[int] = set()
    values = service.get("expose") or []
    if isinstance(values, (str, int)):
        values = [values]
    if not isinstance(values, list):
        return ports
    for value in values:
        port = _parse_compose_port(value)
        if port is not None:
            ports.add(port)
    return ports


def _compose_published_port_errors(compose_doc: object) -> list[str]:
    """Return errors for host-published ports in a service-gateway Compose file."""
    errors: list[str] = []
    for service_name, service in _compose_services(compose_doc).items():
        if isinstance(service, dict) and service.get("ports"):
            errors.append(
                f"Compose service {service_name!r} declares ports; service gateways must not publish host ports "
                "from Compose. Use expose: for internal service ports or serviceGateways[].interface.port."
            )
    return errors


def _compose_indirection_errors(compose_doc: object) -> list[str]:
    """Return errors for Compose features that pull in uninspected local files."""
    errors: list[str] = []
    if isinstance(compose_doc, dict) and "include" in compose_doc:
        errors.append("Compose include: is not supported for service gateways; list kit-local files explicitly")
    for service_name, service in _compose_services(compose_doc).items():
        if not isinstance(service, dict):
            continue
        extends = service.get("extends")
        if isinstance(extends, dict) and "file" in extends:
            errors.append(
                f"Compose service {service_name!r} declares extends.file; service gateways must not pull in "
                "uninspected Compose files"
            )
    return errors


def _as_list(value: object) -> list[object]:
    """Return a Compose scalar-or-list field as a list for shallow inspection."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _volume_source(value: object) -> str | None:
    """Return a Compose volume source for common short/long syntax forms."""
    if isinstance(value, str):
        parts = value.split(":", 1)
        if len(parts) < 2:
            return None
        return parts[0]
    if isinstance(value, dict):
        source = value.get("source") or value.get("src")
        return source if isinstance(source, str) else None
    return None


def _has_compose_interpolation(value: object) -> bool:
    """True when a Compose field uses env interpolation that validation cannot resolve."""
    if isinstance(value, str):
        return "${" in value
    if isinstance(value, list):
        return any(_has_compose_interpolation(item) for item in value)
    if isinstance(value, dict):
        return any(_has_compose_interpolation(item) for item in value.values())
    return False


def _compose_file_reference_errors(compose_doc: object) -> list[str]:
    """Return errors for Compose features that can read uninspected local files."""
    errors: list[str] = []
    for service_name, service in _compose_services(compose_doc).items():
        if not isinstance(service, dict):
            continue
        if service.get("env_file"):
            errors.append(
                f"Compose service {service_name!r} declares env_file; service gateways must not read local env files"
            )
    if not isinstance(compose_doc, dict):
        return errors
    for section in ("secrets", "configs"):
        entries = compose_doc.get(section) or {}
        if not isinstance(entries, dict):
            continue
        for name, entry in entries.items():
            if isinstance(entry, dict) and "file" in entry:
                errors.append(
                    f"Compose {section[:-1]} {name!r} declares file; service gateways must not read local "
                    f"files via {section}"
                )
    return errors


def _compose_escape_errors(compose_doc: object, compose_path: Path, kit_dir: Path) -> list[str]:
    """Return errors for container escape primitives outside the gateway vocabulary."""
    errors: list[str] = []
    for service_name, service in _compose_services(compose_doc).items():
        if not isinstance(service, dict):
            continue
        prefix = f"Compose service {service_name!r}"
        if service.get("privileged") is True:
            errors.append(f"{prefix} declares privileged: true")
        if "build" in service:
            errors.append(f"{prefix} declares build; service gateways must use prebuilt reviewed images")
        for key in ("network_mode", "pid", "ipc", "userns_mode", "cgroup"):
            value = service.get(key)
            if value == "host":
                errors.append(f"{prefix} declares {key}: host")
            elif _has_compose_interpolation(value):
                errors.append(f"{prefix} declares {key} with Compose interpolation; validation cannot prove it safe")
        if service.get("cap_add"):
            errors.append(f"{prefix} declares cap_add; added Linux capabilities are outside serviceGateways v1")
        if _has_compose_interpolation(service.get("cap_add")):
            errors.append(f"{prefix} declares cap_add with Compose interpolation; validation cannot prove it safe")
        if service.get("devices"):
            errors.append(f"{prefix} declares devices; host device passthrough is outside serviceGateways v1")
        if _has_compose_interpolation(service.get("devices")):
            errors.append(f"{prefix} declares devices with Compose interpolation; validation cannot prove it safe")
        if _has_compose_interpolation(service.get("build")):
            errors.append(f"{prefix} declares build with Compose interpolation; validation cannot prove it safe")
        for opt in _as_list(service.get("security_opt")):
            if _has_compose_interpolation(opt):
                errors.append(
                    f"{prefix} declares security_opt with Compose interpolation; validation cannot prove it safe"
                )
            elif isinstance(opt, str) and (
                "unconfined" in opt or opt.startswith("seccomp=") or opt.startswith("apparmor=")
            ):
                errors.append(f"{prefix} disables container confinement with security_opt: {opt!r}")
        for volume in _as_list(service.get("volumes")):
            if _has_compose_interpolation(volume):
                errors.append(f"{prefix} declares volume with Compose interpolation; validation cannot prove it safe")
                continue
            source = _volume_source(volume)
            if not source:
                continue
            if "docker.sock" in source:
                errors.append(f"{prefix} mounts the Docker socket: {source!r}")
                continue
            if source.startswith("/") or source.startswith("~"):
                errors.append(f"{prefix} declares a host path mount outside the kit: {source!r}")
                continue
            if source.startswith("."):
                source_path = (compose_path.parent / source).resolve()
                try:
                    source_path.relative_to(kit_dir.resolve())
                except ValueError:
                    errors.append(f"{prefix} declares a volume source outside the kit: {source!r}")
    return errors


def _parse_compose_port(value: object) -> int | None:
    """Parse the container/service-side port from common Compose port forms."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value if _is_valid_port(value) else None
    if isinstance(value, str):
        candidate = value.split("/", 1)[0].rsplit(":", 1)[-1]
        if candidate.isdigit():
            port = int(candidate)
            return port if _is_valid_port(port) else None
    if isinstance(value, dict):
        target = value.get("target")
        if isinstance(target, int) and not isinstance(target, bool) and _is_valid_port(target):
            return target
    return None


def _service_images(compose_doc: object) -> list[str]:
    """Return image references declared by Compose services."""
    images: list[str] = []
    for service in _compose_services(compose_doc).values():
        if isinstance(service, dict) and isinstance(service.get("image"), str):
            images.append(service["image"])
    return images


def _uses_floating_image(image: str) -> bool:
    """True when an image is untagged or explicitly tagged latest."""
    if _DIGEST_RE.search(image):
        return False
    last_segment = image.rsplit("/", 1)[-1]
    if ":" not in last_segment:
        return True
    return last_segment.rsplit(":", 1)[-1] == "latest"


def validate_kit(kit_dir: Path, schema: dict) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for one kit."""
    errors: list[str] = []
    warnings: list[str] = []
    spec_path = kit_dir / "spec.yaml"
    if not spec_path.exists():
        return [f"{kit_dir.name}: missing spec.yaml"], warnings

    try:
        spec = yaml.safe_load(spec_path.read_text())
    except yaml.YAMLError as e:  # pragma: no cover - surfaced to user
        return [f"{kit_dir.name}: spec.yaml is not valid YAML: {e}"], warnings

    try:
        jsonschema.validate(instance=spec, schema=schema)
    except jsonschema.ValidationError as e:
        errors.append(f"{kit_dir.name}: schema: {e.message} (at {'/'.join(str(p) for p in e.absolute_path)})")

    # A spec that is empty (None) or a non-dict scalar fails schema validation
    # above; bail out before the dict-shaped checks below so a malformed spec is
    # reported as an invalid kit rather than crashing the whole run.
    if not isinstance(spec, dict):
        if not errors:
            errors.append(f"{kit_dir.name}: spec.yaml must be a mapping (got {type(spec).__name__})")
        return errors, warnings

    files = spec.get("files", []) or []
    for f in files:
        src = f.get("source")
        if src and not (kit_dir / src).exists():
            errors.append(f"{kit_dir.name}: files[].source not found: {src}")
        # Defense-in-depth over the schema's path pattern (#225): a backend
        # adapter may interpolate files[].path into a command (e.g. the msb
        # adapter's `chmod $mode '$path'` in a root `sh -c`). A path carrying a
        # shell metacharacter — or a single quote that breaks out of the
        # adapter's quoting — is a root-command-injection vector. Reject any
        # path outside the safe charset even if the schema check were bypassed.
        path = f.get("path")
        if path is not None and not _SAFE_PATH_RE.match(str(path)):
            errors.append(
                f"{kit_dir.name}: files[].path has an unsafe character "
                f"(allowed: absolute path, alphanumerics . _ / -): {path!r}"
            )

    for section in ("backend_shortcuts", "backend_extras"):
        for backend in spec.get(section) or {}:
            if backend not in KNOWN_BACKENDS:
                errors.append(f"{kit_dir.name}: {section}: unknown backend '{backend}'")

    environment = spec.get("environment") or {}
    if not isinstance(environment, dict):
        errors.append(f"{kit_dir.name}: environment must be a mapping of NAME -> value")
    else:
        for name, value in environment.items():
            if not _ENV_NAME_RE.match(str(name)):
                errors.append(
                    f"{kit_dir.name}: environment: invalid env var name '{name}' (must match [A-Za-z_][A-Za-z0-9_]*)"
                )
            if not isinstance(value, str):
                errors.append(
                    f"{kit_dir.name}: environment['{name}']: value must be a string (got {type(value).__name__})"
                )

    service_gateways = spec.get("serviceGateways")
    if service_gateways is not None:
        if not isinstance(service_gateways, list):
            errors.append(f"{kit_dir.name}: serviceGateways must be an array of gateway objects")
        else:
            gateway_names = [
                g.get("name") for g in service_gateways if isinstance(g, dict) and isinstance(g.get("name"), str)
            ]
            for dup in sorted({name for name in gateway_names if gateway_names.count(name) > 1}):
                errors.append(
                    f"{kit_dir.name}: serviceGateways: duplicate name {dup!r} "
                    f"(declared {gateway_names.count(dup)} times)"
                )
            for i, gateway in enumerate(service_gateways):
                if not isinstance(gateway, dict):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}] must be an object")
                    continue
                name = gateway.get("name")
                if not isinstance(name, str) or not re.match(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$", name):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].name must be kebab-case, 1..64 chars")
                interface = gateway.get("interface") or {}
                if not isinstance(interface, dict):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].interface must be an object")
                    interface = {}
                protocol = interface.get("protocol")
                if protocol not in _GATEWAY_PROTOCOLS:
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].interface.protocol must be one of "
                        f"{sorted(_GATEWAY_PROTOCOLS)} (got {protocol!r})"
                    )
                if "port" in interface and not _is_valid_port(interface["port"]):
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].interface.port must be an integer 1..65535 "
                        f"(got {interface['port']!r})"
                    )

                runtime = gateway.get("runtime") or {}
                compose = (runtime.get("compose") or {}) if isinstance(runtime, dict) else {}
                if not isinstance(compose, dict):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose must be an object")
                    continue
                compose_service = compose.get("service")
                if not isinstance(compose_service, str) or not _COMPOSE_SERVICE_RE.match(compose_service):
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.service must be a safe "
                        "Compose service name, 1..64 chars"
                    )
                    compose_service = ""
                compose_files = compose.get("files") or []
                if not isinstance(compose_files, list):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.files must be an array")
                    compose_files = []
                elif not compose_files:
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.files must list at least one file"
                    )

                candidate_ports: set[int] = set()
                inspected_compose = False
                found_named_service = False
                for rel in compose_files:
                    if not isinstance(rel, str) or not _COMPOSE_FILE_RE.match(rel) or rel.startswith("/"):
                        errors.append(
                            f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.files[] must be a relative "
                            f"kit-local .yaml/.yml path in the safe charset (got {rel!r})"
                        )
                        continue
                    compose_path = (kit_dir / rel).resolve()
                    try:
                        compose_path.relative_to(kit_dir.resolve())
                    except ValueError:
                        errors.append(
                            f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.files[] must stay under the kit "
                            f"directory (got {rel!r})"
                        )
                        continue
                    if not compose_path.exists():
                        errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.files[] not found: {rel}")
                        continue
                    try:
                        compose_doc = yaml.safe_load(compose_path.read_text())
                    except yaml.YAMLError as e:
                        errors.append(
                            f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel} is not valid YAML: {e}"
                        )
                        continue
                    inspected_compose = True
                    for detail in _compose_indirection_errors(compose_doc):
                        errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel}: {detail}")
                    for detail in _compose_escape_errors(compose_doc, compose_path, kit_dir):
                        errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel}: {detail}")
                    for detail in _compose_file_reference_errors(compose_doc):
                        errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel}: {detail}")
                    for detail in _compose_published_port_errors(compose_doc):
                        errors.append(f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel}: {detail}")
                    if compose_service and compose_service in _compose_services(compose_doc):
                        found_named_service = True
                        candidate_ports.update(_compose_service_candidate_ports(compose_doc, compose_service))
                    for image in _service_images(compose_doc):
                        if _uses_floating_image(image):
                            warnings.append(
                                f"{kit_dir.name}: serviceGateways[{i}].runtime.compose file {rel} uses a floating "
                                f"image tag: {image!r} (pin a stable tag or digest)"
                            )

                if inspected_compose and compose_service and not found_named_service:
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].runtime.compose.service {compose_service!r} "
                        "was not found in any referenced Compose file"
                    )
                if found_named_service and "port" not in interface and len(candidate_ports) != 1:
                    errors.append(
                        f"{kit_dir.name}: serviceGateways[{i}].interface.port is required when Compose service "
                        f"{compose_service!r} exposes {len(candidate_ports)} candidate ports"
                    )

                expose = gateway.get("expose") or {}
                if not isinstance(expose, dict):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].expose must be an object")
                    expose = {}
                expose_env = expose.get("env") or {}
                if not isinstance(expose_env, dict):
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].expose.env must be a mapping of NAME -> url")
                elif not expose_env:
                    errors.append(f"{kit_dir.name}: serviceGateways[{i}].expose.env must expose at least one env var")
                else:
                    for env_name, value in expose_env.items():
                        if not _ENV_NAME_RE.match(str(env_name)):
                            errors.append(
                                f"{kit_dir.name}: serviceGateways[{i}].expose.env: invalid env var name "
                                f"'{env_name}' (must match [A-Za-z_][A-Za-z0-9_]*)"
                            )
                        if value != "url":
                            errors.append(
                                f"{kit_dir.name}: serviceGateways[{i}].expose.env['{env_name}'] must be "
                                f"the resolved-value token 'url' (got {value!r})"
                            )

    if not (kit_dir / "README.md").exists():
        errors.append(f"{kit_dir.name}: missing README.md (parity note required)")

    # publishedPorts[] field-level checks (ADR-0014, quickstart repo). The
    # schema already constrains these, but — as with environment/path above —
    # we ALSO check them here so a bad value is reported with a clear per-entry
    # message at the gate (rather than only a terse jsonschema path). A port
    # published to the host is a boundary primitive: report offenders, reject.
    published_ports = spec.get("publishedPorts")
    if published_ports is not None:
        if not isinstance(published_ports, list):
            errors.append(
                f"{kit_dir.name}: publishedPorts must be an array of port-mapping objects "
                f"(got {type(published_ports).__name__})"
            )
        else:
            for i, entry in enumerate(published_ports):
                if not isinstance(entry, dict):
                    errors.append(f"{kit_dir.name}: publishedPorts[{i}] must be an object (got {type(entry).__name__})")
                    continue
                # guest: required int in 1..65535.
                if "guest" not in entry:
                    errors.append(f"{kit_dir.name}: publishedPorts[{i}]: missing required 'guest' port")
                else:
                    guest = entry["guest"]
                    if not _is_valid_port(guest):
                        errors.append(
                            f"{kit_dir.name}: publishedPorts[{i}].guest must be an integer 1..65535 (got {guest!r})"
                        )
                # host: optional int in 1..65535 (defaults to guest when omitted).
                if "host" in entry and not _is_valid_port(entry["host"]):
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].host must be an integer 1..65535 (got {entry['host']!r})"
                    )
                # protocol: optional, tcp|udp (defaults to tcp when omitted).
                if "protocol" in entry and entry["protocol"] not in _PORT_PROTOCOLS:
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].protocol must be one of "
                        f"{sorted(_PORT_PROTOCOLS)} (got {entry['protocol']!r})"
                    )
                # name: optional, safe charset only.
                if "name" in entry and not _PORT_NAME_RE.match(str(entry["name"])):
                    errors.append(
                        f"{kit_dir.name}: publishedPorts[{i}].name has an unsafe or invalid value "
                        f"(allowed: alphanumerics . _ -, 1-64 chars): {entry['name']!r}"
                    )

    # volumes[] field-level checks (quickstart ADR-0022). The jsonschema pass
    # above already enforces these; we ALSO check them here so a bad value is
    # reported with a clear per-entry message at the gate. path/size reach a
    # generated backend spec and an msb create argv (SI-10), so both are
    # charset-gated; size is REQUIRED (no unsized default).
    volumes = spec.get("volumes")
    if volumes is not None:
        if not isinstance(volumes, list):
            errors.append(f"{kit_dir.name}: volumes must be an array of volume objects")
        else:
            for i, v in enumerate(volumes):
                if not isinstance(v, dict):
                    errors.append(f"{kit_dir.name}: volumes[{i}] must be an object")
                    continue
                path = v.get("path")
                if not isinstance(path, str) or not _SAFE_PATH_RE.match(path):
                    errors.append(
                        f"{kit_dir.name}: volumes[{i}].path must be an absolute path "
                        f"in the safe charset [A-Za-z0-9._/-] (got {path!r})"
                    )
                size = v.get("size")
                if not isinstance(size, str) or not _VOL_SIZE_RE.match(size):
                    errors.append(
                        f"{kit_dir.name}: volumes[{i}].size is required and must be a "
                        f'portable byte-size string like "20G" or "512m" — no b/ib '
                        f"suffix, msb rejects them (got {size!r})"
                    )
                elif _VOL_SIZE_ZERO_RE.match(size):
                    errors.append(f"{kit_dir.name}: volumes[{i}].size must be non-zero (got {size!r})")
                vtype = v.get("type", "")
                if vtype not in _VOL_TYPES:
                    errors.append(f'{kit_dir.name}: volumes[{i}].type must be "" (block) or "tmpfs" (got {vtype!r})')
            # Duplicate mount paths within one kit are an authoring error: the
            # "union by path, last wins" composition rule exists for cross-kit
            # merging, not for silently resolving a same-kit copy-paste typo.
            vol_paths = [v.get("path") for v in volumes if isinstance(v, dict) and isinstance(v.get("path"), str)]
            for dup in sorted({p for p in vol_paths if vol_paths.count(p) > 1}):
                errors.append(
                    f"{kit_dir.name}: volumes: duplicate path {dup!r} (declared {vol_paths.count(dup)} times)"
                )

    # commands[].background field-level check (ADR-0014, quickstart repo). Marks
    # a startup command that must be detached rather than awaited. Optional; when
    # present it MUST be a boolean (default false when omitted).
    for i, c in enumerate(spec.get("commands", []) or []):
        if isinstance(c, dict) and "background" in c and not isinstance(c["background"], bool):
            errors.append(
                f"{kit_dir.name}: commands[{i}].background must be a boolean (got {type(c['background']).__name__})"
            )

    # caps.network.tier field-level check (#300). Optional; when present it MUST
    # be one of the neutral egress tiers. Omission is valid and means the default
    # `balanced` posture (documented in the schema; not mutated here). The schema
    # enum already rejects bad values — this adds a clearer, kit-scoped message.
    _net = (spec.get("caps") or {}).get("network") or {}
    if "tier" in _net and _net["tier"] not in ("strict", "balanced", "open"):
        errors.append(f"{kit_dir.name}: caps.network.tier must be one of strict|balanced|open (got {_net['tier']!r})")

    # a heuristic (a command could legitimately create a script at runtime), so
    # it flags for human eyes rather than failing the gate outright.
    dropped = {f.get("path") for f in files if f.get("path")}
    for ref in sorted(_referenced_payload_paths(spec.get("commands", []))):
        if ref not in dropped:
            warnings.append(
                f"{kit_dir.name}: commands[] reference '{ref}' but no files[] entry drops it "
                f"(re-home typo? add a files[] entry, or ignore if created at runtime)"
            )

    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat WARN advisories as failures (non-zero exit).",
    )
    args = parser.parse_args(argv)

    root = args.root
    schema_path = root / "schemas" / "kit-hybrid-v1.schema.json"
    kits_dir = root / "integrations" / "isolation" / "acq-kits"

    if not schema_path.exists():
        print(f"ERROR: schema not found: {schema_path}", file=sys.stderr)
        return 1
    schema = json.loads(schema_path.read_text())
    jsonschema.Draft202012Validator.check_schema(schema)

    kit_dirs = (
        sorted(d for d in kits_dir.iterdir() if d.is_dir() and d.name != "__pycache__") if kits_dir.exists() else []
    )
    if not kit_dirs:
        print(f"No kits found under {kits_dir}")
        return 0

    all_errors: list[str] = []
    all_warnings: list[str] = []
    kit_names: list[str] = []
    for kit_dir in kit_dirs:
        errs, warns = validate_kit(kit_dir, schema)
        all_warnings.extend(warns)
        if errs:
            all_errors.extend(errs)
        else:
            print(f"  OK  {kit_dir.name}")
        # Record the spec's own name for the registry cross-check. A malformed
        # spec was already reported by validate_kit() above, so here we only need
        # to skip name collection for it — but narrow the catch to expected
        # parse/IO errors rather than swallowing everything (no silent failures).
        try:
            spec = yaml.safe_load((kit_dir / "spec.yaml").read_text())
            if isinstance(spec, dict) and spec.get("name"):
                kit_names.append(spec["name"])
        except (yaml.YAMLError, OSError):
            pass

    # Registry cross-check: kits.yaml must list exactly the kits present.
    registry_path = kits_dir / "kits.yaml"
    if registry_path.exists():
        try:
            registry = yaml.safe_load(registry_path.read_text())
            if not isinstance(registry, dict):
                raise ValueError("registry root must be a mapping")
            listed = set((registry.get("kits") or {}).keys())
            present = set(kit_names)
            missing = present - listed
            extra = listed - present
            for name in sorted(missing):
                all_errors.append(f"kits.yaml: missing registry entry for kit '{name}'")
            for name in sorted(extra):
                all_errors.append(f"kits.yaml: registry lists unknown kit '{name}'")
        except (yaml.YAMLError, ValueError) as e:
            all_errors.append(f"kits.yaml: not valid: {e}")
    else:
        all_errors.append("kits.yaml registry not found")

    if all_warnings:
        print("\nWARN:", file=sys.stderr)
        for w in all_warnings:
            print(f"  - {w}", file=sys.stderr)

    if all_errors:
        print("\nFAIL:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    if all_warnings and args.strict:
        print("\nFAIL: warnings present and --strict set.", file=sys.stderr)
        return 1

    suffix = f" ({len(all_warnings)} warning(s))" if all_warnings else ""
    print(f"\nAll {len(kit_dirs)} acq-kits valid.{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
