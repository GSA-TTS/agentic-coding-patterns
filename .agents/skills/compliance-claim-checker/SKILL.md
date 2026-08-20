---
name: compliance-claim-checker
id: compliance-claim-checker
version: "1.0.0"
title: "Compliance Claim Checker"
type: skill
description: "Review documentation and PRs for federal compliance claims (FedRAMP, NIST, OWASP, Section 508) and flag uncited or overclaimed statements — without asserting compliance itself"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - security

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Findings"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "New Compliance Assertions"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "compliance claim"
  - "FedRAMP"
  - "NIST"
  - "Section 508"
  - "authorized"
  - "compliant"
  - "overclaim"

tags:
  - "security"
  - "compliance"
  - "documentation"
  - "citations"

categories:
  - "security"
  - "compliance"
  - "documentation"

risk_tier: low
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review docs, READMEs, and PR descriptions for compliance claims"
    - "Flag compliance statements that lack a citation to an authoritative source"
    - "Flag overclaiming (e.g. 'FedRAMP certified', 'NIST compliant') beyond what evidence supports"
    - "Point authors at the playbook's federal source registry for correct citations"
  exclusions:
    - "Does NOT determine or assert whether something is actually compliant"
    - "Not a substitute for an ATO, assessor, or authorizing official"
    - "Not legal advice; does not interpret regulation"
    - "Does not scan code for vulnerabilities (see secure-code-review)"

source_inspiration: []  # No external source; grounded in the playbook's own registry.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — flags uncited/overclaimed federal compliance statements, verifies citations against the playbook federal-ai-landscape registry, asserts no compliance itself."

collection: security
routing:
  task_types:
    - "review"
    - "analyze"
  input_artifacts:
    - "compliance-claim"
    - "documentation"
    - "pull-request-diff"
  output_artifacts:
    - "security-review"
  prefer_when:
    - "the request is to verify a stated FedRAMP/NIST/compliance claim"
  avoid_when:
    - "the request is a general code security review"
  aliases:
    - "compliance claim review"
    - "fedramp claim check"
    - "overclaim check"
---

# Skill: Compliance Claim Checker

Review documentation, READMEs, and pull-request text for **federal compliance
claims** — statements asserting alignment with FedRAMP, NIST (SP 800-53, AI RMF,
SSDF), OWASP, Section 508, or similar — and flag claims that are **uncited** or
**overclaimed**.

> **This skill checks claims; it does not certify compliance.** It never asserts
> that anything *is* compliant, authorized, or certified. Authoritative policy
> and control content live in the
> [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook);
> this skill points authors there and defers all determinations to it. It is not
> legal advice.

## When to Use

- Reviewing a README, doc, or PR that claims compliance ("FedRAMP authorized",
  "meets NIST 800-53", "508 compliant", "OWASP Top 10 covered")
- Before publishing federal-facing documentation that references standards
- When an author cites a framework and you need to confirm the citation is real,
  current, and not overstated

## When NOT to Use

- To *decide* whether a system is compliant — that is an assessor / authorizing
  official function, not this skill's
- As evidence for an ATO package
- To interpret a regulation's meaning (not legal advice)

## Prerequisites

