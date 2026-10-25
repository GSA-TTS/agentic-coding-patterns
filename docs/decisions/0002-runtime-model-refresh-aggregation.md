---
title: "Defer runtime model refresh and aggregation until host authority is established"
status: "proposed"
date: "2026-10-25"
decision_makers: ["Patterns maintainers"]
category: "runtime-models"
impact_level: "moderate"
---

# ADR 0002 - Defer Runtime Model Refresh and Aggregation Until Host Authority Is Established

## Context and Problem Statement

The execution environment is moving model lifecycle authority to the host. This
changes the question from how to collect provider model lists to whether a
separate runtime refresh or aggregate is needed at all. A duplicate discovery
path can create stale data, inconsistent eligibility decisions, unclear
provenance, and a second authority over a host-owned lifecycle.

This decision records the conditions for considering runtime model refresh or
aggregation. It does not authorize an implementation.

## Decision

Do not implement a runtime models orchestrator, provider fetcher, cache,
scheduler, harness renderer, or guest-writable aggregate at this time.

Revisit the need only after both prerequisites are complete:

1. The Quickstart host-authoritative lifecycle migration is complete and its
   host-owned model lifecycle behavior is available to consumers.
2. The Patterns provider-neutral refresh design is approved. It must define a
   provider-independent contract for freshness, normalization, failures,
   provenance, and consumer behavior.

Until then, consumers should use the host-authoritative model state and should
not infer a need for a second discovery or aggregation path from missing
convenience data alone.

## Decision Criteria

An implementation proposal may proceed only when evidence shows that the host
model state cannot satisfy a concrete consumer need without weakening authority
or trust boundaries. The proposal must answer all of the following:

- **Consumer value:** Which consumer needs data unavailable from the host, and
  why is an adapter or host API extension insufficient?
- **Single authority:** Which component decides model availability and
  eligibility? The answer must remain the host.
- **Freshness:** What observable freshness objective is required, and what
  behavior is correct when freshness cannot be achieved?
- **Consistency:** How are conflicting provider observations resolved without
  changing host eligibility or presenting an invented canonical value?
- **Failure behavior:** Does an unavailable provider, expired data, or malformed
  response fail closed without erasing last-known provenance?
- **Operational cost:** What bounded resources, monitoring, and maintenance are
  required, and are they justified by the consumer value?
- **Privacy and security:** Can the design avoid sensitive configuration,
  credentials, tenant-specific metadata, and untrusted provider text in durable
  output?
- **Testability:** Can the contract be verified entirely with offline fixtures,
  including error and stale-data paths?

If any answer requires guest authority over lifecycle state, a mutable shared
aggregate, or an undocumented provider-specific exception, reject the proposal
or return it for redesign.

## Threat Boundaries

The host is the authority for lifecycle state, eligibility, selection, and any
credentials used to observe providers. A guest or harness may request a
read-only view, but it must not create, modify, promote, or invalidate
host-owned model state.

Provider responses are untrusted input. They may be incomplete, stale,
malformed, inconsistent across calls, or shaped to cause excessive resource use.
Any future adapter must validate the response before normalization and must keep
raw provider payloads out of guest-writable or broadly readable storage unless a
separate, reviewed retention decision permits them.

The following boundaries must remain explicit:

| Boundary | Allowed flow | Prohibited flow |
|---|---|---|
| Provider to host | Host obtains and validates observations. | Provider data directly changes guest or harness state. |
| Host to consumer | Host exposes a read-only, provenance-bearing view. | Consumer mutates host lifecycle, eligibility, or freshness. |
| Guest to host | Guest requests a documented read-only view. | Guest writes an aggregate or triggers unbounded refresh work. |
| Cache to consumer | Cache is host-owned and advisory to the host decision. | Cache becomes an independent authority or a guest-writable source. |

## Non-Goals

This decision does not:

- select providers, models, polling intervals, storage technology, or a cache
  format;
- define a models orchestrator, fetch loop, scheduler, renderer, or guest API;
- collect live provider data, add credentials, or make network requests;
- create a cross-provider canonical model catalog;
- promise that all provider labels, capabilities, or availability observations
  are comparable;
- permit a guest-writable aggregate or a guest-initiated refresh mechanism; or
- replace the host-authoritative lifecycle with a pattern-local registry.

## Candidate Architectures for Later Evaluation

The following options are intentionally descriptive, not approved designs.

1. **No additional runtime component.** Consumers use the host-authoritative
   model state directly. Prefer this option when the host view meets consumer
   needs.
