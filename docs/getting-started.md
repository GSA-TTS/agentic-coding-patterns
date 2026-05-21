# Getting Started

> **Quick start guide for contributors**

Welcome! This guide will help you contribute your first pattern to the agentic-coding-patterns repository.

## 5-Step Process

```
1. Choose Type → 2. Copy Template → 3. Fill Frontmatter → 4. Validate → 5. Submit PR
```

**Time to first contribution:** 15-30 minutes

---

## Step 1: Choose Content Type

Pick the type that best fits what you're contributing:

| Type | Use For | Example |
|------|---------|---------|
| **Skill** | Reusable procedures | Code review, test generation, documentation |
| **Prompt** | Standalone prompts | "Write unit tests for this function" |
| **Agent** | Agent instructions | Custom AGENTS.md patterns |
| **Workflow** | Multi-step processes | Issue → PR → Merge workflow |
| **Lesson** | Real experiences | What worked, what didn't |

**Not sure?** Start with **skill** (most flexible).

---

## Step 2: Copy Template

Templates are in the `templates/` directory:

```bash
# For a skill
cp -r templates/skill-template skills/my-pattern-name

# For a prompt
cp -r templates/prompt-template prompts/category/my-prompt

# For an agent
cp -r templates/agent-template agents/my-agent

# For a workflow
cp -r templates/workflow-template workflows/my-workflow

# For a lesson learned
cp -r templates/lesson-template lessons-learned/my-lesson
```

**Naming convention:** Use `kebab-case` (lowercase, hyphens, no spaces)

---

## Step 3: Fill Frontmatter

Open `SKILL.md` (or `AGENTS.md`) in the directory you just created.

### Minimal Frontmatter (5 minutes)

The absolute minimum to get started:

```yaml
---
id: my-pattern-name
version: "1.0.0"
title: "My Pattern Title"
type: skill
status: experimental
owners: ["@your-github-handle"]
primary_personas: ["developers"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
    prohibited_content:
      - "Secrets"
      - "PII"
      - "CUI"
      - "Internal URLs"
quality_gates:
  readability_max_grade: 10
  citations_required: false
---
```

**Key fields:**
- `id`: Never changes (kebab-case)
- `status`: Start with `experimental`
- `prohibited_content`: **Must include at minimum:** Secrets, PII, CUI, Internal URLs

### Add Content

Write your pattern below the frontmatter:

```markdown
# Skill: My Pattern Title

Brief description of what this pattern does.

## When to Use

- Scenario 1
- Scenario 2
- Scenario 3

## Prerequisites

- What's needed before using this pattern

## Procedure

1. First step
2. Second step
3. Third step

## Verification

How to confirm the pattern worked.

## Examples

### Example 1: [Description]
```

---

## Step 4: Validate

Run validation locally:

```bash
# From repository root
make validate
```

**Common validation errors and fixes:**

### Error: Missing required field
```
✗ skills/my-pattern/SKILL.md
  - Schema validation failed: 'title' is a required property
```
**Fix:** Add the missing field to frontmatter.

### Error: Invalid YAML
```
✗ skills/my-pattern/SKILL.md
  - No valid YAML frontmatter found
```
**Fix:** Check frontmatter has `---` before and after, proper indentation.

### Error: Sensitive terms detected
```
✗ skills/my-pattern/SKILL.md
  Line 42: API key detected
    api_key = "sk_live_abc123"
```
**Fix:** Replace with placeholder: `api_key = os.environ.get("API_KEY")`

---

## Step 5: Submit PR

### Create Branch
```bash
git checkout -b add-my-pattern-name
git add skills/my-pattern-name/
git commit -m "feat(skills): add my-pattern-name

Brief description of the pattern and what it solves.

Co-authored-by: [Your Name] <your.email@example.com>"
```

