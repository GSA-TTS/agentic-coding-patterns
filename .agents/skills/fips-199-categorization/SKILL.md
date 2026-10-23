---
id: fips-199-categorization
name: fips-199-categorization
version: "1.0.0"
title: "FIPS 199 Security Categorization Review"
type: skill
description: "Review a draft FIPS 199 categorization for traceable information types, CIA impacts, tailoring, and high-water-mark calculations without approving the categorization. Use when preparing or quality-checking a federal system categorization."
status: experimental
owners: ["@JJediny"]
primary_personas: ["developers", "security"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary", "Findings", "High-Water-Mark Check", "Unresolved Items"]
    prohibited_content: ["Secrets", "Real PII", "Real CUI", "Internal URLs", "Authorization Decisions"]
quality_gates:
  readability_max_grade: 10
  citations_required: true
triggers: ["FIPS 199", "security categorization", "CIA impact", "high-water mark", "NIST SP 800-60"]
tags: ["federal", "FIPS-199", "security-categorization", "CIA", "evidence"]
categories: ["security", "compliance", "review"]
collection: security
risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny
source_inspiration:
  - url: "https://csrc.nist.gov/pubs/fips/199/final"
    license: "public-domain"
    intake_record: "PR description"
  - url: "https://csrc.nist.gov/pubs/sp/800/60/v1/r1/final"
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
    - "Review draft FIPS 199 categorization records for evidence and calculation quality"
    - "Trace final CIA values to information types and loss scenarios"
  exclusions:
    - "Does not approve impact levels, an authorization boundary, or an ATO"
    - "Does not replace agency categorization policy or information-owner decisions"
    - "Does not process live system data or sensitive assessment evidence"
routing:
  task_types: ["review", "analyze"]
  input_artifacts: ["documentation", "compliance-claim"]
  output_artifacts: ["security-review"]
  prefer_when: ["a federal system draft needs a FIPS 199 quality review"]
  avoid_when: ["the requester needs an official system categorization decision"]
  aliases: ["CIA impact review", "categorization review"]
changelog:
  - version: "1.0.0"
    date: "2026-10-19"
    change_type: minor
    summary: "Initial experimental FIPS 199 categorization review skill."
---

# Skill: FIPS 199 Security Categorization Review

Review a draft system categorization for traceability and calculation quality.
This skill checks the evidence record; an authorized official approves the final
categorization.

## When to Use

- Reviewing a draft FIPS 199 categorization.
- Preparing an information-type inventory for categorization.
- Checking a claimed Low, Moderate, or High system impact level.

## Prerequisites

- A defined system boundary and current system description.
- Sanitized information-flow and information-type records.
- Current FIPS 199, NIST SP 800-60, and agency categorization guidance.

## Procedure

### 1. Check Scope

Confirm the record names the boundary, mission functions, information owners,
interfaces, shared services, logs, backups, exports, and material exclusions.
Flag any scope that depends only on a provider authorization or a component label.

### 2. Check Information Types

For every material function and data flow, verify a specific information type or
a documented `not applicable` disposition. Check that provisional confidentiality,
integrity, and availability values cite their source.

### 3. Check Final CIA Values

For each final value, require a loss scenario and consequence rationale:

- **Confidentiality:** unauthorized disclosure.
- **Integrity:** unauthorized modification or destruction.
- **Availability:** disruption of access or use.

Flag values inferred from a sensitivity label, an inherited control baseline, or
likelihood alone. A change from a provisional value needs documented tailoring,
evidence, and the required human approval.

### 4. Recalculate the High-Water Mark

Independently calculate each objective using:

```text
N/A < Low < Moderate < High
system objective impact = maximum final impact across applicable information types
```

Do not average, vote, or collapse confidentiality, integrity, and availability
into one calculation. Identify every information type tied for the maximum.

### 5. Report Gaps Without Approving

Separate verified facts, unsupported claims, and open decisions. Do not state
that a system is authorized, compliant, or finally categorized.

## Output Contract

```markdown
## Summary
<Scope reviewed and overall evidence completeness.>

## Findings
<Missing information types, unsupported CIA values, or unapproved tailoring.>

## High-Water-Mark Check
<Independent C/I/A maxima and their source information types.>

## Unresolved Items
<Decision owner, evidence needed, and due date.>
```

## Verification

- [ ] Every final CIA value has an applicable information type and loss scenario.
- [ ] Every tailoring decision is explicit and routed for human approval.
- [ ] Each objective's high-water mark is reproducible.
- [ ] The report contains no sensitive evidence or approval claim.

## References

- [FIPS PUB 199](https://csrc.nist.gov/pubs/fips/199/final)
- [NIST SP 800-60 Volume I](https://csrc.nist.gov/pubs/sp/800/60/v1/r1/final)
