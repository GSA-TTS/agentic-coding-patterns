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
| [`openchamber/`](openchamber/) | Run OpenChamber, a browser UI for OpenCode, inside the sandbox alongside the terminal TUI. Opt-in; sbx-only for now (see its parity note). |
| [`agor-daemon-egress/`](agor-daemon-egress/) | Allow-list egress to the Agor daemon control-plane so an Agor executor running in the sandbox (via [`orchestrators/agor`](../../orchestrators/agor/)) can connect back. Security-relevant (widens egress). |

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
- `environment` — a flat map of NAME → value for **non-secret** guest
  environment variables (e.g. `OPENCODE_CONFIG`, `GITLAB_HOST`). Names must be
  POSIX identifiers (`[A-Za-z_][A-Za-z0-9_]*`); values are plain strings. Each
  backend maps these onto its native env mechanism (sbx `environment.variables`;
  msb `--env NAME=value`). **Secrets do NOT go here** — they flow through the
  backend credential/secret path (`acq secret …`), never the kit spec.
- `backend_shortcuts.<backend>` — a native primitive that replaces the
  declarative path for one backend (e.g. msb's `--trust-host-cas` for the
  Zscaler kit). Adapters check this first; if present, `caps`/`files`/`commands`
  are skipped for that backend.
- `backend_extras.<backend>` — free-form per-backend config the neutral spec
  doesn't model.

> The `backend_shortcuts` / `backend_extras` values are **unconstrained
> objects** — the schema fixes only the set of backend keys (`sbx`, `msb`,
> `ppp`), not the shape of what's inside. Their content is **human-review-only,
> not schema-enforced**. `ppp` (Podman) is a **reserved** backend slot for the
> in-flight Phase 3 adapter; `sbx` and `msb` have live consumers today.

The schema is [`schemas/kit-hybrid-v1.schema.json`](../../../schemas/kit-hybrid-v1.schema.json).

## Validating kits

```bash
# Backend-agnostic gate: schema + source paths + known backends + registry.
# Wired into CI (Pattern Validation job) + pre-commit + `make ci`.
python integrations/isolation/acq-kits/validate-kits.py    # or: make validate-kits

# Kit unit tests (usai-provider generator + merge). CI: acq-kits Tests job.
make test-kits

# Live, per-backend end-to-end check (needs a backend CLI + a sandbox-capable host):
<kit>/scripts/verify
```
