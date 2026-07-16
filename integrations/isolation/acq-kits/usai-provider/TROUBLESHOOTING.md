# Troubleshooting — usai-provider kit

These are failure modes specific to the USAi provider kit. They assume you have
applied the kit to a sandbox (`sbx run --kit <kit> opencode <project>`).

## OpenCode shows the wrong providers / no USAi models

**Symptoms:** OpenCode lists generic providers instead of USAi; the custom USAi
model catalog is missing.

**Cause:** the USAi provider config isn't in OpenCode's global config. The kit
delivers it by staging `opencode.jsonc` at `/home/agent/usai-config/` and running
a startup step that merges it into `~/.config/opencode/opencode.jsonc`. This
symptom means the kit wasn't applied, or the merge step didn't run.

**Fix:**

- Recreate the sandbox with the kit applied: `sbx run --kit <kit> opencode <proj>`.
- Or inject it into an existing sandbox without recreating
  (EXPERIMENTAL): `sbx kit add <sandbox> <kit>`, then restart the agent so the
  startup merge runs and OpenCode re-reads its global config.
- Confirm the global config has the USAi provider:
  `sbx exec <sandbox> -- sh -c 'grep -c \"\\\"usai\\\"\" ~/.config/opencode/opencode.jsonc'`
  should print a non-zero count.
- Check the merge step's output in the sandbox startup logs (look for
  `usai-provider: merged ...` or `usai-provider: ... copied ...`).

## USAi authentication fails (HTTP 401/403)

**Symptoms:** the agent reaches USAi but every request is rejected.

**Causes & fixes:**

- **Missing/expired key.** The kit reads `USAI_API_KEY` via the sbx proxy; it is
  not stored in the kit. Store/refresh it:
  `sbx secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY`.
  USAi keys expire periodically — rotate and update the secret.
- **Key truncated on copy.** The console may visually truncate the key when
  selected by hand; use the console's copy button so the stored secret is
  complete.
- **Stale sandbox-scoped placeholder.** If a key worked in a fresh sandbox but an
  older one still fails, that sandbox may hold an outdated `USAI_API_KEY`
  placeholder from before a rotation. Re-set a sandbox-scoped custom secret:
  `sbx secret set-custom <sandbox> --host api.gsa.usai.gov --env USAI_API_KEY`.

## USAi requests hang or time out

**Symptoms:** requests stall instead of erroring.

**Causes & fixes:**

- **Egress blocked.** Confirm the policy allowed `api.gsa.usai.gov`:
  `sbx policy log <sandbox>` — add any blocked host to the kit's
  `caps.network.allow`. The kit allow-lists `api.gsa.usai.gov` by default.
- **Custom endpoint + proxy.** USAi is a custom (non-built-in) endpoint, so it is
  reached via the network allow-list, not a built-in sbx service proxy. Don't
  expect `sbx secret set -g <service>` style provider proxying to apply to it.

## A model appears in the list but fails at runtime

**Cause:** the generated model catalog can drift from what USAi currently serves
(models added/removed/renamed upstream).

**Fix:** regenerate the catalog from this kit directory: `npm run
sync:usai-models`, then re-apply/recreate the sandbox. The generator only
rewrites the region between the `BEGIN/END GENERATED USAI MODELS` markers.

## A global-key override warning appeared at startup

**Symptom:** a `usai-provider: warning: overrode existing global key '<key>'
with the USAi value` message in startup logs.

**Cause:** the sandbox already had a global OpenCode config
(`~/.config/opencode/opencode.jsonc` or `.json`) that set a key the USAi kit also
sets (e.g. a top-level `model`). The kit's config wins for its own keys, so it
overrode that leaf during the merge. This is informational, not an error — all
unrelated keys from the existing config are preserved.

**Fix (only if the override is unwanted):** have the other config contribute via
`<workspace>/.opencode/opencode.jsonc` instead of the global path. OpenCode's
**project** layer deep-merges *over* the global config, so a value set there wins
over the USAi kit's global value — letting both compose. See the "Co-tenancy"
section of the README.

## A pre-existing global `config.json` seems to be ignored

**Symptom:** the sandbox had a global `~/.config/opencode/config.json` (or
`opencode.json`), you hand-edit it later, and your change has no effect.

**Cause:** the startup merge writes its result to the canonical
`opencode.jsonc` and leaves any other global filename (`config.json`,
`opencode.json`) **on disk, untouched**. Your original keys were merged into
`opencode.jsonc` at first boot, and OpenCode's precedence ranks `opencode.jsonc`
**over** `config.json` — so the canonical file wins and later edits to the
orphaned `config.json` are shadowed. No data is lost; the orphaned file is just
no longer authoritative.

**Fix:** make edits in `~/.config/opencode/opencode.jsonc` (the file the kit
writes and OpenCode prefers), or drop a project-layer
`<workspace>/.opencode/opencode.jsonc` fragment, which deep-merges *over* the
global config.
