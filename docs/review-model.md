# Review Model

> **Purpose:** Explain review expectations and process for different pattern statuses

## Overview

This repository uses a **tiered review model** based on pattern status. Experimental patterns require minimal review, while recommended patterns undergo peer review.

**Philosophy:** Lower barriers to experimentation, higher bars for recommendations.

## Review Tiers

| Status | Review Type | Who Reviews | What's Checked |
|--------|-------------|-------------|----------------|
| **Experimental** | Self-review | Contributor | Validation passing, safety basics |
| **Recommended** | Peer review | Another contributor | Everything + usability, testing |

## Self-Review (Experimental)

### Requirements

All contributors must complete self-review before submitting experimental patterns.

### Self-Review Checklist

#### 1. Validation

- [ ] `make validate` passes without errors
- [ ] All required frontmatter fields present
- [ ] Frontmatter follows schema (use template)

#### 2. Safety

- [ ] No secrets, API keys, tokens, passwords
- [ ] No PII (names, emails, addresses)
- [ ] No CUI or classified information
- [ ] No internal URLs or hostnames
- [ ] Examples use placeholders only
- [ ] `prohibited_content` defined in frontmatter

#### 3. Quality

- [ ] Pattern has clear purpose (title + description)
- [ ] Instructions are step-by-step
- [ ] Examples are realistic
- [ ] Plain language (avoid jargon)
- [ ] Readability Grade 10 or below (estimated)

#### 4. Usability

- [ ] Pattern is reusable (not project-specific)
- [ ] Prerequisites are documented
- [ ] Expected output is clear
- [ ] Failure modes are mentioned

### How to Perform Self-Review

1. **Run validation:**

   ```bash
   make validate
   ```

   Fix any errors before proceeding.

2. **Check for sensitive content:**
   - Search for real URLs, emails, names
   - Replace with placeholders
   - Verify `prohibited_content` list is comprehensive

3. **Test the pattern:**
   - Follow your own instructions
   - Confirm steps are clear and complete
   - Add examples where helpful

4. **Read as a newcomer:**
   - Would someone unfamiliar understand this?
   - Are terms defined?
   - Are examples helpful?

## Peer Review (Recommended)

### When Required

Peer review is required for promotion from experimental to recommended status.

### Who Can Review

Any contributor can peer review, except:

- Pattern author
- Co-authors

**Best practice:** Request review from someone familiar with the pattern's domain (security, testing, documentation, etc.).

### Peer Review Checklist

Reviewers should check everything in self-review PLUS:

#### 1. Broader Applicability

- [ ] Pattern works across different projects/contexts
- [ ] Not tied to specific tools (unless explicitly tool-specific)
- [ ] No assumptions about user's environment

#### 2. Real-World Validation

- [ ] Evidence of successful use (links, comments, discussions)
- [ ] Multiple users or contexts
- [ ] Positive community feedback

#### 3. Comprehensive Documentation

- [ ] "When to Use" section clear
- [ ] "When NOT to Use" documented
- [ ] Edge cases mentioned
- [ ] Failure recovery documented

#### 4. Testing (if applicable)

- [ ] Test cases exist for complex patterns
- [ ] `tests/test-cases.yml` is valid
- [ ] Assertions are meaningful

#### 5. Alignment with Playbook

