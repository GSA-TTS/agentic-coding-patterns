# Decision: Extract the inline startup shell into `files/home/playbook-clone.sh`

**Status:** accepted (Phase 2)

## Context

The former sbx kit embedded the entire clone-and-link routine as an inline
`sh -c` heredoc inside `commands.startup` in `spec.yaml`. That inline block was
~80 lines of shell living in a YAML string: hard to lint, impossible to unit
test, and duplicated the pin defaults between the YAML and any documentation.

Phase 2 converts the kit to the neutral `hybrid/v1` spec and, per the acq design
doc §6, this is the moment to extract that logic into a real script.

## Decision

Move the clone/link logic into a standalone POSIX `sh` script shipped as the
kit's only payload: **`files/home/playbook-clone.sh`** (mode `0755`). The neutral
`spec.yaml` now:

- lists the script under `files` (dropped to `/home/agent/playbook-clone.sh`), and
- has a one-line `commands.startup` that exports the pins and invokes the script.

Behavior is **unchanged**: idempotent (clone-if-missing, no refetch), non-fatal
(warns + `exit 0` on any failure so the sandbox still starts and self-heals), and
it still verifies the cloned `HEAD` equals `PLAYBOOK_SHA` before linking.

### Why a file, not an inline command

- **Lintable** — `bash -n` / `shellcheck` and the repo's unsafe-shell scanner
  run against a real file, not a YAML string.
- **Testable** — the script can be exercised directly (and in Part B's
  `scripts/verify-backends`) without standing up a sandbox.
- **Reviewable** — diffs to the clone logic show up as script changes, not as
  churn inside a YAML block scalar.

### Pin duplication

The pin values (`PLAYBOOK_REF`, `PLAYBOOK_SHA`) appear in two places: the
`commands.startup` invocation (authoritative for a run) and the script's own
fallback defaults (used if the env vars are unset). They MUST be bumped together.
This mirrors the prior kit's "spec value + script default" arrangement; it is
called out in the README's pinning section.

## Consequences

- **Positive:** the clone logic is now ordinary, testable shell; the spec is
  small and declarative.
- **Negative / residual:** two copies of the pin to keep in sync (documented).
  As before, `sbx kit validate` / schema validation can't exercise the clone
  end-to-end; the real test is a live run (`scripts/verify`), deferred where a
  sandbox-capable host isn't available.
