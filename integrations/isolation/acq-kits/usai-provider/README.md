# usai-provider (acq mixin kit, `hybrid/v1`)

This neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart)
mixin publishes USAi provider input and allow-lists its endpoint. It does not
write OpenCode configuration.

## Interface

The provider bundle declares the provider facts, the catalog normalizer, and
the vendored snapshot. `acq` validates the bundle, materializes each selected
provider under the backend-supplied input root, then atomically selects a
generation at `current/models/providers/usai/`.

The OpenCode kit is the sole acq-owned OpenCode configuration writer. At
startup it reads the selected generation and renders `facts.json` plus
`snapshot.json` into the global config. This ordering prevents two kits from
merging competing config writes. The catalog snapshot is model metadata only;
credentials remain acq-managed.

## What It Does

- Allow-lists `api.gsa.usai.gov` through `caps.network.allow`.
- Supplies facts, normalizer, and snapshot paths through `provider-input.json`.
- Does not install provider-specific OpenCode files or a startup writer.

## Catalog Updates

`scripts/normalize-catalog.mjs` converts the checked-in USAi catalog to the
neutral catalog shape without network access. The snapshot is consumed by the
OpenCode renderer for this milestone; aggregation or live normalizer execution
belongs to acq materialization, not this kit.

```bash
npm test
```

## Credentials

The API key is not stored in this kit. Set it through acq:

```bash
acq secret set usai --host api.gsa.usai.gov
```

The active backend injects the credential for the selected provider. The
OpenCode renderer references the configured environment-variable name from
provider facts and never receives a key value.