- [ ] Follows GSA/TTS coding standards (if applicable)
- [ ] References playbook for policy (doesn't duplicate)
- [ ] Security guidance is sound

#### 6. Plain Language

- [ ] Grade 10 reading level or below
- [ ] Technical terms are defined
- [ ] No unnecessary jargon
- [ ] Examples clarify complex concepts

### How to Request Peer Review

When ready to promote to recommended:

1. **Create a PR** with status change:

   ```yaml
   status: experimental → recommended
   ```

2. **In PR description, include:**
   - Link to evidence of use (discussions, blog posts, issues)
   - Number of successful uses
   - Any modifications made based on feedback
   - Why pattern should be recommended

3. **Request review** from another contributor:
   - Tag them in PR
   - Or ask in GitHub Discussions

4. **Address feedback:**
   - Reviewers may request changes
   - Iterate until concerns resolved

### How to Perform Peer Review

As a reviewer:

1. **Check the PR checklist** (should be completed)
2. **Review the pattern** against checklist above
3. **Test the pattern yourself** (if feasible)
4. **Leave feedback:**
   - Approving: "LGTM - Pattern is clear and well-documented"
   - Requesting changes: Specific, actionable feedback
   - Comments: Suggestions, questions

5. **Approve when ready:**
   - All checklist items satisfied
   - You would use this pattern yourself
   - Documentation is excellent

## Maintainer Review

### When Maintainers Review

Maintainers perform spot-checks on:

- All experimental patterns (safety check)
- All recommended pattern promotions (quality check)
- Deprecated patterns (ensure migration guidance)

### What Maintainers Check

- Repository health (no spam, no malicious content)
- Safety compliance (no secrets, no sensitive data)
- Alignment with repository mission
- License compliance (contributors have rights to content)

**Maintainers are not gatekeepers.** Their role is to ensure safety and consistency, not to judge pattern quality (community does that).

## Review Timeline Expectations

| Review Type | Expected Timeline |
|-------------|-------------------|
| Self-review | Complete before submitting PR |
| Peer review | 1-2 weeks (community-driven) |
| Maintainer check | 1-3 days |

**No SLAs.** This is a community repository. Be patient and respectful.

## What Reviewers Should NOT Do

❌ **Don't gatekeep:**

- Allow experimentation (experimental status is okay)
- Don't require perfection
- Focus on safety and clarity

❌ **Don't rewrite:**

- Suggest improvements, don't impose style
- Respect contributor voice
- Offer alternatives, don't demand them

❌ **Don't be pedantic:**

- Minor wording issues don't block approval
- Focus on substance, not style
- Use "nit:" prefix for non-blocking comments

## Handling Disagreements

### Contributor and Reviewer Disagree

1. Discuss in PR comments
2. Seek third-party opinion (tag another contributor)
3. Maintainer makes final call (rare)

### Pattern Quality Concerns After Merge

1. File an issue (not a PR)
2. Discuss improvements
3. Contributor can submit follow-up PR
4. If critical: Mark deprecated and create replacement

## Review Automation

The repository automatically checks:

- ✅ Validation passes (`make validate`)
- ✅ No sensitive terms detected
- ✅ Frontmatter schema valid
- ✅ Required files present

**Automated checks do not replace human review.** They catch mechanical issues, not usability or safety concerns.

## Questions About Review?

### "What if no one reviews my PR?"

- Post in GitHub Discussions to request review
- Tag contributors who work in related areas
- Be patient (this is volunteer-driven)

### "Can I approve my own PR?"

- No for recommended patterns
- Maintainers can approve your experimental patterns if safe

### "What if a pattern is wrong after recommended status?"

- File an issue
- Contributor can fix in follow-up PR
- If serious: Mark deprecated

### "How do I become a reviewer?"

- Anyone can review!
- Start by reviewing experimental → recommended PRs
- Provide thoughtful, constructive feedback
- Build trust with community

## Review Templates

### Self-Review Comment

```markdown
## Self-Review Checklist

- [x] `make validate` passes
- [x] No secrets or sensitive content
- [x] Placeholders used for examples
- [x] Plain language (Grade 10 or below)
- [x] Pattern is reusable
- [x] Prerequisites documented

Ready for community review.
```

### Peer Review Approval

```markdown
## Peer Review

✅ **Approved for recommended status**

- Pattern is well-documented and clear
- Evidence of successful use: [link to discussion]
- Test cases are comprehensive
- Follows playbook guidance
- Plain language throughout

Great work! This pattern will be useful for many developers.
```

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution process
- [content-lifecycle.md](content-lifecycle.md) - Status transitions
- [safety-guidance.md](safety-guidance.md) - Safety requirements
