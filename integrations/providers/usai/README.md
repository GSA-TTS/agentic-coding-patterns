# USAi Model Catalog (harness-neutral)

This directory holds the harness-neutral USAi model catalog: one source of
truth for the models available through the GSA USAi gateway, independent of any
single agent harness.

## Data flow

```
live feeds -> build-catalog.mjs -> catalog.json -> per-harness emitters
```

- **live feeds** — the USAi models list plus enrichment metadata.
- **build-catalog.mjs** — derives `catalog.json` (added in a later issue).
- **catalog.json** — the generated catalog. **GENERATED — do not hand-edit.**
- **per-harness emitters** — render `catalog.json` into each harness config
  (e.g. the OpenCode `opencode.jsonc` model block).

## Files

- `catalog.schema.json` — JSON Schema (draft 2020-12), id
  `usai-model-catalog/v1`. Defines the catalog shape.
- `catalog.json` — the generated catalog (NOT in this scaffold; see epic
  GSA-TTS/agentic-coding-patterns#357).

## Safety guarantee

A byte-exact round-trip test against the shipped `opencode.jsonc` is the safety
guarantee: the emitter must reproduce the current, human-reviewed config exactly.
That test is the gate that lets us treat `catalog.json` as the source of truth
without silently changing any shipped kit.

## `apiKeyEnv` is a name, not a secret

The `gateway.apiKeyEnv` field holds the **name** of an environment variable
(e.g. `USAI_API_KEY`), never a key value. It is validated to be an uppercase
env-var identifier. Never place a secret in the catalog or the schema.

Part of epic GSA-TTS/agentic-coding-patterns#357.
