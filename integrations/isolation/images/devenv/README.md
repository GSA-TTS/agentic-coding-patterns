# devenv sandbox image

A generic base image for agentic-coding sandboxes whose repos use
[devenv](https://devenv.sh): Nix (single-user — sandboxes have no systemd, so
no daemon), devenv, and direnv baked at build time. Create-time installs are
impractical here — the Nix closure is GBs, and sandbox egress policies rightly
block package mirrors — so the toolchain ships as a published image instead.

Built and pushed to GHCR by
[`devenv-image.yml`](../../../../.github/workflows/devenv-image.yml) on
changes to this directory (plus manual dispatch), as a multi-arch
(amd64 + arm64) public package.

## Variants

| Image | Base | Use |
|-------|------|-----|
| `devenv-shell` | `docker/sandbox-templates:shell-docker` | Generic, agent-less: the backend or a kit installs the agent at provision time. |
| `devenv-opencode` | `docker/sandbox-templates:opencode-docker` | OpenCode preinstalled, for sbx-native `acq run opencode --template` attach. |

## Consumption

One knob on either backend:

```sh
ACQ_IMAGE=ghcr.io/gsa-tts/agentic-coding-patterns/devenv-shell:<tag> acq run …
```

sbx pulls it as a template ref; msb as a plain OCI ref.

## What's baked vs. what stays in kits

The image contains only the base-agnostic toolchain: Nix (single-user store
owned by `agent`), devenv + direnv pinned to a nixpkgs rev, flakes enabled,
and the bash wiring that puts the Nix profile and direnv hook in every shell.

Everything else is a kit's job:

- **Runtime CA trust** — e.g. the `zscaler-ca-certificate` kit; the image pins
  Nix at the system CA bundle, which such kits update.
- **Team config** — instructions, egress, agent settings, extra CLI tools.
- **Sized `/nix` store** — pair the image with a kit-declared `volumes:` entry.

## Local builds behind a TLS-inspecting proxy

CI builds bake no proxy CA — wrong default for a public generic image. For a
local rebuild behind such a proxy, pass the root CA's PEM content:

```sh
docker build --build-arg EXTRA_CA_CERT="$(cat proxy-root-ca.crt)" .
```

## Versioning

[`VERSION`](VERSION) is the published tag, bumped together with any toolchain
change (`NIXPKGS_REV`, installer version, base image); tags are never reused.
A moving `latest` also exists — pin the version tag in anything durable.
