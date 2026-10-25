# Synthetic-image validation procedure (live, not yet run)

**Status:** prepared, **not executed**. No sandbox was created and no model
request was made while writing this. Until the steps below are run and their
observed output is recorded, nothing in this repository claims that image
recognition works or is fixed.

## Purpose

Establish, per USAi model, whether the gateway actually accepts and uses an
image, so that `inputModalities` values are committed from observation rather
than from upstream (models.dev) data or model names. See
`../../../docs/decisions/0006-neutral-model-capability-metadata.md`.

## Preconditions

- A sandbox created from the release candidate bundle (kit pins updated by the
  release process, not by hand).
- The USAi key present only as the injected environment variable. Never paste
  it into a command, prompt, file, or log; never print the environment.
- Network egress exactly as the kits already allow-list; TLS verification
  unchanged.
- Human approval to spend a handful of requests per model.

## What unset means

The treatment of a model with **no** `modalities` is version-dependent:

- OpenCode 2.0.30 (the kit's pinned binary; observed in the binary and by live
  run): treated as accepting `["text", "image"]`. A prior live run with no
  `modalities` on any model found 20 of 24 USAi models able to read a
  synthetic image (9 exactly, 11 with misread characters; 1 declined on policy
  grounds and 3 were unavailable or unusable), and an explicit `["text"]`
  override made the two retested models refuse it.
- OpenCode 1.x (observed in source, tag v1.18.35,
  `packages/opencode/src/provider/provider.ts`): a config-defined model with no
  `modalities` and no built-in catalog entry resolves to image **false**.
  Not exercised live.

On v2, "unset" is therefore not a control for "no image support"; it already
behaves like the image-capable configuration, so the text-only control must use
an explicit `["text"]`. Explicit `modalities` give version-independent behavior
and are the safe contract for any consumer still on 1.x, but unknown models stay
absent in committed data until verified here.

## The synthetic image

Use an image that cannot be answered from text or from the model id: a
generated PNG (for example 256×256) containing a short random token drawn at
test time, such as six random characters rendered large on a plain
background. Generate it locally with a throwaway script; do not use real
documents, screenshots, or any government data. Record the token out of band,
not in the prompt.

## Steps (per model under test)

1. **Config check.** In the sandbox, confirm the rendered provider block for
   the model (read-only inspection of `~/.config/opencode/opencode.jsonc`):
   record whether `modalities.input` and `reasoning` are present. Do not print
   the `apiKey` line.
2. **Text control.** Send a plain text prompt; expect a normal answer. A
   failure here is an auth/routing problem, not an image problem — stop.
3. **Image probe.** Attach the synthetic image and ask: "Reply with only the
   characters shown in the image." Record the model's reply verbatim.
4. **Classify** the outcome:
   - *Accepted and correct* — reply equals the token.
   - *Accepted, wrong* — reply is fluent but not the token (image ignored or
     hallucinated). Treat as **not** image-capable.
   - *Rejected* — OpenCode or the gateway returns an error or strips the
     attachment. Record the exact message.
5. **Configurations.** Run steps 3–4 with `modalities.input` unset (the
   current committed state; on v2 this already means text and image, on 1.x
   it would mean text only), with
   `["text","image"]` set explicitly, and with `["text"]` set explicitly via
   throwaway local overrides. Unset versus explicit `["text","image"]` should
   match; the explicit `["text"]` run is the control that shows the metadata,
   rather than the gateway, governs OpenCode's behavior.
6. **Negative control.** The explicit `["text"]` run must not return the
   token. A model that returns the token under `["text"]` indicates the
   probe or harness is not honoring the setting; stop and investigate.

## Evidence to record

For each model: model id, OpenCode version, step-1 config facts, the verbatim
replies, the classification, and the date. Keep the evidence table in a
durable, self-contained place: the pull request description or tracking issue
that records the run, with enough detail to be understood on its own (fully
qualified references, no bare issue numbers). Only the resulting
`sources.capabilitiesVerified` record, not the raw transcript, is committed.

## Decision rule

- Commit `inputModalities` including `image` only for models classified
  *Accepted and correct* with explicit `["text","image"]`. Accuracy matters:
  a model that reads the image but misreads the token is *Accepted, wrong* and
  stays absent.
- Models that fail, or were not tested, stay **absent** (unknown).
- When capability values are committed, record the verification in
  `sources.capabilitiesVerified` of the USAi catalog as
  `<YYYY-MM-DD>; opencode <version>` (for example `2026-10-25; opencode
  2.0.30`) so the repository guard test passes honestly. The test requires
  this structure, not any non-empty string.
- Before any `reasoning: true` value is committed, check how the target
  OpenCode version treats it: in OpenCode 1.x, `reasoning: true` on an
  openai-compatible model makes OpenCode derive selectable low/medium/high
  reasoning-effort variants. Confirm that is acceptable (or not wanted) first.
- Generate candidate values with the catalog builder's opt-in
  `--include-capabilities` flag, then keep only the verified ones.

## Stop conditions

Stop and report if: any step would require exposing the credential; an
unexpected host is contacted; responses contain data other than the synthetic
token; or the sandbox cannot be created from the release candidate bundle.
