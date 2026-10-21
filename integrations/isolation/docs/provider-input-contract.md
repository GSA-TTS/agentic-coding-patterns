---
title: "Provider Input Bundle Consumer Contract"
description: "Versioned provider bundle paths and the backend-supplied read-only consumer root."
status: canonical
tier: 2
last_updated: "2026-10-21"
---

# Provider Input Bundle Consumer Contract

Provider input bundles let provider kits publish facts, a normalizer, and a
vendored model snapshot without coupling a consumer to a provider or sandbox
backend. The host validates and stages these inputs; the backend materializer
owns the supplied root, read-only mount, and consumer wiring.

## Version 2

New bundles use `schemaVersion: "acq-provider-input-bundle/v2"` and declare:

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

New bundles must use version 2. Consumers supporting both versions use the v1
fixed `projectedPath` or compose the v2 `providerPath` under the supplied root.
The validation contract retains the same artifact, symlink, credential, URL,
executable, and strict-JSON checks for both versions.

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
  --bundle <staged-provider>/provider-input.json
```

`--schema-dir` and `--credential-bindings` are trusted control-plane inputs.
They MUST come from the pinned Patterns release and backend-owned credential
configuration, never from bundle contents or provider-controlled metadata. A
provider controls only the staged manifest path passed with `--bundle`.

## Consumer Requirements

- Treat an absent required `ACQ_PROVIDER_INPUT_ROOT` or provider directory as
  **not ready**, never as an empty provider set.
- Treat a present authoritative root with zero provider directories as a valid,
  authoritative empty provider set.
- Treat a rejected bundle as a provisioning failure. Build an empty aggregate
  only after successful authoritative discovery confirms zero providers.
- Read provider routing and credential-name facts only from the backend's
  read-only provider directory.
- Do not place credential values in the bundle, mount, aggregate catalog, or
  consumer configuration.

See ADR 0004 for the trust boundary, validation rules, and rationale.
