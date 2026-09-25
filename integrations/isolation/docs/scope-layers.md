# Scope layers: global, team, and personal kits

How a team, and each person on it, layers sandbox configuration on top of the
global kits `acq` applies for everyone. Nothing here needs a change to `acq` or
to this repo: the mechanism is `ACQ_EXTRA_KITS`, and the vocabulary is the
neutral `hybrid/v1` kit spec
([ADR 0001](decisions/0001-neutral-hybrid-v1-acq-kits.md)). Every command below
is an `acq` command, so the pattern is identical on every backend.

## The layer model

```text
  applied by acq, in this order (later kits win where a field is last-wins)
  ┌────────────────────────────────────────────────────────────────────────┐
  │ global    zscaler-ca-certificate · usai-provider ·                      │  pinned built-in bundle
  │           agentic-coding-playbook · git-ssh-sign                        │  (everyone)
  │ team      your team's kit                                               │  ACQ_EXTRA_KITS, first
  │ personal  your own kit                                                  │  ACQ_EXTRA_KITS, later
  └────────────────────────────────────────────────────────────────────────┘
  repo       AGENTS.md · .opencode/ · the repo's own agent config            read by the agent,
                                                                             not applied by acq
```

- **Global.** `acq` applies its pinned built-in bundle first, in the order
  shown. Everyone gets it; a lower layer never redeclares it.
- **Team.** One more `hybrid/v1` mixin kit, kept in a repo the team owns,
  carrying only the *team delta*: extra egress, conventions, shared agent
  settings, skills, a few idempotent startup steps.
- **Personal.** The same shape, kept in a repo you own (a dotfiles repo is
  ideal): shell drop-ins, git preferences, a TUI theme, tools you want.
- **Repo.** The workspace's own `AGENTS.md`, `.opencode/`, or equivalent. It
  sits above the kits in precedence *for the agent*, but it is not a kit:
  the agent reads it from the mounted workspace; `acq` never applies it.

`ACQ_EXTRA_KITS` is whitespace-separated and ordered. Each entry is a local
path or a `git+https://…#ref=<sha>&dir=<path>` ref:

```bash
# in your shell rc
export ACQ_EXTRA_KITS="/path/to/team-repo/acq-kits/team-kit /path/to/dotfiles/personal-kit"
acq run opencode /path/to/project
```

When kit content lands depends on the backend. On msb, `acq run` re-applies
every kit to an existing sandbox (files refresh, `environment` is rebuilt,
startup steps re-run), while egress and volumes are fixed at creation. On sbx,
kits apply at creation only. When in doubt: `acq rm <name>` and recreate.

## How stacked kits compose, field by field

Verified against `acq`'s kit-translate layer and both backend adapters at acq
v3.1.0 (`main` as of 2026-09-24). On msb, `acq`'s adapter composes the kits
itself; on sbx, `acq` translates each kit to a native sbx kit and sbx composes
them. The observable rules are the same on both.

| Field | Rule | What it means when you stack |
|-------|------|-------------------------------|
| `caps.network.allow` | **union** | Every kit's hosts are allowed. Overlap with the global layer is harmless. Under org governance, org rules still win. |
| `caps.network.tier` | **sandbox-wide, not per kit** | As of acq v3.1.0 the tier comes from `ACQ_NETWORK_TIER` (default `balanced`); a kit's `tier` field is not read when kits are applied. |
| `files[]` | **last wins, by path** | A whole-file overlay. A later kit's file at the same in-guest path replaces the earlier one, silently and in full. Nothing merges. |
| `commands[]` | **append, in kit order** | Each kit's commands run in spec order; kits run in application order. `install` runs once per sandbox, `startup` at every start. |
| `environment` | **last wins, by name** | A later kit's value for the same `NAME` replaces the earlier one, silently. Single-valued variables such as `OPENCODE_CONFIG` therefore have exactly one owner in the stack. |
| `volumes[]` | **union, last wins by path** | Two kits declaring the same mount path: the later kit's entry is used. |
| `publishedPorts[]` | **union** | Two kits publishing the same guest port is an authoring conflict; nothing resolves it. |
| `agentContext` | **per kit; sbx only** | As of acq v3.1.0 the msb adapter does not surface it. Prefer the agent's own instructions mechanism (the team-kit template shows OpenCode's). |
| `backend_shortcuts` / `backend_extras` | **per kit** | Never compose. A shortcut skips that kit's generic path on that backend. |

Two consequences drive most of the guidance below:

- **Anything last-wins is a silent shadow.** A personal kit that sets
  `OPENCODE_CONFIG` hides the team's settings with no warning. The global
  `usai-provider` kit deliberately merges into OpenCode's *global config path*
  and leaves `OPENCODE_CONFIG` free for the team layer (see its ADR 0004);
  keep it that way in your kits.
- **Files are whole-file.** Never ship a file another layer or the image also
  owns (`~/.bashrc`, `~/.gitconfig`). Ship drop-ins and includes instead.

## Kit, image, or host-side secret?

**Config in kits; toolchains in the image; credentials host-side.**

| Put it in | When | Because |
|-----------|------|---------|
| **a kit** | declarative config: egress, files, env, agent instructions, small idempotent startup steps | cheap to change, versioned with the team, re-applied on run (msb) |
| **the image** (`ACQ_IMAGE`) | anything *installed*: language toolchains, package managers, CLIs the team depends on | create-time installs run through the sandbox proxy and a blip fails the whole create; a baked image is deterministic. The published devenv image under [`../images/devenv/`](../images/devenv/) is the precedent. |
| **`acq secret set`** | every credential: VCS tokens, API keys | the proxy injects the real value in transit; the sandbox only ever holds a placeholder. Never in a spec, not even in `environment`. |

