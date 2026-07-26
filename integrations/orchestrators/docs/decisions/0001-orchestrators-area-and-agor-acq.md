---
title: "Add an integrations/orchestrators/ area; place the Agor + acq integration there"
status: "accepted"
date: "2026-07-26"
decision_makers: ["Bret Mogilefsky", "OpenCode Agent"]
category: "repository-structure"
impact_level: "low"
---

# ADR 0001 (orchestrators) — Add `integrations/orchestrators/` and place Agor + acq there

> Area-scoped ADR for `integrations/orchestrators/`. The repository-wide ADR log
> is [`docs/decisions/`](../../../docs/decisions/); the area that established
> `integrations/` is
> [`docs/decisions/0001-integrations-area.md`](../../../docs/decisions/0001-integrations-area.md).
> This record governs the whole orchestrators integration area, so it sits here
> between the two — mirroring how `integrations/isolation/` carries its own
> [area ADR](../../isolation/docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

> **Status: accepted.** Boundary rule and area confirmed by the human owner on
> 2026-07-26 (review item A).

## Context and Problem Statement

`integrations/` (per the repo-wide
[ADR 0001](../../../docs/decisions/0001-integrations-area.md)) holds tool/editor
integration guides and portable configs. Its first two classes are
`editors/` and `isolation/` (the `acq`/`sbx` mixin kits).

A new kind of integration has arrived that fits neither: **an orchestrator that
*drives* an isolation tool from the outside.** Concretely, [Agor](https://github.com/preset-io/agor)
— a multiplayer agent orchestrator — can run its executor inside an
[`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) sandbox by pointing
its `executor_command_template` at a wrapper script that calls `acq create` /
`acq exec`. This integration:

- is **not an isolation kit** — it is not a `caps`/`files`/`commands` payload that
  `acq` *applies inside* a sandbox; it is code that *calls* `acq` from outside and
  owns the agent + session lifecycle;
- is **not an editor** integration;
- is **not a skill/prompt/workflow** (not an executable agent procedure);
- but **is** reusable, tool-specific, community-shareable, and carries no
  compliance authority — exactly the `integrations/` mission.

Without a home, this material would be misfiled into `isolation/` (wrong — it
consumes kits, it is not one) or `examples/` (wrong — it is a maintained portable
integration, not an illustration).

## Decision Drivers

- The `integrations/` taxonomy groups by **integration class first, then tool**
  (established in the repo-wide integrations ADR).
- The distinction between "drives a sandbox tool" and "is applied inside a
  sandbox" is real and recurring (other orchestrators — CI runners, other agent
  platforms — could drive `acq` too).
- Keep `isolation/` cohesive: it is the home of the neutral `hybrid/v1` kits, not
  of their consumers.
- Avoid forcing a consumer-of-kits into the kit taxonomy.

## Considered Options

1. **Add a top-level `integrations/orchestrators/` area** with per-orchestrator
   subfolders; place Agor+acq at `integrations/orchestrators/agor/`. *(chosen)*
2. **Put it under `integrations/isolation/`** — conflates a kit *consumer* with
   the kits; pollutes the isolation area's cohesive kit taxonomy.
3. **Put it under `examples/`** — examples are illustrative, not maintained
   portable integrations meant to be adopted.
4. **Put it in the Agor repo only** — loses the community-shareable, cross-tool
   value and the `-patterns` audience; the integration is deliberately vendor-
   neutral on the `acq` side.

## Decision

Adopt **Option 1**.

- **New area** `integrations/orchestrators/`, grouped by integration class
  (orchestrator), then by tool (`agor/`).
- **The boundary rule** (also added to `integrations/README.md`):

  > An **orchestrator** integration *drives* a sandbox/isolation tool from the
  > outside — it owns the agent + session lifecycle and calls `acq`/`sbx`/`msb`
  > (e.g. Agor invoking `acq create` / `acq exec`). An **isolation kit** is
  > something `acq` *applies inside* the sandbox (`caps`/`files`/`commands`).
  > Direction of control decides the area: **drives → `orchestrators/`;
  > applied-inside → `isolation/`.**

- **Composition corollary.** When an orchestrator integration *needs* a kit
  (e.g. the `agor-daemon-egress` kit that allow-lists the daemon URL —
  [#259](https://github.com/GSA-TTS/agentic-coding-patterns/issues/259)), that
  kit lives under `integrations/isolation/acq-kits/` (it is applied inside), and
  the orchestrator **references** it. The two areas compose; the artifact's
  direction of control — not its owning project — decides where it lives.

- **Area README.** `integrations/orchestrators/README.md` documents what belongs
  here, the boundary rule, and an index — mirroring
  `integrations/isolation/acq-kits/README.md`. A row is also added to the
  top-level `integrations/README.md` "Available integrations" table, and the
  `orchestrators/` class is named in its "What belongs here" list.

- **Structure:**

  ```text
  integrations/orchestrators/
  ├── README.md                 # what belongs here + boundary rule + index
  ├── docs/decisions/           # area ADRs (this file)
  └── agor/
      ├── README.md             # setup guide (executor_command_template, who-owns-what)
      ├── sandbox-wrapper-acq.sh # portable wrapper the operator adopts
      └── docs/explorations/    # source design docs (sandbox-abstraction, sandbox-acq-analysis)
  ```

## Consequences

**Positive**

- Gives orchestrator-class integrations a correct, discoverable home and a clear
  boundary against isolation kits.
- Keeps `isolation/` focused on kits; keeps consumers-of-kits out of the kit
  taxonomy.
- Establishes a reusable rule for future orchestrators that drive `acq`.

**Negative / trade-offs**

- One more top-level area under `integrations/` to document and index. Mitigated
  by the area README + this ADR + the top-level README row.

**Neutral**

- The Agor+acq integration itself carries **no compliance authority** and is not
  federal policy; behavioral/policy authority stays in the playbook and is
  referenced, not restated (consistent with `docs/contribution-scope.md`).
- v1 of the Agor+acq integration is scoped to the **sbx** backend (see the
  wrapper's own notes / map ticket
  [#251](https://github.com/GSA-TTS/agentic-coding-patterns/issues/251)); msb
  support and Agor-core changes are tracked separately and are out of scope here.

## Links

- Repo-wide area ADR that established `integrations/`:
  [`docs/decisions/0001-integrations-area.md`](../../../docs/decisions/0001-integrations-area.md).
- Sibling area ADR (isolation kits):
  [`../../isolation/docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../isolation/docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).
- Contribution scope:
  [`docs/contribution-scope.md`](../../../docs/contribution-scope.md).
- Wayfinder map:
  [#247](https://github.com/GSA-TTS/agentic-coding-patterns/issues/247);
  boundary decision
  [#250](https://github.com/GSA-TTS/agentic-coding-patterns/issues/250).
- Source explorations:
  [`../agor/docs/explorations/sandbox-abstraction.md`](../agor/docs/explorations/sandbox-abstraction.md),
  [`../agor/docs/explorations/sandbox-acq-analysis.md`](../agor/docs/explorations/sandbox-acq-analysis.md).
