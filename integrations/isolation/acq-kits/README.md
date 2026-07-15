# acq mixin kits (`hybrid/v1`)

Neutral, backend-agnostic **mixin kits** for
[`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) — the pluggable
isolation-backend wrapper. A kit configures an agentic-coding sandbox
declaratively (network egress, files to drop, lifecycle commands, agent
context); `acq` translates the neutral spec into whichever backend is active
(`sbx` today; `msb` from Phase 2; `ppp` later).

These are isolation/environment building blocks — they configure the *sandbox*,
not agent behavior. (Behavioral patterns live in `skills/`, `prompts/`, etc.)

> **Why `acq-kits/` (not `sbx-kits/`)?** These kits are consumed by `acq`, which
> selects a backend, rather than by `sbx` alone. The former
> [`../sbx-kits/`](../sbx-kits/) is a one-release redirect to here. See
> [`../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## Available kits

| Kit | Purpose |
|-----|---------|
| [`usai-provider/`](usai-provider/) | Configure the agent to use the GSA USAi model provider (OpenCode today), with egress allow-listed. |
| [`agentic-coding-playbook/`](agentic-coding-playbook/) | Clone the GSA agentic-coding-playbook at startup and link its `AGENTS.md` + skills into each agent's search paths. |
| [`zscaler-ca-certificate/`](zscaler-ca-certificate/) | Trust the public Zscaler Root CA in the sandbox (msb: native `--trust-host-cas`; sbx: file-drop + `update-ca-certificates`). |
| [`git-ssh-sign/`](git-ssh-sign/) | Sign git commits and tags with the SSH key forwarded from the host agent (vendored from sbx-kits-contrib). |

Each kit is self-contained: a `spec.yaml` (`hybrid/v1`), any `files/` payload, a
`scripts/verify` host-side check, a `README.md` (with a **backend parity** note),
a `TROUBLESHOOTING.md`, and `docs/decisions/` records.

The [`kits.yaml`](kits.yaml) registry is the human-readable parity summary
(kit → supported backends + parity prose).

## What is a hybrid/v1 kit?

A kit is a directory with a `spec.yaml` (`schemaVersion: "hybrid/v1"`). A
`kind: mixin` kit layers onto a base agent sandbox and declares, in a neutral
vocabulary:

- `caps.network.allow` — outbound egress hosts.
- `files[]` — files to drop into the guest (inline `content` or a `source:`
  under the kit's `files/` tree), optionally tagged with a lifecycle `phase`.
- `commands[]` — lifecycle commands, each with a `phase` (`install` /
  `initFiles` / `startup`), `user`, and argv `command`.
- `agentContext` — markdown surfaced to the agent.
- `backend_shortcuts.<backend>` — a native primitive that replaces the
  declarative path for one backend (e.g. msb's `--trust-host-cas` for the
  Zscaler kit). Adapters check this first; if present, `caps`/`files`/`commands`
  are skipped for that backend.
- `backend_extras.<backend>` — free-form per-backend config the neutral spec
  doesn't model.

The schema is [`schemas/kit-hybrid-v1.schema.json`](../../../schemas/kit-hybrid-v1.schema.json).

## Validating kits

```bash
# Backend-agnostic gate: schema + source paths + known backends + registry.
python integrations/isolation/acq-kits/validate-kits.py

# Live, per-backend end-to-end check (needs a backend CLI + a sandbox-capable host):
<kit>/scripts/verify
```
