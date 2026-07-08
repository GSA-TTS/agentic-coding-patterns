# Pull Request Template

## Summary
<!-- Brief description of what this PR does (2-3 sentences) -->

## Eligibility & Accountability
<!-- Required for all PRs. See CONTRIBUTING.md "Who Can Contribute". -->

- [ ] I am a **federal employee or contractor** (PRs merge with `@GSA-TTS/agentic-coding-team` code-owner approval; eligibility is attested here, not authenticated). *Anyone may open issues without this.*
- [ ] **I understand this change and can explain it in my own words** — I am the author of record and accountable for it.
- [ ] By opening this PR, I **attest I have the right to release this work** under the repository's [CC0-1.0](../LICENSE) dedication.

## AI Assistance Disclosure
<!-- Disclosing AI use is encouraged and never counts against your PR.
     See the canonical AI-Assisted Contribution Policy in the playbook:
     https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/AI-CONTRIBUTION-POLICY.md -->

- [ ] AI tools were used in this contribution. If checked, note which and for what:
  <!-- e.g., "OpenCode — drafted the pattern body and examples" -->
- [ ] I verified all AI-generated content: no fabricated/hallucinated APIs, dependencies, citations, or placeholder content; any AI-suggested dependency was confirmed to exist.
- [ ] Any inherited/reused third-party material retains its original license and is identified (not represented as public domain).

## Type of Change
<!-- Mark with an 'x' all that apply -->

- [ ] New skill pattern
- [ ] New prompt pattern
- [ ] New workflow pattern
- [ ] New agent instructions
- [ ] New lesson learned
- [ ] New tool/editor integration (`integrations/`)
- [ ] Documentation update
- [ ] Bug fix
- [ ] Enhancement to existing pattern
- [ ] Infrastructure/tooling change

## Pattern Information
<!-- Complete if submitting a new pattern -->

**Pattern ID:** <!-- e.g., secure-code-review -->
**Pattern Type:** <!-- skill | prompt | workflow | agent | lesson -->
**Status:** <!-- experimental | recommended | deprecated -->
**Owners:** <!-- @username or @org/team -->

## Motivation
<!-- What problem does this solve? Why is this change needed? -->

## Testing
<!-- How was this tested? -->

- [ ] Ran `make validate` locally (all checks pass)
- [ ] Ran `make test` (if applicable)
- [ ] Tested with at least one real scenario
- [ ] Examples are concrete and realistic
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) format (see [CONTRIBUTING.md](../CONTRIBUTING.md#commit-message-format))

## Safety Checklist
<!-- ALL items must be checked before submission -->

- [ ] No secrets, API keys, tokens, or passwords included
- [ ] No PII (names, emails, SSNs, addresses)
- [ ] No CUI (Controlled Unclassified Information)
- [ ] No internal URLs, hostnames, or system paths
- [ ] No customer data or proprietary information
- [ ] Pattern defines `prohibited_content` in output contract (if applicable)

## Quality Checklist
<!-- Check all that apply -->

- [ ] Frontmatter includes all required fields
- [ ] Plain language used (Grade 10 or below preferred)
- [ ] Examples included
- [ ] Prerequisites clearly stated
- [ ] Output contract defined (required_sections, prohibited_content)
- [ ] Status set to `experimental` for new patterns

## Security Skill Checklist
<!-- REQUIRED only if this PR adds or changes a security skill
     (categories: [security]). Delete this section otherwise.
     Governance: docs/security-skill-governance.md -->

- [ ] This PR adds/changes a **security skill** (`categories: [security]`).
- [ ] Governance frontmatter set deny-by-default: `risk_tier`,
      `human_review_required: true`, `allowed_tools` (minimal), `network_policy`,
      `write_policy`, `script_policy` — any grant above `deny` justified in the body.
- [ ] Fixtures for this skill pass; unsafe-shell scanner clean for any embedded shell.
- [ ] **No copied content** from public sources; if inspired by one, an
      [intake record](../templates/security-skill-intake.md) is completed and
      referenced here, and `source_inspiration` records url + license.
- [ ] `needs-human-review` label applied and human security review requested
      (security skills are never auto-/admin-merged).
- [ ] One security skill in this PR (focused review).
- [ ] If promoting `experimental → recommended`, the
      [promotion checklist](../docs/security-skill-promotion-checklist.md) is complete.

## Validation Results
<!-- Paste output of `make validate` -->

```
make validate

```

## Related Issues
<!-- Link to related issues or PRs -->

Closes #
Relates to #

## Additional Context
<!-- Any other information reviewers should know -->

## Reviewer Notes
<!-- For reviewers: checklist of what to verify -->

**Reviewers should verify:**

- [ ] Frontmatter is valid and complete
- [ ] Safety checklist items confirmed
- [ ] Pattern is clear and actionable
- [ ] Examples are realistic
- [ ] No sensitive information included
- [ ] Pattern follows repository conventions
- [ ] `make validate` passes in CI
