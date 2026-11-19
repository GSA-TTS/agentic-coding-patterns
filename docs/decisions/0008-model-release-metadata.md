---
title: "Optional matched model release metadata"
status: "proposed"
date: "2026-11-17"
decision_makers: ["Patterns maintainers"]
category: "provider-catalog"
impact_level: "low"
nist_controls: []
ato_relevance: "no"
risk_treatment: "n/a"
---

# ADR 0008 - Optional Matched Model Release Metadata

## Context and Problem Statement

Consumers need genuine model release dates before they can make a deliberate
presentation choice. A deployment ID, discovery timestamp, or upstream catalog
update date is not a release date. A newer date does not establish quality across
vendors, gateway support, or availability.

The [shared core in ADR 0006](0006-shared-model-catalog-core.md) already selects
precise matches and orders backend sources. A second matcher or separate source
preference table could attach a date from a different model than its other
metadata. Existing catalog authoring and runtime consumers must remain unchanged.

## Proposed Decision

Extend `enrichModelMetadata` with a default-off `includeReleaseMetadata` option.
Enabling it requires a caller-supplied valid `asOf` calendar day. The function
does not read a clock or fetch data. The existing provider loop and precision
matcher select the entry once for all enrichment fields. No new matching,
ranking, or provider-preference policy is introduced.

Copy only the selected entry's `release_date` to `metadata.releaseDate` when it
is a full Gregorian day in years 0001–9999 and no later than `asOf`. Emit
`metadata.releaseDateSource` alongside it, containing `source: "models.dev"`
and the selected upstream `providerId` and `modelId` map keys, not nested claimed
IDs. Invalid, partial, absent, or future dates omit both fields, not the model.
Missing or malformed `asOf` is a caller error only when opting in. The caller
owns a trustworthy day and must refresh it for each preparation; this is not a
schema-controlled clock.

Stop at the first precise match in existing backend preference order. Do not
search a richer fallback because a date is absent. Existing alias selection
remains unchanged, including deployment-date identity checks; those date tokens
never supply the release date. Never use `last_updated`, model names, gateway
creation time, or invented values to fill gaps.

The [neutral model schema](../../integrations/isolation/schemas/acq-neutral-model-catalog.schema.json)
allows this pair, requires mutual presence, and closes the provenance object.
Strings are bounded and source IDs cannot be arbitrary URLs. Unrepresentable
source identities omit the pair rather than being truncated or rewritten.
Calendar validity is enforced by schema pattern even when a validator does not
assert `format`; the producer enforces the dynamic nonfuture bound. Provenance
is data-only attribution, not proof of upstream truth or a network destination.
The [provider input contract](../../integrations/isolation/docs/provider-input-contract.md#optional-model-release-metadata)
defines the exact fields and caller obligations.

## Alternatives Considered

- **Infer dates from IDs or catalog updates:** rejected; these can name a
  deployment or edit rather than the underlying release.
- **Run another date-specific matcher:** rejected; identity and backend policy
  could diverge from the metadata already attached to the model.
- **Enable emission for all consumers now:** rejected; older closed schemas
  may reject the pair and downstream presentation behavior is not qualified.
- **Add a ranking framework or synthetic dates:** rejected; out of scope and
  not evidence of genuine release recency.

## Consequences and Compatibility

Existing exports and default return shapes, authoring output, limits, costs,
capabilities, errors, and diagnostics are preserved. The implementation adds
only bounded optional metadata handling to the existing core; it adds no module
or dependency. Invalid upstream costs retain their existing throwing behavior.
The schema addition does not opt any producer into emitting the new fields.
Catalogs, snapshots, generated runtime files, membership, defaults, and routing
are not changed. Disable the option and omit both fields to roll back emission.

Reported upstream dates remain unverified statements. Alias matching retains
the shared matcher's existing semantics; provenance makes the selected entry
inspectable, not guaranteed to describe a gateway's current deployment.

Harness presentation integration is deferred until after this prerequisite
merges and receiving consumers support the fields. No plugin is delivered here.
No UI sorting, default selection, favorites/recents handling, or native date
override behavior is claimed or enabled by this decision.

## Validation

The [release metadata tests](../../integrations/providers/usai/tests/model-release-metadata.test.mjs)
read the existing models.dev and gateway fixtures. They cover gateway suffixes,
precise matches, aliases, backend preference, unknown models, strict dates,
future bounds, source identity, nonmutation, unchanged default output and
diagnostics, and closed-schema pair validation. Schema tests use the repository's
existing Python `jsonschema` dependency. Run these and existing provider and
contract regressions only in the workspace sandbox. Test execution is required
review evidence, not implied by this proposed record.
