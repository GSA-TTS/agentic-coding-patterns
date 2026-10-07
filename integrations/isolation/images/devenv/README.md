# devenv sandbox image

A generic base image for agentic-coding sandboxes whose repos use
[devenv](https://devenv.sh): Nix (single-user — sandboxes have no systemd, so
no daemon), devenv, and direnv baked at build time. Create-time installs are
impractical here — the Nix closure is GBs, and sandbox egress policies rightly
block package mirrors — so the toolchain ships as a published image instead.

Built and pushed to GHCR by
[`devenv-image.yml`](../../../../.github/workflows/devenv-image.yml) on
changes to the `Dockerfile` or [`VERSION`](VERSION) (plus manual dispatch), as
a multi-arch (amd64 + arm64) public package.

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

The devenv major is part of the image contract: `1.x` tags ship devenv 1.x
(nixos-25.05), `2.x` tags ship devenv 2.x (nixos-26.05). devenv 2.x bundles
its own Nix for evaluation and builds and shares the single-user store with
the installer's Nix on `PATH`; both read and write the same store database.

## devenv 2.x notes for consuming repos

A 2.x image runs a repo's `devenv.nix` with the modules pinned by that repo's
`devenv.lock` (the `devenv` input), so a 1.x-locked repo keeps its 1.x module
semantics until someone runs `devenv update`. What the CLI major changes
regardless of the lock:

- The `git-hooks` input is no longer implicit. A repo using `git-hooks.hooks`
  fails with `git-hooks or pre-commit-hooks input required` until it declares
  the input in `devenv.yaml`.
- `devenv shell` rewrites `devenv.lock` to drop the implicit `git-hooks`,
  `pre-commit-hooks`, and `flake-compat` nodes; a 1.x CLI adds them back at
  current HEAD. Teams mixing 1.x CI with 2.x sandboxes see lock churn until
  `git-hooks` is declared explicitly, which makes both majors agree.
- `.devenv/` written by either major is reusable by the other (the eval cache
  is keyed on the devenv version).
- `devenv up -d` works; `devenv processes down` may time out and SIGKILL the
  process group without stopping the service's children.
- `.devenv/` lives in the project root, so in a sandbox it is part of the
  workspace and persists with it. Under `--clone` the workspace is inside the
  sandbox, and a recreate discards `.devenv/state` along with any service data
  it holds (a Postgres database, for example).
- Once a repo moves to 2.x modules, built-in services (Postgres, Redis, and
  others) pick the next free port when their base port is taken. Set
  `strict_ports: true` in `devenv.yaml` when a kit publishes or another tool
  expects a fixed port, so a conflict fails instead of silently moving the
  service.
- SecretSpec is opt-in (`secretspec.enable` in `devenv.yaml`, or
  `SECRETSPEC_PROVIDER`/`SECRETSPEC_PROFILE`). On missing secrets it prompts
  only when stdin is a terminal, which an agent's PTY can be; otherwise it
  fails.

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
change (`NIXPKGS_REV`, installer version, base image), with a major bump when
the devenv major changes; tags are never reused —
the workflow refuses to republish an existing version tag. A moving `latest`
also exists — pin the version tag in anything durable.