- Access to the text being reviewed (doc, README, or PR body)
- Access to the playbook's federal source registry for citation verification:
  [`FEDERAL-AI-LANDSCAPE.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/FEDERAL-AI-LANDSCAPE.md)
  and its machine-readable source
  [`data/federal-ai-landscape.yaml`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/data/federal-ai-landscape.yaml)

## Procedure

### 1. Extract compliance claims

Scan the text for statements that assert alignment with, or authorization under,
a standard or authority. Treat these claim-signal phrases as triggers:

- Authorization/certification: "authorized", "certified", "accredited", "has an
  ATO", "FedRAMP authorized", "in the FedRAMP marketplace"
- Conformance: "compliant with", "meets", "conforms to", "aligned with",
  "satisfies", "fully implements"
- Framework names: FedRAMP, NIST SP 800-53, NIST AI RMF, NIST SSDF (800-218/218A),
  FISMA, Section 508, OWASP (LLM/Agentic/Top 10), OMB memoranda (M-YY-NN), ISO 42001

### 2. Classify each claim

For each extracted claim, classify it:

| Class | Definition |
|-------|------------|
| **Cited & scoped** | Names a specific source AND scopes the claim (e.g. "implements the AC-6 least-privilege control per NIST SP 800-53") |
| **Uncited** | Asserts alignment but names no source, control, or version |
| **Overclaimed** | Asserts more than evidence supports — e.g. "certified"/"authorized"/"fully compliant" where only *alignment with practices* is shown, or a whole-framework claim from partial coverage |
| **Stale/incorrect citation** | Cites a source that is superseded, rescinded, or misidentified |

### 3. Verify citations against the playbook registry

For every cited framework/memo, confirm against the playbook's
`federal-ai-landscape.yaml` registry that:

- The source **exists** and is identified correctly (right document number/title)
- Its **status** is current — flag citations to entries marked `rescinded`,
  `revoked`, or `superseded` (e.g. a doc citing a rescinded OMB memo as live
  guidance)
- The claim doesn't misattribute a control or requirement to the wrong source

If a cited source is **not in the registry**, do not assume it is wrong — flag it
as "unverified against the registry" and note the registry may need the entry
added (a tracker gap), rather than asserting the citation is invalid.

### 4. Distinguish "certified" from "aligned"

Apply this bright line, which is the most common overclaim:

- **"Certified" / "authorized" / "accredited" / "has an ATO"** are *status*
  claims granted by an external authority (a 3PAO, an AO, the FedRAMP PMO). A
  document MUST NOT assert these unless it cites the authorizing artifact.
- **"Aligned with" / "implements the practices of" / "designed to meet"** are
  *effort* claims and are acceptable when scoped and cited.

Recommend downgrading status claims to effort claims when no authorizing artifact
is cited.

### 5. Report — never assert compliance

Produce the output below. The report:

- **Flags** problems and **suggests** citations or rewordings
- **Never** states that the subject *is* compliant/authorized/certified
- Points the author to the playbook for authoritative policy and to the registry
  for correct citations
- When unsure whether a claim is overstated, flags it for human judgment rather
  than clearing it

## Output Contract

```markdown
## Summary
<1-3 sentences: how many claims found, how many flagged, overall risk of overclaiming.>

## Findings
For each flagged claim:
- **Claim (quoted):** "<the exact text>"
- **Location:** <file/section/line>
- **Class:** uncited | overclaimed | stale-citation | unverified-against-registry
- **Why flagged:** <one sentence>
- **Suggested fix:** <add citation to <source> | downgrade "certified" → "aligned with" | correct/refresh the citation | remove the claim>

## Notes
- Registry gaps: <any cited source not found in federal-ai-landscape.yaml that may need adding>
- This review checks claims only; it does not determine compliance. See the playbook for authoritative policy.
```

## Verification

- Every flagged claim quotes the original text and names a class and a fix
- The report makes **no** new compliance assertion of its own (check the output
  against the `New Compliance Assertions` prohibited-content rule)
- Every "verify against the registry" step names the specific registry entry
  (or explicitly notes the source is absent from the registry)

## Examples

### Example 1 — overclaim (status vs effort)

Input: `> This service is FedRAMP compliant and NIST 800-53 certified.`

Finding:
- **Class:** overclaimed
- **Why:** "FedRAMP compliant" and "800-53 certified" are authorization/status
  claims with no cited authorizing artifact (ATO letter, FedRAMP marketplace
  listing). "Certified" is not a status NIST 800-53 confers.
- **Suggested fix:** downgrade to "designed to align with NIST SP 800-53 Rev 5
  controls" and, if an ATO exists, cite it; otherwise remove the FedRAMP status
  claim.

### Example 2 — uncited claim

Input: `Our pipeline follows secure software development best practices.`

Finding:
- **Class:** uncited
- **Suggested fix:** cite the source if a specific one is meant (e.g. "follows
  NIST SP 800-218 SSDF practices") or reword to avoid implying a standard.

### Example 3 — stale citation

Input: `Per OMB M-24-10, our agency's AI governance…`

Finding:
- **Class:** stale-citation
- **Why:** the registry marks M-24-10 as rescinded/superseded; the live OMB AI
  governance memo is M-25-21.
- **Suggested fix:** cite M-25-21 as the current governance memo; reference
  M-24-10 only historically.

### Example 4 — well-formed claim (not flagged)

Input: `Access control follows the least-privilege principle described in NIST
SP 800-53 AC-6.`

Finding: none — the claim is scoped (AC-6, least privilege) and cited (SP 800-53),
and it describes an *effort/design* alignment, not a certification.

## References

- Federal source registry (citation verification):
  [`FEDERAL-AI-LANDSCAPE.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/FEDERAL-AI-LANDSCAPE.md)
- Authoritative policy (never restated here):
  [playbook `AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md),
  [`SECURITY-CONTROLS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md)
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../../docs/security-skill-governance.md)
