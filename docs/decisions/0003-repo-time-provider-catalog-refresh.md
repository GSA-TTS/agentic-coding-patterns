---
title: "Refresh the USAi provider catalog at repository time, through one command"
status: "proposed"
date: "2026-11-04"
decision_makers: ["Patterns maintainers", "OpenCode Agent"]
category: "provider-catalog"
impact_level: "low"
---

# ADR 0003 - Refresh the USAi Provider Catalog at Repository Time, Through One Command

## Context and Problem Statement

The USAi model list changes. The repository keeps a provider-neutral catalog
(`integrations/providers/usai/catalog.json`) and a metadata-only snapshot derived
from it (`integrations/isolation/acq-kits/usai-provider/files/home/usai-config/model-catalog-snapshot.json`).
Both are committed and ship with a kit release.

Before this decision there was no single way to refresh them:

- The catalog builder could be run by hand against live feeds, but a run with no
  arguments silently rebuilt the catalog from a frozen copy of an old OpenCode
  config, and a rebuild dropped the curated `recommendations` block.
- The snapshot was derived by a second tool that had to be run separately with
  the right paths. Nothing checked that it still matched the catalog after a
  catalog change, other than a test that failed late.
- Nothing reported drift between the committed artifacts and the live feeds.

The earlier provider-owned sync script, which also fetched live data and wrote
OpenCode configuration, no longer exists. The OpenCode kit now renders its own
native configuration from provider-neutral inputs. That leaves one open question
for the provider side: how are the neutral artifacts refreshed, reviewed and
checked for drift?

## Decision

Refresh the neutral artifacts at repository time, by a maintainer, through one
documented command, and never produce or read harness-native configuration.

1. **One command.** `make refresh-usai-catalog` runs
   `integrations/providers/usai/scripts/refresh.mjs`. It pulls the USAi model
   list and the models.dev enrichment once, builds `catalog.json` with the
   existing builder logic, and then regenerates every registered derived
   artifact from that catalog. `make refresh-usai-catalog-check` does the same
   into a temporary directory and reports per-artifact, per-model drift. It
   changes no tracked file and exits non-zero on drift. (A live check still
   saves its pull under the git-ignored `tmp/usai-source/`.)
2. **A registry of neutral artifacts.** `integrations/providers/usai/refresh-registry.json`
   lists the catalog and each derived artifact with the file-to-file generator
   that produces it. Today that is the neutral snapshot, produced by the
   existing normalizer run as a subprocess with a minimal environment, so no
   code crosses kit boundaries and no credential reaches a generator. A new
   provider-neutral artifact is added by adding an entry, not by editing the
   refresh script.
3. **Offline by default for tests and review.** `--from <dir>` regenerates from a
   saved pull with no network and no credential. Tests and CI use only committed
   fixtures.
4. **Live pull is a maintainer action.** It reads `USAI_API_KEY` from the process
   environment only, never from a flag, never prints it, uses the bounded
   https-only loader, and is refused when it detects CI. No credential is stored
   for CI.
5. **Nothing is committed automatically.** A write run changes files in the
   working tree for a person to review and commit. Generation happens in a
   staging directory first, so a failure writes nothing.
6. **No bootstrap mode.** The builder has no default source and no longer seeds
   the catalog from an OpenCode config. A run without a model source refuses and
   points at the refresh command.
7. **Curated data is carried forward, not derived.** Role defaults
   (`recommendations`) and model order come from the existing catalog. If a
   recommended model has left the feed, the refresh fails and names each role; a
   person chooses the replacement.
   Verified `reasoning` and `inputModalities` values are curated in the same way:
   they are carried forward by model id (while the catalog has a valid
   `sources.capabilitiesVerified`), dropped only when their model leaves the
   feed (reported as drift), and never overwritten by the unverified
   `--include-capabilities` copy, which is refused while a verified value is
   carried. `sources.capabilitiesVerified` is carried, never advanced. Details:
   `integrations/providers/usai/README.md`.

## Scope

This decision covers only repository-time authoring of provider-neutral
artifacts. It is **not a runtime component**: nothing here runs in a sandbox,
caches model data, aggregates providers, or holds state a guest can write.

Runtime model refresh, caching and multi-provider aggregation are out of scope
for this record and are governed by ADR 0002 (the proposed Patterns decision
that defers them, which is a different record from the isolation network egress
ADR of the same number). Repository-time authoring refresh is out of scope for
ADR 0002: it needs no host lifecycle, no guest-writable file and no scheduler of
its own. Whatever ADR 0002 decides, this command keeps working.

It also does not change the accepted isolation ADR 0004, which describes the
provider facts, the neutral catalog schema, the normalizer contract and the
release-time snapshot. This decision uses them as written: the snapshot remains
a vendored, host-validated, read-only input, and the normalizer remains a pure
file-to-file transform.

Harness-native configuration is out of scope in both directions. The registry
holds neutral artifacts only, the refresh script imports no emitter and writes no
harness file, and the OpenCode kit remains the sole writer of OpenCode
configuration.

## Consequences

**Positive:**

- One reviewable path replaces two tools that had to be run in the right order.
- Drift between the catalog, its derived artifacts and the feeds has one check
  that names the artifact and the model.
- A refresh can no longer erase the curated role defaults or silently replace the
  catalog from a stale copy.
- Adding a provider-neutral artifact is a registry entry plus a fixture test.

**Negative / trade-offs:**

- A live refresh needs a maintainer host with a USAi key. There is no unattended
  live check, by design, because no key is stored for CI.
- The committed Prime Agent `models.json` is still derived from `catalog.json` by
  a provider-owned emitter and is not in the registry. After a refresh that
  changes models, its existing drift test fails until someone regenerates it.
  That artifact's ownership is a separate decision.
- Model counts are no longer hard-coded in tests, so a test that depends on a
  specific model set must say so.

**Neutral:**

- `catalog.json` `sources` now records the pulled URLs, or an `offline:` label for
  a saved pull, instead of a path to the old OpenCode config.

## Alternatives Considered

1. **Keep two tools and document the order.** Rejected: it leaves drift between
   the catalog and its derived artifacts possible and unchecked.
2. **Refresh at runtime in the sandbox.** Rejected here and deferred to ADR 0002,
   which carries the trust-boundary questions this record deliberately avoids.
3. **Scheduled workflow with a stored key.** Rejected: no USAi key is stored in
   this repository's Actions secrets. A later offline-only drift workflow can
   run the check against committed fixtures and report that the live comparison
   is blocked.
4. **Import the normalizer into the refresh script.** Rejected: running it as a
   subprocess keeps kit boundaries intact and lets the registry treat every
   derived artifact the same way.

## Implementation

Delivered with this record: `scripts/refresh.mjs`, `refresh-registry.json`, the
Makefile targets, removal of the bootstrap path, and offline tests including
static guards that only the catalog builder fetches over the network and that no
registered artifact or generator names a harness.
