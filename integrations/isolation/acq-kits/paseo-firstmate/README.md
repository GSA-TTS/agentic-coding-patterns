# paseo-firstmate (acq mixin kit, `hybrid/v1`)

Installs the [FirstMate for Paseo](https://github.com/ABorakati/paseo-firstmate)
plugin alongside the existing Paseo ACQ kit. FirstMate adds a fleet dashboard,
crew supervision panels, and `/fm`, `/bearings`, and `/ahoy` command surfaces.

This is an **optional companion kit**. Apply it together with the existing
`paseo` kit; it does not install or supervise a second Paseo daemon and it does
not publish another port.

## Usage

Use full commit SHAs for both kit references:

```bash
export ACQ_EXTRA_KITS="git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/paseo"
export ACQ_EXTRA_KITS="$ACQ_EXTRA_KITS,git+https://github.com/GSA-TTS/agentic-coding-patterns.git#ref=<sha>&dir=integrations/isolation/acq-kits/paseo-firstmate"
acq run opencode /path/to/your/project
```

The companion script fetches FirstMate commit
`5e745c7202a4ef1dff859c31be1a365871b8b9c6` from GitHub, installs its locked
Node dependencies with lifecycle scripts disabled, and registers it using:

```text
paseo plugin install /home/agent/.paseo-firstmate --id paseo-firstmate
paseo plugin reload paseo-firstmate
```

The browser endpoint is the one published by the base Paseo kit. Use `acq ports`
to find it and open the Paseo UI through `http://localhost:<mapped-port>`.

## FirstMate home

The plugin needs a local FirstMate checkout or distro containing `AGENTS.md` and
the helper scripts used by its server RPCs. Mount or clone that checkout into
the sandbox, then open **Settings -> Plugins -> FirstMate** and set **FirstMate
Home** to its absolute *guest* path.

The path is stored in Paseo's plugin data at
`$PASEO_HOME/plugin-data/paseo-firstmate/config.json`. Do not rely on exporting
`FM_HOME` in a shell: the plugin intentionally removes inherited `FM_HOME`
variables before it invokes FirstMate scripts, so the configured settings value
is the source of truth.

The ACQ kit does not mount or invent a FirstMate runtime checkout. It installs
the plugin source only. This keeps the plugin package separate from the project
data that FirstMate supervises.

## Trust and network boundary

Paseo plugins are trusted, unsandboxed code. FirstMate executes helper scripts
from its configured `FM_HOME` and can send messages to Paseo agents. Review the
pinned upstream source and the configured FirstMate checkout before enabling the
kit. The kit allows GitHub archive access for source provisioning and npm access
for the locked dependency install.

Installation is startup-time and fail-soft. A fetch, dependency, or plugin
registration failure is logged at:

```text
~/.local/state/paseo-firstmate/install.log
```

The base Paseo daemon and sandbox continue to start when FirstMate is unavailable.

## Validation

```bash
python ../validate-kits.py
./scripts/verify
RUN_ACQ=1 ./scripts/verify
```

The live check is opt-in because it creates a real sandbox and performs network
fetches. The current script verifies the neutral kit and reports that the live
plugin check requires a Paseo-compatible ACQ image when `RUN_ACQ=1` is supplied.
