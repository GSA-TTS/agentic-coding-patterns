# Integrations

Tool and editor **integration guides and portable configs** for agentic coding —
how to wire a specific editor, CI system, or automation into an agentic workflow.

See [ADR 0001](../docs/decisions/0001-integrations-area.md) for why this area
exists, and [contribution scope](../docs/contribution-scope.md) for what belongs
here versus the playbook or quickstart repos.

## What belongs here

- **Editor integrations** (`editors/<editor>/`) — e.g. a task-runner config plus
  its setup guide, so a contributor can copy a working configuration into their
  own project.
- **Isolation / sandbox kits** (`isolation/sbx-kits/<kit>/`) —
  [sbx](https://docs.docker.com/ai/sandboxes/) mixin kits that configure an
  agentic-coding sandbox declaratively (provider config, egress, CA trust,
  rules/skills delivery).
- **CI / automation recipes** (future: `ci/`, `automation/`) — reusable snippets
  for wiring agentic tooling into pipelines.

These are **reusable, tool-specific, and community-shareable**. They carry **no
compliance authority** and are **not** federal policy — behavioral and policy
authority lives in the [playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
and is referenced, not restated.

## What does NOT belong here

- Federal policy, compliance, or NIST control content → **playbook**.
- SBX/USAi environment setup and first-day onboarding → **quickstart**.
- Executable agent procedures → `.agents/skills/` (skills), not integrations.

## Layout

```text
integrations/
├── editors/
│   └── <editor>/
│       ├── README.md       # setup guide
│       └── <config files>  # portable config to copy into your project
└── isolation/
    └── sbx-kits/
        └── <kit>/          # an sbx mixin kit (spec.yaml + files/ + docs)
```

## Rules

- No secrets, credentials, PII, CUI, internal URLs, or customer data in any
  integration file or example.
- Keep configs portable and minimal; document any prerequisites in the
  integration's `README.md`.
- Identify and preserve the license of any inherited third-party material.

## Available integrations

<!-- Add a row when you contribute an integration. -->

| Integration | Tool | Description |
|-------------|------|-------------|
| [editors/zed](editors/zed/) | Zed editor | One-click OpenCode-in-SBX launch + diagnostics via Zed's task runner; portable `tasks.json` + setup guide. |
| [isolation/sbx-kits/usai-provider-kit](isolation/sbx-kits/usai-provider-kit/) | sbx | Mixin kit: configure OpenCode to use the GSA USAi model provider, with egress allow-listed. |
| [isolation/sbx-kits/playbook-kit](isolation/sbx-kits/playbook-kit/) | sbx | Mixin kit: clone the GSA playbook at sandbox startup and link its AGENTS.md + skills into each agent. |
| [isolation/sbx-kits/zscaler-ca-certificate](isolation/sbx-kits/zscaler-ca-certificate/) | sbx | Mixin kit: install the public Zscaler Root CA into the sandbox trust store for HTTPS-inspecting proxies. |
