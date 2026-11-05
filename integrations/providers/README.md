---
title: "Provider Catalog Refresh Runbook"
description: "How to refresh provider-neutral model artifacts, read a drift issue, and onboard a new artifact or harness consumer."
status: draft
tier: 2
last_updated: "2026-11-05"
---

# Provider Catalog Refresh Runbook

This runbook is for a maintainer who needs to refresh the provider-neutral model
artifacts, or add a new one. You can finish both jobs from this page. It uses the
USAi provider as the worked example, because that is the only provider here
today.

Why this page lives in `integrations/providers/`: the steps apply to any
provider directory, not only USAi. The USAi-specific details stay in
[`usai/README.md`](usai/README.md), which is the reference for flags and rules.
The reasons behind the design are in
[ADR 0003](../../docs/decisions/0003-repo-time-provider-catalog-refresh.md) (the
refresh command) and
[ADR 0004](../../docs/decisions/0004-offline-catalog-drift-workflow.md) (the
weekly drift report).

## 1. How the data flows

```text
live feeds (USAi model list + models.dev)
  -> one source pull, by a person, on a maintainer host
  -> integrations/providers/usai/catalog.json
  -> each artifact in integrations/providers/usai/refresh-registry.json
       (today: the neutral snapshot in the USAi provider kit)
  -> person reviews git diff, commits, opens a pull request
  -> a kit release ships the snapshot
  -> acq projects it read-only into a sandbox
  -> a harness kit (for example OpenCode) renders its own native config
```

Everything left of "a kit release" is provider-neutral. Nothing in the refresh
writes or reads a harness-native file.

## 2. Who owns what

- **Provider kits publish neutral facts.** That means model ids, limits, prices,
  advisory role defaults, and verified capability values. They never publish
  harness configuration.
- **Harness kits own native configuration.** The OpenCode kit is the only writer
  of OpenCode configuration. It translates neutral fields into its own format.
- **Guest state is never an authority.** A file a sandbox user can write is not
  trusted as a source of model facts. The host projects the snapshot read-only
  (see
  [isolation ADR 0004](../isolation/docs/decisions/0004-neutral-model-provider-discovery.md)).
- **A person decides, a tool proposes.** The refresh changes files in your
  working tree. It never commits, pushes, or opens a pull request.

## 3. Run a refresh

You need a maintainer host, Node 22, and a USAi key.

1. Put the key in your environment from your approved secret store. Do not type
   it on a command line, do not put it in a file in the repository, and do not
   paste it into an issue or pull request. The refresh reads it from the
   environment only and never prints it.
2. Check what would change, without writing anything:

   ```bash
   make refresh-usai-catalog-check
   ```

3. If it reports drift, write the new files:

   ```bash
   make refresh-usai-catalog
   ```

4. Review the result (next section), then commit and open a normal pull request.

The command exits `0` when nothing differs, `1` when it finds drift in check
mode, and `2` when it cannot run. A live pull is refused when it detects CI, and
the repository stores no USAi key for CI.

To work without the network or a key, regenerate from a saved pull:

```bash
node integrations/providers/usai/scripts/refresh.mjs --from integrations/providers/usai/tests/fixtures/refresh --check
```

## 4. Review the diff

```bash
git diff --stat
```

Check these things before you commit:

- **Models added or removed.** Is each change expected? A removed model may
  break a role default (see below).
- **Role defaults (`recommendations`).** The refresh carries them forward and
  never picks new ones. If a recommended model left the feed, the refresh fails
  and names the role and the id. Nothing is written. Choose a replacement,
  edit `recommendations` in `catalog.json` by hand, and run again.
- **Verified capability values** (`reasoning`, `inputModalities`). These are
  carried forward by model id. If a model leaves the feed, its values go with it,
  and the check reports that. To change one, re-verify it and edit the file with
  its evidence. The refresh never edits one.
- **The snapshot.** It must change only when the catalog changes. If it changes
  alone, stop and find out why.
- **Tests that depend on a model set.** Counts are derived, not hard-coded, but a
  test that names a specific model fails when that model leaves. Fix the test
  only after you confirm the removal is real.

Then run the checks the pull request needs:

```bash
make test-kits
make validate-provider-input-contract
make validate
```

## 5. Read a drift issue

