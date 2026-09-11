# Troubleshooting — pi-coding-agent kit

Failure modes specific to the pi-coding-agent kit, which installs
[earendil-works/pi](https://github.com/earendil-works/pi)
(`@earendil-works/pi-coding-agent`) via the npm registry at every sandbox
start. Most diagnosis is done with `acq exec <sandbox> -- sh -c '…'`. Unlike
the sibling `openchamber`/`paseo` kits, a bare `acq exec` here does **not**
need any `PATH=` prepend to find `pi` — see "Naming/PATH note" below.

## `pi` not found after install (regression watch)

**Symptoms:** the startup log shows
`pi-coding-agent: pi is installed and on PATH (...)`, but a fresh
`acq exec <sandbox> -- sh -c 'command -v pi'` (a bare, non-login shell, no
PATH massaging) comes back empty, or `pi --version` fails to run.

**Cause (the underlying bug this entry documents, now fixed).** An earlier
version of this kit installed with an explicit `--prefix "$HOME/.npm-global"`
— a directory that is **not** on the sandbox's default `PATH` for a fresh
non-login shell (the same reason the sibling `openchamber`/`paseo` kits' own
`scripts/verify` have to inject `$HOME/.npm-global/bin` into every probe's
`PATH` — see their `in_sbx` helpers). The startup script's *own* process could
still find `pi` (it prepends the prefix's `bin/` to its own `PATH` before
installing), so the install would report success, yet a brand-new shell in a
different session — e.g. the human actually typing `pi` at a TUI prompt —
would not see it. `scripts/verify` step 4 specifically probes `command -v pi`
through a bare `sh -c` for exactly this reason: that is the check that would
have caught this class of bug before it shipped.

The fix moved the npm prefix to `$HOME/.local` (already first on the guest's
default `PATH` — no PATH injection needed) and, for the `pi` binary itself,
uses a small wrapper at `$HOME/.local/bin/pi` that also rebuilds
`NODE_EXTRA_CA_CERTS` on every invocation (see
[`docs/decisions/`](docs/decisions/) for why a wrapper rather than an
install-time `export`).

**If you ever see this again (a future regression), check:**

```bash
acq exec <sandbox> -- sh -c 'command -v pi'                # should print a path with NO PATH prepending
acq exec <sandbox> -- sh -c 'echo $PATH'                    # confirm $HOME/.local/bin is on it
acq exec <sandbox> -- sh -c 'ls -la ~/.local/bin/pi'        # confirm the wrapper (or bin link) is there
acq exec <sandbox> -- sh -c 'npm prefix -g'                 # confirm the effective npm prefix
```

If `pi` resolves only with an explicit `PATH=$HOME/.local/bin:$HOME/.npm-global/bin:...`
prepended, the install has regressed to a non-default-PATH prefix — recreate
the sandbox with the current kit, or file an issue.

## Node.js and/or npm not found

**Symptoms:** the startup log shows
`pi-coding-agent: node and/or npm not found on PATH; cannot install pi this
boot (installing Node is out of scope for this kit — see spec.yaml)`, and `pi`
never appears.

**Cause.** This kit deliberately does not install Node — it assumes the base
image already carries it (the same assumption `openchamber` makes for its own
base image). A customized or minimal base image may not.

**Fix:** use the `opencode` base template (the default, which ships Node), or
add a Node install step ahead of this kit in your kit composition.

## Node.js too old

**Symptoms:** the startup log shows
`pi-coding-agent: pi requires Node.js >=22.19.0, found vX.Y.Z; cannot install
pi this boot (installing/upgrading Node is out of scope for this kit)`.

**Cause.** pi's own published npm registry metadata (`engines.node`) requires
Node `>=22.19.0`. npm's `engine-strict` defaults to `false`, so a plain
`npm install` would otherwise proceed silently on an older Node and only fail
later, opaquely, the first time `pi` itself runs — this kit checks explicitly
up front instead, mirroring pi's own installer's preflight check.

**Fix:** upgrade the base image's Node to `>=22.19.0`, or pair this kit with a
Node-upgrade step. Confirm the guest's version:

```bash
acq exec <sandbox> -- sh -c 'node --version'
```

## Malformed `PI_CODING_AGENT_VERSION` — install refused

**Symptoms:** the startup log shows
`pi-coding-agent: PI_CODING_AGENT_VERSION='<value>' doesn't look like a
version; refusing to install` (or `... contains characters outside
[0-9A-Za-z.-]; refusing to install`), and `pi` is never installed.

**Cause.** The kit validates the version pin's shape before it ever reaches
the npm package-spec string (`@earendil-works/pi-coding-agent@<version>`).
This fails **closed**: an unexpected value (typo, stray whitespace, an
accidentally-injected flag-looking token) is refused rather than silently
passed through. Note that this is a defensive **format** check, not a
security boundary on its own — the value is always passed as a single quoted
argv word, never re-parsed by a shell, so it was never shell-injectable; the
check exists so a malformed pin fails loudly and immediately instead of
producing a confusing downstream npm error.

**Fix:** set `PI_CODING_AGENT_VERSION` to either `latest` or a plain
`MAJOR.MINOR.PATCH`-shaped string (matching `[0-9A-Za-z.-]` only) in the
kit's `environment:`/spec configuration, then recreate the sandbox (or
restart it so the startup step re-runs).

