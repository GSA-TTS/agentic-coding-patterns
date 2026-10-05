# Scope layers: global, team, and personal kits

How a team, and each person on it, layers sandbox configuration on top of the
global kits `acq` applies for everyone. Nothing here needs a change to `acq` or
to this repo: the mechanism is `ACQ_EXTRA_KITS`, and the vocabulary is the
neutral `hybrid/v1` kit spec
([ADR 0001](decisions/0001-neutral-hybrid-v1-acq-kits.md)). Every command below
is an `acq` command, so the steps are the same on every backend. The backends
still behave differently in places; [Backend differences](#backend-differences)
lists them.

The rules here describe `acq`'s current behavior. A few depend on `acq`
parser details that may change; [Check against your
acq](#check-against-your-acq) lists those.

## The layer model

```text
  applied by acq, in this order (later kits win where a field is last-wins)
  ┌────────────────────────────────────────────────────────────────────────┐
  │ global    zscaler-ca-certificate · usai-provider ·                      │  pinned built-in bundle
  │           agentic-coding-playbook · git-ssh-sign                        │  (everyone)
  │ agent     the agent's own kit (opencode for `acq run opencode`)         │  pinned by acq, per agent
  │ team      your team's kit                                               │  ACQ_EXTRA_KITS, first
  │ personal  your own kit                                                  │  ACQ_EXTRA_KITS, later
  └────────────────────────────────────────────────────────────────────────┘
  repo       AGENTS.md · .opencode/ · the repo's own agent config            read by the agent,
                                                                             not applied by acq
```

- **Global.** `acq` applies its pinned built-in bundle first, in the order
  shown. Everyone gets it; a lower layer never redeclares it.
- **Agent.** For an agent `acq` ships a kit for (OpenCode), `acq` applies that
  pinned kit next; it installs the agent's CLI. It is not applied when `--kit`
  refs are given.
- **Team.** One more `hybrid/v1` mixin kit, kept in a repo the team owns,
  carrying only the *team delta*: extra egress, conventions, shared agent
  settings, skills, a few idempotent startup steps.
- **Personal.** The same shape, kept in a repo you own (a dotfiles repo is
  ideal): shell drop-ins, git preferences, a TUI theme, tools you want.
- **Repo.** The workspace's own `AGENTS.md`, `.opencode/`, or equivalent. It
  sits above the kits in precedence *for the agent*, but it is not a kit:
  the agent reads it from the mounted workspace; `acq` never applies it.

`ACQ_EXTRA_KITS` is whitespace-separated and ordered. Each entry is a local
path or a `git+https://…#ref=<sha>&dir=<path>` ref. `acq` does not remove
duplicates: a kit listed twice is applied twice, startup commands included.

### Host-side defaults

Keep the team's host-side defaults in a small POSIX-sh `env.sh` inside the
team kit, and have each teammate's shell rc source it:

```bash
# in your shell rc (bash or zsh)
export TEAM_KIT=/path/to/team-repo/acq-kits/team-kit
PERSONAL_KITS="/path/to/dotfiles/personal-kit"    # optional, in order
. "$TEAM_KIT/env.sh"
```

```bash
# then, as usual
acq run opencode /path/to/project
```

- It rebuilds `ACQ_EXTRA_KITS` as the team kit, then any kits already in it,
  then `PERSONAL_KITS`, dropping repeats. Later kits win on overlap, so every
  kit a teammate adds, a catalog kit's `git+https` ref included, lands after
  the team kit. Nested shells (a tmux pane, `exec zsh`) re-source the rc, so
  a plain `ACQ_EXTRA_KITS="$ACQ_EXTRA_KITS …"` would add the kit again each
  time.
- Other defaults, such as `ACQ_IMAGE`, apply only when the teammate has not
  set them. Defaults change for everyone with `git pull`.
- The rc names the kit directory because a sourced file cannot find its own
  directory the same way in bash and zsh. Paths must not contain whitespace.
- It is not a kit payload: list it in neither `files[]` nor the spec.
- An exported `ACQ_EXTRA_KITS` turns off the kits chosen with `acq
  configure` (see [Check against your acq](#check-against-your-acq)).

The team-kit template ships an `env.sh` to start from.

### Recreating a sandbox

At creation, `acq` records the sandbox's extra kits (`ACQ_EXTRA_KITS` and any
`--kit` refs) on the host. When `acq run` reattaches to that sandbox and the
record lists extras, the record replaces the current shell's
`ACQ_EXTRA_KITS`. So a change to the extras set, or to a
`git+https://…#ref=` pin, never reaches an existing sandbox: `acq rm <name>`
and recreate. A local clone path is recorded as a path, so content changes in
that clone are picked up wherever kits are re-applied.

A recreate discards everything the guest holds outside a host mount,
including the agent's session history (OpenCode keeps it under
`~/.local/share/opencode`). To keep it, copy it into a host mount first, for
example with SQLite's `VACUUM INTO` run through `acq exec`.

Whether new kit content reaches an existing sandbox without a recreate
depends on the backend; see [Backend differences](#backend-differences).

A background daemon that a startup step launches (a web UI serving agent
sessions, for example) reads its configuration once, when it starts. After a
kit change reaches the sandbox, run `acq restart <sandbox>` so the daemon
starts again with the new files and environment.

## How stacked kits compose, field by field

On msb, `acq`'s adapter composes the kits itself, so the rules below are
`acq`'s code. On sbx, `acq` translates each kit to a native sbx kit and
**sbx** composes them; where a row says "sbx: composed natively", `acq` does
not decide the outcome. The team-kit template's `scripts/verify` asserts the
`environment`, `files[]`, `commands[]`, and `caps.network.allow` rows live
against a competing kit, on whichever backend runs it, so run it on sbx to
confirm those rows there. The `volumes[]` and `commands[]` rows describe
current behavior; the rule for conflicts between stacked kits' volumes and
startup steps is still under discussion upstream in `acq`.

| Field | Rule | What it means when you stack |
|-------|------|-------------------------------|
| `caps.network.allow` | **union** | Every kit's hosts are allowed. Overlap with the global layer is harmless. Under org governance, org rules still win. msb strips a `:port` suffix, so `host:443` allows the whole host there. |
| `caps.network.tier` | **not per kit** | A kit's `tier` field is not read when kits are applied. msb: the tier is sandbox-wide, from `ACQ_NETWORK_TIER` (default `balanced`). sbx: `ACQ_NETWORK_TIER` is not read; egress posture is sbx's own policy. |
| `files[]` | **msb: last wins, by path** | msb: a whole-file overlay. A later kit's file at the same in-guest `path` replaces the earlier one, silently and in full. Nothing merges. sbx: composed natively; `acq` copies each kit's whole `files/` tree, placement follows where a file sits in that tree, and `files[].path` is used only for its mode. |
| `commands[]` | **append, in kit order** | Each kit's commands run in spec order; kits run in application order. `startup` re-runs at every start; on msb that means every re-apply (`acq run` on an existing sandbox, `acq start`, `acq restart`). `install` runs once per sandbox; on msb its once-marker is a hash of the argv alone, so identical install argv in two kits runs once and a changed argv runs again. |
| `environment` | **msb: last wins, by name** | msb: a later kit's value for the same `NAME` replaces the earlier one, silently. Sessions and every kit's `commands[]` (daemons they start included) see the merged result. sbx: each kit emits its variables and sbx merges them. Either way, give single-valued variables such as `OPENCODE_CONFIG` exactly one owner in the stack. |
| `volumes[]` | **msb: union, last wins by path** | msb: two kits declaring the same mount path, the later kit's entry is used. sbx: composed natively (not verified). |
| `publishedPorts[]` | **msb: union, last wins by guest port** | msb: two kits publishing the same guest port, the later kit's entry is used. A port without `host:` gets a free host port per sandbox; a `host:` port already in use fails the create. sbx: composed natively (not verified); the host port is ephemeral. |
| `agentContext` | **per kit; sbx only** | The msb adapter does not surface it. Prefer the agent's own instructions mechanism (the team-kit template shows OpenCode's). |
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
| Conventions the agent must follow across the team's repos | A markdown file under `files/`, registered in the agent's instructions path (OpenCode: an `instructions` entry in a team config file). OpenCode 2.x does not load `instructions` files (see [Check against your acq](#check-against-your-acq)). |
| Team agent settings that override the global defaults | Ship a config file and point the agent's config env var at it (OpenCode: `OPENCODE_CONFIG` in `environment`), giving the tier global → team → repo. Never pin `model` / `small_model` there, and never add an `allow` rule that overrides a global ask or deny (see the gotchas). |
| Team TUI settings (OpenCode theme, keybinds) | A separate `tui.jsonc`, with `OPENCODE_TUI_CONFIG` pointing at it: OpenCode drops `theme` / `keybinds` / `tui` from `opencode.json(c)` on load. The variable is single-valued, so say in the team README whether a personal kit may override it. |
| Gating a team CLI (for example the VCS CLI) | Permission rules in the team config, in the same default-allow posture as the global kit: reads fall through to its `"*": "allow"`; `ask` before anything that posts or opens a merge request; `deny` merge and approve, pipeline runs, CI variables, destructive admin commands, and the `api` subcommand's write flags and GraphQL. Any write verb you do not list stays allowed, so review your CLI's close, edit, delete, label, release, and CI retry verbs. Rules match the whole command text, so write each from the exact command prefix and see the gotchas. The team-kit template's `opencode.jsonc` sketches the shape. |
| Shared skills | Directories under `files/home/.agents/skills/<name>/`, each file listed in `files[]`, named so they cannot collide with the playbook's skills (see the gotchas) |
| Small per-sandbox setup that must *run* | `commands[]` with `phase: startup`, idempotent (for example `git config --global` keys) |
| A team VCS token | **Not in the kit.** `acq secret set -g <service> --host <vcs-host> --env <TOKEN_VAR>`, plus HTTPS routing for git (below) |

#### Git over HTTPS (team VCS and GitHub)

Route git over HTTPS and let the proxy supply the token. SSH remotes do not
work through msb's egress (see [Backend differences](#backend-differences)), and a team checkout
usually carries one: `--clone` inherits the host's `git@host:` origin, and
some tools (flake inputs, for example) use the `ssh://git@host/` form. One
idempotent startup step (`user: "1000"`) rewrites both forms and adds a
credential helper that reads the proxy-injected variable. For a team VCS:

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

GitHub needs the same routing. acq binds the GitHub token
(`acq secret set -g github`) to `github.com` for HTTPS git on msb, but no
global kit rewrites GitHub's SSH remotes or registers a helper, so an
SSH origin fails in an msb guest. The same step covers it:

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://github.com".insteadOf "ssh://git@github.com"
git config --global credential."https://github.com".helper \
  '!f() { echo username=x-access-token; echo "password=${GITHUB_TOKEN:-}"; }; f'
```

GitHub routing is the same for every team, so it belongs in the global layer
(the kit or `acq` itself that binds the GitHub token) rather than in each team
kit. Until it is there, a team kit carries it, and should drop it once the
global layer does.

### Personal kit

| Need | Mechanism |
|------|-----------|
| Aliases, prompt, shell functions | `files/home/.rc.d/NN-name.sh` drop-ins. Neither the image nor the global layer sources `~/.rc.d`, so one kit must wire the loop: the team kit if it does (the reference implementation's does), otherwise the personal kit. Either way, an append-if-absent startup step adds `case $- in *i*) for f in "$HOME"/.rc.d/*.sh; do [ -r "$f" ] && . "$f"; done ;; esac` to `~/.bashrc`, skipped when a line there already sources `~/.rc.d`. Only one layer should wire it, or drop-ins run twice. |
| Your working shell | An `exec zsh` line in a `99-` drop-in, so it sorts last. The loop's interactive guard (`case $- in *i*)`) is required, or the drop-in hijacks scripted `bash -lc` runs. zsh does not read `~/.bashrc`: give `~/.zshrc` its own loop with a second append-if-absent step, and make the `exec` line skip when it is already in zsh (`[ -z "${ZSH_VERSION:-}" ]`), or zsh sourcing it through that loop re-execs forever. |
| Terminfo for your terminal | Ship the *source* (`infocmp -x`) and compile it in a startup step (`tic -x`) |
| Git preferences | One startup command per key, or ship a file and add it with `include.path` |
| Overriding a team setting | `environment` (last wins) or a later file at the same path (last wins) — deliberately, and only for settings the team marks as personal |
| Your own agent instructions (OpenCode) | A file under `files/`, added through `OPENCODE_CONFIG_CONTENT` in `environment`, for example `{"instructions":["/home/agent/personal/instructions.md"]}`. Do not append to the global rules file: the playbook kit symlinks `~/.config/opencode/AGENTS.md` and `~/.claude/CLAUDE.md` into its managed checkout, so an append edits that checkout. In a local test on OpenCode 1.18, the `instructions` lists combine in order (global, then team through `OPENCODE_CONFIG`, then this one); OpenCode's docs do not say how lists merge, and OpenCode 2.x does not load `instructions` files (see [Check against your acq](#check-against-your-acq)). Put nothing else in it: inline config loads after the repo's own config, so any other key overrides the repo. The variable is single-valued (last kit wins). |
| Extra egress for your tools | `caps.network.allow` (union) |

### Neither

- **Tools and toolchains.** Bake them into the image (`ACQ_IMAGE`).
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
  what it adds in `.git/info/exclude` so it cannot be committed. That guard
  covers only the primary: acq clones nothing else. Other writable repos in
  a multi-repo sandbox are either host checkouts (never write) or disposable
  clones the user made on the host (safe), and from inside the guest they
  look alike. Have the host mark a clone when it makes one, for example
  `git -C <clone> config sandbox.disposable true`, and write only to the
  `--clone` primary and to writable repos carrying that mark. Never write to
  an unmarked repo.
- **`environment` values are verbatim, single-line strings.** No `~`
  expansion: write `/home/agent/...`. `acq kit validate` rejects a block
  scalar.
- **List every shipped file in `files[]`** with its in-guest absolute path,
  and never ship an empty one. msb places only the listed records and rejects
  an empty payload (see [Backend differences](#backend-differences) and
  [Check against your acq](#check-against-your-acq)). Give a placeholder such
  as `.gitkeep` a comment line.
- **Rotate secrets without changing the placeholder.** Existing sandboxes
  captured the placeholder at creation; a new one breaks them until they are
  recreated. How to rotate depends on the backend (see [Backend
  differences](#backend-differences)).
- **One owner per single-valued env var.** Decide in the team kit's README
  which variables a personal kit may override.
- **No `allow` rule that overrides a global ask or deny.** OpenCode uses the
  last matching rule. On OpenCode 1.x the team config is merged key by key: a
  rule with the same pattern as a global one replaces it in the global rule's
  place, and a new pattern goes after all global rules. So a new team pattern
  such as `"git *": "allow"` beats the global `"git push *": "ask"`. OpenCode
  2.x keeps each config file's rules as a separate list, global first, then
  team. Either way, add `ask` and `deny` rules, not `allow`.
- **Permission rules match the whole command text.** That includes inline
  bodies and heredocs, and OpenCode's `*` spans spaces. A loose deny such as
  `vcs*pipe* delete*` can match an issue body that mentions both words and
  block a legitimate `vcs issue create`. Write each rule from the exact
  command prefix (`vcs pipeline delete *`), and have the agent pass post
  bodies from a file (`--body-file`, or `-d "$(cat /tmp/body.md)"`), so the
  body text never reaches the matcher.
- **Permission rules are a guardrail, not a boundary.** `env vcs …`, a full
  path to the binary, or a direct HTTP call to the VCS API all get past them.
  The real control for team-CLI writes is the scope of the token set with
  `acq secret set`: give the sandbox a least-privilege token.
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
  model endpoint on every request. On msb that breaks the session (see
  [Backend differences](#backend-differences)).
- **`agentContext` or instructions, not both** for the same content, or the
  agent reads it twice.
- **Do not put the team's version pin in prose.** Point `ACQ_EXTRA_KITS` at a
  clone and let `git pull` or a detached checkout select the version. A clone
  path suits this: the sandbox records the path, so a changed checkout reaches
  it wherever kits are re-applied (msb). A `git+https://…#ref=` pin is
  recorded as the ref itself, so changing it needs `acq rm` and recreate.

## Backend differences

A kit that uses no `backend_shortcuts` or `backend_extras` still runs on two
backends that behave differently. This is the canonical list; the composition
table above covers the per-field differences (`:port` in `caps.network.allow`,
the network tier, and the rows sbx composes natively).

| Behavior | msb | sbx |
|----------|-----|-----|
| A command with no `user:` | Runs as root: `acq` passes no user to the backend. | Runs as sbx's default exec user (not verified). Set `user:` either way. |
| `agentContext` | Not surfaced. | Surfaced to the agent. |
| New kit content on an existing sandbox | `acq run`, `acq start`, and `acq restart` re-apply every recorded kit: files refresh, `environment` is rebuilt, startup steps re-run. Egress and volumes are fixed at creation. A daemon a startup step started keeps its old configuration until `acq restart`. | `acq run` adds only kits the sandbox has not recorded, and skips a recorded kit even if its content changed. sbx refuses to add a kit with startup commands to a live sandbox and prints a recreate notice, so adding or changing a team kit means `acq rm <name>` and recreate. |
| A file under `files/` with no `files[]` record | Missing: only listed records are placed. | Delivered: the whole `files/` tree is copied. |
| SSH to a host in `caps.network.allow` | Not carried: port 22 times out or is refused, so SSH git remotes hang or fail at once. Use HTTPS (see [Git over HTTPS](#git-over-https-team-vcs-and-github)). | Has worked, but not as a documented contract. |
| A request carrying another host's secret placeholder | The proxy fails closed and drops the connection. A transcript holding a placeholder (from `env` or `printenv`) breaks every later request in that session; start a new one. | Not verified. |
| Rotating a secret | Re-run `acq secret set` for the same service. | `acq` refuses to overwrite an existing secret and prints the `sbx secret rm` command. Remove it, then set it again with the same placeholder. |
| A published port with no `host:` | `acq` picks a free host port per sandbox. | sbx picks an ephemeral host port. |

## Check against your acq

`acq` reads kit specs with a line-based parser, not a full YAML parser, and a
few of its rules are easy to break without an error. The rules below hold for
the current `acq`; after upgrading it, run `acq kit validate` and
`scripts/verify` again, and treat a rule here that no longer matches as out of
date.

- **Comments.** A trailing `# comment` is removed from values in
  `caps.network.allow`, `files[]`, `environment`, `volumes[]`, and
  `publishedPorts[]`. It is kept as part of the value in every top-level field
  (`name:`, `displayName:`, `description:`, …) and everywhere in
  `commands[]`: after `phase:` or `user:` it makes `acq` skip the whole
  command with only a warning, and after an argv item it becomes part of that
  argument. `acq kit validate` catches only a bad `name:`. **Never put a
  comment after a value in a command or a top-level field;** put it on its own
  line.
- **`#` in `environment` values.** A value is cut at its first `#`, even
  inside quotes: `FOO: "a#b"` arrives as `a`. Avoid `#` in values (URL
  fragments, `#ref=` pins, hex colors); ship such a value in a file instead.
- **Flow-style argv.** `command: [git, config, --global, alias.st, status]`
  parses as an empty argv, runs nothing, and passes `acq kit validate`. Write
  argv as a block list, one `- arg` per line, or a single `- |` block scalar.
- **OpenCode 2.x ignores `instructions`.** OpenCode 2.x accepts the
  `instructions` config field but never loads the files it lists, so team
  conventions and personal instructions delivered that way silently do not
  reach the agent. The global `~/.config/opencode/AGENTS.md` still loads.
  Which OpenCode runs depends on the image. The agent kit installs 2.x, but an
  image that bakes OpenCode 1.x puts it earlier on `PATH`, so 1.x runs and the
  files load: `acq`'s own template image for `acq run opencode`
  (`sandbox-templates:opencode-docker`) and this repo's `devenv-opencode` both
  do. An image with no OpenCode of its own, such as
  `sandbox-templates:shell-docker`, runs only the kit's 2.x, and the files
  are ignored. Check with `acq exec <sandbox> -- opencode --version`; the
  team-kit template's `scripts/verify` fails when 2.x runs.
- **Empty files and failed drops (msb).** msb checks each file drop with
  `test -s`, so a zero-byte payload never counts as placed. A failed drop
  stops the rest of that kit's apply: the files placed before it stay, but
  the kit's `environment` is not recorded and its `commands[]` do not run. The
  create output names the file ("could not place kit file").
- **`ACQ_EXTRA_KITS` and `acq configure`.** `acq configure` stores default
  extra kits as `extra_kits:` in `~/.config/acq/config.yaml`.
  - `extra_kits:` takes only catalog names (`openchamber`, `paseo`,
    `oci-engine`). A path or a `git+https` ref fails the create with "config
    extra_kits contains unknown kit", so a team kit cannot go there.
  - A catalog kit resolves to the patterns commit `acq` pins for its built-in
    bundle, so a team cannot choose a newer version of it there.
  - When `ACQ_EXTRA_KITS` is set in the environment, `acq` ignores the
    configured kits and skips the create-time kit picker, with no notice. A
    team `env.sh` therefore turns off every `acq configure` kit choice on that
    host. A teammate who also wants a catalog kit lists its
    `git+https://…#ref=` entry in `PERSONAL_KITS`, so it lands after the team
    kit (see [Host-side defaults](#host-side-defaults)).
  - The config is per host (per user account), so its kits also apply to
    sandboxes that do not use the team kit.

## Validating and verifying

```bash
acq kit validate /path/to/your-kit      # static: spec shape, files[] sources, env names
/path/to/your-kit/scripts/verify        # live: throwaway sandbox through acq, asserts the composition
```

Run `scripts/verify` on each backend your team uses. Inside this repo,
`acq-kits/validate-kits.py` additionally checks every kit and template
against the JSON Schema. It validates this repo's layout, not a standalone
kit directory, so in your own repo `acq kit validate` is the gate. Record
your team's non-obvious choices as ADRs next to the kit (`docs/decisions/`):
future teammates inherit the *why*, not just the YAML.

## Template and reference implementation

- [`../acq-kits/examples/team-kit/`](../acq-kits/examples/team-kit/) is the
  copy-and-rename starting point for the team layer. Every extension point
  carries one live, harmless value that the schema checks and its
  `scripts/verify` asserts, together with the composition rules in the table
  above. A personal kit has the same shape; [Personal kit](#personal-kit)
  above says what goes in it.
- The reference implementation is login.gov Team Data's team kit, with a
  personal-kit example beside it. The gotchas above are the ones that team
  hit; this doc is the generalization.

See [ADR 0005](decisions/0005-kit-templates.md) for why these are templates
rather than a parameterized kit, and where they live.
