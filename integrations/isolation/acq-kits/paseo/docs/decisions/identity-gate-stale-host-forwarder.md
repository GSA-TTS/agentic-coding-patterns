# Decision: gate UI readiness on daemon *identity*, not just reachability

**Status:** accepted

## Context

A sandbox can present a **healthy-looking UI on the published port that is not
the daemon `acq exec` reaches.** Every signal the kit previously checked passed
while this was true:

- `acq ports <sandbox>` reported the create-time `-p` mapping as configured.
- `curl http://127.0.0.1:<host-port>/api/health` returned `{"status":"ok"}`.
- `acq exec … curl http://127.0.0.1:6767/api/health` returned `{"status":"ok"}`.
- The UI bundle arrived byte-complete, so the readiness gate in
  `ui-readiness-gate-immutable-cache.md` was satisfied.

Both daemons were genuinely healthy — they were simply **different daemons**. The
observable divergence was the daemon id in `~/.paseo/server-id`: the host port's
WebSocket `server_info` reported one id while `acq exec` read another.

### Why this surfaces as an authentication failure

Under acq/msb, injected provider secrets can be **placeholders** that the
sandbox's TLS-interception layer substitutes on the wire. A request routed to a
daemon *outside* that path still carries the placeholder, so the provider receives
a well-formed but invalid credential and rejects it (HTTP 401
`{"detail":"Authentication failed"}` — distinct from `Not authenticated`, which
is what a *missing* header returns).

That distinction is the whole diagnostic difficulty: the failure presents as a
**credential problem** while the actual fault is **routing**, two layers down.
Confirming the key works from inside the sandbox (curl, `opencode run`,
`paseo run` all succeeded) does not exonerate the route, and the natural next
step — restarting — does not fix it.

### Root cause

**A host-side forwarder that outlives the sandbox it was created for.** The
create-time `-p HOST:GUEST` publish runs a host `msb` process which can survive
`acq stop` **and** `acq rm` and keep holding the host port. The replacement
sandbox's forwarder cannot bind; `acq ports` still reports the mapping (it
reflects the sandbox's *configuration*, which remains correct), so the restart
appears to succeed and changes nothing. Observed: a forwarder **7 days older**
than the sandbox it served, surviving repeated stop/remove/recreate cycles, only
released by `kill <pid>`.

Two signals discriminate a leaked forwarder, and both are cheap:

1. **Age** — the listener is older than the guest's `/proc/uptime`.
2. **Build** — the listener's binary may belong to a *different* `msb`
   installation than the one `acq` drives. The GSA tap ships a pinned
   `microsandbox-acq` plus keg-only versioned formulas, and upstream's
   `microsandbox` owns the same `bin/msb`; a forwarder from another build is
   invisible to the active one, which is precisely why the lifecycle commands
   cannot reach it.

A `PPID` of `1` is **not** a signal — launchd legitimately adopts these
forwarders, so a check keyed on it fires on every healthy system.

### How the leak is created

The observed leak came from **switching `msb` versions on the host**. The two
processes involved were from different formulas:

```text
leaked   /opt/homebrew/Cellar/microsandbox/0.7.2/libexec/msb machine …
healthy  /opt/homebrew/Cellar/microsandbox-acq/0.6.18/libexec/msb sandbo…
```

Replacing the active `msb` does not stop forwarders already running from the
outgoing build, and because upstream `microsandbox` and the pinned
`microsandbox-acq` both own `bin/msb` (they conflict in Homebrew), a version swap
is exactly the operation that leaves behind a forwarder no surviving binary will
reap. Note also the differing subcommands (`machine` vs `sandbox`) — the
forwarder implementation changed across that boundary.

This is why **build** is the highest-value of the two signals rather than a
nice-to-have: a foreign-build forwarder is the specific case `acq stop` and
`acq rm` provably cannot release, so age alone would under-diagnose it. It also
means the condition is reachable by ordinary maintenance (any host that upgrades
or downgrades `msb` while a sandbox has a published port), not only by accident.

## Decision

**Add an identity gate: `scripts/paseo-verify-identity <sandbox>`.** It asserts
that the host-published port and `acq exec` resolve to the **same**
`~/.paseo/server-id`, and exits non-zero when they do not. It is read-only and
makes no changes.

Design constraints, each learned from a concrete failure:

- **Compare the ids to each other, never to a remembered value.** The id changes
  whenever the VM is recreated, so any hardcoded expectation rots immediately.
  The gate also fails when the three host probes disagree *among themselves*,
  which means multiple backends behind one port.
- **Resolve the host port from `acq ports`; never assume host == guest.** The
  post-hoc publish path maps a different host port, and a probe hardcoded to
  `6767` would silently test the wrong endpoint. Derived hex for `/proc/net/tcp`
  matching is computed from the configured guest port for the same reason.
