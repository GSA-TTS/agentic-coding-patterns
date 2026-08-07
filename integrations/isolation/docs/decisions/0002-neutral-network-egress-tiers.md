---
title: "Neutral network egress tiers (strict / balanced / open) for all sandbox backends"
status: "proposed"
date: "2026-08-07"
decision_makers: ["William Zujkowski", "Bret Mogilefsky", "OpenCode Agent"]
category: "isolation-kit-schema"
impact_level: "moderate"
nist_controls: ["SC-7", "SC-7(5)", "AC-4", "CM-7"]
---

# ADR 0002 (isolation) — Neutral network egress tiers for all sandbox backends

> Area-scoped ADR for `integrations/isolation/`. Extends the neutral `hybrid/v1`
> kit spec (ADR 0001) with a backend-agnostic network-policy vocabulary.

## Context and Problem Statement

`acq` runs sandboxes on multiple backends (`sbx`, `msb`/microsandbox, and a
future `ppp`). The neutral `hybrid/v1` kit spec already carries a per-kit host
allowlist, `caps.network.allow`, which BOTH backends consume today:

- **sbx** — emitted into the synthesized sbx-v2 kit spec at create.
- **msb** — emitted as `--net-rule allow@<host>` flags at create; microsandbox
  treats the presence of net-rules as **default-deny** for everything else.

However, there is **no neutral concept of a policy _baseline / tier_**. The two
backends therefore diverge on the baseline egress a sandbox gets:

- **sbx** exposes its own CLI tiers — `deny-all` / `balanced` / `allow-all` —
  set **manually** by the user (`sbx policy init balanced`, a documented Step 2;
  `acq` does not run it). `balanced` pre-allows "typical dev traffic (AI
  services, package registries)".
- **msb** has no such baseline: its egress is **exactly** the union of each
  kit's `caps.network.allow` hosts (plus a conditional npm-registry allow when
  installing an agent) — stricter than sbx `balanced`, but with no shared
  "useful-but-safe" baseline and no user-facing tier.

Result: no consistent egress surface across backends, no shared curated baseline
we can reason about or reuse for future backends, and the "balanced" convenience
is sbx-only and manual. We want ONE neutral egress surface every current and
future sandbox shares.

## Decision

Add a **neutral `network.tier` vocabulary** to the kit/config schema, mapped by
each backend to its native egress primitive. All tiers preserve
**deny-by-default** (the tier only controls the size of the allowlist, never
"allow, then block").

### Tiers

