# Orchestrator integrations

Integration guides and portable configs for **orchestrators that drive a
sandbox/isolation tool from the outside** — tools that own the agent + session
lifecycle and *call* `acq`/`sbx`/`msb` (rather than being applied *inside* a
sandbox).

See [ADR 0001](docs/decisions/0001-orchestrators-area-and-agor-acq.md) for why
this area exists, and the repo-wide
[integrations ADR](../../docs/decisions/0001-integrations-area.md) for the
`integrations/` area overall.

## Orchestrator vs. isolation kit — the boundary

> An **orchestrator** integration *drives* a sandbox/isolation tool from the
> outside — it owns the agent + session lifecycle and calls `acq`/`sbx`/`msb`
> (e.g. Agor invoking `acq create` / `acq exec`). An **isolation kit** is
> something `acq` *applies inside* the sandbox (`caps`/`files`/`commands`).
> Direction of control decides the area: **drives → `orchestrators/`;
> applied-inside → [`isolation/`](../isolation/).**

**Composition corollary.** When an orchestrator integration *needs* a kit
(e.g. an egress allow-list kit for the orchestrator's control-plane URL), that
kit lives under [`integrations/isolation/acq-kits/`](../isolation/acq-kits/) — it
is applied inside — and the orchestrator here **references** it. The two areas
compose; direction of control, not owning project, decides placement.

## What belongs here

- **Orchestrator integrations** (`<orchestrator>/`) — a portable wrapper/config
  plus its setup guide, so a contributor can wire their own deployment to run an
  orchestrator's execution inside a sandbox.

These are **reusable, tool-specific, and community-shareable**. They carry **no
compliance authority** and are **not** federal policy — behavioral and policy
authority lives in the
[playbook](https://github.com/GSA-TTS/agentic-coding-playbook) and is referenced,
not restated.

## What does NOT belong here

- Kits that `acq` applies inside a sandbox → [`../isolation/acq-kits/`](../isolation/acq-kits/).
- Editor integrations → [`../editors/`](../editors/).
- Executable agent procedures → `skills/` (skills), not integrations.
- Federal policy / compliance / NIST content → the playbook.

## Available orchestrators

| Orchestrator | Drives | Description |
|--------------|--------|-------------|
| [agor](agor/) | `acq` | Run [Agor](https://github.com/preset-io/agor)'s executor inside an `acq` sandbox via `executor_command_template` — a portable wrapper that mounts the branch worktree, allow-lists the daemon, and pipes `agor-executor --stdin` into the sandbox. **v1: sbx backend.** |

## Rules

- No secrets, credentials, PII, CUI, internal URLs, or customer data in any
  integration file or example.
- Keep configs portable and minimal; document prerequisites in each
  integration's `README.md`.
- Identify and preserve the license of any inherited third-party material.
