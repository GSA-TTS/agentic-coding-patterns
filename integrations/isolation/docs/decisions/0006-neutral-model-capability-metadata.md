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
  data until per-model evidence exists, and why the renderer never defaults a value. This
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
  per-model, per-field evidence exists (see
  [Evidence required before a value is published](#evidence-required-before-a-value-is-published)).
- Declaring a capability must not silently turn on request-time behavior
  (reasoning effort, thinking budgets, variants). The renderer emits none of
  these. OpenCode 1.x is believed to derive selectable variants from
  `reasoning: true` (see the OpenCode kit README; not re-tested), but on the
  pinned 2.0.30 the field is dropped (see [Amendment](#amendment-2026-11-04-reasoning-stays-absent)).
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
   harness-specific options, and the provider-neutral snapshot would then be
   usable by only one harness. The snapshot's trust properties are not the
   argument: under ADR 0004 (Layer 1 and Security model) it is
   host-materialized and read-only to the guest.
   Only the OpenCode config the renderer writes in the guest is guest-writable,
   and it is not an authority for model state.
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
  until each value it carries has the evidence described under
  [Evidence required before a value is published](#evidence-required-before-a-value-is-published).
  Values without that evidence stay absent.
- A present `inputModalities` array asserts the listed modalities only. A
  modality that was not probed is not asserted, but the OpenCode mapping treats
  an unlisted modality as disabled, so publishing a partial list narrows what
  OpenCode will send. The review must accept that narrowing for each model, or
  the field stays absent for it.
- A capability field is a statement of fact only. It does not select a
  reasoning effort, budget, variant, or any other request setting.
- Both the USAi catalog schema and the neutral schema carry the same enum; a
  test asserts they cannot diverge.

### Evidence required before a value is published

Evidence is specific to a model, a field, and (for `inputModalities`) a
modality. Evidence for one does not carry over to another, and a value without
its own evidence stays **absent** (unknown). The synthetic-image procedure
substantiates image input only.

| Value | Evidence required before it is published |
|---|---|
| `inputModalities` includes `image` | The synthetic-image procedure for that model: an exact-token read, repeated over several independently generated images, and a text-only control (explicit `["text"]`), repeated on the same images, that never returns the token. A single run is not enough. |
| `inputModalities` includes `audio`, `video`, or `pdf` | Its own probe, with a known-content input of that type that cannot be answered from text or the model id, repeated samples, and a text-only control. An image probe says nothing about these. No such probe exists yet, so these values are not published. |
| `inputModalities: ["text"]` (known text-only) | A negative result is also a claim. Record the failed attempts and the exact rejection or error, so a transient outage is not published as "unsupported". |
| `reasoning: true` or `false` | No procedure can currently substantiate it on OpenCode 2.0.30 or the USAi gateway: OpenCode drops the field, and the gateway exposes no reasoning signal or working control. See [`reasoning-validation.md`](../../acq-kits/opencode/docs/reasoning-validation.md). **Decision rule: no value is published and the field stays absent for every model.** Revisit only if a future OpenCode or gateway exposes an observable control, meaning a consumer that reads the field and changes behavior with it, or a gateway signal (a reasoning stream field or `reasoning_tokens`) plus a documented switch that demonstrably changes it **on the target model** (for `true`), or an explicit gateway or vendor statement for the target model (for `false`). A null observation, or a control that works only on another model, leaves the model indeterminate and the field absent. An image probe says nothing about this. |

### Evidence record

`sources.capabilitiesVerified` is a catalog-wide string shaped like
`<date>; opencode <version>`. It is a **release reminder**, not evidence: it
cannot show which model, field, or modality was verified. The guard test only
checks its shape, so a well-formed string proves nothing about the data.

The data-change review is therefore required to find, for every populated
`reasoning` and `inputModalities` value, a traceable per-model, per-field record:

- The data pull request description states each model id, field, and value, with
  the procedure used, the sample count, the control result, the OpenCode version,
  and the date.
- A durable evidence file is committed in the same pull request at
  `integrations/isolation/acq-kits/opencode/docs/capability-evidence/<YYYY-MM-DD>-opencode-<version>.md`.
  It holds one table row per model, field, and value with the same facts. It
  holds verbatim results, not credentials or raw transcripts.
- The date in `sources.capabilitiesVerified` matches the date of the most recent
  evidence file, and every populated value has a row in some evidence file. A
  value with no row is removed in review.

This is a review requirement. The guard test does not parse the evidence file,
because that would add an unvalidated file format; a later change may validate
it once the format has been used.

### OpenCode mapping (kit-owned)

| Neutral | OpenCode model config |
|---|---|
| `reasoning` | `reasoning` (boolean). **Not applied on 2.0.30** (see Amendment) |
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
behavior is **not** established by this record; the Amendment below records
what was later observed on 2.0.30.

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
3. Only then commit capability values into the USAi snapshot, and only those
   values that have per-model, per-field evidence under the section above.
   Anything else stays absent.

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
  passed, and labels that output in `sources.capabilities`. A guard test refuses
  capability values in any committed catalog or snapshot unless
  `sources.capabilitiesVerified` has the shape `<date>; opencode <version>`.
  That string is a catalog-wide release reminder, not evidence of any
  per-model, per-field verification. Evidence is required in the data-change
  review (see [Evidence record](#evidence-record)). A malformed upstream entry is
  treated as unknown with a warning; malformed data in this repository's own
  committed inputs fails the build.
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

## Amendment (2026-11-04): `reasoning` stays absent

Status of the record is unchanged. This section adds to it; the text above is
kept as written.

### Decision

The owner of the epic accepted keeping `reasoning` **absent for every model**.
No `reasoning: true` or `false` value is published, and none will be unless a
future OpenCode or gateway exposes an observable control, or the gateway or
vendor states explicitly that a given model does not support reasoning (see the
evidence table).

### Evidence

Live probe on 2026-11-04 against OpenCode 2.0.30 (the pinned binary) and the
USAi gateway; full method and limits are in
[`reasoning-validation.md`](../../acq-kits/opencode/docs/reasoning-validation.md).

- A provider model with `reasoning: true` or `false` makes 2.0.30 log a
  `WARN` configuration normalization diagnostic (`kind=unsupported`) with the
  text `omitted unsupported legacy setting`. The OpenCode config field is
  **dropped**. The binary lists it with other legacy model settings it omits.
- Against a local stand-in gateway, request bodies, events and usage were
  identical for the field absent, `true` and `false`. Two runs per setting
  against the live gateway (three models) showed no difference either.
- Variants (`model#low`, `#medium`, `#high`, which send `reasoning_effort`) work
  with the field absent, so they do not depend on it. This was tested against
  the stand-in gateway only.
- The gateway returned no reasoning stream field and no `reasoning_tokens` for
  the four models examined, and the effort and disable switches tried had no
  observable effect, so there is no usable positive or negative control on
  any model. Every model is therefore *Indeterminate*: a null observation
  (no signal, wrong answers, low token counts) is not evidence that a model
  does not reason, and a control working on another model cannot establish a
  value for the target. `true` needs target-specific positive evidence (a signal plus that
  model's own switch changing it). `false` (known-unsupported) needs an explicit
  target-specific statement from the gateway or vendor that the model does
  not support reasoning; an OFF/ON run with no difference is not enough,
  because an ignored switch looks the same. The
  gateway's reporting telemetry does not establish internal reasoning.

The samples are small (four gateway models in depth, single-digit runs, one
date). This is evidence for the decision, not proof.

### Effect on the OpenCode mapping

On the pinned 2.0.30 the `reasoning` row of the mapping table is a no-op:
OpenCode omits the field, and a published value would claim something that no
check on this path can observe.

The renderer
(`integrations/isolation/acq-kits/opencode/files/home/opencode-config/render-provider-config.mjs`)
**still emits** `reasoning` into the model block when the neutral model carries
it, after validating that it is a boolean, and its tests assert that emission.
With the committed catalog and snapshots carrying no `reasoning`, nothing is
emitted today. If a value were supplied, emitting it is harmless on 2.0.30
beyond one logged warning per model (observed with `--print-logs` against the
stand-in gateway). What OpenCode 1.x does with it (possibly deriving variants,
per the kit README) was **not tested**.

### Consequences

- Nothing changes in the catalog or the snapshots: neither carries `reasoning`.
- The `reasoning` field and its type stay in the neutral and USAi schemas as
  optional. Absent means unknown.
- Consumers MUST treat absent `reasoning` as unknown, not as "does not reason".
- Unsuccessful or unobserved reasoning (no signal, failed task, or a positive
  control that exists only on another model) stays *Indeterminate* and the
  field stays absent. `false` is never concluded from a null observation.
- Producers should not supply `reasoning` for OpenCode 2.0.30 consumers unless
  the behavior is re-verified. The renderer does not enforce this today; it
  would emit a supplied value.
- This amendment is documentation only. The renderer and its tests were not
  changed.

### Unresolved

- OpenCode 1.x behavior with the field (variants, requests) is not tested.
- Cost and latency effects were not measured.
- Models other than those examined were not probed.
- Consumers outside the OpenCode kit (for example the Quickstart projection)
  were not examined.

## Links

- ADR 0004 (isolation) — neutral model-provider discovery and the neutral
  catalog schema.
- `../provider-input-contract.md` — host validation invocation and the
  pinned-release rule.
- `../../acq-kits/opencode/docs/synthetic-image-validation.md` — the live
  procedure for image input only. Other fields and modalities need their own
  evidence.
- `../../acq-kits/opencode/docs/reasoning-validation.md` — the reasoning
  investigation behind the Amendment.
- Tracking: GSA-TTS/agentic-coding-patterns#366 within
  GSA-TTS/agentic-coding-patterns#357.
