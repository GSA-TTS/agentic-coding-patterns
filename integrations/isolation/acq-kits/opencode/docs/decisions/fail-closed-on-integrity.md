# ADR: Fail closed on integrity, fail soft on availability

## Context

Every other kit in this family that fetches and verifies a pinned artifact
(openchamber's installer, the Nix installer in the devenv image) treats
verification failure as just another availability failure: log a warning,
skip the optional step, keep the sandbox alive. That convention exists because
in every one of those cases, the thing being installed is an *optional
capability* layered onto an already-functional sandbox — OpenChamber is a web
UI for a model the sandbox can still reach without it; a missing CA cert
degrades TLS trust but doesn't remove the agent.

This kit is different: it installs the sandbox's *agent harness itself*. If
this kit's install silently degrades the same way an optional-capability
kit's does, the practical result is a sandbox with no agent at all — the
single least-recoverable failure mode this whole agent-kit migration exists
to avoid, since the entire point of the kit is to replace an unpinned
fallback (`npm install -g opencode-ai`) that resolves to whatever is newest.

## Decision

Split "the download didn't work" from "the download worked but doesn't match
what we expect" into two different failure classes, with different handling:

- **Availability failures** (no pin set, unsupported architecture, network
  unreachable, extraction failed, binary not executable after install): warn
  loudly to stderr, exit 0. The agent is absent this boot; the sandbox stays
  up. Identical in shape to every other kit's fail-soft convention.
- **Integrity failure** (the downloaded archive's SHA-256 does not match the
  pin): warn loudly, with an explicit `SECURITY:` prefix distinguishing it
  from an availability warning, and refuse to extract or install the
  mismatched bytes. **Still exits 0** (a bad download must not crash sandbox
  *creation*), but there is no fallback path to degrade to — unlike the
  quickstart-side gate this kit satisfies, whose own fallback IS the unpinned
  npm path this kit exists to retire. Falling back to it on a hash mismatch
  would silently reintroduce the exact risk this kit closes, defeating the
  pin's purpose at the one moment it matters.

## Consequences

- A corrupted or tampered download never results in a running, unverified
  opencode binary — the kit either runs the exact pinned bytes or runs
  nothing.
- The agent being absent after a hash mismatch is a user-visible gap (no
  `opencode` on PATH), not a silent compromise. The stderr warning is written
  with enough detail (`got X, want Y, at <version>`) to self-diagnose or
  report.
- This intentionally diverges from the openchamber/pi-coding-agent kits'
  "every failure path looks the same" convention. That divergence is the
  point: those kits install something optional; this kit installs the thing
  the sandbox exists to run.
