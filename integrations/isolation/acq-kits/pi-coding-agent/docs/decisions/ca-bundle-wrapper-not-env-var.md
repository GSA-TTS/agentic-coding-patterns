# Decision: a runtime CA-bundle wrapper for `pi`, not an install-time env var

**Status:** accepted

## Context

`pi` is a plain npm-installed Node CLI. It makes HTTPS requests in two
distinct lifetimes:

1. **At install time** — `npm install` itself, fetching package metadata and
   tarballs from `registry.npmjs.org`.
2. **At runtime, later, in a completely separate process** — every time the
   agent user actually invokes `pi` and it talks to whichever LLM provider
   API it is configured against.

`NODE_EXTRA_CA_CERTS` only **appends** to Node's built-in trust roots; it does
not replace them. On an HTTPS-inspecting network (e.g. Zscaler) neither the
sandbox proxy's CA nor an inspection CA is in Node's built-in root set, so
without `NODE_EXTRA_CA_CERTS` pointed at a bundle that includes it, Node fails
closed with `SELF_SIGNED_CERT_IN_CHAIN` / `unable to get local issuer
certificate`. `pi-coding-agent-install.sh` already builds exactly this bundle
(proxy CA from `PROXY_CA_CERT_B64`, base64-decoded, concatenated with the
system trust store) for lifetime (1) — this part is a straight adaptation of
`openchamber`'s own script, with one deliberate improvement (a base64-decode
failure is surfaced, not swallowed — see the install script's own comment).

The problem is lifetime (2). `export NODE_EXTRA_CA_CERTS=...` inside the
install script only sets that variable for the install script's **own
process** (and its children, for as long as it's running). It does **not**
persist to a `pi` process launched **later**, by a **different** parent (a
fresh `acq exec`, a fresh `acq run` shell, the human's own interactive
session) — environment variables set by a shell script do not outlive that
script once it exits, and nothing else in this kit's design re-exports them
into every later session's environment. A plain `npm install -g` bin-link at
`~/.local/bin/pi` would therefore run with **no** `NODE_EXTRA_CA_CERTS` at
all in every real invocation, defeating the entire point of building the
bundle in the first place — it would only ever have been correct during the
one install-time process that happened to set it.

There is also a second reason the bundle can't just be computed once and
written to a static file referenced by a persisted env var: the sandbox's
proxy CA (`PROXY_CA_CERT_B64`) and the system trust store are each supplied
per-boot by whatever injects them (the sbx/msb backend, or a paired kit like
`zscaler-ca-certificate`) — a bundle baked in at install time and never
refreshed could go stale across a container restart if either input changes,
even though the install step itself only runs once (guarded by `command -v
pi`).

## Decision

**Ship `pi` behind a thin wrapper at `$HOME/.local/bin/pi`** (the same
default-PATH location chosen in
[`local-prefix-not-npm-global.md`](local-prefix-not-npm-global.md)) that:

1. Points at a CA bundle the install script rebuilds fresh **on every boot**
   (same proxy-CA-decode + system-trust-store-append logic described above),
   from whatever `PROXY_CA_CERT_B64` / system trust store are present in
   *that* boot's environment. The wrapper itself does not re-derive
   anything at invocation time — it references the bundle PATH the
   startup step (which runs unconditionally on every boot, not just on a
   fresh install) just built. Any `pi` invocation within that boot gets
   that boot's current bundle; the bundle is only as stale as the sandbox's
   own uptime since its last boot, never staler than an install-time-only
   `export` would leave it (which is stale from the very next process
   onward, not just the next boot).
2. `exec`s the real, npm-installed `pi` binary (resolved from the actual npm
   global-prefix `bin/`, not itself) with the CA env var set for that exec,
   passing all arguments through unchanged.

This mirrors the same "wrapper `exec`s the real binary, doesn't just set an
env var and hope it survives" shape the sibling `openchamber` kit uses for its
own `opencode` wrapper (see
`../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md`) and the
`paseo` kit uses for its own agent shim
(`../../paseo/docs/decisions/paseo-mixin-generic-wrapper.md`) — a wrapper is
this family's established pattern for "do something at invocation time, then
become the real thing," not a one-off invention for this kit.

## Why not simpler alternatives

- **`export NODE_EXTRA_CA_CERTS=...` in `~/.profile`/`~/.bashrc`.** Would only
  take effect for a **login** shell that sources it. `acq exec`/`sbx exec`
  run a bare non-login `sh -c` (see the sibling kits' own `scripts/verify`
  comments on this exact point) — a profile-sourced export is invisible to
  exactly the invocation path this kit most needs to support.
- **A backend-level persisted env var (`environment:` in `spec.yaml`).** This
  kit's `environment:` block sets *names* the backend maps onto its native
  env mechanism at container start — but the **value** here is not static
  per-boot; it must be derived (decode + concatenate) from
  `PROXY_CA_CERT_B64` and the system trust store, both of which are
  themselves runtime state, not something `spec.yaml` can compute ahead of
  time. A wrapper that runs the derivation at invocation is the only point
  in the lifecycle where both inputs are known to be current.
- **Bake the bundle once at install time to a static file, reference it via
  a persisted var.** Solves persistence but not freshness: doesn't pick up a
  changed proxy CA / trust store on a later boot without re-running the
  install step, which is explicitly a no-op once `pi` is present (see
  `pi-coding-agent-install.sh`'s idempotency guard).

## Consequences

- **Positive:** `pi` gets a correct, current CA trust bundle on every
  invocation, in every session, not just the one process that happened to
  install it.
- **Positive:** consistent with the family's wrapper pattern — a reviewer
  familiar with `openchamber`'s or `paseo`'s wrapper immediately recognizes
  the shape here.
- **Neutral:** adds one extra process/exec hop per `pi` invocation (the
  wrapper, then the real binary) — negligible cost for a TUI startup.
- **Negative / residual note:** the wrapper is rewritten by the install
  script on every boot (not just on a fresh install), so it self-heals a
  sandbox that already had `pi` installed from before this wrapper existed,
  and so it can point at that boot's freshly-rebuilt bundle path. That means
  the install script must run its full CA-bundle-and-wrapper logic
  unconditionally, not only inside its "pi is missing" branch — see the
  install script's own comment on why the bundle build and the wrapper
  rewrite both sit outside that guard.

## Links

- `../files/home/pi-coding-agent-install.sh` — the install-time CA-bundle
  block this decision's runtime rebuild parallels.
- [`local-prefix-not-npm-global.md`](local-prefix-not-npm-global.md) — why the
  wrapper lives at `$HOME/.local/bin/pi` specifically.
- `../../openchamber/docs/decisions/wrapper-entrypoint-owns-server.md` — the
  family's precedent for a PATH-shadowing wrapper that `exec`s the real
  binary.
- `../../paseo/docs/decisions/paseo-mixin-generic-wrapper.md` — a second
  precedent, for a generic (non-opencode-coupled) wrapper shim.
