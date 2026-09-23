# Decision: disable OpenDesign API auth behind the ACQ loopback boundary

**Status:** accepted

## Context

OpenDesign supports API authentication with `OD_API_TOKEN`, but this ACQ kit is
intended for a local, single-user sandbox reached through a host-loopback port.
The sibling browser UI kits use the sandbox plus host-loopback publish as the
security boundary. Adding a generated token would make first use harder and would
not protect against a local process that can already access the host loopback
port and user session.

The daemon must bind `0.0.0.0` inside the guest for create-time port publishing to
work on msb-style backends. The host side of the mapping remains loopback-only.

## Decision

Run OpenDesign with:

```bash
OD_DISABLE_API_AUTH=1
OD_BIND_HOST=0.0.0.0
OD_PORT=7456
```

Document that the kit is for trusted, single-user hosts only and that the mapped
port must not be forwarded to a wider interface.

## Consequences

- Browser access requires no token retrieval step.
- The kit is consistent with the approved local-UI posture for ACQ browser kits.
- Anyone with access to the host loopback port can drive OpenDesign and the
  agents it launches, so the kit must not be used on untrusted multi-user hosts
  or with forwarded public ports.
