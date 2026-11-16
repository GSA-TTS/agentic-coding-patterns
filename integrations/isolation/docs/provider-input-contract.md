---
title: "Provider Input Bundle Consumer Contract"
description: "Versioned provider bundle paths and the backend-supplied read-only consumer root."
status: canonical
tier: 2
last_updated: "2026-11-13"
---

# Provider Input Bundle Consumer Contract

Provider input bundles let provider kits publish facts and a vendored model
snapshot without coupling a consumer to a sandbox backend. Versions 1 and 2
also declare a provider normalizer; version 3 instead selects a trusted adapter
with inline data. The host validates and stages these inputs; the backend
materializer owns the supplied root, read-only mount, and consumer wiring.

## Version 3: Data-Only Discovery

`acq-provider-input-bundle/v3` is an additive contract. Its complete manifest
shape is:

```json
{
  "schemaVersion": "acq-provider-input-bundle/v3",
  "providerId": "usai",
  "factsPath": "facts.json",
  "snapshotPath": "snapshot.json",
  "providerPath": "models/providers/usai",
  "credentialEnvNames": ["USAI_API_KEY"],
  "discovery": {"adapter": "usai-openai-list/v1"}
}
```

`discovery` is an inline object, not a file path. Its only property, `adapter`,
is a closed enum containing `usai-openai-list/v1`. That adapter is valid only
for `providerId: "usai"`; it is not a generic OpenAI-compatible adapter for
other providers. No arbitrary mapping, import, command, `normalizerPath`, or
other execution field is accepted, either at the bundle root or in `discovery`.
The trusted runtime owns the adapter implementation, not the provider kit.

Version 3 uses `acq-provider-input-bundle-v3.schema.json`. The host validator
checks facts and snapshot as regular, contained, non-symlink JSON files, applies
their existing schemas, cross-checks provider identity and canonical
`providerPath`, checks credential-name ownership and declaration, and retains
the same HTTPS/same-host checks and set-wide duplicate-provider refusal. It
does not execute provider code, fetch a model list, or test credentials.

The first planned runtime consumer is **OpenCode on MSB**. Live membership must
be discovered, enriched using the existing matcher and models.dev tooling, and
rendered before OpenCode launches. Required discovery failure blocks launch;
snapshot-only operation must be explicitly selected and identified as degraded,
never silently substituted for live discovery. A v2 executable normalizer is
not reinterpreted as a v3 adapter. Existing v1/v2 validation behavior is unchanged.

This contract does not implement that runtime or Quickstart wiring. Keep the
production USAi manifest on v2 until both are ready and qualified. It adds no
kit, scheduler, or runtime dependency graph and makes no Pi or SBX support claim.
See the [approved initial-delivery amendment in ADR 0004](decisions/0004-neutral-model-provider-discovery.md#approved-initial-delivery-amendment-2026-11-13).

## Version 2

Existing normalizer bundles use `schemaVersion: "acq-provider-input-bundle/v2"`
and declare:

```json
{
  "providerId": "example-provider",
  "providerPath": "models/providers/example-provider"
}
```

`providerPath` is a required stable relative path. It is not an absolute guest
path, cannot contain traversal or dot segments, and must exactly agree with the
bundle's `providerId`.

The backend supplies `ACQ_PROVIDER_INPUT_ROOT` as an absolute path to the
read-only provider-input root. A consumer composes the provider directory as:

```text
$ACQ_PROVIDER_INPUT_ROOT/models/providers/<providerId>
```

The backend owns the root value. A provider bundle and a consumer must not infer
or select it from a backend name.

The backend materializer MUST supply the root, enforce the read-only mount,
reject symlinks in the materialized provider tree, and verify that each
materialized directory name equals its validated `providerId`. Its offline and
live backend tests must cover these requirements. This repository deliberately
does not provide a synthetic consumer or mount implementation; see ADR 0004 for
the tracked implementation work.

## Version 1 Migration

`acq-provider-input-bundle/v1` remains accepted. Its `projectedPath` continues
to name the released fixed location
`/var/lib/acq/host/models/providers/<providerId>`. Existing version 1 consumers
therefore continue working unchanged.

Normalizer bundles use version 2; data-only discovery bundles use version 3
once their consumers support it. Consumers use the v1 fixed `projectedPath`
or compose the v2/v3 `providerPath` under the supplied root.
The validation contract retains the same artifact, symlink, credential, URL,
executable, and strict-JSON checks for versions 1 and 2. Version 3 shares the
data checks but has no executable artifact.

The released `acq-provider-input-bundle.schema.json` remains the v1 schema with
its original `$id`. Version 2 uses
`acq-provider-input-bundle-v2.schema.json` and `$id`
`acq-provider-input-bundle/v2`. Every host materializer MUST invoke
`scripts/validate_provider_input_contract.py`; JSON Schema alone cannot enforce
cross-field agreement, file containment, symlink rejection, or executable-file
checks.

Materializers validate staged bundles without copying contract logic:

```text
python3 scripts/validate_provider_input_contract.py \
  --schema-dir <released-patterns>/integrations/isolation/schemas \
  --credential-bindings <released-patterns>/integrations/isolation/schemas/provider-credential-bindings.json \
  --bundle <staged-provider-1>/provider-input.json \
  --bundle <staged-provider-2>/provider-input.json
```

**CLI invocation rules:**

- **Repeated `--bundle` flags in ONE invocation** perform set-wide duplicate-provider checking across all candidates. Each distinct `--bundle` invocation with a single flag resets the uniqueness set, so pass every candidate as repeated `--bundle` flags in a single command to catch duplicates.
- **Zero `--bundle` flags** select repository discovery and validate the shipped fixture and canonical kit bundles. This is discovery mode, not validation of an empty external provider set; see Consumer Requirements.

`--schema-dir` and `--credential-bindings` are trusted control-plane inputs.
They MUST come from the pinned Patterns release and backend-owned credential
configuration, never from bundle contents or provider-controlled metadata. A
provider controls only the staged manifest path(s) passed with `--bundle`.

## Consumer Requirements

- Treat an absent required `ACQ_PROVIDER_INPUT_ROOT` or provider directory as
  **not ready**, never as an empty provider set.
- Treat a present authoritative root with zero provider directories as a valid,
  authoritative empty provider set.
- Treat a rejected bundle as a provisioning failure. An empty model result is
  valid only after successful authoritative discovery confirms it; the initial
  v3 delivery does not require a new writable aggregate file.
- Read provider routing and credential-name facts only from the backend's
  read-only provider directory.
- Do not place credential values in the bundle, mount, aggregate catalog, or
  consumer configuration.

See ADR 0004 for the trust boundary, validation rules, and rationale.
