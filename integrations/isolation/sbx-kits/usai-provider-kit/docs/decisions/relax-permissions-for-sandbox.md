# Decision: default-allow OpenCode permissions, tuned for the sandbox

**Status:** accepted

## Context

The `usai-provider` kit ships an `opencode.jsonc` that includes OpenCode's
`permission` policy. The original policy was a hardened, **default-deny/ask**
config: it denied reading credential files (`.env`, `*.pem`, `~/.aws/*`, …),
gated `git`, package managers, and builds behind `ask`, and hard-denied `sudo`,
`ssh`, `nc`, `rm`, `dd`, and dozens more. That policy was written for an
**untrusted-host** threat model — an agent that shares a filesystem and network
with the user's real machine and real secrets.

This kit does not run in that model. It runs **exclusively inside an sbx
sandbox**:

- an ephemeral container with **no access to the host filesystem**;
- a **proxied, allow-listed network** (egress is constrained by sbx, not by the
  agent's shell);
- **injected credentials** — the container never holds real key material; env
  values are placeholders or proxied.

In that setting, most of the original gates re-implement — weakly — protections
the sandbox already provides, at the cost of constant `ask` prompts. That
friction has its own security cost: it trains users to approve prompts
reflexively, which erodes the value of the one prompt that actually matters.

## Decision

Adopt a **default-allow** permission policy, gating only the class of action the
sandbox boundary does **not** fully contain.

- Top-level default `"*": "allow"`; `edit`, `read`, `webfetch`, `websearch`
  allow. The former `read` credential-file deny-list is **removed** entirely.
- `bash` default `"*": "allow"`.
- `bash` gates (`ask`) **only outbound "new destination" commands**, which could
  push workspace contents somewhere a prompt-injected agent chose:
  `git push`, `git remote add`, `git remote set-url`, and
  `scp`/`sftp`/`rsync`/`nc`/`ncat`/`netcat`/`telnet`.
- **No hard `deny` rules.** The sandbox, not a denylist, is the control.

### What is deliberately allowed (and why it's safe here)

- **Destructive/filesystem/privilege ops** (`rm -rf`, `dd`, `chmod`, `sudo`,
  `systemctl`, …): blast radius is one ephemeral container. `rm -rf` in a
  throwaway box is a self-own, not a breach.
- **Reading dotfiles / "secret" files** (`.env`, `*.pem`, `~/.aws`, kubeconfig):
  the workspace is expected to be a clone or worktree the user chose to mount —
  it should not contain real secrets — and real credentials are injected, not
  on disk. Reading project files is the agent's job.
- **Package installs / builds / tests** (`npm`, `uv`, `pytest`, `make`,
  `cargo`, `docker`): the entire point of a coding agent. Supply-chain risk is
  bounded by the sandbox + egress allow-list, not by an `ask` prompt.
- **`curl`/`wget`**: allowed. A glob allowlist cannot reliably tell a benign
  `GET` from an exfiltrating `POST` (`-d`, `-T`, `-F`, `-X`, or data smuggled in
  a GET URL, in any flag order), so pretending it's an egress firewall would be
  false confidence. The **proxy allow-list** is the real network control; the
  human sees the full command only where a *new channel* is opened (the `ask`
  edges above).
- **Secret-surfacing commands** (`env`, `printenv`, `git remote -v`,
  `git config --get`): allowed. In the sandbox these expose injected
  placeholders / proxied values, not real secret material — inspecting them is
  expected, not a leak. (This matches the sandbox's credential-injection design.)

### Residual risk (accepted)

A novel outbound command not in the `ask` list runs unprompted. This is bounded
by the sandbox's proxy egress allow-list (an unknown host is not reachable), and
the highest-consequence known outbound action (`git push`) is gated. Accepted at
FIPS-Low for a development sandbox.

## Re-gating for stricter environments

This kit's default is intentionally sandbox-appropriate, not a
one-size-fits-all host-safe policy. Operators who want tighter controls should
**not fork this kit**. Instead, compose a **separate mixin** that contributes
`ask`/`deny` rules via a project-layer `<workspace>/.opencode/opencode.jsonc`.
OpenCode deep-merges that fragment *over* this kit's `OPENCODE_CONFIG`, and
evaluates the **last matching** permission rule, so a re-gating fragment that
loads after this config wins. (See the companion co-tenancy decision record for
the merge/precedence contract.) This keeps the permissive default and the strict
overlay as independent, composable pieces.

## Consequences

- Far fewer approval prompts for routine, sandbox-contained work; the prompts
  that remain (`git push`, new remotes/channels) are the ones worth a human's
  attention.
- The policy is honest about what it is: sandbox-tuned, documented as such in the
  README, and not to be lifted into a non-sandboxed context unchanged.
- Encoded in `tests/opencode-permissions.test.mjs`, which asserts the
  default-allow posture, the specific `ask` edges, and that nothing is hard-denied.

## Links

- Companion: `opencode-config-co-tenancy.md` (the merge/precedence contract a
  re-gating mixin relies on)
