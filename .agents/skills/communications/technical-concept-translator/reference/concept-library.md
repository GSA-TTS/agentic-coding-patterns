# Executive Concept Library

Reusable, technically-correct executive explanations for the concepts that come
up when explaining agentic coding to non-engineering leadership. Consumed by
`technical-concept-translator`, `software-delivery-explainer`,
`agentic-value-analyst`, and the `design-artifact` `technical-explainer` profile.

## How to use this file

Each entry uses a fixed schema. Take the entry, adapt the depth to the audience
(see `../../software-delivery-explainer` and the audience profiles), and keep the
technical facts intact. **Do not** invent detail that is not here; if a fact is
not in this library or a cited source, say so rather than guess.

```yaml
concept:            # the term
plain_language:     # one accurate sentence a non-engineer understands
why_it_matters:     # why leadership should care
what_it_is_not:     # bound the concept — stop a false mental model forming
where_it_fits:      # where it sits in the process/architecture
controls:           # security/governance implication, if any
example:            # a short concrete instance
source:             # citation to ground truth (repo/doc), if the claim needs one
```

## Ground-truth sources (cite these, do not restate as policy)

The security and process claims below trace to these repositories. This library
is **reference material, not authoritative policy** — the same rule the source
repos state about themselves.

- **Playbook** (`GSA-TTS/agentic-coding-playbook`): `AGENTS.md` (agent behavioral
  contract), `docs/SECURITY-CONTROLS.md` (NIST 800-53 overlay), `docs/AI-CONTRIBUTION-POLICY.md`
  (human author-of-record), `docs/AGENT-IDENTITY.md` (chain of accountability),
  `docs/GETTING-STARTED.md` (glossary, CI/CD, "AGENTS.md is a guide not enforcement").
- **Quickstart** (`GSA-TTS/agentic-coding-quickstart`): `docs/adr/0001` (sandbox
  isolation), `docs/adr/0013` (token downscoping), `docs/adr/0018`/`0019` (network
  egress), `BACKEND_GUIDE.md`, `KNOWN_FAILURE_MODES.md` §14 (the secrets caveat),
  `acq.backends/secret-store.sh`.

---

## Source control & change concepts

```yaml
concept: Repository
plain_language: A tracked folder that holds a project's files and the full history of every change to them.
why_it_matters: It is the system of record for the software — who changed what, when, and why is all auditable.
what_it_is_not: Not just a backup or a shared drive; it keeps ordered, attributable history, not just the latest copy.
where_it_fits: The container everything else (issues, branches, pull requests, CI) operates on.
controls: History is attributable and hard to rewrite silently — supports audit and accountability.
example: The three GSA-TTS repositories (playbook, quickstart, patterns) are each a repository on GitHub.
source: —
```

```yaml
concept: Commit
plain_language: A saved, labeled snapshot of a set of changes, attributed to a specific author.
why_it_matters: It is the atomic unit of "who changed what"; every change is signed to a responsible human.
what_it_is_not: Not a deployment and not automatically live anywhere — a commit is a recorded change, not a release.
where_it_fits: Changes are made as commits on a branch, then bundled into a pull request.
controls: Each commit carries author identity; AI-assisted commits also record the tool as a co-author, with the human as author of record.
example: "feat(msb): add network tier selector" recorded against a GSA engineer's account.
source: Playbook docs/AI-CONTRIBUTION-POLICY.md (human author-of-record).
```

```yaml
concept: Branch
plain_language: A separate line of work where changes can be made without affecting the main, shared version.
why_it_matters: Work-in-progress stays isolated, so unfinished or unreviewed changes never touch the live/main code.
what_it_is_not: Not a copy of the whole repository for one person to keep; it is a shared, mergeable line of change.
where_it_fits: A change starts on its own branch; it only reaches the main branch after review and approval.
controls: The main branch can be protected so nothing merges into it without review and passing checks.
example: A fix is developed on a branch named "fix/secret-store", reviewed, then merged to main.
source: Playbook AGENTS.md (agent must not commit directly to protected branches).
```

