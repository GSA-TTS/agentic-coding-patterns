# team-kit (template for a team's acq mixin kit, `hybrid/v1`)

A **template, not a deployable kit**: the starting point for a team's own
scope-layer mixin, the layer between the global kits `acq` applies for
everyone and each repo's own agent config. `acq` never applies this directory;
you copy it into a repo your team owns, rename it, and grow it. The pattern,
the per-field composition rules, and the authoring gotchas are in
[`../../../docs/scope-layers.md`](../../../docs/scope-layers.md); the placement
decision is [ADR 0005](../../../docs/decisions/0005-kit-templates.md).

```text
global    zscaler-ca-certificate · usai-provider · agentic-coding-playbook · git-ssh-sign   (acq, everyone)
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
3. Apply it after the global kits. Put this in your shell rc:

   ```bash
   export ACQ_EXTRA_KITS="/path/to/your-team-repo/acq-kits/your-team"
   acq run opencode /path/to/project
   ```

4. Validate on every change, and run the live check when the spec or a payload
   changes:

   ```bash
   acq kit validate /path/to/your-team-kit
   /path/to/your-team-kit/scripts/verify
   ```

Teammates stack their personal kit *after* yours in `ACQ_EXTRA_KITS`; later
kits win wherever a field is last-wins (`environment`, `files[]` by path). Say
in this README which of your settings a personal kit may override.

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

## What it does not carry, on purpose

- **Tools and toolchains.** Bake them into the image and point `ACQ_IMAGE` at
  it; the published devenv image in this repo is the precedent.
- **Secrets.** `acq secret set -g <service> --host <host> --env <VAR>` on the
  host; the sandbox only ever sees a placeholder.
- **Whole shared files** (`~/.bashrc`, `~/.gitconfig`) or **binary files**.
- **Anything the global layer already owns.**

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
Extend its clearly marked **TEAM-SPECIFIC** section as your kit grows, one
assertion per mechanism you add.

## Backend parity

None to note: the kit is declarative only (`caps`, `files[]`, `commands[]`,
`environment`) with no `backend_shortcuts` or `backend_extras`, so behavior is
identical on sbx and msb. `scripts/verify` uses only `acq` verbs for the same
reason. Keep this section in your copy and update it if you ever add anything
backend-specific.

## Troubleshooting

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Record your team's non-obvious
choices as ADRs next to the kit (`docs/decisions/`).