A weekly workflow, described in ADR 0004, runs an offline check and opens or
updates one issue titled "Provider catalog drift report" with the label
`catalog-drift`. It never closes the issue, and it never commits anything.

Read the report from the top:

- **Offline check: PASS, DRIFT or FAILED.** PASS means the committed tooling
  reproduces the committed test artifacts, and the shipped snapshot matches the
  shipped catalog. DRIFT means one of those comparisons failed. The lines below
  name the step and the artifact. FAILED means the check itself could not run.
- **Live comparison: BLOCKED or FAILED.** BLOCKED means the live feed was not
  compared, because no key is stored for CI. BLOCKED is not a pass. It is a
  reminder that a person has to run the live check. FAILED means a live fetch was
  tried and did not work; it says nothing about drift.

What to do: run the live check from section 3. If it shows real drift, refresh
and open a pull request. Then close the issue yourself.

## 6. Add an artifact to the registry

Use this when another file should be regenerated from `catalog.json`. The file
must be neutral. It must not name a harness.

1. Write a generator: a Node script that reads the catalog file and writes the
   artifact. It must be a pure file-to-file transform, with no network, no
   credential, and no harness-native output. The existing example is
   `integrations/isolation/acq-kits/usai-provider/scripts/normalize-catalog.mjs`.
2. Add an entry to `integrations/providers/usai/refresh-registry.json`: an `id`,
   `kind: "derived"`, the repository-relative `path` of the artifact, and a
   `generator` with the script path and its arguments, using the `{catalog}` and
   `{out}` placeholders.
3. Add a fixture copy of the artifact under
   `integrations/providers/usai/tests/fixtures/refresh/artifacts/`, and register
   its file name for the new `id` in `FIXTURE_ARTIFACTS` in
   `integrations/providers/usai/scripts/offline-check.mjs`. Without this the
   weekly check stops with a message that names the missing id.
4. Add a test next to `integrations/providers/usai/tests/refresh.test.mjs`
   that regenerates the artifact from the fixture feeds and compares bytes.
5. Run the focused tests:

   ```bash
   make test-kits
   ```

Use a second provider the same way. Today the refresh tooling lives under
`integrations/providers/usai/`. A second provider would get its own directory
with its own catalog, schema, builder and registry, and it would publish the
`acq-neutral-model-catalog/v1` snapshot that
`make validate-provider-input-contract` checks. Do that as a design change with
its own record, not as a quiet copy.

## 7. Add a harness consumer

A harness kit reads the neutral snapshot and writes its own configuration.

- Read `snapshot.json` from the projected provider directory
  (`models/providers/<providerId>/`). Treat it as read-only input.
- Translate neutral fields in your own kit. For example, the OpenCode kit turns
  `inputModalities` into its own `modalities.input` and rejects values outside a
  fixed list.
- Treat a missing field as unknown. Do not guess a value from a model name.
- Do not import anything from `integrations/providers/usai/emitters/`. Those
  files are legacy and are not part of the refresh.
- Add a test in your kit that renders from a fixture snapshot.

## 8. Known follow-up steps outside the registry

These artifacts depend on the catalog but are not regenerated by the refresh.
After a refresh that changes models, do them by hand.

1. **Prime Agent models file**
   (`integrations/isolation/acq-kits/prime-agent/files/home/prime-agent-config/models.json`).
   It is produced by the legacy emitter
   `integrations/providers/usai/emitters/prime-agent.mjs`, called manually. Until
   you regenerate it, `tests/models-json-regen.test.mjs` fails. Who owns this
   file is a separate decision.
2. **Curated capability evidence.** New or changed `reasoning` and
   `inputModalities` values need per-model evidence in the OpenCode kit's
   capability evidence folder, as ADR 0006 in the isolation docs requires.
3. **Shipping.** The snapshot reaches sandboxes only through a kit release.
   Merging the pull request does not update running sandboxes.

## Safety notes

- Never put a key, token or internal hostname in the catalog, an issue, or a
  pull request. `gateway.apiKeyEnv` holds a variable name, not a value.
- Treat feed content as untrusted data. The refresh validates it against the
  catalog schema before it writes anything.
- AI-assisted changes to these files need human review before merge.

> **Control Mapping:** CM-3 (Configuration Change Control), SA-11 (Developer
> Testing), CA-7 (Continuous Monitoring), SR-3 (Supply Chain Controls)