```yaml
concept: Pull request (PR)
plain_language: A proposal to merge a branch's changes into the main code, opened for review before anything is accepted.
why_it_matters: It is the control point where humans inspect, discuss, and approve or reject a change before it lands.
what_it_is_not: Not an automatic merge and not a deployment; opening a PR changes nothing in the live code by itself.
where_it_fits: Sits between "changes made on a branch" and "changes merged" — the gate where review and automated checks run.
controls: A human reviewer (not the change's author) approves; automated checks must pass first. Separation of duties (author ≠ approver).
example: PR #295 in quickstart proposed the network-egress default and was reviewed before merge.
source: Playbook SECURITY-CONTROLS.md AC-5; AGENTS.md §3.2/§8.2/§14.2.
```

```yaml
concept: Review
plain_language: A person other than the author examines a proposed change and its evidence, then approves it or asks for fixes.
why_it_matters: Human judgment on correctness, security, and fit — the accountability step that "the AI wrote it" can never replace.
what_it_is_not: Not a rubber stamp and not something the change's author (human or agent) can do for their own change.
where_it_fits: On the pull request, after automated checks, before merge.
controls: Separation of duties — the agent may assist review (flag issues, run scanners) but MUST NOT be the sole reviewer for production-bound code.
example: A reviewer requests changes on a PR because a test is missing; the author adds it before approval.
source: Playbook SECURITY-CONTROLS.md AC-5; AI-CONTRIBUTION-POLICY.md.
```

```yaml
concept: Merge
plain_language: Combining an approved branch's changes into the main version of the code.
why_it_matters: The moment a proposed change becomes part of the shared, official codebase.
what_it_is_not: Not a deployment to users — merging updates the main code; a separate step releases it.
where_it_fits: After review approval and passing checks; before (or triggering) deployment.
controls: Gated by branch protection — requires approval + green checks; the agent may not merge its own pull requests.
example: After approval, PR #295 was merged into main.
source: Playbook AGENTS.md §14.2 (agent must not merge its own PRs).
```

---

## Delivery-pipeline concepts

```yaml
concept: Issue
plain_language: A tracked description of a problem to solve or a piece of work to do.
why_it_matters: It is where work is defined and prioritized before anyone writes code — the "what and why".
what_it_is_not: Not a task assigned only to an AI, and not a change itself; an issue describes work, it does not perform it.
where_it_fits: The start of the delivery process; a branch and pull request later reference the issue they resolve.
controls: Creates a traceable link from a stated need to the change that addressed it.
example: "acq secret rm cannot remove an orphaned entry" filed as an issue, later closed by a fix PR.
source: —
```

```yaml
concept: Automated test
plain_language: Code that checks other code behaves as intended, run automatically and repeatably.
why_it_matters: Catches regressions and mistakes before humans review — cheap, consistent verification at scale.
what_it_is_not: Not a guarantee the software is correct or secure; tests check what they were written to check, nothing more.
where_it_fits: Run on the branch and again in CI on every pull request.
controls: A failing test blocks merge when CI is required; part of the run-and-verify loop.
example: quickstart's test-acq suite runs on every change to the wrapper.
source: Playbook docs/GETTING-STARTED.md (CI/CD baseline).
```

```yaml
concept: CI (continuous integration)
plain_language: An automated system that runs checks — tests, security scans, linters — on every proposed change.
why_it_matters: Consistent, unbiased gate that runs the same checks every time, before a human spends review time.
what_it_is_not: Not a human review and not a deployment; CI reports pass/fail, it does not judge fitness or ship code.
where_it_fits: Triggered by a pull request; its results are one input to the human reviewer.
controls: SAST, SCA, secrets scanning, and the test suite; a required check must pass before merge (SA-11, CM-5).
example: A PR that introduces a hardcoded secret is blocked by the secrets-scan check.
source: Playbook docs/GETTING-STARTED.md §7 (CI/CD Security Baseline).
```

```yaml
concept: CD / deployment
plain_language: The controlled process of releasing merged code so it actually runs for users.
why_it_matters: Merging changes the codebase; deployment is what puts a change in front of real users, under its own controls.
what_it_is_not: Not automatic on merge in this context, and not something the agent performs; normal deployment controls still apply.
where_it_fits: After merge; governed by the organization's release and authorization process.
controls: Human approval gates and (for federal production) an Authorization to Operate remain required; the sandbox environment described here is local-dev only and does not touch production.
example: A merged change is later released through the team's normal, human-approved deploy process.
source: Quickstart AGENTS.md (local-dev only, no production access).
```

---

## Isolation & environment concepts

