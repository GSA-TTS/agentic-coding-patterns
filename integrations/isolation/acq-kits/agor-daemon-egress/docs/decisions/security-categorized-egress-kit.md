# Decision: `agor-daemon-egress` as a security-categorized isolation kit

**Status:** accepted
**Date:** 2026-07-26

## Context

The [`orchestrators/agor`](../../../../../orchestrators/agor/) wrapper runs an Agor
executor inside an `acq` sandbox. The executor must connect back to the Agor
daemon over WebSocket. Research
([#248](https://github.com/GSA-TTS/agentic-coding-patterns/issues/248),
[#259](https://github.com/GSA-TTS/agentic-coding-patterns/issues/259)) established
that `acq` has **no per-invocation network flag** — the only acq-native way to
open outbound egress is a kit's `caps.network.allow`, and sbx is default-deny for
arbitrary hosts. So daemon reachability **must** be expressed as a kit.

Two questions had to be settled: (1) *where* the kit lives, and (2) whether it is
governed as a **security** kit.

## Decision

### 1. It is an isolation kit, not an orchestrator artifact

Per the orchestrators-area boundary
([ADR 0001](../../../../../orchestrators/docs/decisions/0001-orchestrators-area-and-agor-acq.md),
drives-vs-applied), a kit is something `acq` **applies inside** the sandbox — so
it lives under `integrations/isolation/acq-kits/`, even though its **only**
consumer is the `orchestrators/agor` integration. The orchestrator **references**
it (via `AGOR_EGRESS_KIT`); it does not own it. This keeps the two areas composing
cleanly and keeps all `caps.network.allow` kits in one place.

### 2. It is governed as a security-relevant kit

The kit **widens network egress**, which is a security-relevant capability. It is
therefore treated as a **security** kit: `human_review_required`, PR labelled
`needs-human-review`, one focused change per PR, and a release-visible
conventional-commit type. Its capability is nonetheless minimal by construction —
one host:port (the daemon), no files, no commands, no secret.

**Constraint / how the governance is recorded.** The `hybrid/v1` kit schema is
`additionalProperties: false` and models **no** security-governance frontmatter
fields — those (`categories`, `risk_tier`, `human_review_required`,
`network_policy`, …) are defined for *skill* patterns
(`schemas/skill.schema.json`), not kit specs. So we do **not** (and cannot) add
those fields to `spec.yaml`. Instead the security posture is recorded in prose in
the kit `README.md` (a "Security posture" table) and here, and enforced by
**human review**, consistent with
[`docs/security-skill-governance.md`](../../../../../../docs/security-skill-governance.md).
Approved by the human owner on 2026-07-26.

## Alternatives considered

- **Put the kit under `orchestrators/agor/`** — rejected: it is applied inside the
  sandbox, so by the area boundary it belongs in `acq-kits/`.
- **Add security-governance frontmatter to `spec.yaml`** — rejected: the kit
  schema forbids unknown fields, and those fields are a skill-pattern concept.
  Recorded in prose + review instead.
- **Add a per-invocation `acq --allow` flag upstream** — out of scope here; a
  reasonable upstream request, but the kit is the mechanism that exists today.

## Consequences

- Daemon egress is expressed declaratively and reviewably, scoped to one
  host:port.
- The kit's static allow entry must be edited for a non-default daemon port/alias
  (a `hybrid/v1` kit cannot template it); documented in the README.
- On msb the port is stripped (host-wide for that host); acceptable for the
  sbx-only v1, tracked with the msb gap
  ([#260](https://github.com/GSA-TTS/agentic-coding-patterns/issues/260)).
