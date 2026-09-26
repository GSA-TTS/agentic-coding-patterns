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
```

```bash
# then, as usual
acq run opencode /path/to/project
```

At creation, `acq` records the sandbox's extra kits (`ACQ_EXTRA_KITS` and any
`--kit` refs) on the host. When `acq run` reattaches to that sandbox and the
record lists extras, the record replaces the current shell's
`ACQ_EXTRA_KITS`. So a change to the extras set, or to a
`git+https://…#ref=` pin, never reaches an existing sandbox: `acq rm <name>`
and recreate. A local clone path is recorded as a path, so content changes in
that clone are picked up wherever kits are re-applied.

When kit content lands depends on the backend:

- **msb.** `acq run` on an existing sandbox (and `acq start` / `acq restart`)
  re-applies every recorded kit: files refresh, `environment` is rebuilt,
  startup steps re-run. Egress and volumes are fixed at creation.
- **sbx.** `acq run` on an existing sandbox adds only kits the sandbox has not
  recorded yet, and skips a recorded extra even if its content changed. sbx
  0.38 and later also refuse to add a kit with startup commands to a live
  sandbox and print a recreate notice. Every team kit has startup commands in
  practice, so on sbx adding or changing a kit means `acq rm <name>` and
  recreate.

## How stacked kits compose, field by field

Verified against `acq`'s kit-translate layer and both backend adapters at acq
v3.1.0 (`main` as of 2026-09-24). On msb, `acq`'s adapter composes the kits
itself, so the rules below are `acq`'s code. On sbx, `acq` translates each kit
to a native sbx kit and **sbx** composes them; where a row says "sbx:
composed natively", `acq` does not decide the outcome. The team-kit
template's `scripts/verify` asserts the `environment`, `files[]`,
`commands[]`, and `caps.network.allow` rows live against a competing kit. It
passed on msb 0.7.3 and on sbx 0.45.1, so on sbx those four rows are observed
behavior rather than `acq` code. Rows it does not exercise on sbx are marked
"not verified".

| Field | Rule | What it means when you stack |
|-------|------|-------------------------------|
| `caps.network.allow` | **union** | Every kit's hosts are allowed. Overlap with the global layer is harmless. Under org governance, org rules still win. msb strips a `:port` suffix, so `host:443` allows the whole host there. |
| `caps.network.tier` | **not per kit** | A kit's `tier` field is not read when kits are applied. msb: the tier is sandbox-wide, from `ACQ_NETWORK_TIER` (default `balanced`). sbx: `ACQ_NETWORK_TIER` is not read; egress posture is sbx's own policy. |
| `files[]` | **msb: last wins, by path** | msb: a whole-file overlay. A later kit's file at the same in-guest `path` replaces the earlier one, silently and in full. Nothing merges. sbx: composed natively; `acq` copies each kit's whole `files/` tree, placement follows where a file sits in that tree, and `files[].path` is used only for its mode. `scripts/verify` observed last-wins by path on sbx too. |
| `commands[]` | **append, in kit order** | Each kit's commands run in spec order; kits run in application order. `startup` re-runs at every start; on msb that means every re-apply (`acq run` on an existing sandbox, `acq start`, `acq restart`). `install` runs once per sandbox; on msb its once-marker is a hash of the argv alone, so identical install argv in two kits runs once and a changed argv runs again. |
| `environment` | **msb: last wins, by name** | msb: in sessions, a later kit's value for the same `NAME` replaces the earlier one, silently. While kits are applied, each kit's own `commands[]` see only that kit's variables. sbx: each kit emits its variables and sbx merges them; `scripts/verify` observed last-wins by name there too. Either way, give single-valued variables such as `OPENCODE_CONFIG` exactly one owner in the stack. |
| `volumes[]` | **msb: union, last wins by path** | msb: two kits declaring the same mount path, the later kit's entry is used. sbx: composed natively (not verified). |
| `publishedPorts[]` | **msb: appended** | msb: every kit's ports are appended with no de-duplication. sbx: composed natively (not verified). Two kits publishing the same guest port is an authoring conflict either way. |
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
| Team agent settings that override the global defaults | Ship a config file and point the agent's config env var at it (OpenCode: `OPENCODE_CONFIG` in `environment`), giving the tier global → team → repo. Never pin `model` / `small_model` there, and never add a broad `allow` permission rule (see the gotchas). |
| Team TUI settings (OpenCode theme, keybinds) | A separate `tui.jsonc`, with `OPENCODE_TUI_CONFIG` pointing at it: OpenCode drops `theme` / `keybinds` / `tui` from `opencode.json(c)` on load. The variable is single-valued, so say in the team README whether a personal kit may override it. |
| Read-only use of a team CLI (for example the VCS CLI) | Permission rules in the team config: deny the whole CLI, then allow-list read verbs *after* it, and allow its `api` subcommand for GET only. Unknown and write subcommands stay denied. The team-kit template's `opencode.jsonc` sketches the shape. |
| Shared skills | Directories under `files/home/.agents/skills/<name>/`, each file listed in `files[]`, named so they cannot collide with the playbook's skills (see the gotchas) |
| Small per-sandbox setup that must *run* | `commands[]` with `phase: startup`, idempotent (for example `git config --global` keys) |
| A team VCS token | **Not in the kit.** `acq secret set -g <service> --host <vcs-host> --env <TOKEN_VAR>`, plus HTTPS routing for git (below) |

