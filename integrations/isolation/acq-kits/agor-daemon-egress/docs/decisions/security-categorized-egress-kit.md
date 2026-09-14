# Decision: `agor-daemon-egress` as a security-categorized isolation kit

**Status:** accepted
**Date:** 2026-07-26 (amended 2026-09 to also install the executor)

## Context

The [`orchestrators/agor`](../../../../../orchestrators/agor/) wrapper runs an Agor
executor inside an `acq` sandbox. For that to work, the sandbox must (a) be able
to reach the Agor daemon over WebSocket and (b) contain the `agor-executor`
binary. Research
([#248](https://github.com/GSA-TTS/agentic-coding-patterns/issues/248),
[#259](https://github.com/GSA-TTS/agentic-coding-patterns/issues/259)) established
that `acq` has **no per-invocation network flag** — the only acq-native way to
open outbound egress is a kit's `caps.network.allow`, and backends are
deny-by-default for arbitrary hosts. So daemon reachability **must** be expressed
as a kit.

Two further questions had to be settled: (1) *where* the kit lives, (2) whether it
is governed as a **security** kit, and — amended — (3) how the **executor** gets
into the sandbox.

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
conventional-commit type.

**Constraint / how the governance is recorded.** The `hybrid/v1` kit schema is
`additionalProperties: false` and models **no** security-governance frontmatter
fields — those (`categories`, `risk_tier`, `human_review_required`,
`network_policy`, …) are defined for *skill* patterns
(`schemas/skill.schema.json`), not kit specs. So we do **not** (and cannot) add
those fields to `spec.yaml`. Instead the security posture is recorded in prose in
the kit `README.md` (a "Security posture" table) and here, and enforced by
**human review**, consistent with
[`docs/security-skill-governance.md`](../../../../../../docs/security-skill-governance.md).

### 3. The kit also installs the executor (amendment)

The wrapper runs `agor-executor --stdin` inside the sandbox, but `agor-live`'s npm
`bin` exposes only `agor`/`agor-daemon` — **not** `agor-executor` (which is
`dist/executor/cli.js`). The executor must therefore be provisioned, and the kit
is the natural home: it is the Agor-specific thing the sandbox needs, alongside
the egress it already provides.

- **Not a committed binary.** `agor-live` is **BUSL-1.1**; committing the executor
  into this **CC0-1.0** repo would violate the no-copy rule. Instead the kit's
  `install` phase runs `npm install -g agor-live` at create time (fetched from
  `registry.npmjs.org`) and writes a thin `agor-executor` shim — the same
  install-at-create-time pattern as the `prime-agent` kit.
- **Not a separate kit.** A second Agor kit would split one consumer's sandbox
  needs across two artifacts with no added clarity; the egress and the executor
  are both "the sandbox side of the Agor integration" and compose as one mixin.
- **Version drift.** The executor defaults to `agor-live@latest`; pin
  `AGOR_EXECUTOR_VERSION` to lock it to the daemon.

### 4. Backend host aliases (amendment)

The daemon is reached through a backend-specific host alias: `host.docker.internal`
(sbx) and `host.microsandbox.internal` (msb, now acq's **default** backend). Both
are allow-listed because a `hybrid/v1` kit cannot template the value; the wrapper
rewrites the executor payload's loopback `daemonUrl` to the active backend's alias
(`AGOR_DAEMON_HOST`). On msb the `:port` is stripped (domain-only), so egress is
host-wide for that host.

## Alternatives considered

- **Put the kit under `orchestrators/agor/`** — rejected: it is applied inside the
  sandbox, so by the area boundary it belongs in `acq-kits/`.
- **Add security-governance frontmatter to `spec.yaml`** — rejected: the kit
  schema forbids unknown fields, and those fields are a skill-pattern concept.
  Recorded in prose + review instead.
- **Add a per-invocation `acq --allow` flag upstream** — out of scope here; a
  reasonable upstream request, but the kit is the mechanism that exists today.
- **Pre-bake the executor into the sandbox image** — deferred; it works, but it
  couples the image to a daemon version and moves the change out of the kit. The
  install-phase approach keeps the executor with the egress it needs.
- **A separate executor kit** — rejected (see Decision 3): one consumer, one mixin.

## Consequences

- Daemon egress is expressed declaratively and reviewably; the executor is
  installed at create time from npm and shimmed onto PATH.
- The static allow entries must be edited for a non-default daemon port/alias
  (a `hybrid/v1` kit cannot template them); documented in the README.
- On msb the port is stripped (host-wide for that host); acceptable — a live msb
  run is tracked at
  ([#257](https://github.com/GSA-TTS/agentic-coding-patterns/issues/257)).
