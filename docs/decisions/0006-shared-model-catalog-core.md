---
title: "Share pure model matching and enrichment across catalog consumers"
status: "proposed"
date: "2026-11-13"
decision_makers: ["Patterns maintainers", "OpenCode Agent"]
category: "provider-catalog"
impact_level: "low"
nist_controls: []
ato_relevance: "no"
risk_treatment: "n/a"
---

# ADR 0006 - Shared Model Matching and Enrichment Core

## Context and Problem Statement

The repository-time USAi catalog builder already has precision-guarded model
matching, backend preference, non-chat filtering and metadata enrichment. A
planned startup discovery consumer needs the same policy without importing the
builder's network, file, CLI or diagnostic output code. Copying the matcher would
create two places to repair identity and filtering mistakes.

[ADR 0003](0003-repo-time-provider-catalog-refresh.md) describes repository-time
refresh. [Isolation ADR 0004](../../integrations/isolation/docs/decisions/0004-neutral-model-provider-discovery.md)
governs provider inputs and discovery. This record defines the shared code
boundary; those records continue to govern each consumer's lifecycle.

## Decision Drivers

- Keep one precision and enrichment policy across consumers.
- Preserve repository-time output, exports, errors and diagnostics.
- Review pure logic separately from future network and launch behavior.

## Considered Options

1. **Extract now (chosen):** one policy implementation, one new module boundary,
   and one current importing consumer. Adds a 466-line file to maintain.
2. **Keep policy in the builder:** zero new modules, but the future consumer must
   import the combined I/O and authoring module or repeat the extraction later.
3. **Copy policy into the adapter:** two policy implementations to keep aligned
   instead of one, including every future precision and exclusion repair.
4. **Extract with runtime delivery:** one policy implementation, but combines
   behavior-preservation review with at least two new concerns: network discovery
   and launch ordering. No latency or effort estimate is claimed.

## Decision Outcome

Extract the existing policy into
[`model-catalog-core.mjs`](../../integrations/providers/usai/scripts/model-catalog-core.mjs).
The [builder](../../integrations/providers/usai/scripts/build-catalog.mjs) imports
it and preserves its existing exports and observable behavior. The core remains
in the provider area because its vendor/backend preferences are USAi-specific;
its output is provider-neutral metadata, not harness-native configuration.

### Inputs and caller responsibilities

The core accepts in-memory data, not raw responses or paths. Before calling it,
consumers must validate their input boundary: model identifiers and record
shapes, provider identity, and the supported models.dev provider/model maps.
`enrichModelMetadata(model, modelsDevCatalog, options)` expects one validated
advertised model with an `id`, classified `vendor`, and optional
`contextWindow` / `maxOutputTokens`. A null or absent enrichment catalog is
supported. Helpers are not a general schema validator or a total function over
arbitrary JavaScript values.

Callers own membership selection, duplicate checks, response and workload bounds,
credentials, destination authorization, parsing, and final schema validation.
The core neither fetches nor filters a whole feed. Callers apply `nonChatReason`
to exclude known non-chat models; passing that conservative filter is not proof
of gateway chat support. The core has no I/O or process containment, and imposes
no deadline, model-count, depth or string-length limits.

### Metadata and defaults

`enrichModelMetadata` returns `metadata`, `matched`, `matchId`, `missingLimits`,
`capabilityWarnings`, and `capabilityMalformed`, without mutating its inputs.
Precision checks decide candidate eligibility before deterministic ranking.
Backend preference stops at the first precise match, even when a fallback has
richer metadata. Positive integer provider limits win independently over
upstream context and output limits.

Unknown limits remain absent in core metadata. Only the repository-time builder
applies its existing authoring defaults of 128000 context and 8192 output tokens.
Runtime consumers must not present those generic defaults as discovered facts.
The core adds no membership, recommendations, or curated capabilities. The
builder still rejects an empty feed; runtime empty-membership handling belongs
to the future consumer and is not demonstrated by this extraction.

### Errors and diagnostics

Preserve throwing behavior: invalid upstream prices throw rather than silently
disappearing. Direct modality normalization also throws on invalid input.
Capability extraction handles malformed upstream capability fields by omitting
them and returning warnings as data. Callers choose where to report diagnostics;
the builder retains its existing warning text, counts and unenriched diagnostics.
A future caller must define its own optional-enrichment failure policy rather
than assume the core catches every error or supplies a fallback.

### Capability provenance

`includeCapabilities` defaults to false. Opting in copies unverified upstream
reasoning/modality metadata, not evidence that a gateway forwards those features.
Callers retain responsibility for per-model, per-field verification and source
provenance. Curated capabilities must remain tied to exact provider/model identity;
the core does not carry them or grant verification status. Existing repository-time
carry-forward and opt-in conflict checks stay in the builder, under
[isolation ADR 0006](../../integrations/isolation/docs/decisions/0006-neutral-model-capability-metadata.md).

## Consequences

### Positive Consequences

Extracting now allows reviewers to verify behavior preservation separately from
the future network and launch-ordering changes. The current builder is the first
consumer; guest packaging, discovery execution and launch qualification remain
future work. This foundation does not activate runtime discovery.

### Negative Consequences

The 466-line core is a cohesive module-size exception: identity normalization,
precision checks, ranking, filtering and enrichment form one model-metadata
policy. Keeping that policy together makes its ordering and assumptions visible
and avoids a second implementation. A mechanical split would add module edges
without a distinct responsibility. Revisit the boundary if it grows new concerns;
network, credentials, rendering and lifecycle logic remain caller responsibilities.
The PR description records the size justification for review under
[Coding Practices](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
sections 11.1 and 13.3.

### Compliance Consequences

This internal refactoring changes no authorization boundary, data destination or
credential handling, and requires no ATO package update. No new NIST control
satisfaction is claimed. The low impact label describes this code change, not a
new system categorization. Peer review of this proposed ADR is required before
the extraction merges.

## Verification and Rollback

Retain the independent byte-exact refresh fixtures, precision regressions and
capability tests as the behavioral reference. Shared-core tests cover absent
limits, provider precedence, diagnostics, throwing behavior and unchanged builder
exports. Builder/core comparison is a wiring check, not an independent oracle
because both call the same implementation.

Before another consumer integrates, rollback can restore the functions to the
builder and remove the shared import, keeping the existing tests and output.
After integration, coordinate rollback with each importing consumer.