- **Strip CR at the guest boundary.** `acq exec` returns CRLF line endings. An
  unstripped `\r` makes an id compare unequal to its own printed form (a **false
  MISMATCH that prints two identical ids**), turns numeric guest values into
  arithmetic-operator errors, and mangles the terminal. One `tr -d '\r'` at the
  boundary, not per-field.
- **Allow a health grace period.** For a few seconds after restart the daemon
  accepts TCP but answers nothing (`rc=52` "Empty reply from server"). Without a
  retry window the gate reports a false transport fault — the same boot race
  `scripts/verify` guards with `POST_INSTALL_GRACE`.
- **Warn only on the *first* resolved address.** `localhost` returning `::1`
  somewhere in its list is harmless; `::1` returning *first* against an
  IPv4-only listener is not, because the client then connects to an address
  nothing is listening on and **hangs**. Keying the check on mere presence fires
  on healthy systems.
- **Read full argv (`ps -ww`).** The installation-prefix comparison depends on
  the binary path, and the version segment is exactly what a truncated `ps` line
  drops.

**Also corrected: the standing "open via `localhost`, not `127.0.0.1`" advice**
in `TROUBLESHOOTING.md`. That guidance predates the IPv4-only observation and is
wrong when the resolver returns `::1` first — it converts a working setup into a
hang. It is now conditional on checking the listener's address family.

## Consequences

- A wrong-daemon route is caught in one command, before it presents as an
  authentication error two layers away from its cause.
- The gate diagnoses but does **not** remediate: it prints the `kill`/restart
  sequence and requires a human to run it. Killing a process by PID is not a
  safe automatic action — if the listener is *not* launchd-adopted it may have
  siblings under a supervisor, so the instructions say to investigate the parent
  before `kill -9`.
- The gate cannot distinguish "UI not yet opened" from "host traffic landing
  elsewhere" on its own; the `"peer":"external"` vs `"peer":"loopback"` client
  counts in `daemon.log` are reported as a **warning** with both readings
  explained, rather than guessed at.
- This is complementary to, not a replacement for, the bundle readiness gate:
  that one proves the assets are *serveable*, this one proves they come from the
  *right daemon*. Both must hold.
- The underlying forwarder leak is an **upstream** defect; the kit can only
  detect and document it. `acq ports` reporting a configured-but-unbound mapping
  as established is a separate reportable gap in `acq` itself.

## Verification

Live run against a real sandbox (host `msb 0.6.18`, guest daemon `0.9.1`) plus
table-driven checks of each predicate. The live run initially exposed three
defects, all fixed and re-verified:

- **False `MISMATCH` printing two identical ids** (`srv_5NMCI_uKzkPs` vs
  `srv_5NMCI_uKzkPs`) — trailing CR. Reproduced with a CRLF fixture: compare
  `UNEQUAL` before the fix, `EQUAL` after.
- **`syntax error: invalid arithmetic operator (error token is "\r")`** on the
  age compare — same cause; guest numerics now parse (`1000`, `110`).
- **False "zero peer=external clients"** immediately below a printed count of
  `110` — same cause.

Predicate tables (post-fix):

- Orphan age: observed healthy (age 1001s vs uptime 1000s) → PASS; the real
  orphan (7 days vs 1 day) → FAIL; slack boundary 1120 → PASS, 1121 → FAIL.
- Loopback ordering: observed `127.0.0.1 ::1` + IPv4 → no warning (correctly
  silent on a healthy host); `::1 127.0.0.1` + IPv4 → warns; `::1` + IPv6 → no
  warning.
- Build compare: the two observed real paths (`microsandbox-acq/0.6.18` vs
  `microsandbox/0.7.2`) → warns; same prefix → PASS; non-Cellar path → PASS (no
  false warning when no prefix is extractable).
- Verdict matrix: ids agree → pass; mismatch → fail; two distinct host ids →
  fail; no host id → fail.
- `bash -n` clean.

A fourth defect was found and fixed in the standalone precursor: `mktemp -t`
without an explicit `XXXXXX` template fails on macOS ("too few X's").

**End-to-end confirmation of the underlying fix** (separate from the gate):
after killing the stale forwarder, `"peer":"external"` client counts went from
**0 → 110**, and a live agent round-trip in the browser UI succeeded. Per the
periodic end-to-end validation discipline, the gate's own PASS path is verified
against a live sandbox, not a mock.

## Links

- `scripts/paseo-verify-identity` — the gate.
- `TROUBLESHOOTING.md` — "The published port reaches a DIFFERENT daemon than
  `acq exec`"; the corrected `localhost` guidance; the `rc=52` restart-grace
  note.
- `ui-readiness-gate-immutable-cache.md` — the complementary asset-serveability
  gate, and the precedent for gating a "ready" signal on more than
  `/api/health`.
- `scripts/verify` — `POST_INSTALL_GRACE`, the existing convention for the same
  post-restart `rc=52` boot race.
