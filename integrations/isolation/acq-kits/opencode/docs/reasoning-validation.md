# Reasoning capability validation procedure (not feasible; field stays absent)

**Status:** investigated live against OpenCode 2.0.30 and the USAi gateway on
2026-11-04. **Finding: this investigation could not verify `reasoning` for any model,
and found no consumer for which a published value changes anything on the
pinned version.** The recommendation is that the field stay **absent**
(unknown) for every model. The evidence is small (four gateway models in depth, a
handful of runs each, one date), so this is a recommendation from limited
evidence, not a proof. No script and no data accompany this document.

## Purpose

ADR 0006 (`../../../docs/decisions/0006-neutral-model-capability-metadata.md`)
forbids publishing `reasoning: true` or `false` until a separate procedure
checks the **target OpenCode version's** behavior, per model, with a negative
control. This document records that procedure's design, what it found, and why
the decision rule below ends in "do not publish".

## Scope: reasoning only

It covers the neutral `reasoning` boolean and its OpenCode rendering. It says
nothing about image, audio, video or pdf input (see
`synthetic-image-validation.md`), and nothing about selecting an effort or
budget for a request.

## What the investigation found

All facts are from OpenCode 2.0.30 (binary inspection plus live runs) and one
probe session against the gateway. Samples were small (see the limits section).

1. **OpenCode ignores the field.** A provider model with `reasoning: true` or
   `false` makes 2.0.30 log a `WARN` "configuration normalization diagnostic"
   with `kind=unsupported action="omitted unsupported legacy setting"`
   for that path. The binary lists `reasoning` with `release_date`,
   `attachment`, `temperature` and `experimental` as legacy model settings it
   drops. Against a local stand-in gateway, the request body, the emitted
   events and the usage were identical for the field absent, `true` and
   `false`; two runs per setting against the live gateway (three models)
   also showed no difference. The ADR's mapping table (neutral `reasoning` to OpenCode
   `reasoning`) therefore describes a no-op on the pinned version.
2. **Variants do not depend on the field** (tested against the local stand-in
   gateway only). For a config-defined openai-compatible
   model with no field and no declared `variants`, `--model usai/<id>#low`,
   `#medium` and `#high` are accepted and send `reasoning_effort` with that
   value. `#none`, `#minimal`, `#xhigh` and `#max` fail locally with
   "Variant unavailable". The result is the same for `reasoning` absent, `true`
   and `false`. In 2.0.30 publishing `true` was therefore observed to add no
   variants and to change no request body, event or usage figure (cost and
   latency were not measured separately). The 1.x behavior in the
   ADR (variants derived from the field) was not re-tested.
3. **Reasoning events appear only when the server streams them.** With
   `opencode run --format json --thinking`, a `reasoning` event appears when
   the stream carries `reasoning_content` or `reasoning`, regardless of the
   field. The `step_finish` event carries `tokens.reasoning` from the usage
   block when the server reports it.
4. **The USAi gateway exposes no reasoning signal.** For four models
   (`claude-sonnet-5.5`, `gpt-6-astra`, `gemini-3.5-flash`,
   `gpt_5_2_default_v2`), streaming and non-streaming responses carried only
   `content` (and `role`) deltas: no `reasoning_content`, no `reasoning`, no
   `completion_tokens_details.reasoning_tokens`. OpenCode's own usage showed
   `reasoning: 0` in every run that emitted a `step_finish` event (some runs did not).
5. **Hidden thinking is visible only as token accounting, and inconsistently.**
   On a six-step modular-arithmetic task with a random hidden answer (a two-digit
   reply), `claude-sonnet-5.5` billed about 160 to 210 completion tokens and
   `gpt-6-astra` about 80 to 120, against 4 to 5 for a trivial prompt.
   `gemini-3.5-flash` reported 0 to 3 completion tokens but a `total_tokens`
   exceeding `prompt_tokens` by about 1,600 to 2,100, so the thinking appears only
   in the total. `gpt_5_2_default_v2` returned 4 tokens and a wrong answer on
   every run. `llama_4_maverick` showed a visible chain of thought, which is
   not hidden reasoning. Each family accounts for tokens differently, so a
   single numeric rule cannot classify them.
