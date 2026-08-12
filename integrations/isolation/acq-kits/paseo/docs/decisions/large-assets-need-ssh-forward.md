# Decision: large web-UI assets need the `ssh -L` publish path (msb relay half-close gap)

**Status:** accepted

## Context

Paseo serves its browser UI from the daemon on one port (6767). The bundled app
includes a large (~15 MB) hashed JavaScript bundle. `@getpaseo/server` streams
static assets with `createReadStream(...).pipe(res)` and sets **no
`Content-Length`**, so Node emits them with `Transfer-Encoding: chunked`. The
small entry documents it *does* length-delimit: `index.html` goes through
`res.send(<string>)` and carries a `Content-Length`.

When the sandbox is reached over a **create-time published port** (the neutral
`publishedPorts` entry → `msb -p 6767:6767`), that port is served by msb's
in-process user-space TCP relay (`crates/network/lib/publisher.rs`), not by
OpenSSH. Observed symptoms from a host browser in that configuration:

- `index.html`, `manifest.json`, and CSS (all length-delimited) load `200 OK`.
- The large **chunked** JS bundle fails with
  `net::ERR_INCOMPLETE_CHUNKED_ENCODING 200 (OK)`.
- New connections opened right after (`/favicon.ico`, `/pwa-icon-192.png`) get
  `net::ERR_CONNECTION_REFUSED`.
- Result: a black page (the app JS never fully loads).

Hitting the daemon **directly inside the guest** (`curl 127.0.0.1:6767/…`)
returns every asset in full, including the chunked bundle — so the daemon is
healthy and the truncation is introduced by the published-port relay.

### Root cause (upstream, not in this kit)

msb's egress relay (`conn.rs`) propagates a guest-side FIN (`CLOSE_WAIT` → drop
the sender so the peer sees a clean EOF); its **ingress / published-port** relay
(`publisher.rs::relay_data`) has **no** equivalent half-close branch — its only
teardown trigger is the *host* side closing first (`relay.to_host.is_closed()`).
So when a published server finishes a response and half-closes, the FIN is not
propagated to the host client. A response the client self-terminates (a
`Content-Length` body) survives; one that needs a clean end-of-stream (a
**chunked** transfer) truncates. A large in-flight transfer that never tears
down also appears to starve new inbound connections on the single poll loop.

This is filed upstream as **microsandbox#1330** (the guest-side half-close fix
landed in `conn.rs` via microsandbox#1181/#1255 but was never mirrored into
`publisher.rs`). It is **not** a Host-header / DNS-rebinding issue: the browser's
`Host: 127.0.0.1:6767` is an IP literal, which Paseo's hostname allowlist accepts
by default, and it is verified reachable — the daemon answers `/api/health` and
serves `index.html` fine over the same relay.

## Decision

**Reach the Paseo web UI over the post-hoc `acq ports --publish` path (msb's
`ssh -L` tunnel), not the create-time published port, until microsandbox#1330 is
fixed.** The kit keeps the neutral `publishedPorts: 6767` (it is correct, needs
no privileged step, and is the right long-term primitive), but the README and
TROUBLESHOOTING steer users to:

```
acq ports <sandbox> --publish 6767:6767
# then open http://127.0.0.1:6767
```

Per msb's own ADRs (0014/0015/0019), `acq ports --publish` establishes an
**OpenSSH `ssh -L` tunnel** whose forward destination resolves **inside the
guest** at guest-loopback — a mature, correctly-half-closing TCP forwarder — and
deliberately bypasses the create-time `publisher.rs` relay that carries the bug.

## Consequences

- The large bundle loads and the UI renders when reached via the `ssh -L` path.
- One extra host command (`acq ports … --publish 6767:6767`) versus the
  ephemeral auto-published port. Documented in README "Reaching it from the host"
  and TROUBLESHOOTING.
- When microsandbox#1330 lands, the ephemeral create-time port should work
  directly and this steer can be relaxed; tracked so it is not forgotten.
- `scripts/verify` now fetches the **large hashed JS asset in full** (not just
  `/api/health` + `/`), so a regression that only manifests on large/chunked
  assets is caught rather than passing on the small files alone.

## Links

- microsandbox#1330 — HTTP partial responses over a forwarded published port
  stall (the tracking upstream issue).
- microsandbox#1181 / #1255 — the guest-side half-close fix on the **egress**
  relay (`conn.rs`) that needs mirroring into `publisher.rs`.
- microsandbox ADR-0015 / ADR-0019 (in the quickstart repo) — post-hoc
  `acq ports --publish` uses `ssh -L`, terminating inside the guest, and is not
  the create-time NAT/relay path.
- `../../paseo/files/home/paseo-start.sh`, `../../paseo/scripts/verify`.
