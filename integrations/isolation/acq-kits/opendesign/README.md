# opendesign (acq mixin kit, `hybrid/v1`)

Runs [OpenDesign](https://github.com/nexu-io/open-design) headlessly inside an
`acq` sandbox and publishes its browser UI / daemon to the host. OpenDesign is a
local-first design workspace that launches existing agent CLIs. This kit uses the
existing sandbox `opencode`; it does not install OpenCode and does not own model
credentials.

A single OpenDesign daemon serves the API and browser UI on container port
**7456**.

This kit is **opt-in** and is designed to compose with the default GSA kits,
especially `usai-provider`.

## Quick start

1. **Set the kit reference** to a full commit SHA of this repo:

   ```bash
   export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/opendesign"
   ```

2. **Ensure the USAi key is available through acq** if you want the default GSA
   OpenCode provider path:

   ```bash
   acq secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
   ```

   `usai-provider` configures OpenCode to read `{env:USAI_API_KEY}`. This kit
   does not copy that key into OpenDesign storage.

3. **Start the sandbox with OpenCode:**

   ```bash
   acq run opencode /path/to/your/project
   ```

   Leave the terminal open. The OpenDesign daemon starts in the background.

4. **Open the browser UI.** Find the mapped host port and open it:

   ```bash
   acq ports <sandbox>     # look up the host port mapped to container 7456
   ```

   Open `http://localhost:<host-port-for-7456>`. On first boot, wait for the
   source install and build, then reload.

## What the kit provisions

- A pinned OpenDesign source checkout at `open-design-v0.24.0`, verified against
  commit `0d3a14c1df6dc5017f3cc3ef05b24558250c220b`.
- A kit-managed Node `24.21.0` runtime under the kit volume, verified by
  SHA-256.
- pnpm `10.33.2` through Corepack.
- OpenDesign daemon startup on `0.0.0.0:7456` with `--no-open`.
- Root startup initialization that makes the root of the persistent OpenDesign
  volume writable by the `agent` user before the daemon supervisor runs.
- OpenDesign state, source checkout, kit-managed Node runtime, Corepack state,
  pnpm executables, and pnpm store under `/home/agent/.local/share/opendesign`.
- OpenDesign app-config seeding for `agentId: "opencode"`,
  `onboardingCompleted: true`, and local telemetry disabled when no user choice
  exists.

The kit deliberately does **not** seed a default model. OpenCode/OpenDesign use
their existing configured defaults.

## Credential model

The intended GSA credential path is:

```text
acq secret store
  -> sandbox env: USAI_API_KEY
  -> usai-provider OpenCode config
  -> OpenDesign launches opencode
  -> opencode reads USAi from its own config/env
```

Do not paste model-provider keys into chat. For the core OpenCode/USAi flow,
OpenDesign never needs a copy of the provider key in its `OD_DATA_DIR`.

If you configure extra OpenDesign media providers in the UI, OpenDesign stores
those settings in its own local data directory. Treat that directory as sensitive
local state.

## Reaching it from the host

The kit exposes container port `7456`, declared via neutral `publishedPorts` in
`spec.yaml`. `acq` publishes it to a host loopback port per sandbox. Look up the
mapping:

```bash
acq ports <sandbox>
# OpenDesign UI: open http://localhost:<host-port-for-7456>
```

Want a fixed host port instead of the ephemeral one?

```bash
acq ports <sandbox> --publish 7456:7456
```

## Security

The daemon runs with `OD_DISABLE_API_AUTH=1` and binds `0.0.0.0` inside the
sandbox. This is safe only because the sandbox is the security boundary and the
host-side published port is loopback-only.

Run this only on a trusted, single-user host. Do not forward the mapped port to a
wider interface. Anyone who can reach the host loopback port can drive the
OpenDesign daemon and the agents it launches.

The in-guest `0.0.0.0` bind is required for `acq` create-time port publishing on
msb-style backends: the host listener dials the sandbox guest network IP, not
guest `127.0.0.1`.

## HTTPS-inspected networks

OpenDesign is installed from GitHub, Node.js, and npm. Behind an inspecting
proxy, pair this kit with the `zscaler-ca-certificate` kit so Node/pnpm trust
the inspection CA. The install script also appends `PROXY_CA_CERT_B64` and the
system CA bundle to `NODE_EXTRA_CA_CERTS` when available.

## Backend support

`acq` selects and abstracts the isolation backend. This kit is written entirely
in neutral `hybrid/v1` vocabulary (`caps`, `files`, `commands`, `publishedPorts`,
`volumes`, and `environment`) and uses no backend-specific shortcuts. See
[`kits.yaml`](../kits.yaml) for the parity summary.

## Validating

```bash
# Offline gate: schema + file paths + registry. Needs python3 + jsonschema + pyyaml.
python ../validate-kits.py

# Kit-local offline checks.
./scripts/verify

# Live end-to-end via acq, from a sandbox-capable host.
RUN_ACQ=1 ./scripts/verify

# Keep the sandbox afterward to inspect it.
KEEP=1 RUN_ACQ=1 ./scripts/verify
```

CI for this repo cannot create nested sandboxes, so live verification is a
host-side step before PR review/merge.

## Layout

```text
opendesign/
├── spec.yaml                         # kit declaration
├── files/home/
│   ├── opendesign-install.sh         # Node 24 + OpenDesign source install/build
│   └── opendesign-start.sh           # app-config seed + daemon supervisor
├── README.md
├── TROUBLESHOOTING.md
├── scripts/verify                    # offline + optional live verification
└── docs/decisions/                   # design records
```

## Design records

Rationale lives in [`docs/decisions/`](docs/decisions/): source install instead
of Docker, OpenDesign auth disabled behind the ACQ loopback boundary, and
ACQ/OpenCode-owned BYOK credential flow.
