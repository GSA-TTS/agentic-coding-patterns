# Contribution Scope — What Belongs Where

This repo (**agentic-coding-patterns**) is one of three complementary GSA-TTS
repositories. Use this page as the single decision reference for where a
contribution belongs before you open a PR — and as a guide for maintainers
writing kind redirect replies.

## The Decision Rule (one line per repo)

| Repo | License / Tier | Decision rule |
|------|----------------|---------------|
| **agentic-coding-playbook** (upstream, canonical) | FIPS Moderate | "Do it right." — federal policy, compliance, NIST mappings, behavioral authority. |
| **agentic-coding-quickstart** (downstream, pilot) | FIPS Low | "Get running." — minimal SBX/USAi onboarding only; **high bar** for additions. |
| **agentic-coding-patterns** (this repo, community hub) | CC0-1.0 | "Share & learn." — reusable, tool-specific, community-shareable artifacts. |

## Belongs in Patterns (this repo)

Reusable, community-shareable, tool-specific artifacts that are **not** federal
policy:

- **Patterns** — reusable approaches and techniques.
- **Prompts** — standalone, portable prompt artifacts.
- **Skills** — executable, reusable procedures (`SKILL.md`).
- **Workflows** — multi-step processes.
- **Lessons-learned** — community experience writeups.
- **Agent instructions** — `AGENTS.md`-style guidance for tools.
- **Tool/editor integrations** — guides + portable configs in `integrations/`:
  an editor's task config plus its setup guide, CI snippets, automation
  recipes.

> Integrations are reusable, community-shareable, and tool-specific. They
> describe how to wire a specific editor/CI/tool — they are **not** federal
> policy and carry no compliance authority.

## Belongs in Playbook (not here)

Open it in the **playbook**, not this repo:

- Federal policy and behavioral contracts.
- Compliance and NIST control mappings.
- The canonical **AI-Assisted Contribution Policy**.
- Security-control content and authority.
- The federal-AI-landscape tracker.

→ File these at
[agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook).

## Belongs in Quickstart (not here)

Open it in the **quickstart**, not this repo:

- SBX sandbox setup.
- USAi endpoint configuration.
- Credential injection.
- First-day onboarding flows.

> Quickstart is **deliberately minimal** with a high bar for additions. An
> editor or tool integration that is **not** core first-day onboarding belongs
> HERE in patterns, not in quickstart.

→ File core onboarding at
[agentic-coding-quickstart](https://github.com/GSA-TTS/agentic-coding-quickstart).

## Redirecting a Misplaced Contribution (maintainer use)

Keep it **artifact-focused, never person-focused**. The scope boundary is a
property of the repo, not a judgment of the contributor. Always link or file
the work in the correct repo **before** closing — never orphan a contribution.

A warm 3-beat reply:

1. **Acknowledge the effort sincerely** — thank them for the specific work.
2. **State the boundary as a repo property** — "this repo scopes to X; that
   artifact lives in Y."
3. **Offer a concrete next step + help** — point to the right repo and offer to
   move it.

Template:

> Thanks for putting this together — the `<artifact>` is genuinely useful.
> This repo is scoped to reusable community patterns, and federal policy /
> onboarding setup lives in the `<playbook|quickstart>` repo instead. I've
> opened `<link to new issue/PR there>` so it lands in the right place — happy
> to help move the content over. Closing here once that's tracked.

## Authority Lives in the Playbook

The canonical **AI-Assisted Contribution Policy** and all behavioral authority
live in the **playbook**. This repo **references** them and does not restate
them — duplicated policy is how the repos drift apart. See the playbook
[`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md).
