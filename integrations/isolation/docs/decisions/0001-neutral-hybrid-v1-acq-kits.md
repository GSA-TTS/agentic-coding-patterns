---
title: "Move sbx-kits → acq-kits with a neutral hybrid/v1 spec"
status: "accepted"
date: "2026-07-15"
decision_makers: ["Bret Mogilefsky", "OpenCode Agent"]
category: "repository-structure"
impact_level: "moderate"
---

# ADR 0001 (isolation) — Move `sbx-kits/` → `acq-kits/` with a neutral `hybrid/v1` spec

> Area-scoped ADR for `integrations/isolation/`. The repository-wide ADR log is
> `docs/decisions/`; kit-local design records live under each kit's
> `docs/decisions/`. This record governs the whole isolation kit area, so it sits
> here between the two.

## Context and Problem Statement

The four isolation kits (`usai-provider`, `agentic-coding-playbook`,
`zscaler-ca-certificate`, `git-ssh-sign`) shipped as **sbx** kits
(`schemaVersion: "2"`) under `integrations/isolation/sbx-kits/`. They are
consumed by the [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart)
wrapper, which in Phase 2 gains a **second isolation backend** (`msb`,
microsandbox) alongside `sbx`.

Two backends cannot share sbx-only kit specs: `sbx run --kit` semantics, the
sbx credential model, and sbx-specific lifecycle phases don't map onto `msb`.
Without a shared vocabulary, each backend would need its own copy of every kit —
guaranteeing drift and doubling the maintenance and review surface.

This is **Part A** of the Phase 2 handoff (the patterns-repo half). Part B (the
`msb` adapter, `kit-translate.sh`, and `acq kit …` subcommands) lands separately
in the quickstart repo and pins the merge SHA this change produces.

## Decision Drivers

- One kit vocabulary shared by every backend (`sbx`, `msb`, and later `ppp`).
- Preserve the existing kits' behavior and payloads verbatim — no functional
  change for current `sbx` users.
- Make it explicit that the kits target `acq` (a backend selector), not `sbx`.
- Don't break existing pins that reference `sbx-kits/…` on the day this merges.
- Allow a backend with a strictly-better native primitive to bypass the generic
  mechanism without forking the kit.

## Considered Options

1. **Neutral `hybrid/v1` spec in a new `acq-kits/` home; keep `sbx-kits/` as a
   one-release redirect.** (chosen)
2. Keep sbx-only kits and add a parallel `msb-kits/` tree. — Guarantees drift;
   doubles review surface; the design doc explicitly rejects least-common-
   denominator duplication.
3. Rename in place (`sbx-kits/` → `acq-kits/`) with no redirect. — Breaks every
   existing pin abruptly.
4. Keep the `kits/` name from the handoff. — Less clear about the `acq`
   association; a reviewer asked for `acq-kits/` to make the intent explicit.

## Decision

Adopt **Option 1**.

- **New neutral home** `integrations/isolation/acq-kits/`, one directory per kit,
  each with a `spec.yaml` at `schemaVersion: "hybrid/v1"` plus `files/`,
  `README.md` (with a backend-parity note), `TROUBLESHOOTING.md`,
  `docs/decisions/`, and `scripts/verify`.
- **New schema** `schemas/kit-hybrid-v1.schema.json` (JSON Schema, draft
  2020-12) capturing the neutral fields: `caps.network.allow`, `files[]`
  (`content` or `source:` + optional `phase`), `commands[]`
  (`phase`/`user`/`command`), `agentContext`, `backend_shortcuts.<backend>`,
  `backend_extras.<backend>`, and `environment` (a flat NAME → value map of
  non-secret guest env vars; added post-1.6.0 — see the amendment note below).
  A repo validator
  (`integrations/isolation/acq-kits/validate-kits.py`) enforces schema + source
  resolution + known-backend keys + README presence + a registry cross-check.
- **Registry** `integrations/isolation/acq-kits/kits.yaml` — kit → supported
  backends (`[sbx, msb]` for Phase 2) + prose parity notes.
- **Dir-name normalization** — the `-kit` suffix is dropped (`usai-provider-kit`
  → `usai-provider`, `playbook-kit` → `agentic-coding-playbook`) so the
  directory equals the kit's `name`.
