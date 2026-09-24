# Decision: keep BYOK credentials in ACQ/OpenCode, not OpenDesign kit files

**Status:** accepted

## Context

OpenDesign supports BYOK-style provider configuration, and its media provider
settings can be stored under `OD_DATA_DIR`. In ACQ, however, model-provider
credentials are already handled by the sandbox credential path: operators store a
secret with `acq secret`, ACQ injects it into the sandbox environment, and the
`usai-provider` kit configures OpenCode to reference that environment variable.

Copying provider keys from the sandbox environment into OpenDesign's persisted
config would create a second secret location and make cleanup/audit harder.

## Decision

The OpenDesign kit does not seed provider keys or OpenDesign media config. It
seeds only non-secret OpenDesign app preferences:

- select the local `opencode` agent when no agent was chosen yet;
- mark onboarding complete;
- do not set a default model.

For the GSA path, credentials flow through:

```text
acq secret store -> USAI_API_KEY env -> usai-provider OpenCode config -> OpenCode
```

OpenDesign launches OpenCode and inherits that configured environment. Extra
OpenDesign media providers remain manual user configuration.

Inheriting the environment is necessary but not sufficient. OpenDesign runs agent
children with `OD_SANDBOX_MODE=1`, which rewrites `HOME` and `XDG_CONFIG_HOME` to
a private agent home under `OD_DATA_DIR` (upstream
`apps/daemon/src/sandbox-mode.ts`). OpenCode resolves its global config from
those variables, so it would look in `$OD_DATA_DIR/sandbox/config/opencode/` —
where it auto-creates an empty stub — and never read the `usai-provider` config.
With no `usai` provider defined it falls back to its own hosted gateway
(`opencode.ai/zen`), which is not in this kit's egress allowlist, so every run
exhausts its retries and fails with "Cannot connect to API".

Startup therefore also exports `OPENCODE_CONFIG`, OpenCode's documented
absolute-path config override, which survives the `HOME`/`XDG_CONFIG_HOME`
rewrite. That names a config **path** only and does not move secret material:
`USAI_API_KEY` stays in the environment and is resolved by that config's own
`{env:USAI_API_KEY}` substitution at run time, preserving this decision.

## Consequences

- The kit works with ACQ's existing credential-injection model.
- `USAI_API_KEY` is not copied into `OD_DATA_DIR` by the kit.
- OpenDesign's core agent flow works through OpenCode/USAi when paired with
  `usai-provider`.
- The kit depends on `OPENCODE_CONFIG` remaining OpenCode's config-path override
  and on `usai-provider` continuing to install a config at
  `~/.config/opencode/opencode.jsonc`. Startup logs which config it selected, and
  logs a warning when it finds none.
- Users who need OpenDesign media provider keys can still configure them in the
  OpenDesign UI, accepting that OpenDesign stores those settings locally.
