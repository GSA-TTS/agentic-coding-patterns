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

## Consequences

- The kit works with ACQ's existing credential-injection model.
- `USAI_API_KEY` is not copied into `OD_DATA_DIR` by the kit.
- OpenDesign's core agent flow works through OpenCode/USAi when paired with
  `usai-provider`.
- Users who need OpenDesign media provider keys can still configure them in the
  OpenDesign UI, accepting that OpenDesign stores those settings locally.
