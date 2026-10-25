---
title: "Provider-Neutral Catalog Refresh Inventory"
description: "Maps current model catalog refresh paths and defines the safe boundary for later provider-neutral drift detection."
status: canonical
tier: 2
last_updated: "2026-10-25"
---

# Provider-Neutral Catalog Refresh Inventory

## Purpose

This inventory records the current model-catalog refresh paths, their ownership,
and the boundary for a later provider-neutral refresh capability. It is a design
and sequencing document only. It does not add a runtime orchestrator, network
fetch, scheduler, emitter, or harness configuration writer.

The intended architecture is documented in
[ADR 0004](decisions/0004-neutral-model-provider-discovery.md): provider kits
publish neutral inputs; a future orchestrator refreshes model metadata; each
harness renders only its own native configuration.

## Current Paths

### Legacy provider refresh

`integrations/isolation/acq-kits/usai-provider/scripts/sync-usai-models.mjs`
has two modes:

- In live mode, it reads the USAi model list with the injected provider
  credential and reads models.dev enrichment metadata.
- In fixture mode, it reads a committed USAi model fixture.

It writes a generated model block and selected model roles into the USAi
OpenCode configuration. The same script is tracked under
`integrations/isolation/sbx-kits/usai-provider-kit/scripts/` and is byte-for-byte
duplicated. The SBX kit's OpenCode configuration is a symlink to the ACQ kit's
configuration, but the duplicate refresh script remains an independent
maintenance path.

This path is provider-specific and harness-native. It is not a candidate for a
provider-neutral refresh entrypoint.

### Legacy provider catalog builder

`integrations/providers/usai/scripts/build-catalog.mjs` derives the committed
`integrations/providers/usai/catalog.json` document. It can:

- Bootstrap deterministically from the shipped OpenCode generated block.
- Build from local model-list and enrichment fixtures.
- Read live USAi and models.dev sources when explicitly given source URLs.
- Compare substantive catalog content with the committed catalog using
  `--check` and report added, removed, and changed model IDs.

Its output is `usai-model-catalog/v1`, which includes USAi routing metadata and
vendor-specific enrichment choices. It is consumed by these legacy emitters:

- `integrations/providers/usai/emitters/opencode.mjs` renders the OpenCode
  generated model block.
- `integrations/providers/usai/emitters/prime-agent.mjs` renders the Prime
  Agent `models.json` artifact.

The builder, its catalog schema, and both emitters are legacy provider-owned
authoring tools. They remain useful for their current committed artifacts but
must not become the runtime provider-neutral refresh mechanism.

### Neutral snapshot bridge

`integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs`
deterministically narrows the legacy USAi catalog into
`acq-neutral-model-catalog/v1`. It emits model metadata only:

- Provider ID and model IDs.
- Optional context limits, output limits, and pricing.
- Optional neutral recommendations.

It intentionally excludes routing and credential fields. Its current output is
the USAi kit's committed `model-catalog-snapshot.json`, a small fallback snapshot
declared by `provider-input.json` alongside `facts.json` and the normalizer.

This bridge is offline and deterministic. It is a provider-owned normalizer,
not an orchestrator and not a harness renderer.

The shipped USAi normalizer currently accepts the legacy committed catalog, not
the raw response from the provider model-list endpoint. Before it can participate
in a live provider-neutral refresh, it must be replaced or adapted with a pure
file-to-file interface that accepts the fetched response bytes and emits a valid
neutral catalog. That provider-specific interface migration must preserve an
offline fixture path and must not add a harness configuration output.

## Duplicate Logic And Consumer Artifacts

The two legacy live-refresh scripts independently implement USAi fetch,
bounded-response handling, models.dev enrichment, vendor classification,
non-chat filtering, matching, cost shaping, role selection, and OpenCode JSONC
mutation. The provider catalog builder independently implements most of that
fetch-and-shape work again.

The current consumer artifacts are:

| Source | Artifact | Owner |
| --- | --- | --- |
| Legacy sync script | USAi OpenCode JSONC model block and role defaults | USAi provider kit, OpenCode-specific |
| USAi catalog OpenCode emitter | USAi OpenCode JSONC model block | OpenCode-specific emitter |
| USAi catalog Prime Agent emitter | Prime Agent `models.json` | Prime Agent-specific emitter |
| Neutral normalizer | Metadata-only USAi fallback snapshot | USAi provider kit |

The duplicate legacy paths must not be expanded. Removing or migrating them is
separate compatibility work because existing authoring and regression tests use
them.

## Ownership Boundary

The later design has three separate owners:

| Layer | Owns | Must not own |
| --- | --- | --- |
| Provider kit | Static facts, vendored snapshot, and a pure normalizer | Harness configuration, cross-provider aggregation, or credential routing decisions outside its facts |
| Provider-neutral refresh entrypoint | Discovery, bounded fetch, validation, fallback, deterministic aggregation, and provenance | Harness-native configuration or provider-specific rendering rules |
| Harness kit | Its native configuration rendering from neutral metadata and authoritative facts | Provider discovery, provider-specific normalization, or another harness's configuration |

