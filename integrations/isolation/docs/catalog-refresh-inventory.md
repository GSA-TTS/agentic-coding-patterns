---
title: "Provider-Neutral Catalog Refresh Inventory"
description: "Maps current model catalog refresh paths and proposes a safe boundary for later provider-neutral drift detection."
status: draft
tier: 2
last_updated: "2026-10-27"
---

# Provider-Neutral Catalog Refresh Inventory

## Purpose

This inventory records the current model-catalog refresh paths, their ownership,
and the boundary for a later provider-neutral refresh capability. It is a design
and sequencing document only. It does not add a runtime orchestrator, network
fetch, scheduler, emitter, or harness configuration writer.

The **Current Paths** and **Duplicate Logic And Consumer Artifacts** sections are
an inventory of what exists today, with constraints carried over from ADR 0004. The accepted architecture remains
[ADR 0004](decisions/0004-neutral-model-provider-discovery.md); this document
does not change it and is not an authority over it.

Everything about a *later* design below (ownership, the bounded host-owned step,
the upstream gate, the test plan, and the planned order) is a **proposal**. It
depends on the proposed Patterns ADR 0002,
`docs/decisions/0002-runtime-model-refresh-aggregation.md`, which would
supersede in part ADR 0004's guest-local, writable model aggregate and the
in-guest orchestrator that writes it, if that ADR is accepted. Until ADR 0002 is
accepted and merged, ADR 0004 stands as written, and this document proposes no
guest-writable aggregate and authorizes no implementation. This document is a
draft and stays one until ADR 0002 is accepted; it can then be promoted.

ADR 0002 is not on the default branch yet, so this document cites it by path, not
by link. Once the ADR 0002 change is merged, the path can become a link. Merge
order does not change this document's draft status; promotion depends on ADR 0002
being accepted. Bare "ADR 0002" in this document means that Patterns ADR, not the
isolation network egress ADR of the same number.

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

## Proposed Ownership Boundary

The proposed later design has three separate owners:

| Layer | Owns | Must not own |
| --- | --- | --- |
| Provider kit | Static facts, vendored snapshot, and a pure normalizer | Harness configuration, cross-provider aggregation, or credential routing decisions outside its facts |
| Host-owned refresh and projection (future, not approved) | Discovery, bounded fetch, validation, last-known-good fallback, deterministic aggregation, provenance, and a read-only projection for the guest | Harness-native configuration, provider-specific rendering rules, or any state the guest can write |
| Harness kit | Its native configuration rendering from the read-only projection and authoritative facts | Provider discovery, provider-specific normalization, model-state authority, or another harness's configuration |

In the proposed design, host authority is the rule. The host decides lifecycle
state and eligibility; the guest and the harness get a read-only view and cannot
create, change, promote, or invalidate it. A file the guest can write, even one
the host first produced, cannot be treated as authoritative. Under accepted ADR
0004, the guest-local aggregate is trusted for model metadata within its own
sandbox and never for routing or credential fields.

Any projection must carry model metadata and refresh provenance only. It must
not carry `host`, `baseUrl`, `modelsUrl`, `keyEnv`, credential values, or any
other routing authority. Harnesses must read routing and credential-name facts
only from the host-authoritative provider-input mount (also required by ADR
0004).

Refresh and projection code must not render or write configuration for OpenCode,
Prime Agent, Goose, Codex, Claude, Copilot, or any other harness. It must not
import a harness emitter or use a harness configuration file as an input or
output (also required by ADR 0004).

## Bounded Shape For A Later Host-Owned Step

ADR 0002 (proposed) would defer any refresh component, so there is no approved
entrypoint. If it is accepted, the smallest shape that stays inside the
host-owned boundary is a provider-neutral
refresh step that runs on the host, not in the guest. Its design is bounded by
these steps and is still subject to ADR 0002's decision criteria:

1. Treat a missing provider-input root as not ready, not as an empty provider
   set.
2. Discover validated provider directories below
   `models/providers/<providerId>`.
3. Read facts, snapshot, and normalizer from the pinned, host-validated provider
   inputs.
4. Fetch each provider's model-list response through one shared bounded-fetch
   implementation, with credentials held only by the host-side fetcher.
5. Where a provider normalizer would run is unresolved. ADR 0004 rejected
   running provider-shipped normalizer code on the host, next to real
   credentials, and neither this document nor ADR 0002 reverses that. Any
   placement needs its own review. Wherever it runs, it is a file-to-file
   transform, and only when its containment requirements are mechanically
   enforced.
6. Validate every normalized result against the neutral catalog schema.
7. On an individual refresh failure, keep the host's last-known-good state for
   that provider, marked stale. Use that provider's validated vendored snapshot
   only when no last-known-good state exists.
