# Troubleshooting — team kit (template)

Failure modes any team's copy inherits. Keep this file in your copy and grow it
with your team's own entries. Every command is an `acq` command, so the entries
apply on every backend unless marked otherwise.

## Kit content missing (`OPENCODE_CONFIG` empty, files absent)

Almost always: `ACQ_EXTRA_KITS` was not exported in the shell you ran `acq`
from, or points at the wrong path, so only the global kits applied. Check:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG   # empty => the kit did not apply
```

Fix the export (put it in your shell rc). On msb, re-running `acq run <sandbox>`
re-applies the kits in place. On sbx, kits apply at creation only:

```bash
acq rm <sandbox> && acq run opencode /path/to/project
```

## Create fails: the backend rejects the kit / unsupported `schemaVersion`

The kit is neutral `hybrid/v1`, which no backend parses natively; `acq`
translates it. If the raw spec reaches the backend (parse errors naming your
spec's fields), the `agentic-coding-quickstart` checkout predates acq's
kit-translate layer (acq v2.0.0). Update it with `git pull`. A bare backend
command that bypasses `acq` fails for the same reason.

## A needed host is blocked

On msb, a blocked fetch fails at acq's egress proxy and `acq` prints a diagnosis
naming the host. Add it to `caps.network.allow` and recreate the sandbox:
egress is fixed at creation on every backend. Under org governance, org network
rules override kit rules; a host that stays blocked despite the kit entry must
be allowed at the org level.

## A team setting has the wrong value, or is missing

`environment` is last-wins by name and `files[]` is last-wins by path across
the whole stack. A kit listed *after* yours in `ACQ_EXTRA_KITS` (a personal
kit) can shadow a team value silently. Check what the sandbox actually has and
who sets it:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG
acq kit list                                  # the kits acq applies, in order
```

Move the override, or document it as an allowed personal override.

## Files landed, but the env var and startup effects are missing (msb)

One of the kit's `files[]` drops failed, and on msb a failed drop aborts the
rest of that kit's apply: files dropped before it stay, `environment` is not
recorded, `commands[]` do not run. The create output names the file
("could not place kit file at ..."). The usual cause as of acq v3.1.0 is an
**empty payload**: the adapter verifies each drop with `test -s`, so a
zero-byte `.gitkeep` never counts as delivered. Give the file a comment line,
then re-run `acq run <sandbox>` (msb re-applies kits) or recreate.

## A shipped file is present on sbx but missing on msb

The file is under `files/` but has no `files[]` record in `spec.yaml`. The sbx
translation copies the whole `files/home/` tree verbatim; msb materializes only
the listed records. Add the record with the in-guest absolute path.

## A startup command did nothing, and validate said OK

As of acq v3.1.0 an inline flow-style argv (`command: [git, config, ...]`)
parses as an empty argv and `acq kit validate` does not report it. Write the
argv as a block list, one `- arg` per line, or a single `- |` block scalar.

## Rotating a team token breaks existing sandboxes

Existing sandboxes captured the secret's *placeholder* at creation; the proxy
swaps in the real value in transit. A rotation must keep the same placeholder.
Re-run the same command for the same service:

```bash
acq secret set -g <service> --host <host> --env <VAR>
```

If your backend refuses to overwrite an existing custom secret, remove it and
re-create it with the same placeholder rather than accepting a new one.

## Inspecting startup state

Startup-command output only prints during `acq run` or `acq create`. Inspect
later with a probe, and recreate to watch the output again:

```bash
acq exec <sandbox> -- sh -c 'git config --global push.autoSetupRemote'
```