### Push and Create PR
```bash
git push origin add-my-pattern-name
gh pr create --title "feat(skills): add my-pattern-name" --body "$(cat <<EOF
## Summary
Add [brief description] pattern.

## Type
- [ ] Skill
- [ ] Prompt
- [ ] Agent
- [ ] Workflow
- [ ] Lesson Learned

## Checklist
- [ ] \`make validate\` passes
- [ ] No secrets or sensitive content
- [ ] Examples use placeholders
- [ ] Plain language (Grade 10 or below)
- [ ] \`status: experimental\`
- [ ] Self-reviewed

## Questions?
[Any questions or areas where you'd like feedback]
EOF
)"
```

### Wait for Review
- Maintainers will perform safety check
- Community may provide feedback
- Address any comments
- PR will be merged when ready

---

## Common Gotchas

### 1. Frontmatter Indentation
**Wrong:**
```yaml
requires:
anchors: []
```

**Right:**
```yaml
requires:
  anchors: []
```

YAML requires 2-space indentation for nested fields.

### 2. Forgetting `prohibited_content`
Every pattern **must** define what content is forbidden in output.

**Minimum:**
```yaml
prohibited_content:
  - "Secrets"
  - "PII"
  - "CUI"
  - "Internal URLs"
```

### 3. Using Real Data in Examples
**Wrong:**
```python
email = "john.smith@agency.gov"
```

**Right:**
```python
email = "user@example.com"
```

Always use placeholders.

### 4. Not Running Validation
```bash
# Always run before committing
make validate
```

Don't skip this! CI will fail if validation doesn't pass.

### 5. Status Too High
Start with `experimental`. Don't go straight to `recommended`.

---

## Where to Get Help

### Documentation
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Full contribution guide
- [safety-guidance.md](safety-guidance.md) - Safety requirements
- [content-lifecycle.md](content-lifecycle.md) - Status lifecycle

### Community
- **GitHub Discussions:** Ask questions, share experiences
- **Issues:** Report problems or suggest improvements
- **PR Comments:** Request feedback on your contribution

### Examples
Look at existing patterns:
- `skills/secure-code-review/` - Well-documented skill
- `prompts/planning/implementation-plan/` - Clear prompt
- `lessons-learned/example-agentic-session/` - Lesson format

---

## After Your First Contribution

### What's Next?
1. **Watch for feedback** on your PR
2. **Address comments** if reviewers suggest changes
3. **Celebrate!** You've contributed to open source
4. **Consider reviewing** other contributions

### Contributing Again?
- You now know the process!
- Try a different content type
- Improve an existing pattern
- Help review others' PRs

### Promoting to Recommended
After your pattern is used successfully:
1. Gather evidence (links, discussions, feedback)
2. Add test cases (if applicable)
3. Submit PR to change status to `recommended`
4. Request peer review

See [content-lifecycle.md](content-lifecycle.md) for details.

---

## Troubleshooting

### Validation Fails with "Command not found"
**Fix:** Run `make setup` to install dependencies.

### Git Pre-Commit Hooks Fail
**Fix:**
```bash
# Bypass hooks if stuck
git commit --no-verify

# Or fix the issue and commit normally
make validate
git add -A
git commit
```

### Can't Push to Repository
**Fix:** You don't have direct push access. Use PR workflow (above).

### Pattern Not Showing in INDEX.yaml
**Fix:** Run `make generate` to regenerate INDEX.yaml (automated in CI).

---

## Quick Reference Card

```bash
# Setup (first time)
make setup

# Create pattern from template
cp -r templates/skill-template skills/my-pattern

# Edit frontmatter and content
vim skills/my-pattern/SKILL.md

# Validate
make validate

# Commit and push
git checkout -b add-my-pattern
git add skills/my-pattern/
git commit -m "feat(skills): add my-pattern"
git push origin add-my-pattern

# Create PR
gh pr create
```

---

## Success Criteria

You're ready to contribute when you can:
- [ ] Choose the right content type
- [ ] Copy and customize a template
- [ ] Fill required frontmatter fields
- [ ] Run validation successfully
- [ ] Create a PR with checklist

**Time to confidence:** 1-2 contributions

---

## Feedback on This Guide

Is something unclear? File an issue or PR to improve this guide!

**Remember:** Everyone's first contribution is scary. You've got this! 🚀