- **One-release redirect** — `sbx-kits/README.md` becomes a pointer to
  `acq-kits/`; the old kit contents are left in place (unchanged) for one
  release and removed with the Phase 4 cleanup. **Nothing is deleted in this
  change.**

### Per-kit conversion notes

- **usai-provider** — `caps.network.allow: [api.gsa.usai.gov]`; the two staged
  files (`opencode.jsonc`, `merge-global-config.mjs`) carried verbatim via
  `files[].source`; startup merge command carried as argv. The node tooling and
  tests (`package.json`, `scripts/sync-usai-models.mjs`, `tests/`) moved with the
  kit so the new home is the single source of truth. No backend shortcut.
- **agentic-coding-playbook** — the ~80-line inline startup shell was extracted
  into a tested `files/home/playbook-clone.sh` (per design §6); startup command
  exports the pins and invokes it. The `PLAYBOOK_SHA` integrity gate and
  graceful non-fatal degradation are unchanged. No backend shortcut.
- **zscaler-ca-certificate** — the showcase for `backend_shortcuts`: declares
  `backend_shortcuts.msb.trust_host_cas: true` so the `msb` adapter uses its
  native `--trust-host-cas` and skips the file-drop; `sbx` (and `ppp` later)
  fall through to the file-drop + `update-ca-certificates` path. The public
  Zscaler Root CA moves from an inline spec PEM to a `files/` payload with the
  `initFiles` phase hint, preserving create-time ordering. Behavioral parity:
  the guest trusts the Zscaler CA either way.
- **git-ssh-sign** — Apache-2.0 vendored kit; the signing-time key-resolution
  command moves from an inline `initFiles` blob to a `files/` payload; the
  system-gitconfig install command carries the `install` phase. `LICENSE`,
  `NOTICE`, and the vendoring/intake records are retained. No backend shortcut —
  SSH-agent forwarding is the shared mechanism, enabled natively per backend.

### Backend-shortcut principle

`backend_shortcuts.<backend>` lets a backend with a strictly-better native
primitive (the msb `--trust-host-cas` case) short-circuit the generic
`caps`/`files`/`commands` path for one kit, avoiding least-common-denominator
drift without forking the kit. Cross-backend parity is **advisory** — documented
in each kit's README and the registry, not machine-enforced.

The `backend_shortcuts.<backend>` / `backend_extras.<backend>` values are
**deliberately unconstrained objects**: they are an escape hatch for
backend-native config the neutral spec does not model. Their *shape* is
**human-review-only — it is NOT schema-enforced** (the schema fixes only the set
of backend keys, via `additionalProperties: false`). A reviewer, not the
validator, is the control on what goes inside them.

### Backend enum: `sbx`, `msb`, `ppp`

The schema's backend enum and `KNOWN_BACKENDS` list three backends:

- **`sbx`** — the current backend; live consumer.
- **`msb`** — the Phase 2 in-flight backend; has an exercised consumer
  (`zscaler.backend_shortcuts.msb.trust_host_cas`).
- **`ppp`** — the Podman backend, **in active development and expected
  imminently** (Phase 3). It is retained as a **reserved** slot (documented as
  such in the schema descriptions) so the vocabulary and registry are ready when
  its adapter lands; no kit declares a `ppp` shortcut yet.

## Consequences

**Positive**

- One neutral kit vocabulary; `msb` (Part B) and `ppp` (Phase 3) reuse the same
  kits.
- No functional change for current `sbx` users; payloads carried verbatim.
- Extracted playbook script and the CA-as-payload are now lintable/testable.
- Schema + validator give a backend-agnostic gate that runs offline in CI. It is
  wired into `make validate-kits` / `make test-kits` (folded into `make ci`), a
  `validate-acq-kits` pre-commit hook, and dedicated CI steps in
  `.github/workflows/ci.yml` (the `Pattern Validation` and `acq-kits Tests`
  jobs), so a spec regression or model-sync drift is caught in CI, not only by
  hand.

**Negative / residual**

- Temporary duplication: `sbx-kits/` contents remain during the one-release
  redirect window (removed in Phase 4).
- The playbook pins now live in two places (spec command + script defaults) that
  must be bumped together (documented in the kit README).