2. **Read-only host projection.** The host derives and exposes a normalized,
   provenance-bearing view from its lifecycle state. Prefer this option when
   consumers need presentation or filtering but not independent discovery.
3. **Host-owned provider-neutral refresh adapter.** The host refreshes
   observations through a defined provider-neutral contract, then updates only
   host-owned lifecycle state. Consider this only when direct host state and a
   projection cannot meet documented freshness needs.
4. **Host-owned derived cache.** The host retains validated, normalized
   observations to provide bounded availability during provider outages. This is
   an extension of Option 3, not an independent aggregate or authority.

Reject any option that gives a guest, renderer, or harness authority to write a
shared aggregate, select a model, override lifecycle state, or own refresh
scheduling.

## Required Semantics if a Future Design Is Approved

Any approved host-authoritative refresh or cache design must specify these
semantics before implementation:

- **Authority:** The host alone determines lifecycle state and eligibility. A
  cache records observations; it does not independently authorize a model.
- **Ownership:** Cache storage, expiration, invalidation, and mutation are
  host-owned. Consumers receive read-only snapshots or queries.
- **Provenance:** Each returned record identifies its source, observation time,
  normalization contract version, and freshness state. A record must distinguish
  an observed provider value from a host-derived value.
- **Freshness:** The design defines an expiration rule, a stale-but-available
  state, and a failure state. It must not silently represent stale data as
  current.
- **Atomicity:** A consumer receives a coherent snapshot with one generation or
  revision identifier. Mixed partial updates must be detectable and rejected.
- **Validation:** The host applies size limits, schema checks, field allowlists,
  and bounded normalization before accepting provider data.
- **Failure isolation:** A failing or malicious provider cannot erase unrelated
  valid observations, expand work without bounds, or change lifecycle authority.
- **Auditability:** The host can explain why a record is present, stale,
  rejected, or unavailable without logging credentials or raw sensitive data.
- **Retention:** Raw payload retention is disabled by default. Any exception
  requires an explicit data-handling decision, a retention period, and access
  controls.

## Offline Fixture and Test Matrix

The future provider-neutral contract must be testable without network access,
real provider credentials, clocks outside test control, or mutable shared
fixtures. Fixtures should be minimal, synthetic, and versioned with the
contract.

| Scenario | Offline fixture | Expected assertion |
|---|---|---|
| Valid observation | Minimal valid provider response | Host produces a normalized, provenance-bearing read-only record. |
| Unknown optional field | Valid response with an extra field | Host ignores or safely records only allowlisted data. |
| Missing required field | Response omits an identity or observation field | Host rejects the observation with an explainable reason. |
| Malformed response | Invalid syntax or schema mismatch | Host rejects it without changing the prior coherent snapshot. |
| Oversized response | Payload exceeds a documented limit | Host bounds processing and records a safe failure. |
| Provider timeout or unavailable result | Deterministic failure fixture | Host preserves eligible prior state only within its explicit stale policy. |
| Expired observation | Controlled clock beyond expiration | Returned record is marked stale or unavailable, never current. |
| Conflicting observations | Two provider fixtures with overlapping labels | Host preserves separate provenance and does not invent equivalence. |
| Partial refresh failure | One valid and one failing provider fixture | Host exposes a coherent generation and isolates the failing source. |
| Reordered input | Equivalent response fields in different order | Normalization is deterministic. |
| Duplicate identity | Repeated identity within one source | Host follows a documented deterministic reject or resolution rule. |
| Consumer mutation attempt | Read-only projection fixture | Consumer cannot alter lifecycle, cache, provenance, or freshness. |
| Raw data leakage check | Fixture containing harmless sentinel fields | Projection excludes raw payloads and sensitive configuration. |
| Revision compatibility | Prior contract-version fixture | Host either migrates deterministically or rejects with a clear compatibility state. |

## Consequences

**Positive:**

- Preserves one lifecycle authority while migration work completes.
- Avoids duplicating provider access, caching, and scheduling before a consumer
  need and provider-neutral contract are demonstrated.
- Establishes testable safety and provenance requirements for any later work.

**Trade-offs:**

- Consumers may need to wait for host-owned lifecycle capabilities rather than
  receiving a pattern-local convenience aggregate.
- A later proposal must supply evidence and offline fixtures before implementation
  can begin.

## Review Trigger

Reopen this decision only after both stated prerequisites are complete and a
proposal includes a documented consumer need, a threat-boundary review, the
required semantics, and the offline fixture matrix.
