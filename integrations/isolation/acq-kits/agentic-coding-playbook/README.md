# agentic-coding-playbook (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that delivers the GSA
[agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook) —
the federal `AGENTS.md` rules and the Agent Skills — into a sandbox.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend (`sbx` today; `msb`
> from Phase 2). It replaces the former `sbx-kits/playbook-kit/` sbx-only spec.
> See [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

The kit ships one small script. At container **startup** it:

1. clones the playbook at a pinned ref into `~/.agentic-coding-playbook`, then
2. symlinks the playbook's `AGENTS.md` and skills into each supported agent's
   search paths.

Clone-at-startup (rather than vendoring the playbook into the kit's `files/`)
keeps the kit tiny and lets the playbook version be pinned and bumped
independently. See [Failure behavior](#failure-behavior) for how it degrades
when the clone can't run.

## Backend parity

All backends use the **same** mechanism: allow-list `github.com` /
`codeload.github.com` and run the same clone+link script
(`files/home/playbook-clone.sh`) at startup. No backend shortcut. The GitHub
token needed while the playbook repo is private is injected by the active
backend on the outbound clone (see [Prerequisites](#prerequisites)); the kit
never holds it. Behavioral parity: the playbook's `AGENTS.md` + skills end up
linked into the agent search paths on every backend.

## Usage

```bash
acq run opencode /path/to/project        # acq applies the pinned kits, incl. this one
```

The kit is a `mixin`, so it composes with the other acq-kits.

## Prerequisites

While the playbook repo is **private**, the clone needs a GitHub token. This kit
does **not** declare its own `github` credential — the base agent sandbox
already provides one, and `acq`'s backend injects it on the outbound clone (the
container never sees the real token). Set it once:

```bash
acq secret set github
```

If you apply this kit on a base agent whose kit doesn't provide `github`, a
private-repo clone has no credential and will fail — the kit degrades gracefully
(warns and continues). Make the playbook repo public or supply a GitHub
credential via that base. Once the repo is public, no token is needed.

## What it links

`AGENTS.md` is linked to each agent's user-level rules path; skills are linked
per the cross-agent [agentskills.io](https://agentskills.io) standard root
(`~/.agents/skills`) plus per-agent roots for agents that only scan their own
directory.

| Agent | Rules file linked | Skills root linked | Confidence |
|-------|-------------------|--------------------|-----------|
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.agents/skills` | high |
| Codex | `~/.codex/AGENTS.md` | `~/.agents/skills` | high |
| Droid (Factory.ai) | `~/.factory/AGENTS.md` | `~/.factory/skills` | high |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills` | high |
| GitHub Copilot CLI | `~/.copilot/copilot-instructions.md` | `~/.copilot/skills` | high |
| Cursor | — (rules live in app settings) | `~/.cursor/skills` | medium |
| Kiro | — (steering dir, not a rules file) | — (no confirmed skills dir) | low |
| Docker Agent (cagent) | — (instructions in agent YAML) | `~/.agents/skills` | high |

Notes:

- **`~/.agents/skills`** is read natively by Codex, OpenCode, Docker Agent, and
  Copilot CLI — one symlink root covers them all. The per-agent roots
  (`~/.claude/skills`, `~/.factory/skills`, `~/.cursor/skills`,
  `~/.copilot/skills`) cover agents that only scan their own directory.
- **Cursor / Kiro / Docker Agent** have no user-level rules *file* convention
  (rules live in app settings or the agent's YAML), so they get skills only.
- Low/medium-confidence rows should be **verified in-sandbox**; the kit links
  them best-effort and never fails if a path is wrong.

## Pinning the playbook version

The kit pins the playbook with two values passed to the startup script:

- `PLAYBOOK_REF` — a human-legible release tag (e.g. `v0.14.0`), what the clone
  fetches.
- `PLAYBOOK_SHA` — the exact commit that tag must resolve to (the integrity pin).

At startup the script shallow-clones `PLAYBOOK_REF`, then verifies the cloned
`HEAD` equals `PLAYBOOK_SHA`; on mismatch it removes the clone and starts
without the playbook rather than linking unexpected content. A tag is a
**mutable** ref, and (with the sibling CA kit) the clone traverses a Zscaler MITM
proxy, so a tag match alone is not sufficient integrity — hence the SHA gate.

To adopt a newer playbook release, bump **both** `PLAYBOOK_REF` and
`PLAYBOOK_SHA` together — in `spec.yaml`'s startup command **and** the matching
fallback defaults in `files/home/playbook-clone.sh` — then recreate sandboxes.

> Signed-tag verification (`git verify-tag`) is a possible future hardening;
> it depends on the playbook signing its releases and is tracked separately.

## Failure behavior

The startup script is **idempotent** and **non-fatal**:

- Clones once (clone-if-missing); no refetch on later starts.
- On clone failure (offline, missing token, bad ref) it **warns and exits 0** —
  the sandbox starts **without** the playbook rather than failing to create.
- Because startup runs on every container start, a sandbox created offline
  **self-heals**: the clone is retried on the next start once the network/token
  is available.

## Troubleshooting

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Design decisions

- [`docs/decisions/playbook-clone-at-startup.md`](docs/decisions/playbook-clone-at-startup.md)
  — why the kit clones the playbook at startup (vs. a vendored copy or a `files/`
  payload), startup vs install, pinning, and the GitHub auth approach.
- [`docs/decisions/extract-clone-script-to-file.md`](docs/decisions/extract-clone-script-to-file.md)
  — why Phase 2 extracted the inline startup shell into
  `files/home/playbook-clone.sh`.

The move to the neutral `hybrid/v1` spec is recorded in the area-level ADR
[`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## Verifying

Run the bundled check on a host with a backend CLI (e.g. `sbx`) installed and
logged in:

```bash
./scripts/verify
```

It validates the spec, creates a throwaway sandbox with the kit, and confirms
the playbook cloned and `AGENTS.md` + skills resolved at the agent paths. Set
`KEEP=1` to keep the sandbox for inspection.