The aggregate catalog must carry model metadata and refresh provenance only. It
must not carry `host`, `baseUrl`, `modelsUrl`, `keyEnv`, credential values, or
any other routing authority. Harnesses must read routing and credential-name
facts only from the host-authoritative provider-input mount.

The later refresh entrypoint must not render or write configuration for OpenCode,
Prime Agent, Goose, Codex, Claude, Copilot, or any other harness. It must not
import a harness emitter or use a harness configuration file as an input or
output.

## Safe Later Entrypoint

The smallest later entrypoint is one provider-neutral models-orchestrator
startup program. It receives a backend-supplied provider-input root and performs
only these steps:

1. Treat a missing provider-input root as not ready, not as an empty provider
   set.
2. Discover validated provider directories below
   `models/providers/<providerId>`.
3. Read facts, snapshot, and normalizer from the read-only provider-input mount.
4. Fetch each provider's model-list response through one shared bounded-fetch
   implementation.
5. Run the provider normalizer as a file-to-file transform only when its
   containment requirements are mechanically enforced.
6. Validate every normalized result against the neutral catalog schema.
7. On an individual refresh failure, validate and use only that provider's
   vendored snapshot.
8. Aggregate providers in a documented stable order, record per-provider
   `live` or `snapshot` provenance, and atomically write a guest-local aggregate.
9. When an authoritative root contains no provider directories, atomically write
   a valid explicitly empty aggregate.

The entrypoint must fail closed on invalid provider identity, malformed facts,
invalid normalizer output, invalid snapshots, duplicate provider IDs, or
duplicate model identities within a provider. It must never substitute a default
provider, silently omit a rejected provider, or replace a prior catalog after an
incomplete discovery result. When a required normalizer containment control is
unavailable, the entrypoint must refuse to run that normalizer and use only that
provider's validated snapshot.

## Required Upstream Gate

No runtime refresh implementation may merge until the sandbox backend provides
the host-authoritative provider-input lifecycle. That lifecycle must:

- Validate all provider bundles on the host before materialization.
- Materialize facts, normalizer, and snapshot from pinned kit content.
- Supply the provider-input root to the guest.
- Enforce the provider-input mount as read-only at the host-to-guest boundary.
- Reject symlinks in the materialized tree.
- Verify that the materialized directory name equals the validated provider ID.
- Preserve the distinction between a missing root and an authoritative empty
  root.
- Complete trusted setup before a consumer can interpret the inputs.
- Provide a startup-completion or readiness barrier so a harness cannot read an
  aggregate before the refresh entrypoint has completed its atomic write.

No guest-owned or guest-written path is an acceptable substitute for this gate.
The sandbox agent can have elevated guest privileges, so guest ownership does
not make provider facts, normalizer code, or snapshot provenance authoritative.

The normalizer execution boundary is a separate gate. Before a normalizer runs
over live data, the runtime must mechanically enforce network denial, an
explicitly minimized environment without credentials, process-tree-wide timeout
termination, and streamed output caps for both standard output and standard
error. A documented expectation without enforcement is insufficient; the safe
behavior is snapshot fallback.

## Offline Fixture And Test Plan

All catalog-refresh tests must use committed fixtures and must not make network
requests or require credentials.

1. Use the committed fixtures in
   `integrations/isolation/schemas/fixtures/acme-ai/` and
   `integrations/isolation/schemas/fixtures/usai/` as separate materialized
   provider directories containing facts, normalizer, snapshot, and source data.
2. Verify discovery is independent of filesystem enumeration order and produces
   byte-identical aggregate output on repeated runs.
3. Verify a missing root is not ready and leaves an existing aggregate unchanged.
4. Verify an existing empty root produces a valid explicit empty aggregate.
5. Verify one provider can fall back to its snapshot while another contributes
   normalized fixture output, with correct per-provider provenance.
6. Verify invalid facts, identity mismatches, malformed normalizer output,
   malformed snapshots, duplicate IDs, and dangling recommendations fail closed.
7. Verify aggregate output contains no routing fields, credential names, or
   credential values.
8. Verify the entrypoint contains no harness-native identifiers, imports, or
   output paths.
9. Verify atomic-write failure preserves the prior aggregate.

Existing provider-input contract validation and provider-normalizer tests remain
part of the offline regression set. Legacy emitter round-trip tests remain
consumer compatibility tests; they are not acceptance tests for the later
provider-neutral entrypoint.

## Planned Order

1. Complete the host-authoritative provider-input lifecycle in the sandbox
   backend, including its offline and live backend verification.
2. Confirm the normalizer containment mechanism is implemented and fail-closed.
3. Provide the upstream startup-completion or readiness barrier required before
   a harness may consume the aggregate.
4. Migrate each participating provider normalizer to the pure fetched-bytes to
   neutral-catalog interface, with offline fixtures and no harness output.
5. Add the provider-neutral models-orchestrator and aggregate contract with the
   offline fixture matrix described above.
6. Add or update harness-owned renderers in separate, harness-specific work.
7. Migrate or retire legacy provider-owned refresh paths only after all shipped
   consumers have compatible replacements and regression coverage.

This order prevents a provider-neutral refresh effort from weakening the
host-to-guest trust boundary or silently becoming a harness configuration
delivery mechanism.
