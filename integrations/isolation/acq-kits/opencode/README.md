# opencode (acq mixin kit)

Installs [anomalyco/opencode](https://github.com/anomalyco/opencode) (MIT) —
the OpenCode terminal AI coding agent — via a **pinned, SHA-256-verified
OpenCode v2 platform package tarball**. Replaces acq's older unpinned MSB
fallback (`npm install -g opencode-ai`, resolves to the legacy 1.x line) with a
deterministic, version-pinned install.

This is the first **harness-agent kit** in the family: it declares the
top-level `agent:` block (`name: opencode`, `entrypoint: opencode`) so acq's
built-in agent-kit readiness gate can confirm this kit genuinely provides the
`opencode` agent token before enabling it for implicit agent selection. The
sibling quickstart repository implements that gate in `acq.backends/common.sh`
(`acq_validate_agent_builtin_kit_dir`). This kit is the reusable, declarative
replacement for acq's older backend-specific fallback installer.

opencode is a **TUI, not a web UI** (contrast the sibling `paseo` and
`openchamber` kits, which each publish a browser-UI port), so this kit
publishes **no ports**.

## Why a direct platform tarball pin, not npm install or nixpkgs

**Not `npm install -g @opencode/cli`**: the stable OpenCode 2.x CLI is published
as `@opencode/cli`, whose wrapper package has a `postinstall` script that
selects and copies an optional architecture-specific binary package, including
a baseline x64 build for hosts without AVX2. This kit sidesteps that lifecycle
script by fetching the exact `@opencode/cli-linux-<arch>` tarball directly,
verifying its SHA-256, and extracting the already-built binary. This keeps the
install deterministic and non-interactive while still using the official 2.x
npm distribution.

**Not the older npm fallback** (`npm install -g opencode-ai`): that package is
still on the legacy 1.x line and its own postinstall step has an
already-documented intermittent fetch failure in GSA-TTS/agentic-coding-quickstart's
`docs/KNOWN_FAILURE_MODES.md`.

**Not nixpkgs**: the project's devenv sandbox image
(`integrations/isolation/images/devenv/`) pins nixpkgs at a fixed revision.
At that pinned revision, nixpkgs' own `opencode` package resolves to
`v0.3.112`, built from the pre-rename upstream repository (`sst/opencode`) —
roughly 70 releases behind the real current release this kit pins. Verified
directly (fetched the pinned revision's own `package.nix` from the real
nixpkgs repository) before choosing the release-binary approach instead.
Revisit nixpkgs only if/when the devenv image's pinned revision tracks the
real `anomalyco/opencode` repository at a current version — neither is true
today.

## Install method: npm platform package, direct fetch + verify

Mirrors the release-asset pinning pattern while using OpenCode v2's actual
published distribution channel. The install runs at **create time**, as root,
once:

1. Resolve the guest architecture (`uname -m`) to OpenCode's npm platform
   package convention (`@opencode/cli-linux-x64`,
   `@opencode/cli-linux-x64-baseline`, or `@opencode/cli-linux-arm64`).
2. Fetch the pinned npm tarball directly from `registry.npmjs.org`.
3. Verify its SHA-256 against the pin **before** extracting.
4. Extract `package/bin/opencode` and install it to `/usr/local/bin`.

**Deliberately not** the `opencode.ai/install` curl-pipe-to-shell script: it
resolves "latest" by default (an explicit `--version` flag is required to
pin at all), and its redirect/CDN chain is designed for interactive/CI use,
not a non-interactive, SHA-pinned create-time install. This kit fetches the
same underlying v2 platform package tarball directly, with its own pin and
verification.

## Integrity posture: fails CLOSED on a hash mismatch

Every other kit in this family (`openchamber`, `pi-coding-agent`) treats a
verification failure as just another availability failure — warn and
degrade, because the thing being installed is an *optional capability*. This
kit is different: it installs the sandbox's agent harness itself. See
[`docs/decisions/fail-closed-on-integrity.md`](docs/decisions/fail-closed-on-integrity.md)
for the full reasoning. In short:

- **Availability failures** (no pin set, unsupported architecture, network
  unreachable, extraction failed): fail soft — warn to stderr, exit 0, agent
  absent this boot, sandbox stays up. Same shape as every sibling kit.
- **A SHA-256 mismatch**: fails CLOSED — refuses to extract or install the
  mismatched bytes, with an explicit `SECURITY:`-prefixed warning. There is
  no unpinned fallback path to degrade to (unlike the quickstart-side gate
  this kit satisfies, whose own fallback *is* the unpinned npm path this kit
  exists to retire) — falling back to it on a hash mismatch would silently
  reintroduce the exact risk this kit closes.

## OpenCode v2

OpenCode 2.x is now available as the `@opencode/cli` npm package, with separate
platform packages such as `@opencode/cli-linux-x64`,
`@opencode/cli-linux-x64-baseline`, and `@opencode/cli-linux-arm64`. The installer selects the baseline x64 package
when AVX2 is unavailable, matching upstream's postinstall logic. GitHub Release
tarballs for the `v2.0.x` tags are
still not published, so this kit pins the npm platform tarballs directly. See
[`docs/decisions/opencode-v2-npm-platform-tarballs.md`](docs/decisions/opencode-v2-npm-platform-tarballs.md)
for the migration record.

## Egress allow-list

Deny-by-default. `registry.npmjs.org` is the only host needed because the kit
fetches the pinned `@opencode/cli-linux-<arch>` package tarball directly from
npm's registry. It does not need `github.com`, GitHub release-asset hosts, or
the `opencode.ai` installer endpoint.

## Version pin

`OPENCODE_VERSION` / `OPENCODE_SHA256_LINUX_X64` /
`OPENCODE_SHA256_LINUX_X64_BASELINE` / `OPENCODE_SHA256_LINUX_ARM64` are set by
`spec.yaml` to a specific, reviewed release - never `latest`. Bump all four
together, as a deliberate reviewed change, after independently re-deriving the
hashes from the real npm platform tarballs (download + `shasum -a 256`, not
copied from any third party).

## Backend parity

Written entirely in the neutral hybrid/v1 vocabulary (`caps` / `files` /
`commands` / `agent`), with no `backend_shortcuts` or `backend_extras`. acq's
kit translation feeds the same spec to whatever backend it has active (sbx,
msb). No published port and no supervisor loop, so no per-backend
detached/port primitives are needed.
