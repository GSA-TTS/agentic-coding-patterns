# TROUBLESHOOTING — agor-daemon-egress

## The executor can't reach the daemon / session never streams results

Symptoms: the Agor session starts but produces no output; executor logs show a
WebSocket/connection error to the daemon.

1. **Confirm the kit was applied.** The `orchestrators/agor` wrapper must pass
   `AGOR_EGRESS_KIT` and include `--kit "$AGOR_EGRESS_KIT"` on `acq create`. Run
   the wrapper with `AGOR_SANDBOX_DRY_RUN=1` and check the printed `acq create`
   line includes `--kit`.
2. **Confirm the host alias + port match your daemon.** The default allow entry
   is `host.docker.internal:3030`. If your daemon runs on a different port, edit
   `spec.yaml`'s `caps.network.allow`. On sbx the alias is
   `host.docker.internal`; other backends/deploys may differ.
3. **sbx is default-deny.** If you removed or mistyped the allow entry, egress to
   the daemon is blocked. Re-check `spec.yaml`.
4. **Routing vs. allow-listing.** This kit only *allow-lists* the destination.
   Whether the sandbox runtime can actually **route** to the
   `host.docker.internal` host-gateway alias is a Docker-Sandboxes property, not
   something the kit controls. Verify from inside the sandbox:
   `acq exec <sandbox> -- sh -c 'getent hosts host.docker.internal'`.

## On msb, egress seems broader than the port I set

Expected. `acq`'s msb adapter emits `--net-rule allow@host.docker.internal` and
**strips the `:port`** — msb keys on the domain only, so egress is host-wide for
that host. v1 targets sbx (which keeps the port); the msb behavior is tracked at
[#260](https://github.com/GSA-TTS/agentic-coding-patterns/issues/260).

## `validate-kits.py` fails for this kit

- **Missing registry entry** — add `agor-daemon-egress` to
  [`../kits.yaml`](../kits.yaml).
- **Missing README** — this file's sibling `README.md` must exist (parity note).
- **Schema error** — the kit uses only `caps.network.allow` + `backend_shortcuts`;
  it drops no files and runs no commands, so there is nothing else to validate.
