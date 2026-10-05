# team-kit (template for a team's acq mixin kit, `hybrid/v1`)

A **template, not a deployable kit**: the starting point for a team's own
scope-layer mixin, the layer between the global kits `acq` applies for
everyone and each repo's own agent config. `acq` never applies this directory;
you copy it into a repo your team owns, rename it, and grow it. The pattern,
the per-field composition rules, the authoring gotchas, the backend
differences, and the parser rules to check against your `acq` are in
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
team      your copy of this kit                                                              (ACQ_EXTRA_KITS)
personal  a teammate's own kit                                                               (ACQ_EXTRA_KITS, later)
repo      the repo's AGENTS.md / .opencode/                                                  (read by the agent)
```

## Use

1. Copy this directory into your team's repo and **rename both the directory
   and `name:` in `spec.yaml`** (kebab-case; keep them equal). Update
   `displayName:` and `description:`.
2. Replace every value marked `REPLACE` in `spec.yaml`, and rewrite
   `files/home/team-config/team-conventions.md` for your team. Each extension
   point ships one live, harmless value so the schema and `scripts/verify`
   exercise it; leave a value in place only if you actually want it.
3. Apply it after the global kits. Each teammate sources the kit's `env.sh`
   from their shell rc, then starts sandboxes as usual:

   ```bash
   # shell rc (bash or zsh)
   export TEAM_KIT=/path/to/your-team-repo/acq-kits/your-team
   . "$TEAM_KIT/env.sh"
   ```

   ```bash
   acq run opencode /path/to/project
   ```

   `env.sh` puts the team kit first in `ACQ_EXTRA_KITS`, and sets `ACQ_IMAGE`
   if you enable it. It is host-side: keep it out of `files[]`. How it works,
   and how it interacts with `acq configure`: "Host-side defaults" in the
   pattern doc.

4. Validate on every change, and run the live check when the spec or a payload
   changes:

   ```bash
   acq kit validate /path/to/your-team-kit
   /path/to/your-team-kit/scripts/verify
   ```

Teammates stack their own kits *after* yours by listing them in
`PERSONAL_KITS` before sourcing `env.sh` (a catalog kit's `git+https` ref
goes here too):

```bash
PERSONAL_KITS="/path/to/personal-kit"
```

Later kits win wherever a field is last-wins (`environment`, `files[]` by
path). Say in this README which of your settings a personal kit may override.

## What it carries (as shipped)

| Extension point | Live value | Replace with |
|-----------------|------------|--------------|
| `caps.network.allow` | `example.org` (an IANA-reserved example domain the global layer does not allow, so `scripts/verify` can observe it) | your team's VCS, package-mirror, and MCP hosts |
| `files[]` | `team-config/opencode.jsonc`, `team-config/team-conventions.md`, a non-empty `.agents/skills/.gitkeep` placeholder (msb rejects empty files) | your conventions, settings, and skills (one `files[]` record per file) |
| `commands[]` | `git config --global push.autoSetupRemote true` at startup | your idempotent per-sandbox setup steps |
| `environment` | `OPENCODE_CONFIG` → the team `opencode.jsonc` | more non-secret settings; never a credential |

The OpenCode wiring gives the settings tier global → team → repo: the global
`usai-provider` kit merges into OpenCode's global config path and leaves
`OPENCODE_CONFIG` free for this layer. The rest of the kit is agent-agnostic.
The conventions file reaches the agent through OpenCode's `instructions`
field, which only OpenCode 1.x loads; `scripts/verify` fails when sandbox
shells run 2.x (see "Check against your acq" in the pattern doc).

## What it does not carry, on purpose

- **Tools and toolchains.** Bake them into the image and point `ACQ_IMAGE` at
  it; the published devenv image in this repo is the precedent.
- **Secrets.** `acq secret set -g <service> --host <host> --env <VAR>` on the
  host; the sandbox only ever sees a placeholder.
- **Whole shared files** (`~/.bashrc`, `~/.gitconfig`) or **binary files**.
- **Anything the global layer already owns.**

## Writing a skill

A skill is a directory under `files/home/.agents/skills/<name>/` holding a
`SKILL.md` with two frontmatter fields, `name` and `description`, followed by
the procedure. The agent picks a skill by matching its description to the
request.

- **Pick a name the global playbook kit does not use.** The playbook symlinks
  its own skills into the same directory at every start, so a same-named team
  skill collides with one of them (use `team-code-review`, not
  `code-review`).
- **Put the trigger phrases in the description**, worded the way a teammate
  would ask, plus one sentence on what the skill produces.
- **Write only the delta:** team conventions, sandbox constraints, the output
  contract. Generic advice on how to do the task is padding.
- **Say what the agent must never do on its own** (post, approve, push). The
  team `opencode.jsonc` can gate the commands; the skill is where the agent
  learns the rule.
- **Keep it small.** Every session loads the description, so keep it under
  1024 characters; keep the body under 500 lines and move reference material
  into sibling files the body points to.
- **Register every file** in the skill directory as a `files[]` record.
- **Check that the description wins.** Several playbook skills cover nearby
  tasks. In a sandbox, ask for the task three ways, one without naming the
  skill, and confirm yours loads. Repeat when the playbook pin changes.

## Verifying

```bash
./scripts/verify            # needs acq on PATH (or ACQ_DIR) and a sandbox-capable host
KEEP=1 ./scripts/verify     # keep the sandbox and work dir for inspection
```

It validates the spec, then creates a throwaway sandbox through `acq`, which
applies the pinned built-in bundle plus, via `ACQ_EXTRA_KITS`, a generated
**lower fixture kit** and then this kit. It asserts that the global layer is
intact, that every live value above landed, and that the composition rules from
the pattern doc hold against the fixture: `environment` last-wins, `files[]`
last-wins by path, `commands[]` append in order, `caps.network.allow` union.
Run it on each backend your team uses; select the backend with `ACQ_BACKEND`.
The values at the top of `scripts/verify` (`TEAM_CONFIG`, `TEAM_CONVENTIONS`,
`TEAM_EGRESS_HOST`) mirror `spec.yaml`: update them whenever you change the
matching path or host. If you replace the git startup step, also update the
startup poll and the `commands[]` check, which both read its git key. Extend its clearly marked **TEAM-SPECIFIC** section as your kit
grows, one assertion per mechanism you add.

## Backend parity

The kit uses no backend-specific features: it is declarative only (`caps`,
`files[]`, `commands[]`, `environment`), with no `backend_shortcuts` or
`backend_extras`, and `scripts/verify` uses only `acq` verbs. The backends
still behave differently (who runs a command with no `user:`, `agentContext`,
how kits re-apply, unlisted files, SSH egress, secret rotation); "Backend
differences" in the pattern doc is the list. Keep this section in your copy
and add anything backend-specific your kit introduces.

## Troubleshooting

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Record your team's non-obvious
choices as ADRs next to the kit, in [`docs/decisions/`](docs/decisions/). The
sample there records the template's own choice of `OPENCODE_CONFIG`; keep it,
rewrite it, or replace it with your first real decision.
