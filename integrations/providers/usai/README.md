# USAi Model Catalog (harness-neutral)

This directory holds the harness-neutral USAi model catalog: one source of
truth for the models available through the GSA USAi gateway, independent of any
single agent harness.

## Data flow

```
live feeds -> build-catalog.mjs -> catalog.json -> per-harness emitters
```

- **live feeds** — the USAi models list plus enrichment metadata.
- **build-catalog.mjs** — derives `catalog.json`.
- **catalog.json** — the generated catalog. **GENERATED — do not hand-edit.**
- **per-harness emitters** — render `catalog.json` into each harness config
  (e.g. the OpenCode `opencode.jsonc` model block).

## Checking for drift

```bash
node scripts/build-catalog.mjs --check
```

Exits non-zero and names what moved when the committed `catalog.json` no longer
matches what the current sources produce — which models were added, removed, or
changed, so the output is actionable rather than a bare pass/fail.

The check compares the **substantive** catalog: `schemaVersion`, `generatedBy`,
`gateway`, `vendors`, and `models`. It deliberately ignores `sources`, which
records *which feed or file a given run read*. A live-feed regeneration and an
offline bootstrap of byte-identical models disagree there by design, so
comparing it would fail every offline run regardless of real drift — and a
detector that always fires is one everybody learns to ignore, leaving genuine
drift indistinguishable from the noise.

## Files

- `catalog.schema.json` — JSON Schema (draft 2020-12), id
  `usai-model-catalog/v1`. Defines the catalog shape.
- `catalog.json` — the generated catalog.

## Safety guarantee

A byte-exact round-trip test against the shipped `opencode.jsonc` is the safety
guarantee: the emitter must reproduce the current, human-reviewed config exactly.
That test is the gate that lets us treat `catalog.json` as the source of truth
without silently changing any shipped kit.

## `apiKeyEnv` is a name, not a secret

The `gateway.apiKeyEnv` field holds the **name** of an environment variable
(e.g. `USAI_API_KEY`), never a key value. It is validated to be an uppercase
env-var identifier. Never place a secret in the catalog or the schema.
