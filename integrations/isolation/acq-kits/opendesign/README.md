# opendesign (acq mixin kit, `hybrid/v1`)

Runs [OpenDesign](https://github.com/nexu-io/open-design) headlessly inside an
`acq` sandbox and publishes its browser UI / daemon to the host. OpenDesign is a
local-first design workspace that launches existing agent CLIs. This kit uses the
existing sandbox `opencode`; it does not install OpenCode and does not own model
credentials.

OpenDesign is exposed on container port **7456**. Internally, the daemon listens
on guest loopback port `17456`, and a small relay publishes it on guest port
`7456` for ACQ port mapping.

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
- OpenDesign daemon startup on internal `127.0.0.1:17456` with `--no-open`,
  plus a supervised relay that publishes it on guest port `7456` (see
  [Security](#security)).
- Root startup initialization that makes the root of the persistent OpenDesign
  volume writable by the `agent` user before the daemon supervisor runs.
- OpenDesign state, source checkout, kit-managed Node runtime, Corepack state,
  pnpm executables, and pnpm store under `/home/agent/.local/share/opendesign`.
- OpenDesign app-config seeding for `agentId: "opencode"`,
  `onboardingCompleted: true`, and local telemetry disabled when no user choice
  exists.
- `OPENCODE_CONFIG` pointing at the `usai-provider` OpenCode config, so
  OpenDesign-launched runs actually reach USAi (see [Credential
  model](#credential-model)).

The kit deliberately does **not** seed a default model. OpenCode/OpenDesign use
their existing configured defaults.

This kit builds OpenDesign from source during first boot. That means it runs
OpenDesign's pinned `pnpm install --frozen-lockfile`, package lifecycle scripts,
bootstrap build, and Next.js production build inside the sandbox as the `agent`
user. The source commit, Node archive, pnpm version, and lockfile are pinned, but
this is still a larger first-boot build surface than sibling kits that install a
single published artifact.

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

One wrinkle makes an extra step necessary. OpenDesign launches agent children
with `OD_SANDBOX_MODE=1`, which rewrites `HOME` and `XDG_CONFIG_HOME` to a
private agent home under `OD_DATA_DIR`. OpenCode resolves its global config from
those variables, so it would look inside
`$OD_DATA_DIR/sandbox/config/opencode/` — where it auto-creates an empty stub —
and never read the `usai-provider` config. With no `usai` provider defined,
OpenCode falls back to its own hosted gateway (`opencode.ai/zen`), which is not
in this kit's egress allowlist, and every run fails with `Cannot connect to API`
after burning its retry budget.

Startup therefore exports `OPENCODE_CONFIG` (OpenCode's documented absolute-path
override, which survives that rewrite):

```text
OPENCODE_CONFIG=/home/agent/.config/opencode/opencode.jsonc
```

That names a config **path** only. `USAI_API_KEY` stays in the environment and is
resolved by the config's own `{env:USAI_API_KEY}` substitution at run time, so no
key material moves into OpenDesign state. Startup logs which config it selected,
and warns when it finds none.

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

The automatic create-time mapping is the supported host-browser path. Avoid
adding an extra post-hoc fixed-port publish for this kit: depending on backend
implementation, that may dial guest loopback port `7456` and bypass the relay
split (`7456` -> `17456`) that keeps OpenDesign's peer-loopback-gated routes
working.

## Security

The daemon runs with `OD_DISABLE_API_AUTH=1` and binds guest `127.0.0.1` only.
This is safe only because the sandbox is the security boundary and the host-side
published port is loopback-only.

Run this only on a trusted, single-user host. Do not forward the mapped port to a
wider interface. Anyone who can reach the host loopback port can drive the
OpenDesign daemon and the agents it launches.

`acq` create-time port publishing on msb-style backends dials the sandbox guest
network IP, not guest `127.0.0.1`, so something in the guest must listen there.
The kit does that with a small supervised relay (`~/opendesign-relay.mjs`) that
listens on published guest port `7456` and forwards to the loopback daemon on
internal port `17456` — rather than binding the daemon to `0.0.0.0`. The relay
accepts loopback, the default gateway peer, and optional backend-specific
`OPENDESIGN_RELAY_ALLOWED_PEERS` entries; other guest-network peers are denied
before forwarding. That peer filter is defense-in-depth against accidental guest
network reachability, not the primary security boundary: code running inside the
sandbox is already trusted for this local development posture. Do not rely on the
relay to contain a hostile in-sandbox process, especially on backends where the
guest network is shared across sandboxes.

That distinction matters functionally, not just cosmetically. OpenDesign gates
several routes on the request **peer** address being loopback
(`requireLocalDaemonRequest`). With the daemon on `0.0.0.0`, every request
arriving from the host carries a guest-network peer, and those routes return
`403 Forbidden` while the rest of the UI works — most visibly Settings → About →
**Export diagnostics**, and `POST /api/strategies/od-next/rollout`. The relay
keeps the peer loopback, so they work. Details and the rejected alternatives are
in
[`docs/decisions/disable-api-auth-loopback-boundary.md`](docs/decisions/disable-api-auth-loopback-boundary.md).

## HTTPS-inspected networks

OpenDesign is installed from GitHub, Node.js, and npm. Behind an inspecting
proxy, pair this kit with the `zscaler-ca-certificate` kit so Node/pnpm trust
the inspection CA. The install script appends `PROXY_CA_CERT_B64` only when it
can decode it successfully, then appends the system CA bundle to
`NODE_EXTRA_CA_CERTS` when available.

## Backend support

`acq` selects and abstracts the isolation backend. This kit is written entirely
in neutral `hybrid/v1` vocabulary (`caps`, `files`, `commands`, `publishedPorts`,
`volumes`, and `environment`) and uses no backend-specific shortcuts. See
[`kits.yaml`](../kits.yaml) for the parity summary.

## Validating

```bash
# Offline gate: schema + file paths + registry + kit-specific invariants.
# Needs python3 + jsonschema + pyyaml; run from this kit directory.
./scripts/verify

# Lightweight smoke-only mode if Python deps are unavailable. This is not enough
# for review completion because it skips validate-kits.py --strict.
ALLOW_PARTIAL_VERIFY=1 ./scripts/verify

# Live end-to-end via acq, from a sandbox-capable host.
RUN_ACQ=1 ./scripts/verify

# Keep the sandbox afterward to inspect it.
KEEP=1 RUN_ACQ=1 ./scripts/verify
```

CI for this repo cannot create nested sandboxes, so live verification is a
host-side step before PR review/merge. Treat skipped schema validation as
incomplete unless `ALLOW_PARTIAL_VERIFY=1` was intentionally used for a local
smoke check.

## Layout

```text
opendesign/
├── spec.yaml                         # kit declaration
├── files/home/
│   ├── opendesign-install.sh         # Node 24 + OpenDesign source install/build
│   ├── opendesign-relay.mjs          # guest-network -> loopback publish relay
│   └── opendesign-start.sh           # app-config seed + daemon/relay supervisors
├── README.md
├── TROUBLESHOOTING.md
├── scripts/verify                    # offline + optional live verification
└── docs/decisions/                   # design records
```

## Design records

Rationale lives in [`docs/decisions/`](docs/decisions/): source install instead
of Docker, OpenDesign auth disabled behind the ACQ loopback boundary, and
ACQ/OpenCode-owned BYOK credential flow.