| Tier | Meaning |
|------|---------|
| `strict` | Deny-by-default. Egress = only the explicit per-kit `caps.network.allow` hosts. (Matches sbx `deny-all` + kit allows; matches msb's current behavior.) |
| `balanced` | Deny-by-default + a **curated baseline allowlist** of useful-but-safe dev traffic (package registries, AI/model APIs, common source hosts), unioned with the per-kit allows. |
| `open` | All egress. Testing only; never for GFE / production agents. |

Effective allowlist for a sandbox = **tier baseline ∪ per-kit
`caps.network.allow` ∪ any per-sandbox user additions**.

### The `balanced` baseline is a curated, SHA-pinned, in-repo data file

- The baseline lives in this repo as a version-controlled data file (e.g.
  `integrations/isolation/network-tiers/balanced.yaml`), pinned by the same
  full-SHA `PATTERNS_KIT_REF` mechanism `acq` already uses. It is **deterministic
  and auditable**; there is no runtime fetch.
- The maintainers own it. The federal user community proposes additions via
  issue/PR, gated by **CODEOWNERS + the existing security-skill review model**.
  Each entry is a domain we are vouching is safe for a (potentially
  prompt-injectable) AI agent to reach.

### No runtime threat-feed; reputation check is CI-time only

- `acq` performs **no runtime threat-feed / blocklist fetch** during sandbox
  build — that would break the offline-safe, deterministic, no-hang contract, and
  a runtime blocklist is redundant under deny-by-default (an allowlist already
  blocks everything not listed).
- A reputation/threat feed is used **only as a CI-time validator on PROPOSED
  allowlist additions** — it flags a domain a PR wants to add against a
  reputation source so a human reviewer sees the signal before approving. It
  never gates runtime egress and never fetches at sandbox-build time.

### Default: fail-safe `strict`, shipped-config `balanced`

Per a 3/3 consensus that weighed the prompt-injection exfiltration threat model:

- **The schema / library default (when `network.tier` is unspecified) is
  `strict`** — a kit or backend that forgets to set a tier fails **closed**, and
  no sandbox silently gets exfiltration-capable egress by omission.
- **The shipped quickstart/default configuration explicitly sets
  `network.tier: balanced`** — so users get the useful baseline out of the box,
  but as an **explicit, reviewable, auditable choice**, not an implicit grant.

This reconciles developer ergonomics (balanced is what users experience) with
least-privilege (the system fails closed to strict when nothing is specified).

### Backend mapping

Each adapter maps `tier` + the merged allowlist to its native primitive at
create:

- **sbx** — the appropriate `sbx policy` tier + the merged allow hosts.
- **msb** — `--net-rule allow@<host>` for each host in the merged allowlist
  (deny-by-default is already msb's behavior when net-rules are present).
- **future ppp** — its own egress primitive; the neutral tier contract is what it
  implements.

## Consequences

### Positive

- One consistent, auditable egress surface across sbx, msb, and any future
  backend — the stated goal.
- `balanced` gives a shared, curated, useful baseline that is the same on every
  backend, extensible by the community through a reviewed PR path.
- Deterministic and offline-safe (SHA-pinned in-repo list, no runtime feed).
- Fail-safe: unspecified tier ⇒ `strict`; a coerced agent never gets broad egress
  by default-of-omission.
- Satisfies SC-7 / SC-7(5) (boundary protection, deny-by-default) with documented,
  version-controlled policy.

### Negative / risks

- **We become the trust anchor** for the `balanced` list: every domain on it is
  something we vouch is safe for a prompt-injectable agent to reach. Even curated,
  each entry (a registry, a model API, a source host) is a potential exfiltration
  channel — `balanced` widens blast radius vs `strict`. Mitigated by: CODEOWNERS +
  security-skill review on additions, the CI reputation check, keeping the list
  minimal, and the fail-safe `strict` default.
- **Maintenance / staleness:** registries and AI endpoints change; the list needs
  periodic review (PR-driven + a scheduled review cadence). No runtime feed means
  freshness depends on us.
- New neutral vocabulary + per-adapter translation is a schema/behavioral change
  across repos (schema in patterns; consumption in the quickstart adapters).

### Neutral

- `strict` == today's msb behavior and sbx `deny-all` + kit allows, so `strict`
  is a no-op re-labeling of existing behavior; only `balanced`/`open` and the
  shared baseline are new.

## Alternatives Considered

- **`balanced` as the true (implicit) default.** Rejected by the security/threat
  panel: silently grants exfiltration-capable egress to every new agent by
  omission. We instead ship `balanced` explicitly while the fail-safe default is
  `strict`.
- **Runtime threat-feed blocklist.** Rejected: redundant under deny-by-default,
  breaks offline/deterministic acq, and adds a fetch-time SSRF/poisoning surface.
  Kept as a CI-time check on proposed additions only.
- **Leave it backend-specific (status quo).** Rejected: no shared surface, sbx-only
  manual `balanced`, no baseline for msb or future backends.

## What an agent must NOT decide unilaterally

- **What belongs on the federally-shipped `balanced` allowlist.** Every addition
  is a human/CODEOWNERS + security-review decision. Agents may propose entries
  (with the CI reputation signal) but never self-approve them.
- The default-tier policy for GFE deployments.

## References

- ADR 0001 (isolation) — neutral `hybrid/v1` acq-kits spec.
- `schemas/kit-hybrid-v1.schema.json` — `caps.network.allow` (the existing shared
  allowlist this extends).
- quickstart `acq.backends/kit-translate.sh` (sbx emit), `acq.backends/msb.sh`
  (`--net-rule` emit) — the adapters that will map the tier.
- Consensus + tradeoff panel (2026-08-07): design approved 3/3; default
  reconciled to fail-safe `strict` / shipped `balanced`.
