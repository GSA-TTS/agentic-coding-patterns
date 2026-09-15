---
title: "Add neutral serviceGateways vocabulary for acq-managed service gateways"
status: "accepted"
date: "2026-09-15"
decision_makers: ["Bret Mogilefsky", "OpenCode Agent"]
category: "isolation-kit-schema"
impact_level: "moderate"
nist_controls: ["AC-4", "CM-7", "SC-7", "SI-10"]
---

# ADR 0003 (isolation) - Add neutral `serviceGateways` vocabulary

> Area-scoped ADR for `integrations/isolation/`. Extends the neutral `hybrid/v1`
> kit spec (ADR 0001) with a backend-agnostic way for kits to declare companion
> service gateways that `acq` manages outside normal client-side kit setup.

## Context and Problem Statement

Some agent workflows need a companion service process that is not simply
software installed inside the sandbox. Examples include a local proxy, broker,
or control-plane-adjacent service that the sandboxed agent reaches through an
interface declared by the kit. Today, `hybrid/v1` has vocabulary for guest files,
lifecycle commands, environment variables, volumes, ports, and backend-specific
escape hatches, but it has no neutral way to say: "this kit also needs an
`acq`-managed service gateway."

Without a neutral field, authors would be pushed toward backend-specific keys,
ad hoc startup commands, or schema fields that encode one current runtime shape.
That would make service-gateway kits difficult to review, difficult to stop or
remove reliably, and hard to map to future backends.

## Decision Drivers

- Keep the kit schema neutral across current and future isolation backends.
- Let kits declare service-gateway intent without encoding host/guest transport
  details that belong to `acq` and the active backend.
- Make local development and private-kit workflows possible without weakening the
  trust model for remotely fetched service-gateway kits.
- Keep v1 implementation deliberately narrow: Docker Compose is an implementation
  detail of the first runtime, not the semantic contract.
- Preserve explicit lifecycle ownership: `acq stop` stops gateways, and `acq rm`
  removes gateways and their state.

## Decision

Add a top-level `serviceGateways` list to the `hybrid/v1` kit vocabulary. The
field is intentionally named for the semantic role, not the first implementation:
the kit declares service gateways that are managed by `acq` for the sandbox.

Each entry identifies a gateway, how the current v1 runtime starts it, and the
interface the sandbox consumes. The vocabulary must stay backend-neutral:

- **Name:** use `serviceGateways`, not `gateways`, `sidecars`, `services`, or a
  backend-specific name. The term is explicit enough to distinguish these from
  ordinary kit files/commands while avoiding a commitment to Docker, Podman,
  Kubernetes, VSOCK, or a particular network topology.
- **Runtime:** `runtime.compose` is the v1 runtime shape. It references only
  Compose files that live inside the kit. It must not reference files from the
  user's workspace or other mutable workspace paths.
- **Sources:** local kit sources remain allowed for development and private kits.
  Remote service-gateway kits must come from trusted kit sources; fetching an
  untrusted kit that can start companion services is not acceptable.
- **Privileges:** service gateways must not require privileged containers. A
  gateway that needs host-level privileges, broad mounts, or Docker socket access
  is outside this vocabulary and requires a different reviewed design.
- **Images:** floating image tags are allowed only as an authoring warning, not a
  schema error. Validators and reviewers should warn on tags such as `latest` or
  on untagged image references so authors pin a stable image or digest.
- **Lifecycle:** `acq stop` stops service gateways. `acq rm` removes service
  gateways and their gateway-owned state. Gateway lifecycle is not left to each
  kit's arbitrary shell snippets.
- **Environment injection:** v1 supports explicit environment injection from the
  kit into the Compose runtime. This is limited to v1 and is not a permanent
  semantic requirement for future runtimes.
- **Client-side setup:** existing kit files and commands continue to own
  client-side software installation and configuration inside the sandbox.
  `serviceGateways` is only for the managed service side of the boundary.
- **Interface ports:** `interface.port` is optional when the interface is
  unambiguous from the Compose declaration. It may be supplied when a gateway has
  multiple exposed ports or the intended service port would otherwise be unclear.
- **Excluded schema details:** the kit schema must not include host/guest IPs,
  DNS rules, VSOCK details, Podman-machine wiring, Kubernetes resources, or
  backend-specific routing. Those are adapter/runtime concerns.
- **Co-location:** even though `runtime.compose` is the first v1 mechanism, the
  vocabulary must not assume the sandbox, gateway, and `acq` process are
  co-located or local. A future backend might run the service in Kubernetes or
  another managed environment while preserving the same semantic contract.

## Expected v1 Shape

The schema should remain minimal. A service gateway entry should include:

- `name` - stable kit-local gateway identifier.
- `runtime.compose.files[]` - one or more kit-local Compose files.
- `runtime.compose.env` - optional non-secret environment variables injected into
  the Compose runtime for v1 only.
- `interface` - the service interface the sandbox should use, with an optional
  `port` and a stable protocol label.

The schema should validate the shape and safe path/name/port basics. The repo
validator should add field-level errors for unsafe or non-kit-local Compose
paths, and warnings for floating image tags it can detect in referenced Compose
files.

## Consequences

### Positive

- Kit authors get one neutral place to declare acq-managed service gateways.
- `acq` gets a clear lifecycle contract for stop/remove behavior rather than
  trying to infer gateway state from arbitrary kit commands.
- Compose can ship as the v1 implementation without freezing Compose, local
  networking, or a co-located process model into the long-term vocabulary.
- Existing kit files/commands remain focused on client-side guest setup.
- Future backends can implement the same gateway intent with different native
  primitives without changing the semantic field name or kit contract.

### Negative / residual

- Compose parsing in the patterns-side validator is necessarily shallow unless we
  add a full Compose parser, which this decision avoids. Human review remains the
  control for nuanced Compose semantics.
- Local kit sources are useful for development and private kits, but they widen
  the trust decision. Users must treat local service-gateway kits as executable
  local code.
- Warning on floating image tags is not a hard schema failure, so maintainers must
  keep strict validation and review pressure on gateway images.

## Alternatives Considered

- **Name the field `gateways`.** Rejected because it is too broad and could be
  confused with network routing gateways. `serviceGateways` says these are
  service processes declared by kits and managed by `acq`.
- **Name the field `sidecars`.** Rejected because sidecar implies co-location with
  a workload and commonly maps to Kubernetes. The semantic contract must not
  assume that topology.
- **Model Compose directly as top-level schema.** Rejected because Compose is only
  the v1 runtime mechanism. The long-term contract is a service gateway, not a
  Docker Compose application.
- **Require `interface.port` for every gateway.** Rejected because a single
  Compose service with a single exposed/published port can be unambiguous.
  Validators should require it only when the interface cannot be inferred safely.
- **Put IPs, DNS, VSOCK, Podman machine, Kubernetes, or routing details in the kit
  schema.** Rejected because those are backend/runtime concerns and would lock the
  neutral contract to current implementations.

## What an agent must NOT decide unilaterally

- Whether a remote source is trusted enough to provide service-gateway kits.
- Whether a gateway that needs privileged containers or broad host mounts is safe
  to run.
- Whether a floating image tag is acceptable for a federally shipped kit.

## References

- ADR 0001 (isolation) - neutral `hybrid/v1` acq-kits spec.
- ADR 0002 (isolation) - neutral network egress tiers.
- Schema: [`schemas/kit-hybrid-v1.schema.json`](../../../../schemas/kit-hybrid-v1.schema.json).
- Tracking: GSA-TTS/agentic-coding-quickstart#472.
