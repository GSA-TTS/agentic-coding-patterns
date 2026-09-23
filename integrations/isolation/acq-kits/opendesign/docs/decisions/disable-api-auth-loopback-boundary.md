# Decision: disable OpenDesign API auth behind the ACQ loopback boundary

**Status:** accepted

## Context

OpenDesign supports API authentication with `OD_API_TOKEN`, but this ACQ kit is
intended for a local, single-user sandbox reached through a host-loopback port.
The sibling browser UI kits use the sandbox plus host-loopback publish as the
security boundary. Adding a generated token would make first use harder and would
not protect against a local process that can already access the host loopback
port and user session.

The published port must be reachable from the host. msb-style backends dial the
sandbox **guest network IP**, not guest `127.0.0.1`, so something inside the
guest has to listen on that address.

The obvious way to satisfy that — binding the daemon itself to `0.0.0.0` — is
wrong, and was shipped in the first draft of this kit. OpenDesign gates a subset
of its API on the request **peer address** being loopback
(`requireLocalDaemonRequest`, upstream
`apps/daemon/src/http/local-daemon-request.ts`), which inspects
`req.socket.remoteAddress` and the `Host` header. A daemon bound to `0.0.0.0`
sees a guest-network peer for every request arriving from the host, so those
routes answer `403 Forbidden` while the rest of the UI works normally. Observed
on `open-design-v0.24.0`:

| Route | Bound `0.0.0.0` | Bound `127.0.0.1` + relay |
|---|---|---|
| `GET /api/health` | 200 | 200 |
| `GET /api/diagnostics/export` | **403** | 200 |
| `POST /api/strategies/od-next/rollout` | **403** | 200 |
| `POST /api/diagnostics/chat-scroll-forensics` | **403** | 200 |

The user-visible symptom is that Settings → About → **Export diagnostics**
returns 403, and the OD Next strategy switch is silently inert. Both are
especially bad in a kit: diagnostics export is the first thing a user reaches for
when something else breaks.

The daemon's own failure journal
(`$OD_DATA_DIR/diagnostics/environment-evidence.json`) records exactly this set
of routes failing and nothing else, which is the cleanest confirmation that the
peer-loopback guard — not the export handler — is the cause.

## Decision

Run OpenDesign with:

```bash
OD_DISABLE_API_AUTH=1
OD_BIND_HOST=127.0.0.1
OD_PORT=7456
```

and publish that loopback listener on the guest network address with a small,
supervised, kit-managed TCP relay (`files/home/opendesign-relay.mjs`). The relay
is a plain byte forwarder — no parsing and no header rewriting — so SSE run
streams and websockets pass through unchanged, and the daemon always observes a
loopback peer.

Document that the kit is for trusted, single-user hosts only and that the mapped
port must not be forwarded to a wider interface.

### Alternatives rejected

- **Bind `0.0.0.0` and document `od diagnostics export` as the supported path.**
  Works for diagnostics (verified: the CLI produced a bundle while the HTTP route
  404/403'd), but leaves `od-next/rollout` broken with no signal to the user, and
  leaves a UI button that always fails.
- **Patch upstream so `requireLocalDaemonRequest` honours `OD_ALLOWED_ORIGINS`**,
  as the sibling `isLocalSameOrigin` check already does. This is the right
  long-term fix and is being raised upstream, but it weakens a deliberate
  CSRF/SSRF boundary and should not be carried as a local patch in this kit.
- **Rewrite the `Host` header in the relay.** Unnecessary: OpenDesign's origin
  middleware already accepts the loopback `Host` a browser sends to a published
  `localhost` port. Not rewriting keeps the relay a byte pipe.

## Consequences

- Browser access requires no token retrieval step.
- The kit is consistent with the approved local-UI posture for ACQ browser kits.
- Peer-loopback-gated routes work from the host browser, including diagnostics
  export — the path users need when filing a kit bug.
- One more supervised process to reason about. It is fail-soft and logs to
  `~/.local/state/opendesign/opendesign-relay.log`; if the relay dies the UI
  becomes unreachable from the host while remaining reachable in-guest, which is
  a clear and diagnosable failure. `TROUBLESHOOTING.md` names it first for any
  403 or connection-refused symptom.
- Exposure is unchanged relative to the `0.0.0.0` draft: the guest network
  interface was already the reachable surface, and the host side of the mapping
  is still loopback-only.
- Anyone with access to the host loopback port can drive OpenDesign and the
  agents it launches, so the kit must not be used on untrusted multi-user hosts
  or with forwarded public ports.
- If upstream later accepts an operator-declared-origin exemption for
  `requireLocalDaemonRequest`, the relay can be deleted and `OD_BIND_HOST`
  returned to `0.0.0.0`.
