# opencode (acq mixin kit)

Installs [anomalyco/opencode](https://github.com/anomalyco/opencode) (MIT) —
the OpenCode terminal AI coding agent — via a **pinned, SHA-256-verified
OpenCode v2 platform package tarball**. Replaces acq's older unpinned MSB
fallback (`npm install -g opencode-ai`, resolves to the legacy 1.x line) with a
deterministic, version-pinned install.

## Provider Renderer Ownership

The kit stages its base policy at `/home/agent/opencode-config/base-config.jsonc`.
It never file-drops that policy into `~/.config/opencode/opencode.jsonc`. At
startup, the renderer is the sole OpenCode global-config writer: it composes the
staged base policy, any existing user global config, and the authoritative
provider projection, then atomically replaces the canonical file. Renderer-owned
provider blocks carry SHA-256 ownership digests; modifying one fails closed
rather than silently deleting a user edit.

The provider projection reads `ACQ_PROVIDER_INPUT_ROOT/models/providers`.
The renderer returns `not-ready` without changing global config when that
generation is absent. Current kit lifecycle semantics do not prove startup hooks
complete before the agent entrypoint consumes config. The required readiness
barrier is supplied by Quickstart's provider-projection startup gate; this kit does not
claim that ordering until that dependency lands.

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

## Provider input rendering

This kit is the sole acq-owned writer of OpenCode's global configuration. At
startup it reads the backend-supplied `ACQ_PROVIDER_INPUT_ROOT`; each provider
directory is `models/providers/<providerId>/`, with `facts.json` and
`snapshot.json` for each provider. The SBX and MSB backends expose the same
layout; MSB's root is `/var/lib/acq/provider-input`.

The directory set below `models/providers` is authoritative, including
an empty set. A missing input root or `current` is not authoritative and leaves
the existing OpenCode config unchanged. The renderer consumes `snapshot.json`
as the catalog for this milestone. It intentionally does not invoke provider
normalizers or aggregate snapshots; acq has already selected and materialized
the current generation.

Per-model capability metadata is translated here, not in the provider kit:
neutral `reasoning` becomes OpenCode `reasoning`, and neutral `inputModalities`
becomes `modalities.input`. Absent neutral fields stay absent (unknown), values
outside the closed modality allowlist fail the render. The renderer emits no
reasoning effort or variants, but OpenCode may derive selectable variants from
`reasoning: true` (1.x does so for openai-compatible models: low/medium/high
reasoning-effort variants, per v1.18.35 `transform.ts` `variants()`); check
this before any `reasoning: true` value is committed; the synthetic-image
procedure covers image input only and cannot substantiate `reasoning`, `audio`,
`video`, or `pdf`. See
[ADR 0006](../../docs/decisions/0006-neutral-model-capability-metadata.md) and
the [synthetic-image validation procedure](docs/synthetic-image-validation.md).

The provider renderer preserves unrelated user configuration and removes only
the provider IDs and default model roles recorded in its previous ownership
metadata. Startup runs after acq materializes `current`; no provider kit writes
OpenCode configuration, preventing a dual-writer race during cutover.

The staged `permission` object is security-owned and replaces any user
`permission` object on every render. This prevents a global override from
reopening credential reads or approval gates. User settings outside
`permission`, including themes, instructions, MCP entries, and foreign provider
definitions, are retained.

The renderer owns the OpenAI-compatible adapter selected by the validated
`apiProtocol`; it supplies gateway timeouts, LiteLLM mode, and non-secret
identification headers without adding OpenCode-specific fields to neutral
provider facts or catalogs.

The adapter in `files/home/opencode-config/render-provider-config.mjs` sets
`chunkTimeout` to **300000 ms (five minutes)**. This is the maximum idle wait
for the next SSE event, not the total request duration.
Extended reasoning or gateway buffering can exceed the former two-minute idle
limit and trigger `SSE read timed out`. The separate `timeout` remains
**600000 ms (ten minutes)**, so stalled requests are still bounded. A genuinely
stalled stream can now take three minutes longer to fail. Restart or reload the
OpenCode runtime after the kit renders updated configuration to apply it.

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