```yaml
concept: Sandbox
plain_language: An isolated environment where an agent can do messy development work with limited, controlled capabilities, separated from the employee's computer.
why_it_matters: It contains the blast radius — mistakes or misbehavior stay inside a disposable box, not on the workstation or the network at large.
what_it_is_not: NOT a perfect security guarantee. It does not verify the integrity of the base image it runs (SI-7 is only partially addressed), and it does not stop an authenticated agent from acting broadly with a credential it legitimately holds.
where_it_fits: Where the agent actually runs and edits code, between the developer's machine and any external service.
controls: Isolation from the host (treated as untrusted), filesystem limited to mounted project paths, deny-by-default network egress, disposable/ephemeral. Maps to AC-6, SC-7, SC-39.
example: The quickstart `acq` tool starts a per-project sandbox (microVM via msb, the default, or a container via sbx) for the agent to work in.
source: Quickstart docs/adr/0001 (isolation; SI-7 partial — integrity depends on image provenance); docs/adr/0013 (egress ≠ repo authority).
```

```yaml
concept: VM / microVM
plain_language: A lightweight, self-contained virtual computer that boots fast and throws away cleanly.
why_it_matters: Gives strong isolation (its own kernel boundary) without the weight of a full virtual machine — practical for per-task sandboxes.
what_it_is_not: Not the same as a plain container sharing the host kernel; the microVM boundary is stronger, but still depends on the image it runs.
where_it_fits: One of the sandbox backends the agent runs inside.
controls: Process/kernel isolation (SC-39); the default quickstart backend (msb) uses a libkrun microVM.
example: msb runs the agent in a libkrun microVM with a per-sandbox network policy.
source: Quickstart BACKEND_GUIDE.md; docs/adr/0001.
```

```yaml
concept: Network egress restriction
plain_language: A rule that blocks the sandbox from reaching the internet except for an explicit list of allowed destinations.
why_it_matters: Limits where an agent (or a compromised dependency) can send data or reach out to — deny-by-default, not open-by-default.
what_it_is_not: It controls WHERE traffic can go, not WHAT authority a credential carries — it cannot stop an authenticated request from touching a repo the credential can already reach.
where_it_fits: Applied to the sandbox at creation; sized by a tier (strict / balanced / open).
controls: Deny-by-default egress for strict and balanced tiers; "open" is refused unless explicitly confirmed. Maps to SC-7 / AC-4.
example: The balanced tier allows a curated set of developer hosts (AI services, package registries) and blocks everything else.
source: Quickstart BACKEND_GUIDE.md (ACQ_NETWORK_TIER); docs/adr/0018, 0019.
```

---

## Secrets & access concepts

```yaml
concept: Secret
plain_language: A sensitive credential — an API key, token, or password — that grants access to a system.
why_it_matters: A leaked secret is a direct path to whatever it unlocks; handling it correctly is a core security control.
what_it_is_not: Not something that should ever appear in source code, logs, or a command line.
where_it_fits: Needed by the agent to reach services (e.g., the model endpoint, source control) — but ideally without the agent ever seeing the raw value.
controls: Stored in a host-side keychain, never committed, rotated on a schedule; maps to IA-5, SC-28.
example: The USAi API key and a GitHub token are the secrets an agent sandbox typically needs.
source: Playbook SECURITY-CONTROLS.md IA-5; CODING_PRACTICES.md §4; Quickstart acq.backends/secret-store.sh.
```

```yaml
concept: Secrets proxy / injection
plain_language: A mechanism that lets the sandbox use a credential without the raw secret value ever being placed inside it.
why_it_matters: The agent can call an authenticated service, but a compromised or curious agent has no raw key to read or leak.
what_it_is_not: Not the same as putting the key in an environment variable for the agent to read. In the sanctioned setup the agent works with a placeholder or a proxied binding, not the real value.
where_it_fits: Between the host secret store and the service the agent calls.
controls: Real values live in a host store, never in argv or logs. Both backends proxy secrets in the default setup — msb swaps a placeholder for the real value on the wire (ENV@HOST), and sbx injects credentials via its proxy for built-in services and via `secret set-custom` for custom endpoints like USAi — so the agent does not hold the raw key material. GitHub tokens are additionally downscoped per sandbox to only the mounted repositories (least privilege, AC-6). Maps to IA-5, SC-28.
example: On msb, the guest holds a placeholder like $MSB_GITHUB_TOKEN and msb substitutes the real token on the wire; on sbx, USAi is configured with `sbx secret set-custom --host api.gsa.usai.gov --env USAI_API_KEY` so the credential is injected without the agent holding the raw value.
source: Quickstart acq.backends/secret-store.sh + acq.backends/sbx.sh (set-custom); AGENTS.md Network Access / "No Secrets Exposure" note; BACKEND_GUIDE.md (swap-on-wire); docs/adr/0013 (downscoping).
```

