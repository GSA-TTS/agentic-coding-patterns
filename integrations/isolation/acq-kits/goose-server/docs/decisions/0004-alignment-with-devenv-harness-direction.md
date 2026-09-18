# Decision: alignment with the devenv / harness-adapter direction (forward work)

**Status:** accepted (records known divergences from an in-flight architecture
direction; not a change to the kit's current behavior)

## Context

While this kit was being built, the team opened a design discussion about the
direction of `acq` and kits. Two proposals are relevant to `goose-server`:

1. **Generic devenv base image, agent knowhow in kits.** Stop baking agents into
   backend base images. Boot a single generic **devenv** image (Nix + devenv +
   direnv, agent-less) on both backends, and move ALL agent install/config/startup
   knowhow — including OpenCode's — into kits that drop **devenv** configuration.
   `acq` runs the devenv environment after boot. Goal: shrink bespoke per-kit code
   and per-agent special-casing in `acq`, and lean on the devenv ecosystem.

2. **Layered model with a harness-adapter layer.** Control Plane → Harness Adapter
   Layer (OpenCode │ Pi │ Goose │ Prime │ …) → Environment/Capability Layer (Kits +
   devenv) → Sandbox Control Layer (`acq` → msb/sbx → generic devenv base). `acq`
   MAY *infer* the agent kit from the invoked command; `shell` is the only special
   case (no per-agent tokens baked into `acq`).

A specific call-out in that discussion: the hand-rolled supervisor loop in the
openchamber/paseo kits was named as "clumsy" precedent to be replaced by a
standardized **devenv process-supervision** method.

This kit was authored against the CURRENT reality (hybrid/v1 kits, backend base
images, imperative install + a shell respawn loop), so it diverges from that
direction in three concrete places. This ADR records them so the divergence is
tracked, not silently carried as debt.

## Decision

**Ship the kit as-is now** (it is a working, tested, kit-only integration and the
best concrete example to inform the very discussion above), **and record the
following migrations to perform once the devenv base-image and harness-adapter
decisions land.** Do not pre-build against those decisions while they are in flux
(YAGNI); revisit when they are accepted.

### Divergence 1 — supervisor loop → devenv process supervision

`files/home/goose-start.sh` supervises `goose serve` with a `while :; do … ; sleep
; done` respawn loop — the same pattern flagged for replacement in openchamber/
paseo. When a standardized devenv process-supervision method exists, the goosed
server SHOULD be expressed as a devenv `process` (process-compose) instead, and the
respawn loop deleted. The config-merge + provider-stage steps would become devenv
enterShell/activation steps.

### Divergence 2 — first-class token → kit inference (reframes Increment B)

The initial plan for Increment B was to add a `goose` token to `acq`'s
`ACQ_KNOWN_AGENTS` + an msb install recipe (`GSA-TTS/agentic-coding-quickstart#466`).
That ADDS per-agent special-casing to `acq`, which is the OPPOSITE of the proposed
direction. Under the proposal, `acq run goose <path>` should work by `acq`
**inferring the `goose-server` kit** from the command, not by teaching `acq` about a
`goose` agent. Increment B should be reframed accordingly; until kit-inference
exists, the kit-on-`shell` path (Increment A, shipped here) remains the supported
entry point.

### Divergence 3 — imperative install → declarative devenv package

`files/home/goose-install.sh` fetches + sha-verifies + installs the goose binary
imperatively at create time. Under the devenv model, goose SHOULD be expressed
declaratively (a devenv `packages`/flake input, or an overlay), gaining Nix's
caching and reproducibility and removing the bespoke installer. The arch-selection
and pinning concerns move into the Nix expression.

## Consequences

- The kit works today on the current stack (hybrid/v1, backend base images) with no
  `acq` core changes — it is committable and useful now, and demonstrates that a new
  harness *category* (a chat client with an out-of-sandbox GUI) fits the kit layer.
- Three tracked migrations remain, each gated on the corresponding upstream
  decision: (1) devenv process supervision, (2) kit-inference reframing of Increment
  B, (3) declarative devenv install. Each SHOULD be filed as a tracked item when its
  gating decision is accepted (do not file speculative work before the trigger).
- **goose-server stresses the harness-adapter abstraction.** Unlike OpenCode/Pi/
  Prime — TUI agents `acq` attaches to and drives — goose here is a **background
  server whose client is a native goose Desktop app on the host**, reached over a
  published loopback port with a secret-key handshake and a provider-identity
  contract (see ADR-0002, ADR-0003). `acq` is NOT the client. This is a useful data
  point for the "Harness Adapter Layer": its "prompt · events · tools · status ·
  resume" session API assumes an agent the control plane drives directly, which does
  not describe Goose-via-Desktop. Whether Goose is a distinct harness *category* or
  sits outside the adapter layer (human drives Desktop directly) is an open design
  question this kit surfaces.
