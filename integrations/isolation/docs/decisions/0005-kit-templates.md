---
title: "Ship scope-layer kits as copy-and-rename templates under acq-kits/examples/"
status: "proposed"
date: "2026-09-25"
decision_makers: ["Basilio Bogado"]
category: "repository-structure"
impact_level: "low"
---

# ADR 0005 (isolation) — Ship scope-layer kits as copy-and-rename templates under `acq-kits/examples/`

> Area-scoped ADR for `integrations/isolation/`. Extends ADR 0001 (the neutral
> `hybrid/v1` acq-kits area) with a home for kit *templates*, and records why the
> team and personal scope layers are shipped as templates rather than as kits.

## Context and Problem Statement

Every team adopting `acq` builds the same two things: a **team scope layer**
between the global kits `acq` applies for everyone and each repo's own agent
config, and a **personal layer** each teammate stacks on top. `ACQ_EXTRA_KITS`
already supports both, but until now nothing in this repo said so, stated how
the fields of stacked kits compose, said what belongs in each layer, or gave a
validated starting point. One team has run such a kit in production since June
2026 and re-learned a list of failure modes (whole-file overlays clobbering
shared rc files, binary payloads, create-time installs through the proxy,
secret rotation changing the placeholder, `environment` last-wins shadowing)
that the next team would hit again.

The pattern is documented in [`../scope-layers.md`](../scope-layers.md). This
record covers the two structural decisions that document depends on.

## Decision Drivers

- The `hybrid/v1` vocabulary has **no parameters**. A kit is applied verbatim;
  it cannot carry a placeholder team value.
- A starting point is only useful if CI keeps it valid as the schema evolves.
- Templates must not be mistaken for deployable kits, by humans or by the
  registry cross-check.
- Zero or minimal validator change; no new tooling.

## Considered Options

### A parameterized generic kit vs. templates

1. **Copy-and-rename templates** with one live, harmless value per extension
   point. (chosen)
2. A **generic team kit** in the registry that teams apply as-is and extend
   with a second kit. Rejected: with no parameters, its extension points would
   be empty, so applying it does nothing, and a team still has to author the
   real kit. The value is the pattern plus a skeleton, not a deployable.
3. **Doc only**, linking the reference implementation. Rejected: the reference
   implementation lives in a team repo this repo must not link (internal), and
   nothing would keep a skeleton schema-valid over time.

### Placement

- **(A)** `acq-kits/<name>/` with a `kits.yaml` entry whose parity note says
  TEMPLATE, not applied by acq. No validator change; `prime-agent` already sits
  in the registry as a skeleton, so there is precedent.
- **(B)** `acq-kits/examples/<name>/`, schema- and `files[]`-validated by
  `validate-kits.py` but exempt from the registry cross-check. (chosen)

## Decision

Adopt **templates (option 1)** and **placement (B)**.

- **Templates, not kits.** Each template is a complete, valid `hybrid/v1` mixin
  where every extension point (`caps.network.allow`, `files[]`, `commands[]`,
  `environment`) carries **one live, harmless value** the schema actually
  checks, with a comment saying what to replace. Commented-out YAML is never
  schema-checked, so a template made of comments would rot silently. Names are
  real kebab-case names (`team-kit`); the README says to rename both the
  directory and `name:`.
- **`scripts/verify` asserts the composition, not just liveness.** It creates
  a throwaway sandbox through `acq` (which applies the pinned built-in bundle,
  including `usai-provider`), stacks a generated lower fixture kit and then the
  template via `ACQ_EXTRA_KITS`, and asserts the per-field rules the pattern
  doc states: `environment` last-wins, `files[]` last-wins by path,
  `commands[]` append in order, `caps.network.allow` union. It uses only `acq`
  verbs, so it is identical on every backend. The personal-kit template's
  verify instead stacks it on a team kit and asserts the three-layer stack
  (global and team layers intact, both kits' values coexisting); the per-field
  rules are proven once, by the team template.
- **Placement (B).** `acq-kits/examples/` is a *container of templates*, not a
  kit. `validate-kits.py` skips it in the kit walk, validates each
  `examples/<name>/` with the same per-kit checks (schema, `files[].source`
  resolution, env names, README presence), reports them under an `examples/`
  prefix, and leaves them out of the `kits.yaml` cross-check. A template that
  *is* listed in `kits.yaml` fails validation ("registry lists unknown kit"),
  so the separation is enforced, not advisory. `acq-kits/README.md` gets a
  separate **Templates** section rather than rows in the Available kits table.
- **Backend-neutral, acq-first prose.** Every command in the pattern doc and
  the templates is an `acq` command. No `backend_shortcuts` or `backend_extras`;
  parity is identical on sbx and msb by construction.
- **Defects are dated, not taught.** Where a gotcha is really an `acq`
  limitation (the inline flow-style argv that parses as empty and passes
  `acq kit validate`), the doc marks it "as of acq vX" and describes the
  observable behavior in prose, rather than teaching it as a permanent rule or
  citing a tracker number (per this repo's durable-references rule).
- **What stays out.** The reference team's egress list, its Nix/devenv
  coupling, agent-specific config beyond a single OpenCode example of the
  config-tier mechanism (`OPENCODE_CONFIG` pointing at a team file), any
  workaround specific to its repos, and any internal URL. The reference
  implementation is named, not linked. One deliberate exception to the Nix
  exclusion: the personal-kit template carries a *commented* Nix tool-install
  step, tied to this repo's devenv image and its `NIXPKGS_REV`, as the single
  sanctioned case of a personal tool installed at startup rather than baked
  into the image. It is not live config and no team coupling comes with it.

## Consequences

**Positive**

- Other teams bootstrap a team layer from a validated skeleton instead of
  re-learning the failure modes.
- The composition table is checked against `acq`'s code where `acq` composes
  the kits (msb) and asserted live by `scripts/verify` on both backends, so
  the doc and the behavior cannot drift apart unnoticed. Rows sbx composes
  natively and `scripts/verify` does not exercise are marked unverified.
- The validator change is small and additive: existing kits and the registry
  cross-check are unaffected; the `examples/` container is opt-in by presence.

**Negative / residual**

- A template's live values are real config. A team that copies without
  replacing them gets a harmless but pointless egress entry, env var, file,
  and startup command. The README and in-spec comments say what to replace.
- `scripts/verify` needs a sandbox-capable host and network; like every kit's
  verify in this area, it cannot run in this repo's CI. The offline gate is
  `validate-kits.py`.
- The composition rules are a snapshot of acq v3.1.0. A change in `acq`'s
  adapters would need the table, the ADR date note, and `scripts/verify`
  updated together.

## Links

- Pattern doc: [`../scope-layers.md`](../scope-layers.md).
- Templates: [`../../acq-kits/examples/team-kit/`](../../acq-kits/examples/team-kit/),
  [`../../acq-kits/examples/personal-kit/`](../../acq-kits/examples/personal-kit/).
- Validator: [`../../acq-kits/validate-kits.py`](../../acq-kits/validate-kits.py)
  (`TEMPLATES_DIR`).
- ADR 0001 (isolation): the neutral `hybrid/v1` acq-kits area this extends.
- Proposal and placement discussion: GSA-TTS/agentic-coding-patterns#421.
