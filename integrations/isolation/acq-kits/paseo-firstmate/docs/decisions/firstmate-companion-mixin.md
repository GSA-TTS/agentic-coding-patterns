# Decision: Keep FirstMate as a Paseo companion mixin

## Context

FirstMate is a Paseo plugin, not a replacement for the Paseo daemon. The
existing `paseo` ACQ kit owns the daemon, browser endpoint, published port, and
worktree setup. FirstMate adds UI and RPC handlers that depend on that daemon
and on a separate FirstMate runtime checkout.

## Decision

Ship FirstMate as a separate optional `paseo-firstmate` mixin. The mixin fetches
the upstream repository at a full commit SHA during sandbox startup, installs
the committed Node dependency tree with lifecycle scripts disabled, and uses
Paseo's supported local `plugin install` and `plugin reload` commands.

The mixin publishes no port. It composes with the base `paseo` kit and uses its
existing web UI endpoint.

## Consequences

- Operators can enable or omit FirstMate without changing the base Paseo kit.
- The plugin source is immutable at the configured upstream commit rather than
  following a mutable branch.
- Startup may perform a network fetch and locked dependency install.
- Installation is fail-soft because FirstMate is optional; failures are logged
  without preventing the sandbox or base Paseo daemon from starting.
- Paseo plugins are trusted, unsandboxed code. Operators must review the pinned
  source and set `FM_HOME` only to a trusted checkout.
