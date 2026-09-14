# Decision: run goosed in the sandbox, goose Desktop on the host

**Status:** accepted

## Context

We want to extend the `acq` sandbox platform beyond coding-agent CLI harnesses to
a **chat harness** — specifically the [goose](https://github.com/aaif-goose/goose)
desktop client. The goal is to get goose's agent capabilities (interactive loop,
tool execution, MCP extensions, filesystem/shell access) under acq's isolation
controls without virtualizing a desktop GUI inside the sandbox.

goose has three architectural parts (per its
[architecture guide](https://goose-docs.ai/docs/goose-architecture/)):

1. **Interface** — the desktop app or CLI. Collects input, renders output.
2. **Agent / server** — `goose serve` (the "goosed" ACP server). Runs the loop,
   executes tools, connects extensions, touches the filesystem, calls the LLM.
3. **Extensions** — MCP servers the agent invokes.

Only part (2) has real blast radius (files, shell, network egress, credentials).
Part (1) is a renderer.

Crucially, goose **already supports** running the server separately from the UI:
the [remote-server guide](https://goose-docs.ai/docs/guides/remote-goose-server)
documents pointing goose Desktop at an external `goose serve` via
**Settings → goose Server → external server** (URL + optional secret + optional
cert fingerprint). So the split we want is a first-class, supported deployment
mode — not a hack.

Alternatives considered:

- **Virtualize the whole desktop app in the sandbox** (X/VNC/RDP). Heavy, poor UX,
  and it drags a GUI stack into a security boundary that exists to be minimal.
  Rejected.
- **Run goose entirely on the host.** Then none of acq's controls apply — the
  whole point of the exercise is lost. Rejected.
- **Run the goosed server in the sandbox, keep the native UI on the host**
  (this decision). The isolated part is exactly the part with blast radius; the
  UI stays native and pleasant. Matches goose's documented remote-server mode.

## Decision

**Put `goose serve` (goosed) inside the acq sandbox and publish its port to the
host; the user's native goose Desktop connects to it as an external server.**

Concretely, this kit:

- installs a pinned goose CLI in the guest (create time, sha256-verified),
- supervises `goose serve --host 0.0.0.0 --port 3284` on every start (respawn
  loop, held open by the sandbox keepalive, so a detached `acq create` is enough),
- publishes container port 3284 to the host via the neutral `publishedPorts`,
- the operator points goose Desktop at `http://127.0.0.1:<host-port>`.

Structurally this is the same pattern as the sibling `openchamber` and `paseo`
kits (supervise a long-lived server in the guest, publish one host-loopback port),
with one difference: the **client is a native desktop app**, not a browser UI
served from the guest. That makes the guest side simpler (no UI to install
in-guest) at the cost of one manual "paste the URL into Desktop settings" step.

## Consequences

- All agent work — the interactive loop, tool execution, MCP extensions, file
  edits, shell commands, LLM egress — happens inside the sandbox, under acq's
  controls (ephemeral container/microVM, deny-default allow-listed egress, no host
  FS, injected credentials). The desktop app is a thin renderer.
- The host↔guest link and auth posture are their own decisions
  (`0002-plaintext-http-loopback.md`), as is the LLM provider wiring
  (`0003-usai-openai-compatible-provider.md`).
- This kit rides on the `shell` agent for now (Increment A). Promoting `goose` to
  a first-class acq harness token (`acq run goose <path>`) is a separate, tracked
  increment in the quickstart repo, because a first-class harness normally attaches
  an interactive TUI, whereas here the "agent" is a background server driven by a
  host UI — the attach semantics need their own design. **Note:** the team's
  in-flight direction favors `acq` *inferring* the kit from the command over adding
  per-agent tokens, which reframes that increment — see
  `0004-alignment-with-devenv-harness-direction.md`.
- MCP **extensions** goose loads run in the guest and make their own egress; any
  new extension host must be added to the kit's `caps.network.allow` (deny-default).
  This is deferred until an extension is actually configured.
