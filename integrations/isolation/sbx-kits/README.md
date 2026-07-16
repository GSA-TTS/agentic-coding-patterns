# sbx mixin kits — moved to `../acq-kits/`

> **Redirect (one-release compatibility shim).** These kits now live at
> [`../acq-kits/`](../acq-kits/) as neutral **`schemaVersion: "hybrid/v1"`**
> kits for the [`acq`](https://github.com/GSA-TTS/agentic-coding-quickstart)
> pluggable-backend wrapper. The `acq-kits/` name makes it explicit that the
> kits target `acq` (which selects a backend — `sbx`, and, from Phase 2, `msb`)
> rather than `sbx` alone.

## What changed

Phase 2 of the `acq` effort introduced a **backend-agnostic kit vocabulary**
(`hybrid/v1`) so more than one isolation backend can share one set of kits. The
four kits that used to live here as `schemaVersion: "2"` **sbx** specs were
converted to `hybrid/v1` and moved to `../acq-kits/`:

| Old (here) | New home |
|------------|----------|
| `usai-provider-kit/` | [`../acq-kits/usai-provider/`](../acq-kits/usai-provider/) |
| `playbook-kit/` | [`../acq-kits/agentic-coding-playbook/`](../acq-kits/agentic-coding-playbook/) |
| `zscaler-ca-certificate/` | [`../acq-kits/zscaler-ca-certificate/`](../acq-kits/zscaler-ca-certificate/) |
| `git-ssh-sign/` | [`../acq-kits/git-ssh-sign/`](../acq-kits/git-ssh-sign/) |

The rationale, the neutral-spec shape, and the per-backend parity notes are
recorded in
[`../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md`](../docs/decisions/0001-neutral-hybrid-v1-acq-kits.md).

## Why the old contents are still here

This directory is kept for **one release** as a redirect so existing pins that
reference `sbx-kits/…` do not break abruptly. The old kit contents below this
README are retained, unchanged, as historical reference and will be removed in a
later release (tracked with the Phase 4 cleanup). **Do not add new work here** —
edit the kits under `../acq-kits/` instead.

## Still here: `openchamber/`

The opt-in [`openchamber/`](openchamber/) kit (a browser UI for OpenCode) still
lives here as a `schemaVersion: "2"` **sbx** kit. It landed alongside the
`acq-kits/` migration and has not yet been converted to `hybrid/v1`/moved under
`../acq-kits/`; that conversion is tracked as a follow-up. Until then, apply it
by its `sbx-kits/openchamber` path as documented in its
[README](openchamber/README.md).
