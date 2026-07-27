# Pattern Catalog

> **Generated file — do not edit by hand.** Run `make generate` (regenerates INDEX.yaml + CATALOG.md). Source of truth is each pattern's `SKILL.md`/`AGENTS.md` frontmatter.

31 patterns — 21 skills, 3 prompts, 3 agents, 3 workflows, 1 lessons.

For machine routing use the [`pattern-router`](.agents/skills/meta/pattern-router/SKILL.md) skill + `scripts/route_patterns.py`; this catalog is the human view.

## Meta

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`example-agentic-session`](lessons-learned/example-agentic-session/SKILL.md) | lesson | experimental | analyze | documentation | documentation |
| [`pattern-router`](skills/meta/pattern-router/SKILL.md) | skill | experimental | discover, orchestrate | — | — |

## Engineering

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`general-agent`](agents/general/AGENTS.md) | agent | experimental | author, plan | source-code | source-code |
| [`implementation-plan`](prompts/planning/implementation-plan/SKILL.md) | prompt | experimental | plan | artifact-brief | documentation |
| [`issue-to-merge-request`](workflows/issue-to-merge-request/SKILL.md) | workflow | experimental | author, orchestrate, test | artifact-brief | pull-request-diff, source-code |
| [`over-engineering-review`](skills/over-engineering-review/SKILL.md) | skill | experimental | analyze, review | pull-request-diff, source-code | qa-report |
| [`qa-round`](prompts/review/qa-round/SKILL.md) | prompt | experimental | review, test | pull-request-diff, source-code | qa-report |
| [`qa-workflow`](workflows/qa-round/SKILL.md) | workflow | experimental | orchestrate, review, test | source-code | qa-report |
| [`safe-shell-script-author`](skills/safe-shell-script-author/SKILL.md) | skill | experimental | author | artifact-brief | shell-script |
| [`test-generation`](skills/test-generation/SKILL.md) | skill | experimental | author, test | source-code | qa-report, source-code |

## Security

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`agentic-actions-auditor`](skills/agentic-actions-auditor/SKILL.md) | skill | experimental | analyze, review | ci-workflow, source-code | security-review |
| [`backdoor-review`](skills/backdoor-review/SKILL.md) | skill | experimental | analyze, review | ci-workflow, pull-request-diff, source-code | security-review |
| [`compliance-claim-checker`](skills/compliance-claim-checker/SKILL.md) | skill | experimental | analyze, review | compliance-claim, documentation, pull-request-diff | security-review |
| [`dependency-analysis`](skills/dependency-analysis/SKILL.md) | skill | experimental | analyze, review | dependency-manifest, source-code | security-review |
| [`incident-evidence-review`](skills/incident-evidence-review/SKILL.md) | skill | experimental | analyze, review | documentation, incident-evidence | security-review |
| [`least-privilege-review`](skills/least-privilege-review/SKILL.md) | skill | experimental | analyze, review | ci-workflow, infrastructure-as-code, source-code | security-review |
| [`safe-code-review`](prompts/security/safe-code-review/SKILL.md) | prompt | deprecated | analyze, review | pull-request-diff, source-code | security-review |
| [`secure-code-review`](skills/secure-code-review/SKILL.md) | skill | experimental | analyze, review | pull-request-diff, source-code | security-review |
| [`security-review-agent`](agents/security-review/AGENTS.md) | agent | experimental | analyze, review | pull-request-diff, source-code | security-review |
| [`security-scan-review`](workflows/security-scan-review/SKILL.md) | workflow | experimental | analyze, orchestrate, review | dependency-manifest, source-code | security-review |
| [`untrusted-input-boundary-review`](skills/untrusted-input-boundary-review/SKILL.md) | skill | experimental | analyze, review | source-code | security-review |

## Content

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`documentation-agent`](agents/documentation/AGENTS.md) | agent | experimental | author, review | documentation | documentation |
| [`documentation-review`](skills/documentation-review/SKILL.md) | skill | experimental | analyze, review | documentation | qa-report |
| [`plain-language-review`](skills/frontend/plain-language-review/SKILL.md) | skill | experimental | analyze, review | documentation, web-page | qa-report |

## Digital Service

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`accessibility-review`](skills/frontend/accessibility-review/SKILL.md) | skill | experimental | analyze, review | source-code, web-page, web-prototype | qa-report |
| [`federal-service-blueprint`](skills/frontend/federal-service-blueprint/SKILL.md) | skill | experimental | discover, plan | artifact-brief | documentation, service-blueprint |
| [`uswds-form-flow`](skills/frontend/uswds-form-flow/SKILL.md) | skill | experimental | author, render | artifact-brief | form, source-code |
| [`uswds-landing-page`](skills/frontend/uswds-landing-page/SKILL.md) | skill | experimental | author, render | artifact-brief | landing-page, source-code |
| [`uswds-prototype`](skills/frontend/uswds-prototype/SKILL.md) | skill | experimental | author, render | artifact-brief | source-code, web-prototype |

## Communications

| Pattern | Type | Status | Tasks | Consumes | Produces |
|---------|------|--------|-------|----------|----------|
| [`explainer-gif`](skills/outreach/explainer-gif/SKILL.md) | skill | experimental | author, render | artifact-brief, shell-script | explainer-gif, terminal-demo |
| [`explainer-video`](skills/outreach/explainer-video/SKILL.md) | skill | experimental | author, render | artifact-brief, web-page | explainer-video, marketing-asset |
