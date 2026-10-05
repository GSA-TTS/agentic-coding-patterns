# Troubleshooting — team kit (template)

Failure modes any team's copy inherits. Keep this file in your copy and grow it
with your team's own entries. Every command is an `acq` command. The rules
behind these entries live in the pattern doc (`scope-layers.md`, see the
README); each entry names the section.

## Kit content missing (`OPENCODE_CONFIG` empty, files absent)

Almost always: the shell that *created* the sandbox did not source `env.sh`
(or `TEAM_KIT` pointed at the wrong path), so only the global kits applied.
Check:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG   # empty => the kit did not apply
echo "$ACQ_EXTRA_KITS"                           # on the host: the team kit should come first
```

Fix the rc, then recreate:

```bash
acq rm <sandbox> && acq run opencode /path/to/project
```

Re-running `acq run` alone is not enough: `acq` records a sandbox's extra kits
at creation and reuses that record on reattach. See "Recreating a sandbox" in
the pattern doc.

## Create fails: the backend rejects the kit / unsupported `schemaVersion`

The kit is neutral `hybrid/v1`, which no backend parses natively; `acq`
translates it. If the raw spec reaches the backend (parse errors naming your
spec's fields), the `agentic-coding-quickstart` checkout predates acq's
kit-translate layer. Update it with `git pull`. A bare backend command that
bypasses `acq` fails for the same reason.

## Create fails fetching a global kit over SSH

The create output shows a `git@github.com:` URL and `Permission denied
(publickey)` for one of the pinned kits. A host `url.*.insteadOf` rewrite (for
example `url.git@github.com:.insteadOf https://github.com/`) sends acq's
anonymous kit fetch over SSH, which fails whenever your SSH key is not
available. Check for one:

```bash
git config --get-regexp 'url\..*insteadOf'
```

Make the key available (load it into your agent) and retry the create.

## A needed host is blocked

On msb, a blocked fetch fails at acq's egress proxy and `acq` prints a diagnosis
naming the host. Add it to `caps.network.allow` and recreate the sandbox:
egress is fixed at creation on every backend. Under org governance, org network
rules override kit rules; a host that stays blocked despite the kit entry must
be allowed at the org level.

## A team setting has the wrong value, or is missing

A kit applied *after* yours (a personal kit) can shadow a team value
silently (see the composition table in the pattern doc). Check what the
sandbox actually has, then look for the same variable name or file path in the
kits listed after yours:

```bash
acq exec <sandbox> -- printenv OPENCODE_CONFIG
acq kit list    # the pinned kits plus THIS shell's ACQ_EXTRA_KITS
```

`acq kit list` shows neither `--kit` refs nor the extras recorded for an
existing sandbox, so compare against the `ACQ_EXTRA_KITS` the sandbox was
created with. Move the override, or document it as an allowed personal
override.

## The agent ignores the team conventions

`opencode debug config` lists `team-conventions.md` under `instructions`, but
the agent does not follow it or cannot quote it. Check which OpenCode the
sandbox runs:

```bash
acq exec <sandbox> -- opencode --version
```

OpenCode 2.x accepts `instructions` but never loads the files it lists. See
"Check against your acq" in the pattern doc.

## A daemon still uses the old team settings

A background process that a startup step launched (a web UI serving agent
sessions, for example) read its configuration when it started, so kit changes
that reached the sandbox since then do not reach it. Restart the sandbox:

```bash
acq restart <sandbox>
```

## A startup command did nothing, and validate said OK

`acq kit validate` passes several spec shapes that run nothing or run the
wrong thing: a comment after `phase:` or `user:` (the command is skipped with
only a warning in the create output), a comment after an argv item (it becomes
part of the argument), and flow-style argv (`command: [a, b]`, parsed as
empty). See "Check against your acq" in the pattern doc for the exact rules.

## Files landed, but the env var and startup effects are missing (msb)

One of the kit's `files[]` drops failed, which stops the rest of that kit's
apply on msb. The create output names the file ("could not place kit file at
..."); the usual cause is an empty payload. See "Check against your acq" in the
pattern doc.

## A shipped file is present on sbx but missing on msb

The file is under `files/` but has no `files[]` record in `spec.yaml`. Add the
record with the in-guest absolute path. See "Backend differences" in the
pattern doc.

## git push/fetch hangs or is refused on an SSH remote (msb)

The remote is `git@host:…` or `ssh://git@host/…`, and msb does not carry SSH
to allowed hosts (see "Backend differences"). Adding `host:22` to the allow
list does not help. A `--clone` workspace inherits the host checkout's SSH
origin, so this is the default case for a team VCS and for GitHub. Check what
git will actually contact:

```bash
acq exec <sandbox> -- git -C /path/in/guest/to/repo ls-remote --get-url origin
```

Fix: add the startup step from "Git over HTTPS" in the pattern doc.

## OpenCode: `The socket connection was closed unexpectedly` (msb)

Every request in one session fails the same way, on any model, and reopening
the sandbox does not help, while `curl` to the model endpoint from the same
sandbox succeeds. The session transcript contains a secret placeholder,
usually from a command that printed the environment (`env`, `printenv`), and
msb's proxy fails closed on it (see "Backend differences").

Fix: start a new session; the affected one cannot be sent as-is. Prevent it by
keeping "never print the environment" in the team conventions file.

## Rotating a team token breaks existing sandboxes

The new secret got a new placeholder; existing sandboxes still hold the old
one. Rotate with the same placeholder: see "Backend differences" in the
pattern doc for the command on each backend.

## Inspecting startup state

Startup-command output only prints during `acq run` or `acq create`. Inspect
later with a probe, and recreate to watch the output again:

```bash
acq exec <sandbox> -- sh -c 'git config --global push.autoSetupRemote'
```