- **Live per-backend verification is deferred.** Like ADR-0009/0010 in the
  quickstart repo, full `acq run` end-to-end checks can't run inside an sbx
  sandbox (no nested sandboxes); each kit's `scripts/verify` runs on a
  sandbox-capable host. The offline gate (schema validation, the usai node
  tests, `bash -n`, unsafe-shell scan) runs everywhere.

## Amendment: `environment` vocabulary (post-1.6.0)

The initial `hybrid/v1` vocabulary had **no way to express guest environment
variables**. The two sbx-v2 kits that used env (`playbook-kit`, `openchamber`)
carried an `environment.variables` block that was dropped in the Phase-2
conversion and re-expressed as inline `KEY=val \` prefixes on their startup
commands — a workaround, not a first-class mechanism. A downstream team
(quickstart#202 review) needs `environment.variables`-style config
(`OPENCODE_CONFIG`, `OPENCODE_TUI_CONFIG`, `GITLAB_HOST`) as a first-class kit
mechanism, which the neutral format could not express.

**Decision:** add a top-level `environment` block — a **flat map** of
`NAME → value`, both strings. Deliberately minimal (YAGNI):

- Static string values only. No interpolation/templating, no references to
  paths staged by `files[]`. None of the reference kits need more; a kit that
  needs a computed value uses a `commands[]` step as before.
- Env var **names** are validated against `^[A-Za-z_][A-Za-z0-9_]*$` at the
  schema (`patternProperties` + `additionalProperties: false`) AND in
  `validate-kits.py` (explicit field-level check with a clear message). Names
  reach the guest environment and possibly a shell, so a bad name is rejected,
  not silently passed.
- **Secrets do NOT go here.** This block is plain, human-readable config. API
  keys / tokens continue to flow through the backend credential/secret path
  (sbx secret proxy, msb `--secret ENV@HOST`), never the kit spec.
- **Env var *values* are NOT validated or shell-escaped here** — only names are.
  A value is `type: string` and may contain newlines or shell metacharacters.
  This is safe *by construction downstream, not by validation here*: backends
  MUST pass each value as argv / native env (msb `exec -e NAME=value`; sbx's
  native `environment.variables` block), and MUST NOT interpolate a value into a
  shell string. A future backend adapter (e.g. `ppp`) must uphold this contract
  — do not assume the gate sanitized the value.

**Backend mapping** (implemented in the quickstart translate layer):

- **sbx** — emit the native sbx-v2 `environment: { variables: { … } }` block
  (the mechanism the pre-Phase-2 `playbook-kit`/`openchamber` kits used). sbx
  sets these in the guest environment natively; no `commands` workaround needed.
- **msb** — thread each `NAME=value` as an `msb exec -e NAME=value` on the
  kit's lifecycle commands (msb's native per-exec env flag, already used for
  `HOME=/home/agent`). Per-exec `-e` scopes the env to the kit's own commands
  and mirrors how `msb.sh` already threads env.

The schema addition is additive and backward-compatible (existing kits without
`environment` are unaffected). See quickstart#202 for the translate-layer
implementation and ADR-0011 there.

## Follow-ups (tracked, not in this change)

- **Part B (quickstart, blocked on this PR's merge SHA):** `msb.sh`,
  `kit-translate.sh`, `sbx.sh` conversion, `acq kit` subcommands,
  `scripts/verify-backends`, docs + ADR-0011. Do not start the kit-ref repoint
  until this merges and the SHA is known (handoff §4.1).
- **Phase 4 cleanup:** remove the `sbx-kits/` redirect contents.

## Links

- Handoff: `docs/explorations/acq-handoff-2.0.md` (quickstart repo,
  agentic-coding-quickstart#202).
- Design: `docs/explorations/acq-design.md` §3 (neutral spec), §4 (per-kit
  mapping), §6 (patterns-repo changes).
- Schema: [`schemas/kit-hybrid-v1.schema.json`](../../../../schemas/kit-hybrid-v1.schema.json).
- Registry: [`../acq-kits/kits.yaml`](../../acq-kits/kits.yaml).
- Repo-wide ADR that established this area:
  [`docs/decisions/0001-integrations-area.md`](../../../../docs/decisions/0001-integrations-area.md).
