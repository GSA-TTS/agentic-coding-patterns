# USAi Model Catalog (harness-neutral)

This directory holds the harness-neutral USAi model catalog: one source of
truth for the models available through the GSA USAi gateway, independent of any
single agent harness.

## Data flow

```
live feeds (USAi model list + models.dev)
  -> one source pull
  -> catalog.json                      (this directory)
  -> registered provider-neutral artifacts
       neutral model snapshot          (acq-kits/usai-provider, via its normalizer)
  -> drift check / review / commit by a person
```

- **catalog.json** — the generated catalog. **GENERATED — do not hand-edit**
  (except the `recommendations` role defaults, which a person curates).
- **neutral snapshot** — the metadata-only `acq-neutral-model-catalog/v1`
  document the USAi provider kit vendors. It is derived from `catalog.json`.
- **harness-native configuration** is not produced here. Each harness kit renders
  its own configuration from the neutral inputs. The refresh never writes or
  reads one.

The decision behind this lifecycle is
[ADR 0003](../../../docs/decisions/0003-repo-time-provider-catalog-refresh.md).

## Refreshing the catalog (the one command)

```bash
make refresh-usai-catalog          # pull once, rewrite catalog.json and the snapshot
make refresh-usai-catalog-check    # same pull, report drift, write nothing
```

Run these on a maintainer host. A live pull needs `USAI_API_KEY` in the process
environment (the gateway rejects unauthenticated requests). The key is read from
the environment only, never from a flag, and is never printed or written to a
file. The command refuses to run a live pull when it detects CI.

What happens:

1. Both feeds are fetched **once** (https only, bounded time and size) into
   `tmp/usai-source/`, which is git-ignored.
2. `catalog.json` is built from that pull. Role defaults and model order are
   carried forward from the existing catalog.
3. Every artifact in [`refresh-registry.json`](refresh-registry.json) is
   regenerated from the new catalog by its file-to-file generator.
4. Only if every step succeeded are the files written. Nothing is committed.
   Review `git diff`, then commit as a normal change.

Check mode compares in a temporary directory and exits `1` on drift, naming the
artifact and the models that were added, removed or changed. `sources` is not
compared, because it records where a run read from, not what the catalog says.

### Offline and deterministic

```bash
node integrations/providers/usai/scripts/refresh.mjs --from <dir> [--check]
```

`<dir>` holds `usai-models.json` and `models-dev.json` (the two feeds saved
earlier, for example by a previous live pull under `tmp/usai-source/`).
No network and no credential are needed. The fixtures under
`tests/fixtures/refresh/` are such a directory, and `tests/fixtures/refresh/artifacts/`
holds the catalog and snapshot they regenerate byte for byte. The tests use those
copies, so they do not change when the real catalog is refreshed.

### When a refresh fails

- **A recommended model left the feed.** The build names each role and id and
  writes nothing. Choose a replacement, edit `recommendations` in `catalog.json`,
  and re-run.
- **The catalog at the output path is not a catalog.** The build refuses to
  overwrite it. Repair or remove the file.
- **No key / CI detected / feed unreachable.** The command exits `2` with the
  reason. Use `--from` to work from a saved pull.

### Adding a provider-neutral artifact

Add an entry to `refresh-registry.json` with a repository-relative `path` and a
`generator` (a Node script that reads the catalog and writes the artifact, using
the `{catalog}` and `{out}` placeholders). The generator must be a pure
file-to-file transform: no network, no credential, no harness-native output.
Add a fixture test next to `tests/refresh.test.mjs`.

## Checking for drift in the catalog alone

```bash
node scripts/build-catalog.mjs --check --models-url <usai-models.json> --models-dev <models-dev.json>
```

`build-catalog.mjs` has no default source and no bootstrap mode; run without
`--models-url` it refuses and points at the refresh command.

The check compares the **substantive** catalog: `schemaVersion`, `generatedBy`,
`gateway`, `vendors`, `models` and `recommendations`. It deliberately ignores
`sources`, which records *which feed or file a given run read*. Two runs over
byte-identical models disagree there by design, so comparing it would fail every
run regardless of real drift — and a detector that always fires is one everybody
learns to ignore.

## Role defaults (`recommendations`)

`recommendations` maps a role (`primary`, `small`, `compaction`, `summary`,
`title`) to a model id. A person chooses these; the feeds do not. So a
regeneration carries the existing values forward from the catalog at `--out`
rather than recomputing them.

- Every value must name a model in `models[]`. A role name outside the schema,
  or an id that is not in `models[]`, fails validation.
- If a recommended model is no longer in the regenerated list, the build **fails**
  and names each missing role and id. Nothing is written and nothing is
  re-picked automatically. Choose a replacement, edit `recommendations` in
  `catalog.json`, and re-run.
- The file at `--out` must be absent or a real catalog (a JSON object with
  `schemaVersion` `usai-model-catalog/v1` and a `models` array). Anything else,
  including invalid JSON, `[]`, `null`, a number, `{}`, or a catalog with no
  `models`, fails the build and leaves the file untouched, instead of
  overwriting it with a catalog that has no roles.
- A real catalog that has no `recommendations` yet is accepted: there are no
  roles to lose, so the new catalog is written without any. Roles are only ever
  added by a person editing `recommendations`; the build never invents them.
  The shipped catalog always carries them, so deleting the block from it is a
  reviewable diff, not a silent build outcome.
- `--check` applies the same rules: a recommended model that left the feed makes
  it fail with the message above, and `describeDrift` also names any role whose
  value differs between the two catalogs it compares.

## Files

- `catalog.schema.json` — JSON Schema (draft 2020-12), id
  `usai-model-catalog/v1`. Defines the catalog shape, including the advisory
  `recommendations` roles (`primary`, `small`, `compaction`, `summary`, `title`),
  which match the neutral catalog contract and the OpenCode kit renderer.
- `catalog.json` — the generated catalog.

## Capability metadata

`reasoning` (boolean) and `inputModalities` (subset of `text`, `image`, `audio`,
`video`, `pdf`) are optional per-model fields. **Absent means unknown**; `false`
and `["text"]` mean known-unsupported and known text-only. The builder does
**not** copy them by default. Passing `--include-capabilities` to a live-feed
build copies them from the matched models.dev entry and labels that provenance
in `sources.capabilities`; models.dev describes the upstream provider, not
necessarily the USAi gateway, so that output must not be committed until each
value is confirmed against the gateway with per-model, per-field evidence (a
data PR description plus a committed evidence file; see the ADR). The
`sources.capabilitiesVerified` string (`<date>; opencode <version>`) is only a
catalog-wide release reminder, not evidence. Malformed upstream values are
treated as unknown with a warning. Nothing is inferred from model ids or names. See
[ADR 0006](../../isolation/docs/decisions/0006-neutral-model-capability-metadata.md).

## Safety guarantee

A byte-exact round-trip test against the durable OpenCode renderer contract is the safety
guarantee: the emitter must reproduce the current, human-reviewed config exactly.
That test is the gate that lets us treat `catalog.json` as the source of truth
without silently changing any shipped kit.

## `apiKeyEnv` is a name, not a secret

The `gateway.apiKeyEnv` field holds the **name** of an environment variable
(e.g. `USAI_API_KEY`), never a key value. It is validated to be an uppercase
env-var identifier. Never place a secret in the catalog or the schema.