6. **There is no working control.** `reasoning_effort` of `low`, `high` and
   `none`, and `thinking: {type: "disabled"}`, were accepted without error, with no observable change in tokens or
   correctness. `low` and `high` were tried on all four models, `none` and
   `thinking: disabled` on `claude-sonnet-5.5` and `gemini-3.5-flash` only,
   two runs per setting. A control needs a way to switch thinking on or off
   on the target itself. Only `gpt_5_2_default_v2` behaves as a
   non-thinker, and that comes from observation, not from any switch, and it
   says nothing about the other models. Without a working switch, every model
   stays *Indeterminate*, including `gpt_5_2_default_v2`: its short wrong
   answers could equally be a reasoning model with thinking off by default.

## What a published value would mean

| Consumer | `true` | `false` | absent |
|---|---|---|---|
| OpenCode 2.0.30 renderer output | Dropped by OpenCode with a warning in the log | Same | No warning |
| OpenCode request, variants, events, usage | No change observed | No change observed | Baseline |
| OpenCode 1.x | Unverified: may derive low/medium/high variants | Unverified | No variants |
| Quickstart projection and other consumers | Not examined here | Not examined here | Unknown |

On the pinned version a value is inert and was seen to log a warning per model
(`--print-logs`, debug level, local stand-in gateway). `false` has no use that `absent` does not already serve: no consumer
examined here reads "known not to reason", and the evidence for it would be the weakest
(absence of a signal the gateway never sends, which cannot tell "does not
reason" from "reasons but is not reported"). Publishing `true` would be a
claim about a vendor behavior that no check in this path can see, and on 1.x
may (unverified) add variants and change requests, which someone must accept
(the OpenCode kit owner, and the owner of the data change).

## Procedure (for a future run)

Run only if the gateway starts exposing a reasoning signal, a consumer is
found that reads the field, or the gateway or vendor states explicitly that a
model's reasoning capability is unsupported (not merely that a parameter is
rejected). Otherwise stop at the decision rule.

### Preconditions

- Host or sandbox with the pinned OpenCode and the USAi key present only as the
  injected environment variable. Never print, log or store it.
