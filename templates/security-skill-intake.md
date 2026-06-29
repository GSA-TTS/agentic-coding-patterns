# Public Skill Intake Checklist

Use this checklist whenever a **security skill** (or any skill) draws on a
**public source** — another skill, a blog post, a tool, or a repository — as
**inspiration**. Inspiration is allowed; **copying is not**. Complete one intake
record per public source and reference it from the skill's PR.

> See the [Security Skill Governance Standard](../docs/security-skill-governance.md)
> for how this fits the governance model, and the playbook
> [`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
> for the behavioral authority.

## Hard rule: no copying

You MUST NOT copy from the public source into this repository:

- ❌ Scripts or executable code
- ❌ Prompt bodies / system prompts
- ❌ Full skill bodies or substantial prose passages

You MAY take:

- ✅ Concepts, structure ideas, and the *categories of checks* to perform
- ✅ Publicly known facts (e.g. "OWASP A03 is injection")

When in doubt, write it yourself from understanding — do not paste.

## Intake record (copy this block into the skill PR or a tracked note)

```yaml
intake:
  skill_id: <the skill this inspires>
  source:
    name: <source name>
    url: <source url>
    license: <SPDX id or "unknown"; if license forbids reuse, note it>
    type: <skill | blog | tool | repo | docs>
  reviewed_by: <github handle>
  review_date: <YYYY-MM-DD>
  concepts_used: |
    <what ideas/structure you took — in your own words>
  content_NOT_imported: |
    <explicit confirmation of what you deliberately did NOT copy
     (scripts, prompt bodies, full skill text)>
  scripts_present_in_source: <yes | no>
  network_assumptions: |
    <does the source assume network egress, external services, telemetry?
     what did you do about it (deny-by-default here)?>
  safety_concerns: |
    <any weaponized payloads, unsafe shell, secret handling, prompt-injection
     surface in the source — and how this skill avoids reproducing them>
  license_concerns: |
    <attribution required? share-alike? any reuse restriction?>
  decision: <adopt-as-inspiration | reject | needs-more-review>
  decision_notes: |
    <why>
```

## Checklist (PR author confirms each)

- [ ] No scripts, prompt bodies, or full skill bodies were copied from the source.
- [ ] The source's license has been recorded; any reuse restriction is noted and respected.
- [ ] If the source contains scripts, they were **not** imported (and the skill's `script_policy` reflects deny / author-only).
- [ ] Network assumptions in the source were reviewed; this skill is **deny-by-default** on network unless a host is justified.
- [ ] Any safety concern in the source (weaponized payloads, unsafe shell, secret handling) is explicitly **not** reproduced here.
- [ ] The skill frontmatter records the source under `source_inspiration` (`url`, `license`, `intake_record`).
- [ ] This intake record is referenced from the skill's PR.

## References

- [Security Skill Governance Standard](../docs/security-skill-governance.md)
- [Skill schema](../schemas/skill.schema.json) (`source_inspiration` field)
- Playbook authority: [`AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