```yaml
concept: Least privilege
plain_language: Give each actor only the access it needs for the task at hand, and no more.
why_it_matters: If something is compromised, the damage is bounded to the narrow access it had.
what_it_is_not: Not a one-time setup — it means actively scoping each credential and capability, not granting broad standing access.
where_it_fits: Applied to the agent's tokens, filesystem, and network access.
controls: Per-sandbox fine-grained tokens scoped to mounted repos; filesystem limited to the project directory; explicit capability allowlist. Maps to AC-6, CM-7.
example: A per-sandbox GitHub token can reach only the repositories that sandbox mounts, so a prompt-injected agent in one sandbox cannot touch others.
source: Quickstart docs/adr/0013; Playbook SECURITY-CONTROLS.md AC-6, CM-7.
```

```yaml
concept: Audit trail
plain_language: A tamper-resistant log of who (or what) did what, and when.
why_it_matters: Makes agent actions traceable back to the accountable human — essential for oversight and incident response.
what_it_is_not: Not something the agent can turn off or edit; an agent that could suppress its own logs would defeat the control.
where_it_fits: Records every consequential agent action across the process.
controls: Logs capture agent id, invoking user, timestamp, and correlation id; the agent MUST NOT be able to disable or modify its own audit logs. Maps to AU-2, AU-3, AU-12.
example: An agent action is logged with both the agent identity and the human who delegated it.
source: Playbook SECURITY-CONTROLS.md AU-2/3/12; AGENT-IDENTITY.md (chain of accountability).
```

```yaml
concept: Human approval gate
plain_language: A required checkpoint where a person must approve before a consequential action proceeds.
why_it_matters: Keeps a human in control of the decisions that carry real risk, regardless of how much work the agent did.
what_it_is_not: Not optional for the actions it covers, and not something the agent can approve for itself or escalate past.
where_it_fits: Before destructive operations, external network requests, dependency installs, license acceptance, CI/CD changes, commits/pushes, and production deployment.
controls: The agent MUST obtain explicit approval for the listed actions, MUST NOT self-approve, and MUST fail closed (halt and escalate) on ambiguity.
example: The agent proposes an execution plan and waits for the human to approve before running it.
source: Playbook AGENTS.md §3.2 (approval gates), §8.2 (no self-approve), §14.5 (fail closed).
```

```yaml
concept: Production access
plain_language: The ability to change or reach the live systems real users depend on.
why_it_matters: The highest-consequence access; mistakes here affect users and data directly.
what_it_is_not: Not something the development sandbox has — the sandbox described here is local-dev only, with no production access and no real sensitive data.
where_it_fits: Outside the sandbox, behind the organization's deployment and authorization controls.
controls: Sandbox is FIPS-Low, local-dev, no PII/CUI; the agent MUST NEVER access or modify production systems or data.
example: A merged change reaches production only through the team's separate, human-approved deployment process.
source: Quickstart AGENTS.md (prohibited actions; data classification).
```

---

## Agent-system concepts

```yaml
concept: AI model
plain_language: The underlying trained system that generates text or code from a prompt.
why_it_matters: It is the raw capability — but on its own it only produces output; it takes no actions.
what_it_is_not: Not an agent. A model does not read your repository, run commands, or open pull requests by itself.
where_it_fits: The engine an agent calls; reached here through the USAi endpoint.
controls: Model access is authenticated and, in the sandbox, mediated so the raw key is protected (see secrets proxy — proxied on both backends in the default setup).
example: A large language model accessed via the USAi API answers a coding question.
source: Quickstart docs/adr/0001 (USAi endpoint).
```

