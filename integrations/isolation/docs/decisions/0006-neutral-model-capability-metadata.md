---
title: "Carry reasoning and input-modality capability metadata in the neutral model catalog"
status: "proposed"
date: "2026-10-25"
decision_makers: ["Bret Mogilefsky", "OpenCode Agent"]
category: "isolation-kit-schema"
impact_level: "moderate"
nist_controls: ["SI-10", "CM-3", "SA-8"]
ato_relevance: "no"
risk_treatment: "mitigate"
---

# ADR 0006 (isolation) — Carry reasoning and input-modality capability metadata in the neutral model catalog

> Area-scoped ADR for `integrations/isolation/`. Extends ADR 0004's neutral
> catalog (`acq-neutral-model-catalog/v1`) with two optional per-model
> capability fields. ADR 0004 reserves changes to the neutral catalog field set
> for human/CODEOWNERS review, so this record is **proposed**, not accepted.

## Context and Problem Statement

The USAi source feed (models.dev enrichment) describes, per model, whether it
supports reasoning and which input modalities it accepts. Before this change
every stage between that source and the OpenCode config dropped those values:
the catalog builder kept limits and cost only, the USAi catalog schema marked
both fields "not populated yet", the neutral catalog schema forbade them
(`additionalProperties: false`), the provider normalizer narrowed them away,
and the OpenCode renderer emitted neither.

How a config-defined model without `modalities` is treated depends on the
OpenCode line, and that difference is the motivation for this record.

- **OpenCode 1.x** (observed in source, tag v1.18.35,
  `packages/opencode/src/provider/provider.ts`, config-model construction):
  a model's `input.image` is computed as
  `model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false`.
  A gateway-defined model with no `modalities` and no matching built-in
  catalog entry therefore resolves to image **false** (text true). On 1.x,
  absent metadata disables images. The acq OpenCode kit previously fell back
  to `npm install -g opencode-ai`, which resolves to this legacy line, so a
  user on 1.x would plausibly have seen exactly the reported symptom. This is
  an inference from source reading; it was not reproduced on 1.x.
- **OpenCode 2.0.30** (the kit's pinned binary; observed in the binary and by
  a live test): an unlisted model defaults to input `["text", "image"]`. A
  live test through the kit's rendered config (no `modalities` on any model)
  sent a synthetic image to 24 USAi models; 20 read it (9 exactly, 11 with
  misread characters), 1 declined on policy grounds, and 3 were unavailable or
  unusable in OpenCode for unrelated reasons.
  With an explicit `modalities.input: ["text"]` override, the two models
  retested (a Claude and a GPT model) refused the image.

Conclusions:

- Explicit `modalities` make image handling **version-independent**. They are
  the safe contract for any consumer still on 1.x, where absence disables
  images. On the pinned 2.0.30 they change nothing for models that already
  accept images.
- The harm risk is wrong values: rendering `["text"]` wrongly (for example
  from a mis-mapped upstream entry) disables images the gateway accepts, on
  every OpenCode line. That is why **unknown must stay absent** in committed
  data until verified, and why the renderer never defaults a value. This
  record makes the data expressible; it does not commit any values.

Image-reading accuracy also varied by model family on a hard synthetic task
(several models misread characters while still reading the image), which a user
may perceive as "not recognizing images". Metadata cannot address accuracy.
Live samples were single runs on one synthetic image on 2.0.30 only; PDFs,
photos, other harnesses, repeat runs and OpenCode 1.x were not tested.

## Decision Drivers

- Lossless, validated source → neutral → harness mapping (SI-10: validate
  external input; allowlists over denylists).
- **Unknown must stay distinct from known-false and known-text-only.** A
  consumer that cannot tell "never described" from "described as unsupported"
  will either hide working capabilities or advertise broken ones.
- No inference from model ids or names, and no trust in upstream-vendor data
  where the gateway may differ: models.dev describes the upstream provider's
  deployment, not necessarily what the USAi gateway forwards. Copying it in the
  catalog builder is therefore opt-in (`--include-capabilities`), off by
  default. The flag matches each USAi id to a models.dev entry with the
  builder's precision-guarded id matching, so "never inferred from id or name"
  applies to the renderer and normalizer; the flag's output is unverified until
  the live synthetic-image run.
- Declaring a capability must not silently turn on request-time behavior
  (reasoning effort, thinking budgets, variants). The renderer emits none of
  these; note that OpenCode itself may derive selectable variants from
  `reasoning: true` (see the OpenCode kit README).
- Harness-neutral vocabulary; harness syntax stays inside the harness kit
  (ADR 0004, Layer 3).
- Deployability: `additionalProperties: false` on the neutral model means a
  validator that predates new fields rejects them.

## Considered Options

1. **Add optional `reasoning` (boolean) and `inputModalities` (closed-enum
   array) to `acq-neutral-model-catalog/v1`, absent = unknown.** (chosen)
2. **Introduce `acq-neutral-model-catalog/v2`.** The OpenCode renderer rejects
   any `schemaVersion` it does not recognise, so every v2 snapshot would
   disable provider rendering for kits not yet upgraded. A hard break for an
   additive, optional change.
