# Decision: Deliver team agent settings through `OPENCODE_CONFIG`

**Status:** accepted (sample: keep, rewrite, or replace it in your copy)

## Context

The team needs settings every teammate's agent shares: team instructions,
permission rules for team tools. OpenCode reads config from three places, in
order: its global config path, the file `OPENCODE_CONFIG` names, and the
repo's own config. Later sources override earlier ones key by key.

The global `usai-provider` kit merges its provider settings into the global
config path at every start, and leaves `OPENCODE_CONFIG` unset. Writing the
team's settings to the global path as well would mean merging with that kit,
or overwriting it.

## Decision

Ship the team's settings as `files/home/team-config/opencode.jsonc` and set
`OPENCODE_CONFIG` to its in-guest path in `environment`. The team kit owns
that variable; a personal kit does not override it.

## Consequences

- Settings tier global → team → repo, with no merge script in this kit.
- `OPENCODE_CONFIG` is single-valued and last-wins across kits, so any later
  kit that sets it hides the team settings without a warning.
- The conventions reach the agent through OpenCode's `instructions` field,
  which OpenCode 2.x ignores. On an image whose sandbox shells run 2.x, the
  team settings still apply but the conventions do not load; `scripts/verify`
  fails there.
