# Decision: install the Paseo CLI at startup, not at create time

**Status:** accepted

## Context

The sibling `openchamber` kit documents (in its `install-at-startup.md`) that a
create-time install hook is dangerous when the install can fail: a non-zero exit
crashes sandbox creation itself (a dead sandbox, not just a missing UI).
OpenChamber also had a native-module (better-sqlite3) toolchain hazard and fetched
a pinned `install.sh` it had to SHA-verify.

Paseo's install is simpler but the create-path hazard is the same:

- Install is a plain **`npm install -g @getpaseo/cli`** (which pulls
  `@getpaseo/server`, whose npm tarball **bundles** the web UI at
  `dist/server/web-ui/`). No `install.sh` to fetch or pin.
- Its only native dependency, `sherpa-onnx-node` (voice), resolves via
  **platform prebuilt `optionalDependencies`** (`sherpa-onnx-linux-x64`, etc.)
  with **no build/install scripts** — so it installs on the opencode base image,
  which has **no C toolchain**, straight from the npm registry. Setting
  `ONNXRUNTIME_NODE_INSTALL=skip` (mirroring Paseo's own Docker image) avoids any
  onnxruntime fetch attempt.
- All tarballs are served from `registry.npmjs.org` (npm's `dist.tarball` URLs
  point there), so that single host is the only egress the install needs.

Still, an npm install can transiently fail (registry 503, proxy blip). Putting it
in a create-time hook would risk crashing sandbox create over an optional UI.

## Decision

**Do the install in the `startup` phase (backgrounded), never a create-time
hook.** `paseo-start.sh` installs the CLI on first boot only (guarded by
`command -v paseo`), then supervises the daemon. There is deliberately no
`install` phase.

- The startup script routes npm through the sandbox proxy
  (`HTTP(S)_PROXY`/`npm_config_*`) and builds a `NODE_EXTRA_CA_CERTS` bundle from
  the sandbox proxy CA (`PROXY_CA_CERT_B64`) + the system trust store, so the
  install works behind an inspecting proxy (e.g. Zscaler).
- On the default sandbox-template base the npm global prefix is root-owned, so
  the install uses an agent-owned npm prefix (`$HOME/.npm-global`) and cache
  (`$HOME/.npm`) instead of `sudo npm`. That keeps all npm-written files owned by
  the agent user and avoids privileged package installation.
- A failed install degrades to "UI unavailable" (`|| true` + an early `exit 0`
  after the `command -v paseo` guard); it never fails the sandbox.

## Why no SHA-pinned installer (unlike openchamber)

OpenChamber piped a fetched `install.sh` to bash, so it pinned + SHA-verified
that script. Paseo has no such script — the integrity anchor is npm's own
registry + the pinned package **version** (`PASEO_CLI_VERSION`, exported from the
kit spec with a matching in-script default; bump both together). This mirrors the
repo's pin posture at the granularity Paseo actually offers (a version, resolved
from the trusted npm registry over the proxied, allow-listed egress).

## Consequences

- `acq create` can never be taken down by a Paseo install failure.
- First boot pays a one-time npm install cost (a few seconds) before the UI is
  reachable; later starts skip it (guarded by `command -v paseo`).
- Adopting a newer Paseo release is a two-value edit (`PASEO_CLI_VERSION` in
  `spec.yaml` + the fallback default in `paseo-start.sh`).
- The kit's only egress is `registry.npmjs.org`.

## Links

- `../../openchamber/docs/decisions/install-at-startup.md` — the create-path
  crash rationale this reuses.
- `../../openchamber/docs/decisions/pin-and-verify-installer.md` — why
  openchamber SHA-pins an installer; why Paseo (npm-only) pins a version instead.
- `../../../paseo/files/home/paseo-start.sh`.
