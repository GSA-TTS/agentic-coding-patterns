# ADR: OpenCode v2 is tagged but not yet released; this kit pins 1.18.x

## Context

OpenCode's upstream repository (`anomalyco/opencode`) carries git tags
`v2.0.0` through `v2.0.21` as of this kit's authoring. Taken at face value,
pinning to a `v2.x` tag would look like "the current version."

Verified directly before authoring this kit, across every real distribution
channel:

- No `v2.x` tag has a published GitHub Release object (`GET
  /repos/anomalyco/opencode/releases/tags/v2.0.21` returns 404, as does every
  other `v2.x` tag checked).
- `npm view opencode-ai dist-tags` reports `latest` as a `1.18.x` version; no
  `2.x` version has ever been published to npm.
- The GoReleaser-generated Homebrew tap formula
  (`anomalyco/homebrew-tap/opencode.rb`) still pins a `1.18.x` version.
- No `2.x` tag exists in the project's GHCR container image tags.
- The `v2.0.0` tag's own commit message is `fix(release): use V2 Docker
  artifact paths`, for a previous, failed v2.0.0 release attempt (per that
  commit's own PR description: "The first 2.0.0 attempt published some npm
  packages before failing...").

So `v2.x` is real, in-progress upstream work, but is not yet consumable by any
install path a kit could pin to. The opencode.ai docs site shows a "New
OpenCode v2 is now available" banner, but every actual install command on
that same page (`npm install -g opencode-ai`, the install script, Homebrew,
Docker) still resolves to the current `1.18.x` release.

## Decision

Pin this kit to the real, currently-released `1.18.x` series (see spec.yaml
for the exact pinned version and hashes). Do not attempt to track or
pre-pin against any `v2.x` tag.

## Consequences

- When v2 does actually ship (a published GitHub Release + npm version +
  Homebrew formula bump, not just a tag), bumping this kit's pin is NOT a
  routine version increment. `git diff v1.18.34...v2.0.21` on the upstream
  repo is already ~3,976 commits / 5,000+ files — large enough that GitHub's
  own compare UI refuses to render it. Treat the v2 migration as its own
  reviewed change: re-verify the asset naming convention, the CLI invocation
  shape, and this kit's wrapper/entrypoint assumptions all still hold, rather
  than assuming a pin bump is sufficient.
- This ADR should be revisited (and likely retired) once v2 has a real,
  checkable release across at least npm and GitHub Releases.