- Each probe uses a throwaway configuration tree (`XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`; the `OPENCODE_CONFIG*`
  variables did not work in earlier probing and were not re-tested here),
  `--standalone` (without it `run` uses the shared background service), an
  empty working directory, all tool permissions denied, and
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`. This investigation confirmed that the XDG
  tree, `--standalone` and the project-config switch work on 2.0.30.
- Approval to spend requests. Plan up to about 45 per model (3 field settings
  times 3 prompts times 5 runs) and ask before going past about 300 in
  total.

### Steps per model

1. **Config check.** Record the model's rendered `reasoning` and `variants` (never
   the `apiKey` line) and the OpenCode version.
2. **Field effect (2.0.30).** Run the same prompt with the field absent, `true`
   and `false`, with `--print-logs`. Record whether the "omitted unsupported
   legacy setting" diagnostic appears, and compare the request-visible
   behavior (variants offered, `reasoning_effort` sent, events, usage). On
   2.0.30 the expected result is no difference.
3. **Observe reasoning at the gateway.** Send a deduction task with a random
   hidden answer drawn per run (for example six chained modular updates), a
   trivial prompt, and the same task with a reasoning off switch if the model has
   a documented one. Record, per run: any reasoning field in the stream,
   `reasoning_tokens` in usage, completion tokens, `total_tokens` minus
   `prompt_tokens`, and whether the answer is correct.
4. **Repeat** at least five times per prompt with fresh random tasks.
5. **Classify** each model. Every class needs evidence about **that model**.
   A result on another model (a positive control, a non-thinker, a switch that
   works elsewhere) shows only that the probe can see a signal; it never
   establishes a value for the target.
   - *Reasons, observed* (supports `true`): on the target, a reasoning field or
     `reasoning_tokens` is present on every run, **and** the target's own
     documented off switch removes or sharply reduces that signal on the same
     task (or a non-thinker control run on the target itself shows none).
     Correctness falling when the switch is off strengthens this but does not
     replace it. A control the gateway merely accepts (HTTP 200, no error, an
     echoed parameter) is not evidence of the capability.
   - *Does not reason, known-unsupported* (supports `false`): only an explicit,
     target-specific statement that the model's reasoning **capability itself**
     is unsupported (the model does not reason or has no reasoning mode):
     the gateway's or vendor's documentation for that model, or an explicit
     response for that model that says so. Capability statement, accepted
     example: documentation that "model X is not a reasoning model". Control
     rejection, **never enough**: an error that a parameter, an effort value
     or an endpoint is unsupported (for example `reasoning.effort` rejected,
     or only `high` accepted, or the reasoning API surface unavailable). That
     shows only which request syntax or control the model's API accepts, and a
     reasoning-capable model can reject any of them while reasoning through
     its supported API. Such a rejection leaves the model *Indeterminate*. An
     OFF/ON run with no difference is also not enough, because a switch the
     gateway ignores looks identical to a model that does not reason. A
     missing signal, failed arithmetic or low token counts are never enough.
   - *Indeterminate*: everything else. In particular: a null or negative
     observation (no signal, wrong answers, small token counts) on a model whose
     own positive control is missing, or was run only on a different model;
     a model that may have thinking disabled by default, suppressed telemetry
     or weak accuracy; and token accounting alone. Indeterminate means the
     field stays **absent** (unknown).

### Controls

- A trivial prompt, to give each model's baseline token count.
- A switch on the **target model** (on or off) that the gateway documents for
  that model and that demonstrably changes the signal. Without one,
  *Reasons, observed* cannot be reached for that model, so `true` cannot be
  published for it. `false` does not come from a control at all: it needs the
  explicit target-specific statement described above.
- A non-thinker on the same task (in the 2026-11-04 session,
  `gpt_5_2_default_v2`) shows only that the probe can tell two models apart.
  It is a calibration, not evidence about any other model, and it cannot move
  another model out of *Indeterminate*.

### Decision rule

- Publish `reasoning: true` only for a model classified *Reasons, observed*
  with its evidence file already written (see below), **and** only after the consumer decision in "What a published value would
  mean" has been made in writing: for the pinned OpenCode version a published
  value must change something a consumer reads, and whoever owns that
  consumer must accept the changes in variants, requests, cost and latency.
- Publish `reasoning: false` only for a model classified *Does not reason,
  known-unsupported* from a target-specific capability statement **and** only
  if a consumer is shown to need the distinction from absent. A null
  observation, or a rejected parameter, value or endpoint, never yields
  `false`.
- Everything else, including every *Indeterminate* model, stays **absent**. As
  of the 2026-11-04 session this is every model tested, and every untested model.

### Evidence file

One file per run, at `capability-evidence/<YYYY-MM-DD>-opencode-<version>.md`
(the convention the ADR defines; no evidence file is committed by this
document). One table row per model, field and value, with:
model id, OpenCode version, date, field effect result (step 2), sample count,
per-run signals (step 3), control results, classification, and the value
published or "absent". Verbatim results only; no credentials, no raw
transcripts. `sources.capabilitiesVerified` stays a release reminder and does
not substantiate any value.

### Stop conditions

Stop and report if: the credential would be exposed; a host other than the
gateway host is contacted; a reply contains credential-shaped data; the same
control fails three times in a row; the budget is reached; or the OpenCode
version differs from the one under test.

## What this cannot show

- That a model "really reasons" internally. Token accounting and the presence of
  a stream field are observations about the gateway's reporting, not about
  the model. Reporting telemetry does not establish internal reasoning, and
  its absence does not establish that a model does not reason.
- That a model does not reason. A reasoning-capable model may have thinking off
  by default, suppressed telemetry, wrong answers, or reject a reasoning
  parameter, value or endpoint. Only a target-specific statement that the
  model's reasoning capability is unsupported can move a model to `false`; a
  positive control on another model, or a control rejection, cannot.
- Behavior of any OpenCode version other than the one run, including 1.x.
- Behavior of consumers not examined here, notably the Quickstart projection.
- Anything about audio, video, pdf or image input.
- Repeatability beyond the small samples in the session: single-digit runs per
  model, one date, one gateway state.

## Recommendation

Keep `reasoning` absent for all models. Do not add a script. The owner
accepted this on 2026-11-04, and ADR 0006 now carries an Amendment recording
that OpenCode 2.0.30 omits the field, so its mapping table is not read as
behavior-bearing. Revisit the field's purpose before any value is proposed.
