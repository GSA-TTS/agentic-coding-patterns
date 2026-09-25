# Troubleshooting — personal kit (template)

Failure modes any copy inherits. Keep this file in your copy and grow it with
your own entries. Every command is an `acq` command, so the entries apply on
every backend unless marked otherwise. For team-layer problems, see the team
kit's own TROUBLESHOOTING.

## Kit content missing (`OPENCODE_TUI_CONFIG` empty, files absent)

`ACQ_EXTRA_KITS` was not exported in the shell you ran `acq` from, or does not
list your kit, so it never applied. Check:

```bash
acq exec <sandbox> -- printenv OPENCODE_TUI_CONFIG   # empty => the kit did not apply
```

Fix the export (put it in your shell rc). On msb, re-running `acq run <sandbox>`
re-applies the kits in place. On sbx, kits apply at creation only:

```bash
acq rm <sandbox> && acq run opencode /path/to/project
```

## A team setting changed after you added your kit

Your kit is last, and `environment` (by name) and `files[]` (by path) are
last-wins, so a variable or file of yours with the same name or path as the
team's replaces it silently. Compare what the sandbox has with what the team
kit ships:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG
acq kit list                                  # the kits acq applies, in order
```

Rename your file or variable, or drop the override unless the team kit's
README allows it.

## Aliases or prompt missing in the shell

The drop-ins are sourced only by **interactive** shells, and only once the
startup step has added the `~/.rc.d` loop to `~/.bashrc`. Check both:

```bash
acq exec <sandbox> -- sh -c 'grep -n rc.d ~/.bashrc; ls ~/.rc.d'
```

A drop-in present in `files/` but absent from `~/.rc.d` has no `files[]`
record: msb materializes only listed records. If you switched to zsh, zsh
does not read `~/.bashrc`; give `~/.zshrc` its own loop.

## A scripted command hangs or runs in the wrong shell

A drop-in that runs `exec zsh` replaced a shell it should not have. Keep that
line in a `99-` drop-in and keep the interactive guard
(`case $- in *i*) ... esac`) so `bash -lc` scripts never reach it.

## Files landed, but the env var and startup effects are missing (msb)

One of the kit's `files[]` drops failed, and on msb a failed drop aborts the
rest of that kit's apply: files dropped before it stay, `environment` is not
recorded, `commands[]` do not run. The create output names the file
("could not place kit file at ..."). The usual cause as of acq v3.1.0 is an
**empty payload**: the adapter verifies each drop with `test -s`. Give the
file a comment line, then re-run `acq run <sandbox>` (msb) or recreate.

## A startup command did nothing, and validate said OK

As of acq v3.1.0 an inline flow-style argv (`command: [git, config, ...]`)
parses as an empty argv and `acq kit validate` does not report it. Write the
argv as a block list, one `- arg` per line, or a single `- |` block scalar.

## Inspecting startup state

Startup-command output only prints during `acq run` or `acq create`. Inspect
later with a probe, and recreate to watch the output again:

```bash
acq exec <sandbox> -- sh -c 'git config --global alias.st'
```
