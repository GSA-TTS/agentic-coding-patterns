# sbx mixin kits

[sbx](https://docs.docker.com/ai/sandboxes/) **mixin kits** that configure an
agentic-coding sandbox declaratively at creation time. Apply a kit with
`sbx run --kit <path-to-kit> <agent> <project>`; mixins compose, so several can
be applied together with repeated `--kit` flags.

These are isolation/environment building blocks — they configure the *sandbox*,
not agent behavior. (Behavioral patterns live in `skills/`, `prompts/`, etc.)

## Available kits

| Kit | Purpose |
|-----|---------|
| [`usai-provider-kit/`](usai-provider-kit/) | Configure the agent to use the GSA USAi model provider (OpenCode today), with egress allow-listed. |
| [`playbook-kit/`](playbook-kit/) | Clone the GSA agentic-coding-playbook at startup and link its `AGENTS.md` + skills into each agent's search paths. |
| [`zscaler-ca-certificate/`](zscaler-ca-certificate/) | Install the public Zscaler Root CA into the sandbox trust store so HTTPS works behind a Zscaler inspecting proxy. Adapts the Docker CA example to work on the opencode base (initFiles + startup). |

Each kit is self-contained: a `spec.yaml`, any `files/` payload, a
`scripts/verify` host-side check, a `README.md`, a `TROUBLESHOOTING.md`, and
`docs/decisions/` records explaining the design.

## What is a mixin kit?

A kit is a directory with a `spec.yaml` (sbx schema v2). A `kind: mixin` kit
layers onto a base agent sandbox and can declare network egress
(`caps.network`), environment variables, files to drop into the container
(`files/`), credentials, and startup/install commands. See the
[sbx kits documentation](https://docs.docker.com/ai/sandboxes/).

## Validating a kit

```bash
sbx kit validate <path-to-kit>   # static spec check
<path-to-kit>/scripts/verify     # end-to-end: create a sandbox and assert behavior
```
