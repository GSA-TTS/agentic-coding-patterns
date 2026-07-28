# Troubleshooting — agentic-coding-playbook kit

These are failure modes specific to the playbook kit, which fetches the GSA
playbook (a GitHub REST source tarball) at container startup and links its
`AGENTS.md` + skills into each agent's search paths.

## No playbook rules or skills in the sandbox

**Symptoms:** `~/.agents/skills` is empty; the agent has no federal `AGENTS.md`;
`~/.agentic-coding-playbook` is missing.

**Cause:** the startup fetch didn't run or failed. The startup command is
non-fatal — on failure it warns and lets the sandbox start without the playbook.

**Fix / diagnose:**

- Check startup logs for the kit's warning (it names the likely cause and now
  includes the underlying `curl` error).
- **Missing GitHub token (private repo).** While the playbook repo is private the
  fetch needs auth. Set it once: `acq secret set -g github`. The kit relies on
  the base agent kit's `github` credential — applying the kit on a base agent
  that doesn't declare `github` leaves the fetch unauthenticated.
- **Egress blocked.** Confirm `api.github.com` (the primary host — the token is
  substituted there) and `codeload.github.com` (the redirected archive bytes)
  were allowed: `sbx policy log <sandbox>`; add blocked hosts to
  `caps.network.allow`.
- **Bad ref.** Confirm `PLAYBOOK_REF` in `spec.yaml` names a real tag/branch.
- **Integrity mismatch.** If the fetch succeeded but the content sha256 didn't
  match `PLAYBOOK_AGENTS_SHA256`, the kit removes the tree and warns "SECURITY:
  ... Refusing to link untrusted playbook content." Regenerate the pin (see the
  README) if you intentionally bumped `PLAYBOOK_REF`.
- **Self-heal:** the fetch is retried on every container start, so once the
  network/token is fixed, stop/start the sandbox (or `sbx kit add <sandbox>
  <kit>` then restart) and it will fetch.

## Skills are present but the agent doesn't use them

**Cause:** the agent reads skills from a path this kit didn't populate. The kit
links `~/.agents/skills` (the cross-agent standard) plus per-agent roots
(`~/.claude/skills`, `~/.factory/skills`, `~/.cursor/skills`, `~/.copilot/skills`).

**Fix:** confirm your agent's expected skills directory is among those (see the
README's table) and that the symlinks resolve:
`sbx exec <sandbox> -- sh -c 'ls -l ~/.agents/skills'`. Cursor/Kiro support is
lower-confidence — verify in-sandbox and adjust the kit's link targets if needed.

## Playbook is pinned to an old version

**Cause:** the kit pins `PLAYBOOK_REF`, and an existing tree is never re-fetched
(fetch-if-missing only).

**Fix:** bump `PLAYBOOK_REF` **and** `PLAYBOOK_AGENTS_SHA256` in `spec.yaml`
(and the script's fallback defaults), then recreate the sandbox (or remove
`~/.agentic-coding-playbook` inside it and restart so the kit re-fetches).

## `AGENTS.md` links are dangling

**Cause:** the fetch partially failed, or the playbook layout changed.

**Fix:** confirm `~/.agentic-coding-playbook/AGENTS.md` exists; if not, re-fetch
(see the self-heal note above). The kit links best-effort and never fails the
sandbox start on a missing link target.
