---
title: "Add an integrations/ area for tool/editor guides and portable configs"
status: "accepted — implementation pending first integration"
date: "2026-06-30"
decision_makers: ["William Zujkowski", "OpenCode Agent"]
category: "repository-structure"
impact_level: "low"
---

# ADR 0001 — Add an `integrations/` area for tool/editor guides and portable configs

## Context and Problem Statement

The patterns repository hosts reusable agentic-coding artifacts under
`patterns/`, `prompts/`, `skills/` (→ `.agents/skills/`), `workflows/`,
`lessons-learned/`, and `agents/`. None of these is a natural home for
**tool/editor integration material** — for example, an editor's task-runner
config plus its setup guide, CI snippets, or automation recipes for wiring a
specific tool into an agentic workflow.

This gap surfaced concretely: editor-integration content (e.g. a Zed editor
setup guide and its `tasks.json`) was placed in the **quickstart** repo, which is
deliberately minimal and scoped to first-day SBX/USAi onboarding. Editor/tool
integrations that are not core onboarding do not belong there; they are reusable,
community-shareable, and tool-specific — exactly the patterns-hub mission — but
they are not a "skill" (an executable agent procedure) or a "pattern/prompt."

## Decision Drivers

- The three-repo split assigns **reusable, tool-specific, non-policy** artifacts
  to this community hub (see `docs/contribution-scope.md`).
- Quickstart is intentionally minimal with a high bar; pushing editor configs
  there violates its scope.
- Integration material has a recurring shape (a portable config file + a setup
  guide) that none of the existing content types fits cleanly.
- The `.agents/skills/` standard is for executable skills, not editor/CI configs.

## Considered Options

1. **Add a top-level `integrations/` area** with per-tool subfolders.
2. Force integrations into `skills/` — misuses the skill contract (executable
   procedures), pollutes the skills taxonomy.
3. Force integrations into `examples/` — examples are illustrative, not
   maintained portable configs meant to be copied into a user's repo.
4. Leave them in quickstart — violates quickstart's minimal onboarding scope.

## Decision

Adopt **Option 1**: add a top-level `integrations/` area for tool/editor guides
and portable configs.

Structure:

```text
integrations/
├── README.md              # what belongs here + index of integrations
└── editors/
    └── <editor>/          # e.g. zed/
        ├── README.md       # setup guide (generic, copy-into-your-repo)
        └── <config files>  # portable config (e.g. tasks.json)
```

Conventions:

- Group by integration class first (`editors/`, and later `ci/`, `automation/`,
  etc.), then by tool.
- Each integration carries a `README.md` setup guide plus the portable config
  file(s) a user copies into their own project.
- Integrations are **reusable, tool-specific, and carry no compliance
  authority** — they are not federal policy. Policy/behavioral authority stays
  in the playbook and is referenced, not restated.
- Prohibited-content rules (no secrets/PII/CUI/internal URLs) apply as they do
  to all repository content.

## Consequences

**Positive:**

- Gives editor/tool integration material a correct, discoverable home.
- Keeps quickstart minimal and the skills taxonomy clean.
- Establishes a place to relocate the existing Zed content out of quickstart
  (tracked separately).

**Negative / trade-offs:**

- One more top-level area to document and index. Mitigated by a clear
  `integrations/README.md` and the `docs/contribution-scope.md` decision rules.

**Neutral:**

- Indexing/validation of `integrations/` content can be folded into existing
  tooling incrementally; initial entries are plain Markdown + config files.
