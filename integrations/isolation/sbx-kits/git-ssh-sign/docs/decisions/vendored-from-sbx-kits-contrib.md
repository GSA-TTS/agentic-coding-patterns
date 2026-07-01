# Decision: vendor git-ssh-sign from sbx-kits-contrib

**Status:** accepted

## Context

Federal contributors (and their agents) are expected to sign commits. Docker's
[sbx-kits-contrib](https://github.com/docker/sbx-kits-contrib) publishes a
`git-ssh-sign` mixin that configures git to sign with the SSH key forwarded from
the host agent. It does exactly what we need.

We could apply it directly by remote reference
(`git+https://github.com/docker/sbx-kits-contrib.git#…&dir=git-ssh-sign`), but
that would (a) add a second remote kit source to every consumer's
`kit.allowedSources` allowlist and (b) leave a supply-chain dependency on a repo
we don't control, resolved fresh at sandbox-create time.

## Decision

**Vendor (copy) the kit into this repo**, under
`integrations/isolation/sbx-kits/git-ssh-sign/`, with attribution.

- **Provenance:** copied from `docker/sbx-kits-contrib` at commit
  `d259d157af15649d1f90902cae397ebe1f2b1e3d`. Recorded in `NOTICE`.
- **License:** the upstream kit is Apache-2.0. We retain a copy of the license
  (`LICENSE`) and an attribution `NOTICE` in the kit directory, as Apache-2.0
  §4 requires for redistribution. (This repo is otherwise CC0; the Apache-2.0
  terms apply to this vendored subtree.)
- **Supply chain:** vendoring means consumers resolve this kit from the same
  pinned `GSA-TTS/agentic-coding-patterns` source they already trust for the
  other kits — no additional `kit.allowedSources` entry, and changes arrive only
  via reviewed PRs here.

### Modifications from upstream

1. **Ported spec `schemaVersion "1"` → `"2"`** for consistency with the other
   kits in this directory. The only surface change is `memory:` → `agentContext:`;
   sbx normalizes v1 into the same canonical form, so behavior is identical.
2. **Dropped `files/home/.config/git/hooks/pre-commit`.** Upstream ships this
   file but its own README states the kit "does not set `core.hooksPath` and does
   not install a pre-commit hook," and the `install` step actively unsets
   `core.hooksPath` when it points at that hooks dir. The file is vestigial and
   contradicts the documented design, so it is omitted. Signing works via
   `gpg.ssh.defaultKeyCommand`, not a hook.
3. **Added** `README.md`, `TROUBLESHOOTING.md`, `scripts/verify`, and this
   record, matching the house style of the sibling kits.

The signing logic itself (system-gitconfig install + signing-time key command)
is copied verbatim.

## Consequences

- Commit signing is available as a first-class, reviewed kit alongside the USAi
  provider, playbook, and CA kits.
- The kit is **fail-closed**: with no SSH key in the forwarded agent, git refuses
  to sign rather than producing unsigned commits. The `agentic-coding-quickstart`
  wrapper (`qsbx`) warns before attaching if the host has no key loaded, so users
  aren't surprised mid-commit; the kit is unchanged for that ergonomics.
- We take on a small maintenance duty: periodically reconcile against upstream
  `git-ssh-sign` for fixes (the pinned source commit in `NOTICE` is the diff
  base).

## Links

- Upstream: <https://github.com/docker/sbx-kits-contrib/tree/main/git-ssh-sign>
- [Docker: signed commits in sandboxes](https://docs.docker.com/ai/sandboxes/usage/#signed-commits)