```yaml
concept: Agent
plain_language: A program that uses a model plus tools to actually do tasks — read files, run commands, edit code — in a loop toward a goal.
why_it_matters: This is what "does the work"; understanding it as a tool operating under controls (not an autonomous worker) is the key executive point.
what_it_is_not: Not autonomous and not a replacement for the engineer. It works inside the sandbox and stops at every human approval gate; it cannot approve or merge its own work.
where_it_fits: Runs inside the sandbox, calls the model, uses tools, and proposes changes for human review.
controls: Operates under the AGENTS.md behavioral contract; bounded by sandbox isolation, least-privilege credentials, approval gates, and audit logging.
example: OpenCode running in a quickstart sandbox investigates a repo, drafts a fix, runs tests, and prepares a pull request for review.
source: Playbook AGENTS.md (behavioral contract); Quickstart AGENTS.md (authorized agents).
```

```yaml
concept: Agent harness
plain_language: The tool that runs an agent — managing its loop, tool access, and configuration.
why_it_matters: The harness is where the controls are wired in (which tools, which files, which approvals) — it is the enforcement surface around the model.
what_it_is_not: Not the model (the intelligence) and not the AGENTS.md file (the rules); the harness is the runtime that connects them and enforces tool limits.
where_it_fits: Between the model and the environment; it is the program a developer launches.
controls: Enforces tool allowlists and approval prompts; different harnesses (OpenCode, Claude Code, Copilot) read the same AGENTS.md convention.
example: OpenCode is an agent harness; it reads AGENTS.md and runs the model against the repository with tool gating.
source: Quickstart AGENTS.md (authorized agents: OpenCode, Claude Code, GitHub Copilot).
```

```yaml
concept: AGENTS.md
plain_language: A file in the repository that tells AI coding agents the rules and practices to follow for that project.
why_it_matters: It is how an organization's practices and guardrails travel with the code and are applied consistently by any compatible agent.
what_it_is_not: NOT a technical enforcement mechanism. It is a behavioral guide that relies on the agent honoring it; the actual enforcement comes from branch protection, CI checks, sandbox limits, and human review — AGENTS.md sets expectations, those controls hold the line.
where_it_fits: Read automatically by the harness at the start of work; a tool-agnostic convention supported by many agents.
controls: Encodes the priority order (safety > correctness > compliance > simplicity > performance), the approval expectations, and the discouraged actions — but because it is guidance rather than a hard boundary, it must be backed by the technical controls to be effective.
example: The playbook's universal AGENTS.md sets the behavioral expectations an agent should follow; the technical controls (branch protection, CI, the sandbox) are what actually enforce them.
source: Playbook docs/GETTING-STARTED.md ("AGENTS.md is a behavioral guide, not enforcement").
```

```yaml
concept: Agent Skill
plain_language: A reusable, packaged instruction set that teaches an agent how to perform a specific procedure well.
why_it_matters: It lets an organization encode a good practice once and have any compatible agent apply it consistently — reusable organizational knowledge.
what_it_is_not: Not a policy and not code that runs on its own; a skill is guidance an agent loads when the task matches, still under human review.
where_it_fits: Loaded by the harness when a task matches the skill's triggers; composed by workflows.
controls: Skills in this repository are CC0 reference material; security-relevant skills carry governance fields and require human review of their output.
example: This "technical-concept-translator" skill is an Agent Skill.
source: Playbook README ("skills convert best practices into workflows any agent can follow"); patterns repo AGENTS.md.
```

```yaml
concept: MCP / tool integration
plain_language: A standard way to give an agent access to an external tool or data source.
why_it_matters: It is how an agent's reach is extended — and therefore a place where access must be scoped deliberately.
what_it_is_not: Not unrestricted access; each tool connection should be governed by the same least-privilege and approval rules as any other capability.
where_it_fits: Configured in the harness; each integration is a capability the agent can use.
controls: Subject to the capability allowlist and approval gates; new external integrations require explicit approval.
example: A tool integration that lets the agent query an issue tracker.
source: Playbook AGENTS.md (approval required for new integrations/capabilities).
```

```yaml
concept: Model / API access (USAi)
plain_language: The authenticated gateway through which the agent reaches an approved AI model.
why_it_matters: It is the approved, governed path to model capability — not an arbitrary third-party call.
what_it_is_not: Not a separate "broker" component with policy of its own in this setup; it is an authenticated endpoint the agent's harness is configured to use.
where_it_fits: The model endpoint the harness calls from inside the sandbox.
controls: Authenticated with a key that is protected via the secrets mechanism (proxied into the sandbox on both backends in the default setup); egress to the endpoint is on the allowlist.
example: The agent reaches models through the USAi OpenAI-compatible endpoint configured by the usai-provider kit.
source: Quickstart docs/adr/0001; README (usai-provider kit).
```
