# Pull Request Template

## Summary
<!-- Brief description of what this PR does (2-3 sentences) -->


## Type of Change
<!-- Mark with an 'x' all that apply -->

- [ ] New skill pattern
- [ ] New prompt pattern
- [ ] New workflow pattern
- [ ] New agent instructions
- [ ] New lesson learned
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

## Validation Results
<!-- Paste output of `make validate` -->

```
$ make validate

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
