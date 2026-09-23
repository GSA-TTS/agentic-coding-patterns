# Decision: source-install OpenDesign and run the headless daemon

**Status:** accepted

## Context

OpenDesign can be run from a published container image or from a source checkout.
The container image is convenient for standalone deployments, but an ACQ kit has a
different goal: run OpenDesign in the same sandbox process environment as the
already-installed coding agents.

OpenDesign launches local agent CLIs such as OpenCode. If OpenDesign runs inside
a nested container, the existing sandbox `opencode` binary, OpenCode config, and
ACQ-injected environment are not naturally visible without extra mounts and PATH
plumbing. That would make the kit harder to reason about and would duplicate
responsibility already owned by ACQ and sibling kits.

OpenDesign also requires Node 24 and pnpm 10.33.2. The OpenCode sandbox base may
carry a different Node major, so assuming the base `node` is fragile.

## Decision

Install OpenDesign from the pinned upstream source tag
`open-design-v0.24.0`, verify the checked-out commit, install a kit-managed Node
24 runtime under the kit volume, activate pnpm 10.33.2 through Corepack, and run
the built daemon headlessly with:

```bash
node apps/daemon/dist/cli.js --host 0.0.0.0 --port 7456 --no-open
```

The install runs during the startup phase, not create time. It is idempotent and
fail-soft: failures are logged but do not fail sandbox creation/startup.

## Consequences

- OpenDesign sees the sandbox's existing `opencode` and OpenCode configuration.
- The kit does not need nested Docker/Podman.
- First boot can be slow because it downloads Node, installs dependencies, and
  builds OpenDesign.
- First boot needs enough memory for the Next.js production build. Direct
  exercise with a 1536 MiB Node heap reached the web build, compiled
  successfully, and failed during `Running TypeScript ...` with `JavaScript heap
  out of memory`; the kit now defaults to a 3072 MiB Node heap. Host verification
  should use a larger sandbox or adopt a prebuilt artifact if upstream publishes
  one if that is still insufficient.
- The persistent kit volume caches the source checkout, Node runtime, Corepack
  state, pnpm executable home, explicit pnpm store, and build marker for later
  starts.
- The kit must allow egress to GitHub, nodejs.org, and registry.npmjs.org for
  first boot.
