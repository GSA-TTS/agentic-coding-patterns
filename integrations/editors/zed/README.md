# Zed Editor + OpenCode in Docker Sandboxes (SBX)

A portable integration for running a containerized OpenCode agent inside a Docker
sandbox (SBX) while editing on your host with the [Zed editor](https://zed.dev).
Copy [`tasks.json`](tasks.json) into your project's `.zed/` directory to get
one-click sandbox launch and diagnostics from Zed's task runner.

> This is a community integration pattern, not federal policy. Environment setup
> (installing `sbx`, configuring USAi) is covered by the
> [quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart) repo;
> this guide assumes you already have a working SBX + USAi setup and focuses on
> wiring it into Zed.

## Why Zed + SBX

- **Instant sync** — the SBX container mounts your workspace, so anything the
  agent writes inside the sandbox appears immediately in Zed on your host.
- **Interactive approvals** — Zed's task runner provides a real pseudo-TTY, so
  you can answer the agent's confirmation prompts (e.g. approving an edit) inside
  the editor.
- **Host stays protected** — the agent runs commands and tests inside the
  container, not on your host.

## Prerequisites

You need a working SBX + USAi environment first (see the
[quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart)):

- **Zed** installed on your host.
- The **`sbx` CLI** installed (e.g. `brew install docker/tap/sbx` on macOS).
- Your **USAi API key** stored as an SBX secret (USAi is a custom endpoint):

  ```bash
  sbx secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
  ```

## Install the Zed tasks

Copy the integration's task file into your project:

```bash
mkdir -p .zed
cp path/to/integrations/editors/zed/tasks.json .zed/tasks.json
```

Adjust the sandbox name / commands in `.zed/tasks.json` to match your project if
needed.

## Use it

1. Open Zed's command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`), type
   `task: spawn`, press `Enter` (or `Cmd+Alt+T` / `Ctrl+Alt+T`).
2. Run **`OpenCode: Environment Diagnostics`** to confirm `sbx` is installed and
   the `USAI_API_KEY` secret is set.
3. Run **`OpenCode: Run Agent`** — this launches OpenCode in SBX (creating the
   sandbox if needed) and opens an interactive terminal panel.
4. Respond to the agent's approval prompts (`y`/`n`) directly in the Zed terminal
   panel when it asks before editing files or running mutating commands.

### Tasks provided

| Task Label | Description | Underlying Command |
|------------|-------------|--------------------|
| `OpenCode: Run Agent` | Launches OpenCode inside SBX (secrets auto-injected; creates sandbox if needed) | `sbx run opencode .` |
| `OpenCode: Environment Diagnostics` | Checks that `sbx` is installed and the `USAI_API_KEY` secret is set | inline `sbx` checks |

## Alternative: integrated terminal

Prefer to run commands yourself? Open Zed's integrated terminal (`Ctrl + ~`):

```bash
# verify sbx + the USAi key secret
command -v sbx && sbx secret ls | grep USAI_API_KEY

# run the agent (creates the sandbox automatically if needed)
sbx run opencode .
```

## Mounting a shared config (optional)

If your team mounts a shared OpenCode config into sandboxes (rather than copying
it per project), the quickstart repo's `qsbx` wrapper handles that — it mounts
the clone and symlinks the config into the sandbox home, then attaches:

```bash
./qsbx run opencode /path/to/your/project
```

See the [quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart) for
`qsbx` details. The `tasks.json` here drives the Zed tasks; copy it into any
project's `.zed/` directory and adjust the sandbox name to match.

## Troubleshooting

### "Task command not found"

The tasks call `sbx` directly — ensure the `sbx` CLI is installed and on your
`PATH`. You can edit `.zed/tasks.json` to adjust commands for your environment.

### "USAI_API_KEY not found"

USAi is a custom endpoint, so set the secret with `sbx secret set-custom`:

```bash
sbx secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY
```

After setting the secret, recreate the sandbox so it picks up the new value
(e.g. `sbx rm <name>` then re-run the launch task).

### SSL/TLS certificate errors ("unable to get local issuer certificate")

On TLS-intercepting federal networks (e.g. ZScaler on GFE), OpenCode may fail to
connect with a certificate error. This is an environment/proxy issue, not a Zed
issue — see the quickstart's
[Known Failure Modes](https://github.com/GSA-TTS/agentic-coding-quickstart/blob/main/docs/KNOWN_FAILURE_MODES.md)
for the certificate-handling guidance. Never disable TLS verification with real
credentials.

### Terminal output frozen or unresponsive

If a task stops responding to keystrokes, close the terminal pane (`Cmd + W`) and
re-trigger the task from the palette. If problems persist, run
`sbx run opencode .` directly in Zed's integrated terminal (`Ctrl + ~`) instead
of the task runner.
