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
backend. The host validates and stages these inputs; the backend exposes them on
a read-only mount.

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

## Version 1 Migration

`acq-provider-input-bundle/v1` remains accepted. Its `projectedPath` continues
to name the released fixed location
`/var/lib/acq/host/models/providers/<providerId>`. Existing version 1 consumers
therefore continue working unchanged.

New bundles must use version 2. Consumers supporting both versions use the v1
fixed `projectedPath` or compose the v2 `providerPath` under the supplied root.
The validation contract retains the same artifact, symlink, credential, URL,
executable, and strict-JSON checks for both versions.

## Consumer Requirements

- Treat `ACQ_PROVIDER_INPUT_ROOT` as an absolute backend-supplied value.
- Compose only the validated v2 `providerPath`; do not normalize an arbitrary
  consumer-provided relative path.
- Read provider routing and credential-name facts only from the read-only
  provider directory.
- Do not place credential values in the bundle, mount, aggregate catalog, or
  consumer configuration.
- Fail as not ready when a required provider root or provider directory is
  absent. Do not interpret absence as an empty provider set.

See ADR 0004 for the trust boundary, validation rules, and rationale.
