# Content Lifecycle

> **Purpose:** Explain pattern status transitions and promotion criteria

## Overview

Patterns in this repository follow a clear lifecycle from experimental contribution to proven recommended pattern, with eventual deprecation when superseded.

```
experimental → recommended → deprecated
```

**Philosophy:** Start fast, prove value, retire gracefully.

## Status Definitions

### Experimental
**What it means:** New pattern, unproven in production, community testing encouraged.

**Requirements:**
- Valid frontmatter (all required fields)
- Passes validation (`make validate`)
- Self-review completed
- No sensitive content

**Duration:** Indefinite. Patterns can remain experimental forever.

**Use at your own risk:** Experimental patterns may have rough edges, incomplete documentation, or untested edge cases.

### Recommended
**What it means:** Pattern proven valuable through real-world use and community feedback.

**Promotion criteria:**
- Used successfully by multiple practitioners
- Positive community feedback
- No major issues reported
- Well-documented with examples
- Test cases exist (for complex patterns)
- Peer review completed

**Duration:** Until superseded by better pattern or no longer relevant.

**Trust signal:** Recommended patterns are production-ready and widely applicable.

### Deprecated
**What it means:** Pattern superseded by better approach or no longer relevant.

**Requirements:**
- Must include `deprecated_reason` in frontmatter
- Must include `replaced_by` (if superseded)
- Original content preserved (for reference)
- Clear migration guidance

**Duration:** Permanent. Deprecated patterns are never deleted, only marked.

**Purpose:** Historical record and migration path for users.

## Promotion Process

### Experimental → Recommended

#### Step 1: Community Usage
Pattern must demonstrate real-world value:
- **Minimum:** 2-3 successful uses reported
- **Evidence:** GitHub discussions, issue comments, external blog posts
- **Diversity:** Multiple users, different contexts

#### Step 2: Quality Review
Pattern maintainers check:
- Documentation complete and clear
- Examples are realistic and safe
- Edge cases documented
- Prohibited content properly defined
- Test cases exist (when applicable)

#### Step 3: Peer Review
Another contributor reviews:
- Reusability across contexts
- Alignment with playbook guidance
- Safety and security considerations
- Plain language (Grade 10 or below)

#### Step 4: Promotion PR
Contributor or maintainer creates PR:
```yaml
# Change frontmatter
status: experimental → recommended
changelog:
  - version: "1.1.0"
    date: "2026-05-XX"
    changes:
      - "Promoted to recommended status after successful use in 3 projects"
      - "Added additional examples based on community feedback"
```

### Recommended → Deprecated

#### Triggers for Deprecation:
- Better pattern available (superseded)
- Tool/technology no longer relevant
- Security concerns discovered
- Federal guidance changed

#### Deprecation Process:

1. **Create replacement pattern** (if applicable)
2. **File deprecation issue** with:
   - Reason for deprecation
   - Link to replacement (if any)
   - Migration guidance
   - Timeline for marking deprecated

3. **Update pattern frontmatter:**
```yaml
status: deprecated
deprecated_reason: "Superseded by secure-code-review-v2 which includes OWASP Top 10 2023"
replaced_by: "secure-code-review-v2"
deprecated_date: "2026-05-15"
```

4. **Add migration guide** to pattern:
```markdown
## ⚠️ DEPRECATED

This pattern is deprecated as of 2026-05-15.

**Reason:** Superseded by [secure-code-review-v2](../secure-code-review-v2/SKILL.md)
which includes updated OWASP Top 10 2023 guidance.

**Migration:** See [migration guide](./MIGRATION.md) for upgrade steps.
```

## Community Feedback Mechanism

### How to Report Pattern Experience

#### Positive Experience
Create a GitHub Discussion:
- **Category:** Show and Tell
- **Title:** "Success with [pattern-name]"
- **Content:** What you built, what worked well, any modifications

#### Issues or Improvements
Create a GitHub Issue:
- **Label:** enhancement
- **Title:** "[pattern-name] could be improved by..."
- **Content:** What didn't work, suggestions, examples

#### Security Concerns
See [SECURITY.md](../.github/SECURITY.md) for responsible disclosure.

## Pattern Versioning

Patterns follow semantic versioning:

```
MAJOR.MINOR.PATCH
1.0.0
```

### When to Increment

| Change | Version | Example |
|--------|---------|---------|
| Breaking change | MAJOR | Change required input format |
| New feature | MINOR | Add optional parameter |
| Bug fix | PATCH | Fix typo, clarify wording |
| Status change | MINOR | experimental → recommended |

### Version in Frontmatter
```yaml
version: "1.2.0"
changelog:
  - version: "1.2.0"
    date: "2026-05-21"
    changes:
      - "Added JSON output mode"
      - "Improved error handling examples"
  - version: "1.1.0"
    date: "2026-04-15"
    changes:
      - "Promoted to recommended status"
  - version: "1.0.0"
    date: "2026-03-01"
    changes:
      - "Initial experimental release"
```

## Status Distribution Goals

**Healthy repository balance:**
- **60-70% Experimental:** Active innovation, low barrier to entry
- **20-30% Recommended:** Proven patterns, production-ready
- **5-10% Deprecated:** Historical record, migration paths

If too many recommended: Barriers may be too high.
If too few: Community trust may be low.

## Automatic Status Checks

The repository tracks:
- Age of experimental patterns (flag after 6 months)
- Recommended patterns with reported issues (flag for review)
- Deprecated patterns still referenced (help users migrate)

## Questions About Status?

### "How long should I stay experimental?"
As long as needed. Many patterns remain experimental indefinitely and that's fine.

### "Can I skip experimental and go straight to recommended?"
No. All patterns start experimental. Community validation is required for recommended status.

### "What if no one uses my pattern?"
That's okay! Experimental status means it's available if someone needs it. No pressure to promote.

### "Can deprecated patterns be un-deprecated?"
Rarely. If context changes significantly (new tool version, updated guidance), file an issue to discuss.

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md) - How to contribute patterns
- [review-model.md](review-model.md) - Review expectations
- [design-notes.md](design-notes.md) - Why we chose this lifecycle model
