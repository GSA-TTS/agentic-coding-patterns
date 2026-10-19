---
id: privacy-lifecycle-inventory
name: privacy-lifecycle-inventory
version: "1.0.0"
title: "Privacy Information Lifecycle Inventory"
type: skill
description: "Review a draft privacy information inventory for linkability, purpose, interfaces, retention, access, and decision-owner gaps without determining whether a privacy assessment is required. Use when documenting a system's privacy-relevant information practices."
status: experimental
owners: ["@JJediny"]
primary_personas: ["developers", "security"]
requires:
  anchors: []
output:
  format: markdown
  contract:
    required_sections: ["Summary", "Inventory Findings", "Interface Findings", "Unresolved Items"]
    prohibited_content: ["Secrets", "Real PII", "Real CUI", "Internal URLs", "Privacy Determinations"]
quality_gates:
  readability_max_grade: 10
  citations_required: true
triggers: ["privacy inventory", "information lifecycle", "PII review", "data retention review", "privacy threshold"]
tags: ["privacy", "PII", "data-lifecycle", "retention", "evidence"]
categories: ["security", "compliance", "review"]
collection: security
risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny
source_inspiration:
  - url: "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf"
    license: "public-domain"
    intake_record: "PR description"
  - url: "https://www.archives.gov/files/cui/documents/20161214-Privacy-Act-1974.pdf"
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
    - "Review privacy-relevant information inventories and data-flow documentation"
    - "Flag missing context for potentially linkable information and system interfaces"
    - "Prepare evidence questions for privacy and information owners"
  exclusions:
    - "Does not decide whether information is PII or whether a privacy assessment is required"
    - "Does not interpret legal authority or approve collection, sharing, or retention"
    - "Does not process real personal information or system records"
routing:
  task_types: ["review", "analyze"]
  input_artifacts: ["documentation", "compliance-claim"]
  output_artifacts: ["security-review", "qa-report"]
  prefer_when: ["a system needs an evidence-focused privacy data inventory review"]
  avoid_when: ["the request asks for a final privacy or legal determination"]
  aliases: ["PII inventory review", "privacy threshold review", "data lifecycle review"]
changelog:
  - version: "1.0.0"
    date: "2026-10-19"
    change_type: minor
    summary: "Initial experimental privacy lifecycle inventory review skill."
---

# Skill: Privacy Information Lifecycle Inventory

Review a draft inventory of privacy-relevant information and its lifecycle. This
skill identifies evidence gaps for authorized privacy and information owners; it
does not make a PII, Privacy Act, or privacy-assessment determination.

## When to Use

- Preparing or reviewing a system information inventory.
- Reviewing new interfaces, analytics, automation, or retention changes.
- Checking whether a privacy review package has enough lifecycle evidence.

## Prerequisites

- A defined system boundary and current service description.
- Sanitized architecture, interface, records-retention, and business-process documentation.
- Identified privacy, information, system, records, and interface owners.

## Procedure

### 1. Check Information Context

For each information type, verify the inventory states:

- The business purpose and minimum need.
- The population or role associated with the information.
- The source and collection method.
- Whether the element can identify, distinguish, or be linked to a person in context.

Flag generic labels such as "user data" or "contact information" when the record
does not state the actual element and context. Do not label an element non-PII
solely because it is technical, business-related, or indirect.

### 2. Check the Lifecycle

Trace collection or receipt, creation, use, transformation, storage, retrieval,
sharing, retention, archival, and disposal. Include logs, backups, exports,
support tooling, analytics, automation, and non-production copies when relevant.

For each storage or processing location, require a purpose, accountable owner,
and retention/disposal evidence. Flag a retention period that has no trigger,
schedule, or disposal responsibility.

### 3. Check Interfaces and Access

For every interface or recipient, require the sender, recipient, direction,
purpose, frequency, information elements, onward-sharing condition, and owner.
Check access roles separately from data recipients. An identity service, managed
platform, or shared service may still receive privacy-relevant information.

### 4. Check Authority and Notices

Require the claimed authority, applicable notice or record reference, and any
documented choice or redress path where applicable. Flag claims that an authority,
notice, or agreement exists but provide no evidence reference. Do not interpret
the authority or decide whether it permits the practice.

### 5. Report Questions for Human Decision

Separate observed facts from assumptions. Route questions about linkability,
purpose limitation, collection, sharing, retention, or assessment requirements to
the authorized privacy and information owners.

## Output Contract

```markdown
## Summary
<Scope reviewed and lifecycle coverage.>

## Inventory Findings
<Missing purpose, context, linkability, ownership, retention, or disposal evidence.>

## Interface Findings
<Missing sender, recipient, direction, elements, access, or sharing evidence.>

## Unresolved Items
<Question, accountable owner, evidence needed, and due date.>
```

## Verification

- [ ] Each information type has context, purpose, source, lifecycle, and owner.
- [ ] Each interface has direction, purpose, elements, and an accountable owner.
- [ ] Retention and disposal have evidence and accountable ownership.
- [ ] The output contains no personal information and no final privacy conclusion.

## References

- [OMB Circular A-130](https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf)
- [Privacy Act of 1974](https://www.archives.gov/files/cui/documents/20161214-Privacy-Act-1974.pdf)
