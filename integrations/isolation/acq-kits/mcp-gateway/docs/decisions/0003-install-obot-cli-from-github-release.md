# Decision: Install the obot CLI from a pinned GitHub Release binary

**Status:** accepted

## Context

The kit needs the `obot` CLI inside the sandbox to discover and reach MCP servers
(ADR-0001). The user installs obot on their workstation via Homebrew
(`brew install obot-platform/tap/obot`), but Homebrew is not available (or
appropriate) inside the ephemeral Linux sandbox.

Inspecting the Homebrew formula (`obot-platform/homebrew-tap`) shows it is a
GoReleaser-generated wrapper: it downloads a **static binary tarball** from GitHub
Releases and does `bin.install "obot"`. i.e. brew adds nothing but the download +
place-on-PATH. The release assets are per-OS/arch, e.g.
`obot_v0.25.4_linux_amd64.tar.gz`.

## Decision

Install obot by **fetching the pinned release asset directly** from GitHub
Releases at create time, as root, and placing the single `obot` binary on PATH
(`/usr/local/bin`). No Homebrew, no Go toolchain, no build.

- **Pin the version and the archive sha256.** GitHub *release* assets are
  byte-stable (unlike auto-generated *source* tarballs, which the server
  recompresses), so we pin the archive sha256 directly and verify before
  extracting — simpler than the content-manifest digest the playbook kit needs.
  Pins are passed via the install command env with in-script fallbacks kept in
  sync (`OBOT_VERSION`, `OBOT_SHA256_LINUX_AMD64`).
- **Target `linux/amd64`.** The sandbox base and the gateway host are amd64. (An
  `arm64` asset exists; multi-arch selection is future work if a backend runs on
  arm64.)
- **Non-fatal.** A download/verify failure warns and exits 0 so provisioning
  still succeeds; obot is simply absent and the startup + helper steps warn. This
  matches the `agentic-coding-playbook` and `zscaler-ca-certificate` kits'
  degrade-gracefully posture.

## Considered alternatives

- **`brew` inside the sandbox** — rejected: heavy dependency, not present in the
  base image, and buys nothing over the direct asset fetch the formula itself does.
- **`go install`** — rejected: pulls a Go toolchain and builds from source; slower,
  larger, and not reproducible against a pinned artifact hash.
- **Content-manifest digest (like the playbook kit)** — unnecessary: release
  assets are byte-stable, so a direct archive-sha pin is sufficient and simpler.

## Consequences

- Bumping obot = change `OBOT_VERSION` + `OBOT_SHA256_LINUX_AMD64` together (in
  the spec's install command and the script fallbacks), and re-verify.
- The install adds three egress hosts (`api.github.com`, `github.com`,
  `objects.githubusercontent.com`) for the release download.

## See also

- [`0001-obot-cli-discovery-and-wiring.md`](0001-obot-cli-discovery-and-wiring.md)
- [`0004-prime-obot-config-and-token.md`](0004-prime-obot-config-and-token.md)
- Homebrew formula: `github.com/obot-platform/homebrew-tap` (GoReleaser wrapper).
