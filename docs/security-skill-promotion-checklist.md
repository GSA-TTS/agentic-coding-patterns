# Security Skill Promotion Checklist

> **Scope:** Promoting a security skill (`categories: [security]`) from
> `experimental` → `recommended`. Governance authority lives in
> [`security-skill-governance.md`](security-skill-governance.md); this checklist
> operationalizes its gates. Referenced by the PR template.

Security skills carry `human_review_required: true`, so promotion is **never**
automatic and **never** admin-merged. A human security reviewer must confirm
every item below before the status change merges.

## Preconditions (must all be true)

- [ ] The skill has been `experimental` long enough to gather real usage/feedback.
- [ ] One skill per promotion PR (focused review — see governance "Human-review gates").
- [ ] The status change is the *only* behavioral change in the PR, or the PR is
      otherwise scoped to this skill.

## Correctness & tests

- [ ] The skill's fixtures pass (`tests/fixtures/…` for this skill) in CI.
- [ ] The unsafe-shell scanner (`scripts/scan_unsafe_shell.py`) is clean for any
      shell the skill authors or embeds.
- [ ] Examples are concrete, realistic, and reproduce the documented behavior.

## Governance frontmatter (deny-by-default)

- [ ] `risk_tier` is set to the highest plausible tier for the skill's blast radius.
- [ ] `human_review_required: true`.
- [ ] `allowed_tools` lists **only** what the skill needs (nothing speculative).
- [ ] `network_policy`, `write_policy`, `script_policy` are each at the tightest
      posture the skill can function with; any grant above `deny` is justified in
      the body.
- [ ] `categories` includes `security` (so the governance gate applies).

## Provenance & safety

- [ ] If the skill drew on any public source, a completed
      [intake record](../templates/security-skill-intake.md) is referenced from
      the PR, and `source_inspiration` records `url` + `license` per entry.
- [ ] No copied scripts, prompt bodies, or full skill bodies from public sources
      (inspiration only — see governance "Public-source inspiration").
- [ ] Output contract defines `prohibited_content` (no secrets / PII / CUI /
      internal URLs).

## Human sign-off

- [ ] A member of [`@GSA-TTS/agentic-coding-team`](https://github.com/orgs/GSA-TTS/teams/agentic-coding-team)
      has reviewed the skill as a security reviewer (not just CI).
- [ ] The PR carries the `needs-human-review` label.
- [ ] The reviewer can explain what the skill does and why the capability grants
      are appropriate.

Only when **every** box is checked may the skill's `status` change to
`recommended`.
