# Decision: plaintext HTTP + shared secret-key handshake over a host-loopback port

**Status:** accepted (revised after a live goose Desktop 1.50.0 test; supersedes the
initial "unauthenticated" decision)

## Context

goosed (`goose serve`) is reached by goose Desktop over the host↔guest link. goose
supports two transports (per the
[remote-server guide](https://goose-docs.ai/docs/guides/remote-goose-server)):

1. **Plaintext HTTP**, with a shared secret (`GOOSE_SERVER__SECRET_KEY`, sent by the
   client as `X-Secret-Key` on `/status` and as `?token=` on `/acp`), or
   `--dangerously-unauthenticated` to skip the secret.
2. **Self-signed TLS** (`--tls`), which logs a `GOOSED_CERT_FINGERPRINT` that
   Desktop can pin.

acq publishes the guest port to the **host loopback** only (127.0.0.1).

### What we tried first, and why it failed

The initial version ran `--dangerously-unauthenticated`, reasoning that the sandbox
is the security boundary and a static secret in the kit env is not a "real" secret
(and acq cannot inject a host-less secret through its credential path). A live test
against **goose Desktop 1.50.0** disproved the *connectivity* assumption:

- The server was fully healthy: `GET /status` → `200 OK`, `GET /acp` (no SSE header)
  → **406** ("client must accept text/event-stream"), i.e. the ACP endpoint was live
  and, per the goose docs, 406 means *auth passed*.
- Yet Desktop reported **"server cannot connect"** and made **no** TCP connection to
  the port on launch.

Inspecting the Desktop app bundle (`app.asar`) showed why: its ACP client's health
check **always** sends `X-Secret-Key: <secret>` to `/status` and builds the ACP URL
as `/acp?token=<secret>`. Its own `goose serve` spawn path sets
`GOOSE_SERVER__SECRET_KEY` unconditionally (`ve()` requires a non-empty secret and
throws "GOOSE_SERVER__SECRET_KEY is required for goose serve" otherwise). Desktop
1.50.0 has **no supported path for an empty-secret external server** — so an
unauthenticated server, however healthy, is unusable from Desktop.

### The secret is not a protectable credential

`GOOSE_SERVER__SECRET_KEY` must ALSO be entered into Desktop's settings by the
operator, and it guards only a **host-loopback** port. It is a **handshake token**,
not a credential protecting external egress. acq's secret path (which requires a
host binding and could not inject a host-less value) is therefore both unavailable
*and* unnecessary here: there is nothing to protect that a cleartext env value
weakens.

## Decision

**Run `goose serve` WITH a shared secret from `GOOSE_SERVER__SECRET_KEY`, set in the
kit's non-secret `environment:` block, over plaintext HTTP on a host-loopback
published port.** The operator pastes the same value into goose Desktop →
Settings → goose Server → Secret Key.

- Default value: `goose-server-kit-local-loopback`. Operators MAY override it per
  sandbox (`-e GOOSE_SERVER__SECRET_KEY=<value>`), setting the same value in Desktop.
- The secret is passed via the environment (goose reads it), not on argv, to keep it
  out of the process command line and logs.

This reverses the earlier "unauthenticated" decision on the strength of the live
finding: Desktop 1.50.0 requires the handshake, so matching it is a correctness
requirement, not a security upgrade.

## Consequences

- goose Desktop 1.50.0 connects; the earlier "server cannot connect" is resolved.
- The link is **not** encrypted, and the "secret" is cleartext in the kit env and in
  Desktop's settings. This is acceptable only because the port is **loopback-only**
  and the **sandbox is the real security boundary** (ephemeral container/microVM,
  deny-default allow-listed egress, no host FS, injected credentials). It is **not**
  a posture for exposing goosed on a network interface.
- The verify script asserts the **handshake**: `/status` returns 200 **with** the
  kit secret, and `/acp?token=<kit secret>` returns **406** (auth passed) — not
  401/403 (secret rejected).
- If a future requirement needs real network exposure or defense against other local
  users on a shared host, adopt the **TLS + fingerprint** follow-up: run
  `goose serve --tls`, capture the logged `GOOSED_CERT_FINGERPRINT`, and pin it in
  Desktop (Desktop also supports HTTPS external URLs). That path does not need acq to
  inject a secret (the fingerprint is not a secret). Tracked as a follow-up
  increment.