```bash
acq secret set -g <service> --host <host> --env <VAR>   # once per machine, host-side
```

## What belongs in each layer

### Team kit

| Need | Mechanism |
|------|-----------|
| Egress for team hosts (VCS, package mirrors, MCP servers) | `caps.network.allow` (union) |
| Conventions the agent must follow across the team's repos | A markdown file under `files/`, registered in the agent's instructions path (OpenCode: an `instructions` entry in a team config file) |
| Team agent settings that override the global defaults | Ship a config file and point the agent's config env var at it (OpenCode: `OPENCODE_CONFIG` in `environment`), giving the tier global → team → repo |
| Shared skills | Directories under `files/home/.agents/skills/<name>/`, each file listed in `files[]` |
| Small per-sandbox setup that must *run* | `commands[]` with `phase: startup`, idempotent (for example `git config --global` keys) |
| A team VCS token | **Not in the kit.** `acq secret set -g <service> --host <vcs-host> --env <TOKEN_VAR>` |

### Personal kit

| Need | Mechanism |
|------|-----------|
| Aliases, prompt, shell functions | `files/home/.rc.d/NN-name.sh` drop-ins sourced by interactive shells (the team kit or image wires the loop) |
| Your working shell | An `exec zsh` line in a `99-` drop-in, so it sorts last |
| Terminfo for your terminal | Ship the *source* (`infocmp -x`) and compile it in a startup step (`tic -x`) |
| Git preferences | One startup command per key, or ship a file and add it with `include.path` |
| Overriding a team setting | `environment` (last wins) or a later file at the same path (last wins) — deliberately, and only for settings the team marks as personal |
| Extra egress for your tools | `caps.network.allow` (union) |

### Neither

- **Tools and toolchains.** Bake them into the image (`ACQ_IMAGE`).
- **Secrets.** Host-side only.
- **Whole shared files** (`~/.bashrc`, `~/.zshrc`, `~/.gitconfig`).
- **Binary files.** Kit file delivery is for text. Ship sources and generate
  at startup, or download in a guarded, non-fatal startup command.
- **Anything the global layer already owns**: provider config, the playbook,
  CA trust, commit signing, the `github` credential. Carry only the delta.

## Authoring gotchas

- **Startup commands re-run at every start.** Make them idempotent, and
  non-fatal where the feature is optional: guard on the tool or file
  existing, `exit 0` on the expected miss. One failing step can fail the
  create.
- **List every shipped file in `files[]`** with its in-guest absolute path.
  The sbx translation also copies the whole `files/home/` tree verbatim, but
  msb materializes only the listed records: an unlisted file silently goes
  missing there.
- **Never redeclare a credential the global layer declares** (`github`); the
  create fails with a "defined in both" error.
- **Rotate secrets without changing the placeholder.** Existing sandboxes
  captured the placeholder at creation; a new one breaks them until they are
  recreated. Re-run `acq secret set` for the same service.
- **One owner per single-valued env var.** Decide in the team kit's README
  which variables a personal kit may override.
- **`agentContext` or instructions, not both** for the same content, or the
  agent reads it twice.
- **Do not put the team's version pin in prose.** Point `ACQ_EXTRA_KITS` at a
  clone and let `git pull` or a detached checkout select the version.

## Known acq limitations (as of acq v3.1.0)

These are `acq` behaviors, not patterns. Re-check them against the acq you
run; they may be fixed.

- **Inline flow-style argv is parsed as empty.** A command written as
  `command: [git, config, --global, alias.st, status]` runs nothing, and
  `acq kit validate` reports OK. Write argv as a block list, one `- arg` per
  line, or a single `- |` block scalar for a script.
- **An inline comment after a top-level scalar becomes part of its value.**
  `name: my-team   # rename me` makes the name `my-team   # rename me`, which
  `acq kit validate` rejects as not kebab-case. Keep comments on their own
  lines above `name:`, `displayName:`, and `description:`.
- **An empty file cannot be dropped on msb.** The adapter verifies each
  `files[]` drop with `test -s`, so a zero-byte payload (a bare `.gitkeep`)
  never counts as delivered. Give placeholders a comment line.
- **A failed file drop aborts the rest of that kit's apply on msb.** The
  kit's `environment` is not recorded and its `commands[]` do not run, while
  the files dropped before the failure stay in place. The symptom is a kit
  whose files are present but whose env var and startup effects are missing;
  the cause is printed at create time as "could not place kit file".
- **`environment` values must be single-line scalars.** A block scalar is
  rejected by `acq kit validate`, so this one at least fails loudly.

## Validating and verifying

```bash
acq kit validate /path/to/your-kit      # static: spec shape, files[] sources, env names
/path/to/your-kit/scripts/verify        # live: throwaway sandbox through acq, asserts the composition
```

This repo's own gate, `acq-kits/validate-kits.py`, additionally checks the
JSON Schema; run it on a copy of a template if you want that check too. Record
your team's non-obvious choices as ADRs next to the kit (`docs/decisions/`):
future teammates inherit the *why*, not just the YAML.

## Template and reference implementation

- [`../acq-kits/examples/team-kit/`](../acq-kits/examples/team-kit/) is the
  copy-and-rename starting point for the team layer. Every extension point
  carries one live, harmless value that the schema checks and its
  `scripts/verify` asserts, together with the composition rules in the table
  above. A personal-kit template follows the same shape; the team template's
  README says what differs.
- The reference implementation is login.gov Team Data's team kit
  (`acq-kits/team-data/` in their `data-warehouse-ag` repository), in
  production since June 2026, with a personal-kit example beside it. The
  gotchas above are the ones that team hit; this doc is the generalization.

See [ADR 0005](decisions/0005-kit-templates.md) for why these are templates
rather than a parameterized kit, and where they live.