8. Aggregate providers in a documented stable order and record per-provider
   `live`, `snapshot`, or stale provenance with a single generation identifier.
9. Publish the result as an immutable, host-owned, read-only projection that the
   guest can read. When an authoritative root contains no provider directories,
   publish a valid explicitly empty projection so "no providers configured" is
   distinguishable from "refresh did not run".

In the proposed step, it must fail closed on invalid provider identity, malformed facts, invalid
normalizer output, invalid snapshots, duplicate provider IDs, or duplicate model
identities within a provider. It must never substitute a default provider,
silently omit a rejected provider, or replace the last-known-good projection
after an incomplete discovery result. When a required normalizer containment
control is unavailable, it must refuse to run that normalizer and fall back as in
step 7.

Running the refresh in the guest at startup, and having it write a guest file
that harnesses read, is the accepted ADR 0004 design that ADR 0002 would
supersede. It is not proposed here as a fallback.

## Proposed Upstream Gate

Proposed: no runtime refresh implementation should merge until the sandbox backend provides
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
- Publish any model projection as host-owned and read-only to the guest, with a
  generation identifier, and provide a readiness barrier so a harness cannot read
  a projection that is not yet complete.

The provider-input items above follow accepted ADR 0004. The final item (the
host-owned projection and its readiness barrier) is proposed. If ADR 0002 is accepted, no guest-owned or
guest-written path would be an acceptable substitute for this gate, including a
guest-local aggregate.
The sandbox agent can have elevated guest privileges, so guest ownership does
not make provider facts, normalizer code, or snapshot provenance authoritative.

As already required by ADR 0004, the normalizer execution boundary is a separate
gate. Before a normalizer runs
over live data, the runtime must mechanically enforce network denial, an
explicitly minimized environment without credentials, process-tree-wide timeout
termination, and streamed output caps for both standard output and standard
error. A documented expectation without enforcement is insufficient; the safe
behavior is snapshot fallback.

## Proposed Offline Fixture And Test Plan

This plan is proposed. Items 2 and 4 to 8 apply to either ADR 0004's in-guest
aggregate or the ADR 0002 projection. Items 3 and 9 to 11 apply only if ADR 0002
is accepted.

All catalog-refresh tests must use committed fixtures and must not make network
requests or require credentials.

1. Use the committed fixtures in
   `integrations/isolation/schemas/fixtures/acme-ai/` and
   `integrations/isolation/schemas/fixtures/usai/` as separate materialized
   provider directories containing facts, normalizer, snapshot, and source data.
2. Verify discovery is independent of filesystem enumeration order and produces
   byte-identical projection output on repeated runs.
3. Verify a missing root is not ready and leaves the existing projection
   unchanged.
4. Verify an existing empty root produces a valid explicit empty projection.
5. Verify one provider can fall back to its snapshot while another contributes
   normalized fixture output, with correct per-provider provenance.
6. Verify invalid facts, identity mismatches, malformed normalizer output,
   malformed snapshots, duplicate IDs, and dangling recommendations fail closed.
7. Verify projection output contains no routing fields, credential names, or
   credential values.
8. Verify the refresh code contains no harness-native identifiers, imports, or
   output paths.
9. Verify a failed or partial refresh leaves the host's last-known-good
   projection and generation unchanged and marks the affected source stale
   rather than current, and that the vendored snapshot is used only when no
   last-known-good state exists.
10. Verify the guest-facing view is read-only: a consumer attempt to modify the
    projection, its provenance, or its freshness is rejected and has no effect.
11. Verify a consumer sees one coherent generation, and a mixed partial update is
    detected and rejected.

Existing provider-input contract validation and provider-normalizer tests remain
part of the offline regression set. Legacy emitter round-trip tests remain
consumer compatibility tests; they are not acceptance tests for the later
provider-neutral entrypoint.

## Proposed Order

1. Complete the host-authoritative provider-input lifecycle in the sandbox
   backend, including its offline and live backend verification.
2. Confirm the normalizer containment mechanism is implemented and fail-closed
   (useful for any normalizer placement, whatever ADR 0002 decides).
3. Provide the upstream readiness barrier required before a harness may consume
   a model projection.
4. Migrate each participating provider normalizer to the pure fetched-bytes to
   neutral-catalog interface, with offline fixtures and no harness output.
5. Only if ADR 0002's prerequisites are met and its design is approved, add the
   host-owned provider-neutral refresh and read-only projection contract with the
   offline fixture matrix described above.
6. Add or update harness-owned renderers in separate, harness-specific work.
7. Migrate or retire legacy provider-owned refresh paths only after all shipped
   consumers have compatible replacements and regression coverage.

This order prevents a provider-neutral refresh effort from weakening the
host-to-guest trust boundary or silently becoming a harness configuration
delivery mechanism.