3. **Put harness-native syntax (OpenCode `modalities`) in the provider's
   snapshot.** Violates the Layer 3 boundary: provider inputs must not carry
   harness-specific options, and the snapshot lives on an agent-writable path.
4. **Infer capabilities in the renderer from model ids or names.** Rejected:
   unverifiable and wrong for renamed or gateway-specific deployments.

## Decision Outcome

Chosen option: **1**, because it is the smallest change that makes the data
expressible while keeping the existing fail-closed schema-version check, and it
leaves the harness-specific translation inside the OpenCode kit.

### Contract

- `reasoning`: optional boolean. `true` known-supported, `false`
  known-unsupported, **absent unknown**.
- `inputModalities`: optional non-empty, duplicate-free array drawn from the
  closed allowlist `text`, `image`, `audio`, `video`, `pdf`. `["text"]` is
  known text-only; **absent is unknown**. Producers emit canonical order.
- Producers MUST NOT infer either field from ids or names, and MUST NOT copy
  upstream-vendor values for a model whose gateway behavior is unverified.
  The one sanctioned exception is the USAi catalog builder's explicit
  `--include-capabilities` flag, which is off by default, labels its output
  `sources.capabilities` as unverified, and whose output must not be committed
  until the synthetic-image procedure has verified it.
- A capability field is a statement of fact only. It does not select a
  reasoning effort, budget, variant, or any other request setting.
- Both the USAi catalog schema and the neutral schema carry the same enum; a
  test asserts they cannot diverge.

### OpenCode mapping (kit-owned)

| Neutral | OpenCode model config |
|---|---|
| `reasoning` | `reasoning` (boolean) |
| `inputModalities` | `modalities.input` |

Observed against the kit's pinned OpenCode (v2.0.30) on a throwaway config:
a value outside the allowlist, or a non-boolean `reasoning`, causes OpenCode
to drop the **entire provider block**, not just the model. The renderer
therefore validates both fields and fails closed before writing. A model with
no `modalities` is treated by the 2.0.30 binary as accepting
`["text", "image"]` but by OpenCode 1.x source (tag v1.18.35) as text-only,
and an explicit `modalities.input: ["text"]` disables image handling on both
(see Context). The OpenCode V2 documentation site was unreachable from the
implementation sandbox, so the config-field syntax rests on the pinned
binary's observed behavior and MUST be re-confirmed against the V2
configuration guide during review. The effect of `reasoning` on request
behavior is **not** established by this record.

### Versioning and compatibility

The change is additive but not forward compatible: the neutral model definition
forbids unknown properties, so a validator or consumer built from a Patterns
release that predates these fields rejects any snapshot that carries them.
The renderer, by contrast, ignores unknown model properties, so an old renderer
with a new snapshot degrades to "capabilities absent" rather than failing.

Host-side validation is invoked with the schema directory of the **same
pinned Patterns release** that supplies the kit (see
`../provider-input-contract.md`), so within one pin the schema, normalizer,
snapshot and renderer move together. Deployability therefore depends on
rollout order, not on negotiation machinery:

1. Merge and release Patterns containing the schema, normalizer, renderer and
   tests, with the **committed snapshot still capability-free**. This is safe
   for every consumer, old or new.
2. Consumers that validate with a vendored or separately pinned copy of the
   neutral schema (including Quickstart's provider-input fixtures and any
   Prime Agent consumer, both outside this change) must adopt the new schema
   before step 3.
3. Only then commit capability values into the USAi snapshot, after the
   gateway-side synthetic-image validation has recorded which models
   actually accept images.

No `schemaVersion` bump is made. If a later change is *not* additive (renames,
required fields, changed meaning of absence) it needs a new version and a new
record.

## Consequences

### Positive

- Capability data can flow end to end with unknown/false/text-only preserved.
- Invalid capability data is rejected at the earliest stage that sees it.
- No behavior change for any existing snapshot: the committed USAi catalog and
  snapshot are unchanged by this record.

### Negative

- Strict `additionalProperties: false` makes rollout order matter (above).
- models.dev is the only automated source; it can be wrong for the gateway.
  The builder therefore does not copy it unless `--include-capabilities` is
  passed, labels that output in `sources.capabilities`, and a guard test
  refuses capability values in any committed catalog or snapshot unless
  `sources.capabilitiesVerified` holds a structured record
  (`<date>; opencode <version>`). A malformed upstream entry is treated as
  unknown with a warning; malformed data in this repository's own committed
  inputs fails the build.
- The legacy `emitters/opencode.mjs` GENERATED-block emitter does not emit the
  new fields. It exists only as a byte-exact contract check for the retired
  config and is intentionally left as is.

### Compliance Consequences

- SI-10: allowlisted, type-checked input at the builder, normalizer, schema and
  renderer.
- CM-3: contract change recorded here; human review required before
  `accepted`.
- AI-generated change: requires human and independent adversarial review
  before any push.

## Links

- ADR 0004 (isolation) — neutral model-provider discovery and the neutral
  catalog schema.
- `../provider-input-contract.md` — host validation invocation and the
  pinned-release rule.
- `../../acq-kits/opencode/docs/synthetic-image-validation.md` — the live
  procedure that must precede any capability value being committed.
- Tracking: GSA-TTS/agentic-coding-patterns#366 within
  GSA-TTS/agentic-coding-patterns#357.