#### Git to a non-GitHub team VCS

Route git over HTTPS and let the proxy supply the token. SSH remotes do not
work through msb's egress (see the known limitations), and a team checkout
usually carries one: `--clone` inherits the host's `git@host:` origin, and
some tools (flake inputs, for example) use the `ssh://git@host/` form. One
idempotent startup step (`user: "1000"`) rewrites both forms and adds a
credential helper that reads the proxy-injected variable:

```bash
git config --global url."https://git.example.gov/".insteadOf "git@git.example.gov:"
git config --global url."https://git.example.gov".insteadOf "ssh://git@git.example.gov"
git config --global credential."https://git.example.gov".helper \
  '!f() { echo username=oauth2; echo "password=${TEAM_VCS_TOKEN:-}"; }; f'
```

The two `url.` keys differ by the trailing slash on purpose: `git config`
replaces a single-valued key, so one key cannot carry both rewrites. The
helper only ever sees the placeholder in `TEAM_VCS_TOKEN`; the proxy swaps in
the real value in transit, for the host the secret is scoped to. Use the
username your VCS expects for token auth.

### Personal kit

| Need | Mechanism |
|------|-----------|
| Aliases, prompt, shell functions | `files/home/.rc.d/NN-name.sh` drop-ins. Neither the image nor the global layer sources `~/.rc.d`, so one kit must wire the loop: the team kit if it does (the reference implementation's does), otherwise the personal kit. Either way, an append-if-absent startup step adds `case $- in *i*) for f in "$HOME"/.rc.d/*.sh; do [ -r "$f" ] && . "$f"; done ;; esac` to `~/.bashrc`, skipped when a line there already sources `~/.rc.d`. Only one layer should wire it, or drop-ins run twice. The personal-kit template does this, and skips when a lower layer already has. |
| Your working shell | An `exec zsh` line in a `99-` drop-in, so it sorts last. The loop's interactive guard (`case $- in *i*)`) is required, or the drop-in hijacks scripted `bash -lc` runs. Also guard the `exec` on `BASH_EXECUTION_STRING` being empty (`bash -ic '...'` is interactive, with or without a terminal, and bash sets that variable whenever it runs a command string), on `ZSH_VERSION` being empty, and on an exported handoff marker, or zsh sourcing the same drop-in re-execs itself forever. The personal-kit template's `50-example.sh` carries the full guard. zsh does not read `~/.bashrc`: give `~/.zshrc` its own loop with a second append-if-absent step. |
| Terminfo for your terminal | Ship the *source* (`infocmp -x`) and compile it in a startup step (`tic -x`) |
| Git preferences | One startup command per key, or ship a file and add it with `include.path` |
| Overriding a team setting | `environment` (last wins) or a later file at the same path (last wins) — deliberately, and only for settings the team marks as personal |
| Extra egress for your tools | `caps.network.allow` (union) |

### Neither

- **Tools and toolchains.** Bake them into the image (`ACQ_IMAGE`). The one
  exception is a tool only you want in your personal kit: a guarded,
  non-fatal startup step, never `phase: install` (the personal-kit template
  shows one).
- **Secrets.** Host-side only.
- **Whole shared files** (`~/.bashrc`, `~/.zshrc`, `~/.gitconfig`).
- **Binary files.** Kit file delivery is for text. Ship sources and generate
  at startup, or download in a guarded, non-fatal startup command.
- **Anything the global layer already owns**: provider config, the playbook,
  CA trust, commit signing. Carry only the delta.
- **Credentials.** `hybrid/v1` has no credentials vocabulary; credentials are
  host-side via `acq secret set`.

## Authoring gotchas

- **Always set `user:` on every command.** Use `"1000"` for the agent user.
  An omitted `user:` does not mean the agent user: `acq` passes no user to the
  backend, so on msb the command runs as root.
- **Startup commands re-run at every start.** Make them idempotent, and
  non-fatal where the feature is optional: guard on the tool or file
  existing (`command -v tool >/dev/null 2>&1 || exit 0`), so a stock image
  without the tool skips the step. One failing step can fail the create.
- **Guard `.` on the file existing** in a `sh -c` script. `.` is a POSIX
  special builtin: when the file is missing, dash exits the whole script, and
  `|| true` does not catch it. Write `[ -r f ] && . f`.
- **Do not assume the working directory.** Startup commands do not run in
  the workspace. `acq` exports `ACQ_WORKSPACE` (the primary workspace's mount
  root) and, under `--clone` only, `ACQ_CLONE=1` into the guest on both
  backends. A step that writes into the repo must require `ACQ_CLONE=1`, so it
  never touches a host checkout mounted in passthrough mode, and should list
  what it adds in `.git/info/exclude` so it cannot be committed.
- **`environment` values are verbatim.** No `~` expansion: write
  `/home/agent/...`.
- **List every shipped file in `files[]`** with its in-guest absolute path.
  The sbx translation also copies the whole `files/` tree verbatim, but
  msb materializes only the listed records: an unlisted file silently goes
  missing there.
- **Rotate secrets without changing the placeholder.** Existing sandboxes
  captured the placeholder at creation; a new one breaks them until they are
  recreated. On msb, re-run `acq secret set` for the same service. On sbx,
  `acq` refuses to overwrite an existing secret and prints an `sbx secret rm`
  hint: remove it and set it again with the same placeholder (the team-kit
  template's TROUBLESHOOTING has the entry).
- **One owner per single-valued env var.** Decide in the team kit's README
  which variables a personal kit may override.
- **No broad `allow` permission rule in the team config.** OpenCode evaluates
  the last matching rule, and a rule the team tier adds lands after the global
  kit's rules, so a team `allow` can silently defeat the global ask/deny
  gates. Add narrow rules, and prefer `deny`.
- **Do not pin `model` or `small_model` in the team config.** The global
  provider kit updates its defaults as the provider's model catalog changes; a
  team pin overrides that and can outlive the model it names.
- **TUI settings need their own file.** OpenCode drops top-level `theme`,
  `keybinds`, and `tui` from `opencode.json(c)` on load, so they vanish from a
  team `opencode.jsonc` without an error. Ship a `tui.jsonc` and set
  `OPENCODE_TUI_CONFIG`.
- **Name team skills so they cannot collide with the playbook's.** The global
  playbook kit symlinks its skills into the same `~/.agents/skills` directory
  at every start (`ln -sfn`). A team skill with the same name as a playbook
  skill (`code-review`, say) shadows it and collects a stray nested symlink.
  Prefix team skills (`team-code-review`).
- **Never print the environment in an agent session.** `env` or `printenv`
  puts secret placeholders into the transcript, which the agent replays to the
  model endpoint on every request. On msb that request then fails (see the
  known limitations).
- **`agentContext` or instructions, not both** for the same content, or the
  agent reads it twice.
- **Do not put the team's version pin in prose.** Point `ACQ_EXTRA_KITS` at a
  clone and let `git pull` or a detached checkout select the version. A clone
  path suits this: the sandbox records the path, so a changed checkout reaches
  it wherever kits are re-applied (msb). A `git+https://…#ref=` pin is
  recorded as the ref itself, so changing it needs `acq rm` and recreate.

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
- **msb egress admits no SSH to allowed hosts.** A host in
  `caps.network.allow` is reachable over HTTPS, but an SSH connection to it on
  port 22 times out, so SSH git remotes hang. HTTPS is the supported git path;
  see "Git to a non-GitHub team VCS" above. sbx has carried SSH to allowed
  hosts, but not as a documented contract.
- **A placeholder in a transcript breaks the session on msb.** msb swaps a
  secret's real value in at its proxy only for the host the secret is scoped
  to. When a transcript contains another secret's placeholder (from `env` or
  `printenv`), the request to the model endpoint carries it, the proxy fails
  closed and drops the connection, and every later request in that session
  fails the same way. Not verified on sbx.

## Validating and verifying

```bash
acq kit validate /path/to/your-kit      # static: spec shape, files[] sources, env names
/path/to/your-kit/scripts/verify        # live: throwaway sandbox through acq, asserts the composition
```

Inside this repo, `acq-kits/validate-kits.py` additionally checks every kit
and template against the JSON Schema. It validates this repo's layout, not a
standalone kit directory, so in your own repo `acq kit validate` is the gate. Record
your team's non-obvious choices as ADRs next to the kit (`docs/decisions/`):
future teammates inherit the *why*, not just the YAML.

## Template and reference implementation

- [`../acq-kits/examples/team-kit/`](../acq-kits/examples/team-kit/) is the
  copy-and-rename starting point for the team layer. Every extension point
  carries one live, harmless value that the schema checks and its
  `scripts/verify` asserts, together with the composition rules in the table
  above.
- [`../acq-kits/examples/personal-kit/`](../acq-kits/examples/personal-kit/)
  is the same for the personal layer: shell drop-ins with the `~/.rc.d` loop
  wired, a git preference, and an OpenCode TUI theme through
  `OPENCODE_TUI_CONFIG`. Its `scripts/verify` stacks it on a team kit (the
  team-kit template by default) and asserts the three-layer stack: the global
  and team layers survive under it, and both kits' values coexist.
- The reference implementation is login.gov Team Data's team kit, in
  production since June 2026, with a personal-kit example beside it. The
  gotchas above are the ones that team hit; this doc is the generalization.

See [ADR 0005](decisions/0005-kit-templates.md) for why these are templates
rather than a parameterized kit, and where they live.
