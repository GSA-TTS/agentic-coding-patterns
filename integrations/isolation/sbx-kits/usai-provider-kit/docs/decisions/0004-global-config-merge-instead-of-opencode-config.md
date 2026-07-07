# Decision: Merge into OpenCode's global config instead of setting `OPENCODE_CONFIG`

**Status:** accepted (2026-07-06)
**Supersedes:** the `OPENCODE_CONFIG` delivery mechanism in
[`0001-usai-provider-as-mixin-kit.md`](0001-usai-provider-as-mixin-kit.md)
(§"Namespaced `OPENCODE_CONFIG`") and all of
[`0002-opencode-config-co-tenancy.md`](0002-opencode-config-co-tenancy.md).

## Context

The kit originally delivered the USAi provider config by writing a namespaced
file (`~/usai-config/opencode.jsonc`) and setting
`OPENCODE_CONFIG=/home/agent/usai-config/opencode.jsonc`. That leaned on
OpenCode's config layering (global < `OPENCODE_CONFIG` < project) to *compose
with* whatever the base template might write to the global path, without
clobbering it — see ADR 0001. The single-valued nature of `OPENCODE_CONFIG` then
forced a co-tenancy contract (ownership marker + warn-only guard) — see ADR
0002.

**Users asked for the config to land at the global path**
(`~/.config/opencode/opencode.jsonc`) rather than being reached through
`OPENCODE_CONFIG`. Reasons cited: it is the path people already know and inspect,
it avoids an extra env var, and it behaves like a "normal" OpenCode install.

The naive way to honor that — write the kit's file directly to the global path —
would **clobber** any global config the base template or another kit wrote. That
is exactly the failure mode ADR 0001 avoided by *not* writing the global path.

## Decision

**Ship the USAi config in the kit's `files/` tree (staging area, unchanged) and,
at startup, MERGE it into the global config path — copying verbatim when no
global config exists, deep-merging when one does.** Stop setting
`OPENCODE_CONFIG`.

Concretely:

1. **No `OPENCODE_CONFIG`.** The `environment.variables` block is removed.

2. **Ship a merge script in `files/`.** `merge-global-config.mjs` lives at
   `files/home/usai-config/` (not host-only `scripts/`), so sbx maps it into the
   sandbox next to the staged `opencode.jsonc`. The base image ships `node`
   (v22), which the kit already depends on.

3. **`commands.startup` runs the merge** as the agent user (uid 1000, which owns
   `/home/agent`). The kit's `files/` payload is laid down by base-image setup
   that runs **before** `startup` — the same lifecycle ordering the
   `zscaler-ca-certificate` kit relies on — so the staged source and script
   exist by then.

4. **Copy vs. merge:**
   - **No existing global config** (`config.json` / `opencode.json` /
     `opencode.jsonc` all absent): copy the staged file **verbatim**. Comments
     and the ownership marker are preserved.
   - **Existing global config(s):** deep-merge the USAi keys **into** the
     existing config and write JSON to `opencode.jsonc`. The **USAi kit wins for
     its own keys** (`provider.usai`, `model`, `small_model`, `agent`,
     `permission`, …); unrelated existing keys are preserved. Any existing leaf
     the kit overwrites (e.g. a pre-existing top-level `model`) is reported as a
     `warning:` on stderr. If more than one global filename exists, they are
     merged in OpenCode's precedence order first, then the kit's config on top.

5. **Converges to a stable fixed point.** Re-running the merge on every start
   satisfies sbx's "startup must be idempotent" rule in the sense that matters:
   the effective config is stable at every boot. Note it is *not* byte-identical
   from the very first run — on an empty global dir, boot 1 copies verbatim
   (comments + marker intact) and boot 2 re-reads that file as an existing config
   and normalizes it to bare JSON (comments + marker dropped). From boot 2 onward
   the on-disk bytes are stable. No config key/value is ever lost across this
   transition; only comments are (JSON has none).

### Co-tenancy after this change

The single-valued `OPENCODE_CONFIG` shadowing problem (ADR 0002) **no longer
exists**, because the kit no longer sets that env var. Other config-contributing
kits still contribute via `<workspace>/.opencode/opencode.jsonc` — OpenCode's
**project** layer still deep-merges *over* the global layer, so a co-tenant kit's
fragment composes with the USAi global config exactly as before. The warn-only
startup guard is removed; the ownership **marker comment** is retained (it still
tags the kit's file and lets `scripts/verify` recognize a verbatim copy).

## Trade-offs

- **Comments are lost in the merge branch.** JSON has no comments, so merging
  into a pre-existing global config drops the annotations. Accepted: the fully
  annotated source stays at `~/usai-config/opencode.jsonc` inside the sandbox and
  in the repo, so the reference copy is never lost. The copy branch (the common
  case, since the stock base writes no global config) **keeps** comments.
- **We now own the global path's contents.** Overwriting an existing leaf is a
  real semantic change to the user's config; we surface each such override as a
  warning rather than silently winning.
- **Startup does not fail closed.** Like the zscaler kit, a merge failure logs
  but does not gate the agent entrypoint. The script exits non-zero only on an
  unexpected error (missing/unparseable source), not on leaf conflicts.
  `scripts/verify` asserts the end state to catch regressions.

## Considered alternatives

- **Write the global path directly (no merge)** — rejected: clobbers an existing
  global config, the exact property ADR 0001 preserved.
- **Keep `OPENCODE_CONFIG`** — rejected per the user request that motivated this
  ADR; also carries the ADR-0002 co-tenancy complexity.
- **Merge with `jq`** — rejected: `jq` cannot parse the JSONC comments in the
  shipped file, and the kit already depends on Node, which handles JSONC and the
  file's shape. A small, unit-tested script is clearer than a comment-stripping
  `jq` pipeline.
- **Embed the merge script inline via `commands.initFiles`** — rejected:
  duplicates the script body in `spec.yaml` and can't be unit-tested; shipping it
  in `files/` keeps a single tested source.

## Validation

- `tests/merge-global-config.test.mjs` covers JSONC comment stripping (including
  `//` inside string URLs), deep-merge precedence and conflict reporting, the
  copy-vs-merge branches, and an end-to-end run of the script against a temp dir.
- `scripts/verify` asserts the end state on a real sandbox: the global
  `opencode.jsonc` exists and contains `provider.usai`, and a pre-seeded foreign
  global key survives the merge.
- Phase-ordering assumption (files/ present by startup) is the same one the
  `zscaler-ca-certificate` kit documents and relies on.

## See also

- [`0001-usai-provider-as-mixin-kit.md`](0001-usai-provider-as-mixin-kit.md) —
  original self-contained-mixin decision (partially superseded here).
- [`0002-opencode-config-co-tenancy.md`](0002-opencode-config-co-tenancy.md) —
  the `OPENCODE_CONFIG` co-tenancy contract (superseded here).
- Docker kit spec reference — [Commands (`install`, `startup`, `initFiles`)](https://docs.docker.com/ai/sandboxes/customize/kit-reference/#commands)
