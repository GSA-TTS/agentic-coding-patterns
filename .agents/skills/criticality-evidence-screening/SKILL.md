---
id: criticality-evidence-screening
name: criticality-evidence-screening
version: "1.0.0"
title: "System Criticality Evidence Screening"
type: skill
description: "Review evidence for a system criticality or high-value-asset screening package by tracing mission consequences, dependencies, information concentration, and uncertainty without designating an asset. Use when an authorized program needs a preliminary criticality evidence review."
status: experimental
owners: ["@JJediny"]
primary_personas: ["developers", "security"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary", "Evidence Findings", "Dependency Findings", "Unresolved Items"]
    prohibited_content: ["Secrets", "Real PII", "Real CUI", "Internal URLs", "Asset Designations"]
quality_gates:
  readability_max_grade: 10
  citations_required: true
triggers: ["criticality screening", "high value asset", "HVA screening", "mission impact", "critical service"]
tags: ["criticality", "mission-impact", "dependencies", "HVA", "evidence"]
categories: ["security", "compliance", "review"]
collection: security
risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny
source_inspiration:
  - url: "https://www.whitehouse.gov/wp-content/uploads/2018/12/M-19-03.pdf"
    license: "public-domain"
    intake_record: "PR description"
portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
scope:
  intended_use:
    - "Review evidence gathered for an authorized criticality or HVA screening process"
    - "Identify gaps in mission-consequence, dependency, and information-concentration evidence"
  exclusions:
    - "Does not designate, de-designate, or report a high-value asset"
    - "Does not set FIPS impact levels or determine CUI/PII status"
    - "Does not replace agency-specific HVA policy, inventory, or CIO decisions"
routing:
  task_types: ["review", "analyze"]
  input_artifacts: ["documentation", "compliance-claim"]
  output_artifacts: ["security-review", "qa-report"]
  prefer_when: ["a system needs evidence-quality review before an authorized criticality screening"]
  avoid_when: ["the requester needs a final HVA or other asset designation"]
  aliases: ["HVA evidence review", "mission criticality review", "asset criticality screening"]
changelog:
  - version: "1.0.0"
    date: "2026-10-19"
    change_type: minor
    summary: "Initial experimental criticality evidence screening skill."
---

# Skill: System Criticality Evidence Screening

Review a preliminary system criticality evidence package. This skill identifies
unsupported assertions and unresolved questions for authorized officials; it does
not make or report a high-value-asset or other asset-designation decision.

## When to Use

- Preparing a preliminary criticality screening package.
- Reviewing mission-impact and dependency evidence after a major system change.
- Checking whether an escalation package distinguishes facts from assumptions.

## Prerequisites

- A defined system or asset scope and accountable mission owner.
- Sanitized service, continuity, dependency, and information-inventory documentation.
- Current agency policy for criticality screening and escalation.

## Procedure

### 1. Check Scope and Mission Evidence

Require a clear assessment unit: whole system, service, component, or information
asset. Verify the package identifies the mission function, users or beneficiaries,
service expectations, outage tolerance, manual fallback, and accountable owner.

Flag a conclusion based on system visibility, budget, user count, or public-facing
status alone. A high FIPS impact, sensitive information, or internet exposure can
be evidence, but none automatically establishes asset criticality.

### 2. Check Consequence Scenarios

For confidentiality, integrity, and availability loss, require a plausible
scenario and consequences for mission delivery, affected population, legal or
financial obligation, public confidence, recovery duration, and downstream work.
Separate measured impact from estimates and assumptions.

### 3. Check Dependencies and Cascade Paths

Review upstream and downstream services, identity, hosting, data, network, backup,
and manual dependencies. For every claimed cascade, require an explanation of the
dependency relationship, affected consumer, fallback, and evidence owner.

Do not infer criticality from the number of interfaces alone. A shared provider's
authorization or resilience claim does not prove the assessed workload's impact.

### 4. Check Information and Privilege Concentration

Review evidence about authoritative records, aggregation, privileged functions,
high-trust interfaces, and broad user or organizational effects. Record the
information owner and why compromise or loss would change mission consequences.

Do not treat the presence of PII, CUI, or a high-impact system label as a final
criticality result. Route classification and categorization questions to their
separate authorized processes.

### 5. Report Evidence Gaps

Separate `supported`, `unsupported`, and `unknown` assertions. Name the decision
owner for each unanswered question. Do not label an asset likely or unlikely to
receive a designation when material evidence is missing or conflicting.

## Output Contract

```markdown
## Summary
<Scope reviewed and evidence completeness.>

## Evidence Findings
<Mission and consequence claims that are supported, unsupported, or unknown.>

## Dependency Findings
<Missing cascade, consumer, fallback, or ownership evidence.>

## Unresolved Items
<Question, accountable owner, evidence needed, and due date.>
```

## Verification

- [ ] The assessment unit and mission owner are explicit.
- [ ] Each material consequence claim has evidence or is marked unknown.
- [ ] Each dependency claim identifies a consumer, fallback, and evidence owner.
- [ ] The report makes no designation or final categorization claim.

## References

- [OMB M-19-03](https://www.whitehouse.gov/wp-content/uploads/2018/12/M-19-03.pdf)
- [Agentic Coding Playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