## npm install failure or timeout

**Symptoms:** the startup log shows
`pi-coding-agent: npm install exited <rc> (prefix=...); pi unavailable this
boot. See <log path>`, and `pi` is not on `PATH`.

**Cause.** Most commonly: egress to `registry.npmjs.org` is blocked (this
kit's only allow-listed host), a proxy/TLS issue (see the next entry), or a
slow/silently-dropping connection. The install runs with
`--fetch-timeout=30000 --fetch-retries=0` deliberately — this is a
**startup-phase** script that runs on every boot, not a one-shot manual
install, so retrying against a systemic failure just delays the sandbox for
no benefit; the *next* boot retries naturally.

**Fix:** check the install log and egress:

```bash
acq exec <sandbox> -- sh -c 'cat /tmp/pi-coding-agent-install.*.log 2>/dev/null | tail -n 40'
acq exec <sandbox> -- sh -c 'echo "${HTTPS_PROXY:-unset}"'
```

If `registry.npmjs.org` is not reachable under org network policy, confirm it
is on the sandbox's effective allow-list (`sbx policy log <sandbox>` /
`acq policy log <sandbox>` under org governance may show it superseded).

## CA-decode failure (malformed `PROXY_CA_CERT_B64`)

**Symptoms:** the startup log shows
`pi-coding-agent: PROXY_CA_CERT_B64 failed to base64-decode; proxy CA NOT
added to the bundle (see <err path>)`, typically followed by an npm/TLS
failure like `unable to get local issuer certificate` or
`SELF_SIGNED_CERT_IN_CHAIN` on an inspected network.

**Cause.** `PROXY_CA_CERT_B64` (base64-encoded PEM, supplied by whatever
injects a proxy CA into the sandbox — e.g. the `zscaler-ca-certificate` kit)
failed to decode. Unlike the sibling `openchamber` kit's equivalent block
(which swallows this same decode failure via `2>/dev/null`), this kit's
install script surfaces it explicitly, on the theory that a silently
incomplete CA bundle produces a much more confusing downstream TLS error than
telling you up front that the base64 itself was bad.

**Fix:** confirm the value is actually valid base64-encoded PEM from the
source that's supposed to provide it (commonly the `zscaler-ca-certificate`
kit — pair it if you're on an inspected network), then recreate/restart the
sandbox:

```bash
acq exec <sandbox> -- sh -c 'echo "PROXY_CA_CERT_B64 len=${#PROXY_CA_CERT_B64}"'
acq exec <sandbox> -- sh -c 'echo "$PROXY_CA_CERT_B64" | base64 -d | head -c 40'  # should start with -----BEGIN CERTIFICATE-----
```

## pi installs but making an LLM-provider call fails TLS

**Symptoms:** `pi` runs, but any call it makes to a model provider on an
inspected network fails with a TLS trust error (`unable to get local issuer
certificate`, `SELF_SIGNED_CERT_IN_CHAIN`).

**Cause.** `NODE_EXTRA_CA_CERTS` only **appends** to Node's built-in trust
roots — it needs the sandbox's proxy CA (and, per the wrapper design in
`docs/decisions/`, needs to be **rebuilt on every invocation**, not just at
install time, because an `export` inside the install script's own process
does not persist to a separately-launched `pi` process later).

**Fix:** confirm the wrapper is rebuilding the CA bundle at invocation time,
not just at install:

```bash
acq exec <sandbox> -- sh -c 'cat ~/.local/bin/pi'    # should reference NODE_EXTRA_CA_CERTS on every run, not a one-time export
```

If it doesn't, the wrapper has regressed to install-time-only CA export; see
`docs/decisions/` for the intended design and file an issue.

## No model provider configured

**Symptoms:** `pi` runs but has no LLM provider to talk to.

**Cause.** This kit deliberately defers model-provider configuration (no
USAi `models.json` catalog exists for pi yet — see the README's "Status"
section).

**Fix:** authenticate `pi` manually inside the sandbox — `/login`, a provider
environment variable, or `~/.pi/agent/auth.json` — per
[pi's own provider docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md).
