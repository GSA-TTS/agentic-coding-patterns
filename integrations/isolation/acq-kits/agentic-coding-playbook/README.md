# agentic-coding-playbook (acq mixin kit, `hybrid/v1`)

A neutral [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin
kit** that delivers the GSA
[agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook) —
the federal `AGENTS.md` rules and the Agent Skills — into a sandbox.

> **Neutral (backend-agnostic) kit.** This is the `schemaVersion: "hybrid/v1"`
> form consumed by `acq`, which selects an isolation backend (`msb` — the
> default — and `sbx` today; `ppp` later). It replaces the former `sbx-kits/playbook-kit/` sbx-only spec.
> See [backend parity](#backend-parity) and
> [`../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

The kit ships one small script. At container **startup** it:

1. fetches the playbook at a pinned ref (as a GitHub REST **source tarball**)
   into `~/.agentic-coding-playbook`, then
2. symlinks the playbook's `AGENTS.md` and skills into each supported agent's
   search paths.

Fetch-at-startup (rather than vendoring the playbook into the kit's `files/`)
keeps the kit tiny and lets the playbook version be pinned and bumped
independently. See [Failure behavior](#failure-behavior) for how it degrades
when the fetch can't run.

## Backend parity

All backends use the **same** mechanism: allow-list `api.github.com` /
`codeload.github.com` and run the same fetch+link script
(`files/home/playbook-clone.sh`) at startup. No backend shortcut.

The script fetches the repo **source tarball** from the GitHub REST API
(`https://api.github.com/repos/<owner>/<repo>/tarball/<ref>`, which 302-redirects
to `codeload.github.com`) with a Bearer token — **not** `git clone`. That matters
for cross-backend parity: msb does **not** substitute an injected credential for
git's smart-HTTP transport to `github.com`/`codeload` (the origin of
[quickstart#203](https://github.com/GSA-TTS/agentic-coding-quickstart/issues/203)),
but it **does** substitute the `Authorization: Bearer` header for the REST API.
So the one tarball code path authenticates on both `sbx` and `msb`, needs no
`.git`, and needs no `gh`. The GitHub token is injected by the active backend to
`api.github.com` (see [Prerequisites](#prerequisites)); the kit never holds it.
Behavioral parity: the playbook's `AGENTS.md` + skills end up linked into the
agent search paths on every backend.

## Usage

```bash
acq run opencode /path/to/project        # acq applies the pinned kits, incl. this one
```

The kit is a `mixin`, so it composes with the other acq-kits.

## Prerequisites

While the playbook repo is **private**, the fetch needs a GitHub token. This kit
does **not** declare its own `github` credential — the base agent sandbox
already provides one, and `acq`'s backend injects it to `api.github.com` (the
container never sees the real token). Set it once:

```bash
acq secret set github
```

If you apply this kit on a base agent whose kit doesn't provide `github`, a
private-repo fetch has no credential and will fail — the kit degrades gracefully
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

- `PLAYBOOK_REF` — a human-legible release tag (e.g. `v0.14.0`), what the fetch
  retrieves.
- `PLAYBOOK_AGENTS_SHA256` — the integrity pin: a sha256 over the **consumed
  content** (the extracted `AGENTS.md` plus every file under `.agents/skills`,
  hashed as a sorted per-file digest manifest).

A GitHub source tarball is **not** byte-stable (server-side recompression), so
the archive bytes can't be hash-pinned; and a tag is a **mutable** ref traversing
a possibly MITM-inspected path — so a successful download alone is not integrity.
At startup the script fetches `PLAYBOOK_REF`, extracts it, recomputes the content
digest, and links **only** if it equals `PLAYBOOK_AGENTS_SHA256`; on mismatch it
removes the tree and starts without the playbook rather than linking unexpected
content. Hashing the skill files (not just `AGENTS.md`) means tampered skills —
which are executable agent instructions — are also rejected. Skill entries that
are symlinks or resolve outside the playbook tree are never linked.

To adopt a newer playbook release, bump **both** `PLAYBOOK_REF` and
`PLAYBOOK_AGENTS_SHA256` together — in `spec.yaml`'s startup command **and** the
matching fallback defaults in `files/home/playbook-clone.sh` — then recreate
sandboxes. Regenerate the hash with the command in `spec.yaml`'s pinning comment.

> Signed-tag verification is a possible future hardening; it depends on the
> playbook signing its releases and is tracked separately.

## Failure behavior

The startup script is **idempotent** and **non-fatal**:

- Fetches once (fetch-if-missing); no refetch on later starts.
- On fetch failure (offline, missing token, bad ref) it **warns and exits 0** —
  the sandbox starts **without** the playbook rather than failing to create. The
  underlying `curl` error is surfaced in the warning to aid diagnosis.
- Because startup runs on every container start, a sandbox created offline
  **self-heals**: the fetch is retried on the next start once the network/token
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
the playbook fetched and `AGENTS.md` + skills resolved at the agent paths. Set
`KEEP=1` to keep the sandbox for inspection.
