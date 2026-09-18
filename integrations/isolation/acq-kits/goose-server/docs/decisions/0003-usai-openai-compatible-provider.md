# Decision: wire USAi via a goose custom provider (`custom_usai`) matching Desktop

**Status:** accepted (supersedes the initial "built-in `openai` provider" approach
after a live goose Desktop test)

## Context

goosed needs an LLM provider, and — because this is a *chat harness* driven by a
**goose Desktop** client connected to the external server — the provider the
**server** exposes must match the provider the **Desktop** selects. goose Desktop
drives the external `goose serve` by *named provider + model*; if it asks for a
provider the server has not defined, agent initialization fails and Desktop reports
"unable to connect" even though the server is healthy.

The GSA ecosystem targets the **USAi** gateway (`api.gsa.usai.gov`), which is
OpenAI-compatible. A real GSA goose Desktop reaches it through a goose **custom
provider** named **`custom_usai`** (engine `openai`), defined in
`~/.config/goose/custom_providers/custom_usai.json`:

```json
{
  "name": "custom_usai",
  "engine": "openai",
  "api_key_env": "CUSTOM_USAI_API_KEY",
  "base_url": "https://api.gsa.usai.gov/api/v1/chat/completions",
  "models": [ { "name": "claude_4_5_sonnet", ... }, ... ],
  "requires_auth": true
}
```

An initial version of this kit configured the server with goose's **built-in
`openai`** provider (`GOOSE_PROVIDER=openai` + `OPENAI_HOST`/`OPENAI_BASE_PATH`, key
as `OPENAI_API_KEY`). A live Desktop test disproved that approach: Desktop asked
for provider `custom_usai`, the server only had `openai`, the session failed to
initialize, and Desktop showed "unable to connect" (host `curl .../status` returned
`200 OK` the whole time — the failure was purely the provider-identity mismatch).

We also verified acq's secret injection: a **custom acq service** lets the operator
choose the injected env-var name via `--env`, honored end-to-end (the `(host, env)`
sidecar is read first, msb binds `--secret <ENV>@<HOST>`), so the guest can receive
the key under whatever name the provider's `api_key_env` requires.

## Decision

**Reproduce the `custom_usai` custom provider on the server, and inject the key
under its `api_key_env` name (`CUSTOM_USAI_API_KEY`).**

Concretely, the kit:

1. Ships `files/home/goose-config/custom_providers/custom_usai.json` — the exact
   `custom_usai` definition (name, engine `openai`, `base_url`, model list),
   **minus the secret**. The startup script copies it into the guest's
   `~/.config/goose/custom_providers/` (idempotently; it does not clobber a
   provider the user later edited in Desktop).
2. Marks `custom_usai` active in the config primer (`active_provider: custom_usai`,
   default `GOOSE_MODEL: claude-sonnet-5`).
3. Injects the API key as **`CUSTOM_USAI_API_KEY`** — the provider's `api_key_env` —
   via a custom acq secret service bound to `api.gsa.usai.gov`, never stored in the
   kit:
   ```
   acq secret set -g goose-usai --host api.gsa.usai.gov --env CUSTOM_USAI_API_KEY
   ```

No `OPENAI_*` env and no built-in `openai` provider are used — that is a *different*
provider identity than the one Desktop names.

## Consequences

- Desktop configured with `custom_usai` connects to the server without
  reconfiguration; the two provider identities agree.
- The key value never enters the guest in cleartext or the kit spec; msb swaps it
  on the wire only for `api.gsa.usai.gov` (TLS-intercepted), matching the
  usai-provider/mcp-gateway secret model.
- `caps.network.allow` must include `api.gsa.usai.gov` (it does), since egress is
  deny-default.
- **Provider-name coupling:** a Desktop using a *differently-named* provider (not
  `custom_usai`) still won't connect. The README/TROUBLESHOOTING call this out; the
  fix is to align the names (rename in Desktop, or edit the shipped
  `custom_usai.json` + primer). This is inherent to goose's named-provider model,
  not a kit defect.
- If USAi changes its base path/host, update `custom_usai.json` (`base_url`) and the
  secret's `--host`. A `404` on model calls signals a wrong `base_url`; a `401`
  signals a wrong key/host binding.
- The default model (`claude-sonnet-5`) must be one the operator's USAi tenant
  serves and must be present in `custom_usai.json`; it is overridable in Desktop or
  via `GOOSE_MODEL`.
- The config primer stays a **flat** top-level YAML map (no nested `providers:`
  block) so the kit's fail-safe flat-YAML merger can merge it into a pre-existing
  config without touching an unmodeled nested shape; the provider *connection*
  details live in `custom_usai.json`, not the primer.
