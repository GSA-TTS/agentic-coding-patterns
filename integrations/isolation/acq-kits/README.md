# acq mixin kits (`hybrid/v1`)

Neutral, backend-agnostic **mixin kits** for
[`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart) — the pluggable
isolation-backend wrapper. A kit configures an agentic-coding sandbox
declaratively (network egress, files to drop, lifecycle commands, agent
context); `acq` translates the neutral spec into whichever backend is active.

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
| [`openchamber/`](openchamber/) | Run OpenChamber, a browser UI for OpenCode, inside the sandbox alongside the terminal TUI. Opt-in (see its parity note). |
| [`opencode/`](opencode/) | Install the OpenCode terminal AI coding agent as a pinned, SHA-256-verified release binary. Agent-harness kit; no ports. |
| [`paseo/`](paseo/) | Self-host the [Paseo](https://github.com/getpaseo/paseo) daemon + browser web UI (for coding agents) inside the sandbox on one port. Opt-in; agent-generic wrapper, no shared TUI session. |
| [`prime-agent/`](prime-agent/) | Install [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent), a terminal AI coding assistant with an embedded IPython tool. Opt-in; TUI, no ports. |
| [`pi-coding-agent/`](pi-coding-agent/) | Install [earendil-works/pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`), a plain terminal AI coding agent (read/write/edit/bash tools only). Opt-in; TUI, no ports. |

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

### What a `scripts/verify` exit code means

Verify scripts share one verdict contract, `verify-report.sh` in this directory.
It exists because the previous per-kit verdict was `[ "$fail" -eq 0 ]`, which
reports success both when **zero** checks ran and when checks were **skipped** —
so a run that exercised nothing still printed "All checks passed."

| Exit | Meaning |
|---|---|
| `0` | every check that ran passed, and at least one check ran |
| `1` | at least one check FAILED |
| `3` | nothing failed, but the run is **not** a pass: a check could not be performed, or no check ran at all |

`3` is distinct from `1` so a caller can tell *"we looked and found problems"*
from *"we could not look"*. Treat any non-zero exit as "do not ship".

The five reporters: `ok` / `bad` are the ran-and-passed / ran-and-failed cases;
`unver` is **could not check** (missing tool, absent credential, no network) and
degrades the verdict to `3`; `skip` is *not applicable in this configuration*
(e.g. a backend-specific check on the other backend) and does **not** degrade
it; `warn` is advisory. The `unver` / `skip` distinction is load-bearing —
collapsing the two is how a verify script ends up claiming coverage it does not
have.

`scripts/tests/test_verify_contract.py` enforces this statically, because CI
cannot run these scripts (they need a live sandbox). Its `UNCONVERTED` set lists
kits not yet migrated; it must reach empty.
