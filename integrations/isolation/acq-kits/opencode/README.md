# opencode (acq mixin kit)

Installs [anomalyco/opencode](https://github.com/anomalyco/opencode) (MIT) —
the OpenCode terminal AI coding agent — via a **pinned, SHA-256-verified
release binary**, not npm. Replaces acq's own unpinned MSB fallback
(`npm install -g opencode-ai`, resolves to latest) with a deterministic,
version-pinned install.

This is the first **harness-agent kit** in the family: it declares the
top-level `agent:` block (`name: opencode`, `entrypoint: opencode`) so acq's
built-in agent-kit readiness gate can confirm this kit genuinely provides the
`opencode` agent token before enabling it for implicit agent selection — see
GSA-TTS/agentic-coding-quickstart's `acq.backends/common.sh`
(`acq_validate_agent_builtin_kit_dir`) and the ADR-0030 devenv/agent-kits
epic this kit is part of.

opencode is a **TUI, not a web UI** (contrast the sibling `paseo` and
`openchamber` kits, which each publish a browser-UI port), so this kit
publishes **no ports**.

## Why a release-binary pin, not npm or nixpkgs

**Not npm** (`npm install -g opencode-ai`): this kit's chosen install method —
fetching the GitHub Release tarball directly — has no npm package metadata and
no native-module postinstall step to go through at all, because it never
touches npm. The `opencode-ai` npm package itself DOES have real package
metadata and its own `postinstall` script (which fetches the actual binary
separately, confirmed against the live npm registry) — this kit sidesteps that
postinstall step entirely rather than it not existing. That matters because
the postinstall step is a real, already-documented bug: GSA-TTS/agentic-coding-quickstart's
`docs/KNOWN_FAILURE_MODES.md` records that `opencode-ai`'s own npm
postinstall step intermittently fails fetching the real binary, which `acq`
already carries a bespoke `ensure_opencode_postinstall`
remediation for. This kit's install method has no postinstall step at all —
the release tarball already contains the real binary.

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

## Install method: GitHub Release asset, direct fetch + verify

Mirrors the goose-server kit's pattern (a single prebuilt binary tarball
needs no toolchain, so there is no create-vs-startup safety tension the way
there is for openchamber's native-module npm dependency — the install runs at
**create time**, as root, once):

1. Resolve the guest architecture (`uname -m`) to OpenCode's own asset-name
   convention (`opencode-linux-x64.tar.gz` / `opencode-linux-arm64.tar.gz`).
2. Fetch the pinned release tarball from GitHub Releases.
3. Verify its SHA-256 against the pin **before** extracting.
4. Extract the single `opencode` binary and install it to `/usr/local/bin`.

**Deliberately not** the `opencode.ai/install` curl-pipe-to-shell script: it
resolves "latest" by default (an explicit `--version` flag is required to
pin at all), and its redirect/CDN chain is designed for interactive/CI use,
not a non-interactive, SHA-pinned create-time install. This kit fetches the
same underlying GitHub Release asset directly, with its own pin and
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

As of this kit's authoring, upstream has tagged `v2.0.0` through `v2.0.21`,
but none of them are published GitHub Releases, npm versions, or
Homebrew-formula versions — see
[`docs/decisions/opencode-v2-not-yet-released.md`](docs/decisions/opencode-v2-not-yet-released.md)
for the full verification. This kit pins the real, currently-released
`1.18.x` series. When v2 does ship, treat the migration as a deliberate,
reviewed change (the upstream diff is already on the order of several
thousand commits), not a routine pin bump.

## Egress allow-list

Deny-by-default. `github.com` (the initial release-asset request) and
`release-assets.githubusercontent.com` (the host GitHub's download redirect
actually resolves to for release assets — verified live against the real
pinned release before authoring this kit). Sibling kits (`openchamber`,
`prime-agent`) instead allow-list `objects.githubusercontent.com` for the
same purpose (release-asset downloads) — GitHub has used more than one
redirect hostname for release assets historically, and this kit's allowlist
covers the host actually observed for this specific release; a future GitHub
infrastructure change to the redirect target would need this allowlist
revisited.

## Version pin

`OPENCODE_VERSION` / `OPENCODE_SHA256_LINUX_X64` / `OPENCODE_SHA256_LINUX_ARM64`
default to a specific, reviewed release — never `latest`. Bump all three
together, as a deliberate reviewed change, after independently re-deriving
both hashes from the real release assets (download + `shasum -a 256`, not
copied from any third party).

## Backend parity

Written entirely in the neutral hybrid/v1 vocabulary (`caps` / `files` /
`commands` / `agent`), with no `backend_shortcuts` or `backend_extras`. acq's
kit translation feeds the same spec to whatever backend it has active (sbx,
msb). No published port and no supervisor loop, so no per-backend
detached/port primitives are needed.
