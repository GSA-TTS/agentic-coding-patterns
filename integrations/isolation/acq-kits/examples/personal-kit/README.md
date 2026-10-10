# personal-kit (template for your own acq mixin kit, `hybrid/v1`)

A **template, not a deployable kit**: the starting point for your personal
scope-layer mixin, the last kit in the stack, on top of the global kits and
your team's kit. `acq` never applies this directory; you copy it into a repo
you own (a dotfiles repo is ideal), rename it, and grow it. The pattern, the
per-field composition rules, the authoring gotchas, the backend differences,
and the parser rules to check against your `acq` are in
`integrations/isolation/docs/scope-layers.md` in
[agentic-coding-patterns](https://github.com/GSA-TTS/agentic-coding-patterns)
(the pattern doc); the placement decision is ADR 0005 beside it, in
`docs/decisions/`.

> **Tested on msb only.** This template and its `scripts/verify` have not been
> tested on sbx and may not work there. Run `scripts/verify` on sbx before
> relying on it.

```text
global    zscaler-ca-certificate · usai-provider · agentic-coding-playbook · git-ssh-sign   (acq, everyone)
agent     the agent's own kit (opencode for `acq run opencode`)                              (acq, per agent)
team      your team's kit                                                                    (ACQ_EXTRA_KITS, first)
personal  your copy of this kit                                                              (ACQ_EXTRA_KITS, last)
repo      the repo's AGENTS.md / .opencode/                                                  (read by the agent)
```

## Use

1. Copy this directory into a repo you own and **rename both the directory
   and `name:` in `spec.yaml`** (kebab-case; keep them equal). Update
   `displayName:` and `description:`.
2. Replace every value marked `REPLACE` in `spec.yaml` and in the files under
   `files/`. Each extension point ships one live, harmless value so the schema
   and `scripts/verify` exercise it; leave a value in place only if you
   actually want it.
3. Apply it last, after your team's kit. List it in `PERSONAL_KITS` before
   your shell rc sources the team kit's `env.sh`, which puts your kits after
   the team's (see "Host-side defaults" in the pattern doc), then start
   sandboxes as usual:

   ```bash
   # shell rc (bash or zsh)
   export TEAM_KIT=/path/to/team-repo/acq-kits/team-kit
   PERSONAL_KITS="/path/to/dotfiles/personal-kit"
   . "$TEAM_KIT/env.sh"
   ```

   ```bash
   acq run opencode /path/to/project
   ```

4. Validate on every change, and run the live check when the spec or a payload
   changes:

   ```bash
   acq kit validate /path/to/dotfiles/personal-kit
   TEAM_KIT=/path/to/team-repo/acq-kits/team-kit /path/to/dotfiles/personal-kit/scripts/verify
   ```

Your kit is last, so wherever a field is last-wins (`environment`, `files[]`
by path) yours silently shadows the team's. Override a team setting only where
the team kit's README says a personal kit may.

## What it carries (as shipped)

| Extension point | Live value | Replace with |
|-----------------|------------|--------------|
| `caps.network.allow` | `example.net` (an IANA-reserved example domain no other layer allows, so `scripts/verify` can observe it) | the hosts your own tools need, or nothing |
| `files[]` | `.rc.d/50-example.sh` (one alias), `personal/tui.jsonc` (OpenCode TUI theme) | your drop-ins and personal config files (one `files[]` record per file) |
| `commands[]` | `git config --global alias.st status` | your own idempotent steps |
| `environment` | `OPENCODE_TUI_CONFIG` → your `tui.jsonc` (this overrides a team `tui.jsonc`; keep it only if the team kit's README allows that, and `scripts/verify` skips its checks once you remove it) | more non-secret personal settings |

## What to put where

| You want | Do this |
|----------|---------|
| Aliases, prompt, shell functions | A `files/home/.rc.d/NN-name.sh` drop-in plus its `files[]` record. `acq`'s `~/.profile` sources them in lexical order in every bash login shell, scripted `bash -lc` runs included, so add no loop of your own. Keep them POSIX and safe without a terminal; wrap interactive-only lines in `case $- in *i*) ... esac`. |
| zsh as your working shell | An `exec zsh` line in a `99-` drop-in, so it sorts last, guarded so it runs only in an interactive shell on a terminal, never swallows a `bash -lic '...'` command string (`BASH_EXECUTION_STRING`), and never re-fires in a `bash` you start from zsh (see `files/home/.rc.d/50-example.sh`), plus a startup step that gives `~/.zshrc` its own `~/.rc.d` loop (commented example in `spec.yaml`), since `acq`'s loop runs only in bash |
| Terminfo for your terminal | Ship the source (`infocmp -x`) and compile it in a startup step (`tic -x`); the commented example in `spec.yaml` shows how |
| Git preferences | One startup step per key, or ship `files/home/personal/gitconfig` and register it once with `include.path`; read its keys back with `git config --global --includes KEY`. A per-remote identity goes in a fragment behind `includeIf "hasconfig:remote.*.url:…"` (commented example in `spec.yaml`) |
| An OpenCode theme or keybinds | Edit `files/home/personal/tui.jsonc` |
| Config for your own tools | One `files[]` record per file under `files/home/.config/<tool>/`. These are copies of your host config kept in sync by hand; expect sandbox-specific trims, because the sandbox runs the image's pinned version of the tool (see TROUBLESHOOTING). |
| Personal CLI tools | The image first: anything the team needs belongs there. Git config that points at such a tool (`core.pager = delta`, say) goes in its own fragment, registered with `include.path` inside the install step only while `command -v` finds the tool; otherwise a skipped install leaves git broken. For a tool only you want, and only if the image ships Nix, a guarded, non-fatal `nix profile install` startup step pinned to the image's nixpkgs rev (commented in `spec.yaml`). It is a startup step, not `phase: install`, so a failed download skips that tool instead of failing the create. |
| Extra egress | `caps.network.allow` (union across kits) |

## What it does not carry, on purpose

- **Whole shared files** (`~/.bashrc`, `~/.zshrc`, `~/.gitconfig`). Files are
  whole-file and last-wins, so shipping one clobbers the image's copy and any
  earlier layer's. Append-if-absent startup steps and includes compose.
- **Binary files.** Kit file delivery is for text; ship sources and generate
  at startup. A compiled terminfo entry in `files[]`, for example, fails the
  create with "Unterminated quoted string".
- **Secrets.** `acq secret set -g <service> --host <host> --env <VAR>` on the
  host; the sandbox only ever sees a placeholder.
- **Team or global settings.** Whatever your team or the global layer already
  owns stays there; carry only your own delta.

## Verifying

```bash
./scripts/verify                          # stacks on ../team-kit/ by default
TEAM_KIT=/path/to/team-kit ./scripts/verify
KEEP=1 ./scripts/verify                   # keep the sandbox and work dir for inspection
```

It validates both kits, then creates a throwaway sandbox through `acq`, which
applies the pinned built-in bundle plus, via `ACQ_EXTRA_KITS`, the team kit and
then this kit. It asserts that the global and team layers are intact under your
kit, that every live value above landed, that a bash login shell sources the
drop-in exactly once (twice means some layer added its own `~/.rc.d` loop),
that a scripted `bash -lc` still runs its command, and that both kits'
variables, files, and egress hosts coexist. When you point
`TEAM_KIT` at your team's kit, also set the `TEAM_*` variables
(`TEAM_CONFIG`, `TEAM_CONVENTIONS`, `TEAM_GIT_KEY`, `TEAM_GIT_VALUE`,
`TEAM_EGRESS_HOST`) to what it ships, and `UNLISTED_EGRESS_HOST` if your team
kit allows `example.com`. Each egress host must answer at `/` with a code
other than the backend's deny response (000 on msb, 403 on sbx). Extend
its clearly marked **PERSONAL** section as your kit grows, one assertion per
mechanism you add.

## Backend parity

The kit uses no backend-specific features: it is declarative only (`caps`,
`files[]`, `commands[]`, `environment`), with no `backend_shortcuts` or
`backend_extras`, and `scripts/verify` uses only `acq` verbs. The backends
still behave differently (who runs a command with no `user:`, how kits
re-apply, unlisted files, SSH egress); "Backend differences" in the pattern
doc is the list. Keep this section in your copy and add anything
backend-specific your kit introduces.

## Troubleshooting

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
