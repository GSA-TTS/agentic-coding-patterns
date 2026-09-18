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
- **per-harness emitters** — render `catalog.json` into each harness config:
  - `emitters/opencode.mjs` — the OpenCode `opencode.jsonc` model block.
  - `emitters/prime-agent.mjs` — the prime-agent kit `models.json`.
  - `emitters/goose.mjs` — the goose-server kit `custom_providers/custom_usai.json`
    (a goose custom provider; `name` per model is the catalog model **id** goose
    selects by, and `api_key_env` is the goose guest's injected env-var name
    `CUSTOM_USAI_API_KEY`, not the catalog's `USAI_API_KEY`).

## Files

- `catalog.schema.json` — JSON Schema (draft 2020-12), id
  `usai-model-catalog/v1`. Defines the catalog shape.
- `catalog.json` — the generated catalog (NOT in this scaffold; see epic
  GSA-TTS/agentic-coding-patterns#357).

## Safety guarantee

Byte-exact round-trip / lockstep tests against each shipped config are the safety
guarantee: every emitter must reproduce the current, human-reviewed shipped file
exactly (`tests/emitters.test.mjs` for OpenCode; `tests/models-json-regen.test.mjs`
for prime-agent; `tests/goose-provider-regen.test.mjs` for goose). Those tests are
the gate that lets us treat `catalog.json` as the source of truth without silently
changing any shipped kit — if the catalog changes and a shipped config is not
regenerated, CI fails.

## `apiKeyEnv` is a name, not a secret

The `gateway.apiKeyEnv` field holds the **name** of an environment variable
(e.g. `USAI_API_KEY`), never a key value. It is validated to be an uppercase
env-var identifier. Never place a secret in the catalog or the schema.

Part of epic GSA-TTS/agentic-coding-patterns#357.
