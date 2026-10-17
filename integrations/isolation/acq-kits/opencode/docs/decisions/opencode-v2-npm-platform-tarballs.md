# ADR: OpenCode v2 is installed from pinned npm platform tarballs

## Context

When this decision was made, OpenCode's upstream repository
(`anomalyco/opencode`) carried git tags through `v2.0.22`, and the stable v2 CLI is published to npm under the new
`@opencode/cli` package. The older `opencode-ai` package remains on the legacy
`1.18.x` line, and the `v2.0.x` git tags still do not have matching GitHub
Release objects or `opencode-linux-<arch>.tar.gz` release assets.

Verified directly during the v2 migration:

- `npm view @opencode/cli dist-tags` reports `latest` as `2.0.22`.
- `npm view @opencode/cli@2.0.22` declares `bin.opencode` and optional platform
  packages including `@opencode/cli-linux-x64`,
  `@opencode/cli-linux-x64-baseline`, and `@opencode/cli-linux-arm64`, all at
  `2.0.22`.
- `npm view opencode-ai dist-tags` still reports `latest` as `1.18.34`.
- `GET /repos/anomalyco/opencode/releases/tags/v2.0.22` returns 404, and the
  expected GitHub Release asset URL for `v2.0.22` also returns 404.

So v2 is now installable, but not through the GitHub Release tarball path this
kit originally used. The installable, architecture-specific v2 artifacts are npm
platform packages.

## Decision

Pin this kit to a stable 2-series version of `@opencode/cli` (`2.0.22` at the
time of this decision; the current pin is `OPENCODE_VERSION` in `spec.yaml`) by
fetching the matching `@opencode/cli-linux-<arch>` npm tarball directly from
`registry.npmjs.org`, verifying the tarball SHA-256, and extracting
`package/bin/opencode` without running npm lifecycle scripts. On x64 Linux,
select the baseline package when AVX2 is not available, matching upstream's own
postinstall selection logic.

## Consequences

- The kit installs a pinned stable 2-series OpenCode CLI while preserving the previous deterministic direct-download/verify/extract
  model.
- The egress allow-list changes from GitHub release hosts to `registry.npmjs.org`.
- The kit intentionally does not run `npm install -g @opencode/cli`: that wrapper
  package uses a postinstall script to select a platform package, and this kit
  keeps lifecycle scripts out of the create-time install path.
- Future bumps must re-check `@opencode/cli` and all supported Linux platform
  packages, then re-derive the SHA-256 values from the real npm tarballs.
