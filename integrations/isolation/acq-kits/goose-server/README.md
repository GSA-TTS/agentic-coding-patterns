# goose-server (acq mixin kit, `hybrid/v1`)

Runs the [goose](https://github.com/aaif-goose/goose) ACP server (`goose serve`,
"goosed") **inside an `acq` sandbox** and publishes its port to the host, so a
[goose Desktop](https://goose-docs.ai/docs/getting-started/installation) app
running **natively on your host machine** can drive it as an **external server**.

This is the first `acq` **chat-harness** kit: it extends the sandbox platform
beyond coding-agent CLIs to a desktop chat client, without virtualizing a GUI
inside the sandbox.

## The architecture (and why it is split this way)

goose has three parts (see the
[goose architecture guide](https://goose-docs.ai/docs/goose-architecture/)):

- **Interface** — the desktop app or CLI (collects input, renders output).
- **Agent / server** — `goose serve`, the "goosed" ACP server. Runs the
  interactive loop, executes tools, connects MCP extensions, touches the
  filesystem.
- **Extensions** — MCP servers the agent calls.

This kit puts the **server inside the sandbox** and leaves the **interface on the
host**:

```
   host machine                          acq sandbox (ephemeral, isolated)
 ┌────────────────┐   http/loopback    ┌───────────────────────────────────┐
 │ goose Desktop  │ ─────────────────▶ │ goose serve  (goosed, port 3284)  │
 │ (native UI)    │   published port   │  ├─ interactive loop              │
 └────────────────┘                    │  ├─ tool execution (files, shell) │
                                       │  ├─ MCP extensions                │
                                       │  └─ LLM calls → USAi gateway      │
                                       └───────────────────────────────────┘
```

Every action with real blast radius — file edits, shell commands, network egress,
credential use — happens **in the sandbox**, where all of acq's controls apply:
ephemeral container/microVM, deny-default allow-listed egress, no host filesystem,
credentials injected on the wire. The desktop app is a thin renderer pointed at
the server. This is goose's own documented
[remote-server pattern](https://goose-docs.ai/docs/guides/remote-goose-server)
(goose Desktop → Settings → goose Server → external server), not a workaround.

This kit is **opt-in** (not one of the default GSA kits); you add it explicitly.

## Quick start

1. **Store the USAi API key once** as a custom acq secret bound to the USAi host,
   injected into the guest as `CUSTOM_USAI_API_KEY` (the env var the shipped
   `custom_usai` provider reads). The key value never enters the guest or the kit —
   acq swaps it on the wire only for `api.gsa.usai.gov`:

   ```bash
   acq secret set -g goose-usai --host api.gsa.usai.gov --env CUSTOM_USAI_API_KEY
   ```

2. **Set the kit reference** (a full 40-char commit SHA of this repo — branches
   and tags are rejected):

   ```bash
   export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/goose-server"
   ```

3. **Start the sandbox.** The goosed server is brought up entirely by the kit's
   startup command and held open by the sandbox's keepalive, so a detached
   `acq create` is enough — you do not need to keep a terminal attached:

   ```bash
   acq create --name goose-dev shell /path/to/your/project
   ```

   On first boot the goose CLI is already present (installed at create time), and
   the server comes up within a few seconds.

4. **Find the host port and point goose Desktop at it.**

   ```bash
   acq ports goose-dev     # look up the host port mapped to container 3284
   ```

   In goose Desktop → **Settings → goose Server**:

   | Setting | Value |
   |---|---|
   | **Use external server** | Enabled |
   | **URL** | `http://127.0.0.1:<host-port-for-3284>` |
   | **Secret Key** | `goose-server-kit-local-loopback` (the kit's `GOOSE_SERVER__SECRET_KEY`) |
   | **Certificate Fingerprint** | *(leave empty — HTTP, no TLS in v1)* |

   Save, then **fully Quit goose Desktop (Cmd-Q) and reopen it** — the external
   server setting is only read at startup. goose Desktop now routes all backend
   work to the in-sandbox server. Pick the **USAi** provider (`custom_usai`) and a
   model such as `claude-sonnet-5` in Desktop's model selector.

That's the whole flow. The server starts automatically; you never run a separate
command to bring it up.

> **Provider must match.** goose Desktop drives the external server by *named
> provider*. This kit defines a custom provider called **`custom_usai`** on the
> server (see [Provider](#provider-usai)); your Desktop must have a `custom_usai`
> provider selected (most GSA goose Desktops already do). If Desktop asks for a
> provider the server hasn't defined, the session fails to initialize and Desktop
> reports "unable to connect" — even though the server itself is healthy.

## Keep it running

Unlike the paseo/openchamber kits, this kit does **not** ship an entrypoint
wrapper, because the goosed server is a background service held open by the
sandbox's keepalive (PID 1) — not something you interact with in the terminal.

A detached `acq create` is therefore sufficient to keep the server alive: the
startup command supervises `goose serve` for the container's lifetime regardless
of whether anyone attaches. (A session-less sandbox may be auto-stopped by acq
after a long idle; if that happens, `acq start <sandbox>` or a fresh `acq create`
brings it back.)

## Provider (USAi)

The kit ships a goose **custom provider** named `custom_usai` (an
OpenAI-compatible custom provider — `files/home/goose-config/custom_providers/
custom_usai.json`) pointed at the GSA **USAi** gateway. It is copied into the
guest's `~/.config/goose/custom_providers/` at startup and marked active in the
config primer:

- provider name: `custom_usai` (engine `openai`)
- `base_url`: `https://api.gsa.usai.gov/api/v1/chat/completions`
- `api_key_env`: `CUSTOM_USAI_API_KEY`
- default model: `claude-sonnet-5` (change it in Desktop or via `GOOSE_MODEL`)

**Model list is generated, not hand-maintained.** `custom_usai.json` is emitted
from the single USAi catalog (`integrations/providers/usai/catalog.json`) by
`integrations/providers/usai/emitters/goose.mjs`, exactly like the OpenCode and
prime-agent provider configs. A byte-exact lockstep test
(`integrations/providers/usai/tests/goose-provider-regen.test.mjs`) fails CI if the
committed file drifts from the catalog. To change the models goose Desktop offers,
update `catalog.json` and regenerate — do **not** hand-edit `custom_usai.json`:

```bash
cd integrations/providers/usai
node -e 'import("./emitters/goose.mjs").then(async (m)=>{const fs=await import("node:fs");fs.writeFileSync("../../isolation/acq-kits/goose-server/files/home/goose-config/custom_providers/custom_usai.json", m.emitGooseProviderFromCatalog(JSON.parse(fs.readFileSync("./catalog.json","utf8"))))})'
npm test   # runs the lockstep guard
```

**Why a named custom provider, not the built-in `openai` provider:** goose Desktop
drives the external server by *named provider + model*. A GSA goose Desktop is
configured with the `custom_usai` provider, so the server must define that same
provider or the session can't initialize (Desktop shows "unable to connect"). The
kit reproduces the exact `custom_usai` definition so the two agree.

The **API key** is the only secret. It is injected at runtime by acq as
`CUSTOM_USAI_API_KEY` (the `goose-usai` custom secret you set in step 1, matching
the provider's `api_key_env`), bound to `api.gsa.usai.gov`, and never stored in the
kit or written into the guest in cleartext.

For model selection and custom-provider details see the goose
[provider guide](https://goose-docs.ai/docs/getting-started/providers).

## Security note

The server runs over plain HTTP on a **host-loopback** published port, with a
**shared secret-key handshake** (`GOOSE_SERVER__SECRET_KEY`). goose Desktop 1.50.0's
ACP client always sends a secret (`X-Secret-Key` on `/status`, `?token=` on `/acp`),
so an unauthenticated server is rejected by Desktop with "server cannot connect"
even though `/status` is reachable — hence the kit sets a secret and you paste the
same value into Desktop.

That secret is a **cleartext loopback handshake token**, not a protected credential:
it lives in the kit's non-secret env, guards only a host-loopback port, and must
also be entered into Desktop's settings. **The sandbox is the real security
boundary** (ephemeral, deny-default allow-listed egress, no host FS, injected
credentials) and the host side of the publish is loopback only. The kit's default
value is `goose-server-kit-local-loopback`; override it per sandbox with
`-e GOOSE_SERVER__SECRET_KEY=<value>` if you prefer a unique token (and set the same
value in Desktop).

**TLS + certificate-fingerprint pinning** (goose's stronger remote-server posture)
is a tracked follow-up. When adopted, the server would run `--tls`, log a
`GOOSED_CERT_FINGERPRINT`, and Desktop would pin it; see
docs/decisions/0002-plaintext-http-loopback.md.

## Backend parity

Written entirely in the neutral `hybrid/v1` vocabulary with no backend shortcut or
extras. Supported backends: **sbx, msb**.

- The single published container port (**3284**, goosed's ACP API + WebSocket) is
  declared with the neutral top-level `publishedPorts` list. acq's kit translation
  maps it to the active backend's native port-publish primitive, so the port is
  published at create time on both backends with no manual step.
- The never-exiting startup supervisor is marked with the neutral
  `background: true` flag, which acq maps to each backend's native detached hook.
- The goose CLI is installed by an **install-phase** command (create-time, root):
  a single pinned, sha256-verified static binary selected by guest architecture
  (`x86_64` / `aarch64` — msb microVMs are aarch64 on Apple Silicon), so both
  backends install the same verified artifact.
- The in-guest bind is **0.0.0.0:3284** (not loopback) — required for acq's
  create-time port publish to reach the guest on msb, where `-p HOST:GUEST` dials
  the guest network IP rather than guest loopback. The host side stays
  loopback-only, so 0.0.0.0 in-guest does not widen host exposure. (Same lesson as
  the paseo/openchamber kits and quickstart `KNOWN_FAILURE_MODES.md`.)

No backend shortcut is needed: every backend installs the same binary, allow-lists
the same hosts, runs the same supervise/merge startup script, ships the same
`custom_usai` provider definition, and reads the same injected
`CUSTOM_USAI_API_KEY`.

## What it installs / drops

| Path in guest | Purpose |
|---|---|
| `/usr/local/bin/goose` | The pinned goose CLI (installed at create time). |
| `/home/agent/goose-install.sh` | Create-time installer (sha256-verified). |
| `/home/agent/goose-start.sh` | Startup: merge config, stage provider, supervise `goose serve`. |
| `/home/agent/goose-config/config.yaml` | Staged USAi config primer. |
| `/home/agent/goose-config/merge-config.mjs` | Merges the primer into `~/.config/goose/config.yaml` (fail-safe). |
| `/home/agent/goose-config/custom_providers/custom_usai.json` | Staged `custom_usai` provider definition. |
| `~/.config/goose/config.yaml` | goose global config (written/merged at startup). |
| `~/.config/goose/custom_providers/custom_usai.json` | The `custom_usai` provider on the server (copied at startup). |
| `~/.local/state/goose/goose-serve.log` | Server log (respawn supervisor). |
| `~/.local/state/goose/goose-config-merge.log` | Config-merge + provider-stage log. |

## Verify

```bash
# Offline gate (schema + registry + merge-helper checks):
integrations/isolation/acq-kits/goose-server/scripts/verify

# Live end-to-end (needs a sandbox-capable host + the acq CLI):
RUN_ACQ=1 integrations/isolation/acq-kits/goose-server/scripts/verify
```

The live check creates a real sandbox with the kit, then asserts the CLI install,
the supervised server, the config merge, the published port, the in-guest 0.0.0.0
bind, host reachability, the secret-key handshake, and supervisor self-heal.

## Roadmap

- **Increment B (tracked separately):** make `acq run goose <path>` work without
  riding on `shell`. Under the team's in-flight direction this should be `acq`
  *inferring* the `goose-server` kit from the command, **not** a new per-agent token
  in `acq` — see the alignment note below and
  `docs/decisions/0004-alignment-with-devenv-harness-direction.md`.
- **TLS + fingerprint pinning:** adopt goose's stronger remote-server transport.

## Alignment with the devenv / harness-adapter direction

This kit was built against the current stack (hybrid/v1 kits, backend base images,
an imperative installer, and a shell respawn loop). The team is discussing a move
to a generic **devenv** base image with all agent knowhow in kits, a standardized
devenv process-supervision method, and `acq` inferring kits from the invoked
command. Three parts of this kit are expected to migrate when those decisions land:
its respawn supervisor → a devenv `process`; its imperative installer → a
declarative devenv package; and Increment B → kit inference (not a token). The kit
also stresses the "harness adapter" abstraction, since its client is a native goose
Desktop app on the host rather than an agent `acq` drives directly. Full rationale
and the tracked migrations are in
`docs/decisions/0004-alignment-with-devenv-harness-direction.md`.

See the `docs/decisions/` records for the design rationale.

## Related

- [goose architecture](https://goose-docs.ai/docs/goose-architecture/)
- [Running a remote goose server](https://goose-docs.ai/docs/guides/remote-goose-server)
- Sibling kits: [`openchamber/`](../openchamber/), [`paseo/`](../paseo/) — other
  in-sandbox servers published to the host.
