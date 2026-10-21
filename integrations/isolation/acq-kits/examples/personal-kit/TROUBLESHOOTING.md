# Troubleshooting — personal kit (template)

Failure modes any copy inherits. Keep this file in your copy and grow it with
your own entries. Every command is an `acq` command. The rules behind these
entries live in the pattern doc (`scope-layers.md`, see the README); each
entry names the section. For team-layer problems, see the team kit's own
TROUBLESHOOTING.

## Kit content missing (drop-ins and personal files absent)

The shell that *created* the sandbox did not have your kit in
`ACQ_EXTRA_KITS` (missing from `PERSONAL_KITS`, or the rc did not source the
team kit's `env.sh`), so it never applied. Probe something only your kit
ships. An environment variable is not a reliable probe here: a team kit may
set the same one (`OPENCODE_TUI_CONFIG`, for example), so it can be non-empty
without your kit.

```bash
acq exec <sandbox> -- sh -c 'ls ~/.rc.d/50-example.sh; git config --global alias.st'   # both missing => the kit did not apply
```

Fix the rc, then recreate:

```bash
acq rm <sandbox> && acq run opencode /path/to/project
```

Re-running `acq run` alone is not enough: `acq` records a sandbox's extra kits
at creation and reuses that record on reattach. See "Recreating a sandbox" in
the pattern doc.

## A team setting has the wrong value (your kit shadows it)

Your kit is last, and `environment` (by name) and `files[]` (by path) are
last-wins (see the composition table in the pattern doc), so a variable
or file of yours with the same name or path as the team's replaces it
silently. Compare what the sandbox has with what the team kit ships:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG
acq kit list    # the pinned kits plus THIS shell's ACQ_EXTRA_KITS
```

`acq kit list` does not show what an existing sandbox was created with, so
compare against the `ACQ_EXTRA_KITS` you used at creation.

Rename your file or variable, or drop the override unless the team kit's
README allows it.

## Aliases or prompt missing in the shell

`acq`'s `~/.profile` sources the drop-ins, so only bash **login** shells see
them: `acq shell` and `bash -l`, not a plain `bash` typed at a prompt. Check
that the loop is there and the drop-in landed:

```bash
acq exec <sandbox> -- sh -c 'cat ~/.profile; ls ~/.rc.d'
```

`acq` writes that loop only when `~/.profile` is missing, empty, or its own; an
image that ships its own `~/.profile` must source `~/.rc.d` itself. A drop-in
present in `files/` but absent from `~/.rc.d` has no `files[]` record (see
"Backend differences" in the pattern doc). If you switched to zsh, `acq`'s loop
runs only in bash; give `~/.zshrc` its own loop.

## Drop-ins run twice

Some layer still appends its own `~/.rc.d` loop to `~/.bashrc`, and `acq`'s
`~/.profile` sources `~/.bashrc` before running its own loop. Find it and
remove that kit's startup step; `acq` already wires the directory:

```bash
acq exec <sandbox> -- sh -c 'grep -n rc.d ~/.bashrc'
```

## A scripted command hangs or runs in the wrong shell

A drop-in that runs `exec zsh` replaced a shell it should not have. `acq`'s
loop sources drop-ins in scripted `bash -lc` runs too, so the line needs its
own guards: keep it in a `99-` drop-in, wrap it in `case $- in *i*) ... esac`,
require a terminal (`[ -t 0 ]`), and require `BASH_EXECUTION_STRING` to be
empty: bash sets that variable whenever it runs a command string, so
`bash -lic '...'` still runs its command. The example in
`files/home/.rc.d/50-example.sh` carries all the guards.

## Files landed, but the env var and startup effects are missing (msb)

One of the kit's `files[]` drops failed, which stops the rest of that kit's
apply on msb. The create output names the file ("could not place kit file at
..."); the usual cause is an empty payload. See "Check against your acq" in the
pattern doc.

## A startup command did nothing, and validate said OK

`acq kit validate` passes several spec shapes that run nothing or run the
wrong thing: a comment after `phase:` or `user:` (the command is skipped with
only a warning in the create output), a comment after an argv item (it becomes
part of the argument), and flow-style argv (`command: [a, b]`, parsed as
empty). See "Check against your acq" in the pattern doc for the exact rules.

## Commits in the sandbox have the wrong author

`acq` carries your host's git identity into the sandbox, but not when
`user.name` and `user.email` come from a file your host gitconfig includes
(`include.path` or `includeIf`). Check what the sandbox has:

```bash
acq exec <sandbox> -- git config --global --includes --get user.email
```

Set the identity in your kit instead: a startup step per key, or the gitconfig
your kit ships and includes (see "Git preferences" in the README).

## A tool warns about config keys that work on the host

The sandbox runs the tool version from the image's pin, not the host's, so a
config file copied from your dotfiles can carry keys that version does not
know yet (or no longer knows). The tool then warns on every run. Trim the
sandbox copy to what the pinned version accepts, and note in the file that it
is a sandbox-specific copy of your host config.

## Inspecting startup state

Startup-command output only prints during `acq run` or `acq create`. Inspect
later with a probe, and recreate to watch the output again:

```bash
acq exec <sandbox> -- sh -c 'git config --global alias.st'
```
