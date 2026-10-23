---
id: federal-information-assessment
name: federal-information-assessment
version: "1.0.0"
title: "Federal Information Assessment Workflow"
type: workflow
description: "Build a sanitized evidence package for privacy, CUI, FIPS 199, and high-value-asset decisions without making an authorization or classification decision. Use when a federal system needs coordinated information-risk assessment."

status: experimental
owners:
  - "@JJediny"

primary_personas:
  - developers
  - security

requires:
  anchors: []
  skills:
    - compliance-claim-checker

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Evidence Inventory"
      - "Decision Requests"
      - "Unresolved Items"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Authorization Decisions"

quality_gates:
  readability_max_grade: 10
  citations_required: true

triggers:
  - "information assessment"
  - "privacy review"
  - "CUI review"
  - "FIPS 199"
  - "high value asset"
  - "system information inventory"

tags:
  - "federal"
  - "privacy"
  - "cui"
  - "fips-199"
  - "risk-assessment"
  - "evidence"

categories:
  - "security"
  - "compliance"
  - "review"

collection: security
risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: deny
source_inspiration: []

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Coordinate evidence collection for multiple federal information-risk reviews"
    - "Identify information types, lifecycle locations, interfaces, and decision owners"
    - "Prepare a sanitized decision package for authorized privacy, security, and information officials"
  exclusions:
    - "Does not determine CUI categories, PII status, FIPS 199 impact levels, HVA status, or ATO status"
    - "Does not replace agency-specific assessment forms, records, or approvals"
    - "Does not process live government data, sensitive evidence, or system credentials"

routing:
  task_types:
    - "orchestrate"
    - "discover"
    - "analyze"
  input_artifacts:
    - "documentation"
    - "compliance-claim"
  output_artifacts:
    - "qa-report"
    - "security-review"
  prefer_when:
    - "a federal team needs one evidence inventory to support related privacy, CUI, categorization, and criticality reviews"
  avoid_when:
    - "the task is to make a final legal, privacy, authorization, or classification decision"
  aliases:
    - "federal data assessment"
    - "system information risk review"
    - "privacy CUI FIPS review"

changelog:
  - version: "1.0.0"
    date: "2026-10-19"
    change_type: minor
    summary: "Initial experimental workflow for a sanitized federal information assessment package."
---

# Workflow: Federal Information Assessment

Use this workflow when a federal system needs a coordinated assessment of its
information practices before privacy, CUI, FIPS 199, or high-value-asset
decisions. It creates one sanitized evidence package and routes decisions to the
officials who hold authority. It does not make those decisions.

## When to Use

- A new or changed system needs several related information-risk reviews.
- A team needs to reconcile privacy, security, records, and mission evidence.
- An authorized official needs a concise package that identifies decisions and gaps.
- A system has new interfaces, data types, analytics, automation, or shared services.

## Prerequisites

- A defined system or service boundary.
- Access to approved, sanitized architecture and process documentation.
- Identified system, mission, information, privacy, security, and records owners.
- Approved storage for sensitive evidence. Do not place sensitive evidence in this
  workflow's output or in a public repository.

## Overview

```text
Scope -> inventory -> lifecycle and interfaces -> evidence reconciliation
      -> decision requests -> authorized review -> maintained record
```

## Workflow Steps

### Step 1: Define Scope and Owners

**Goal:** Establish a shared assessment boundary before collecting evidence.

**Actions:**

1. Record the system or service name, boundary, mission function, assessment date,
   and material change that triggered the review.
2. Identify accountable roles: system owner, mission owner, information owner,
   security lead, privacy lead, records lead, and interface owners.
3. List components and dependencies that process, store, transmit, administer, log,
   back up, or export information.
4. State excluded components and why they are outside the assessment boundary.

**Outputs:**

- Scope statement.
- Owner and reviewer list by role.
- Component and dependency inventory.

**Verification:**

- [ ] The boundary matches current architecture and service documentation.
- [ ] Every material interface has an accountable owner.
- [ ] Exclusions have a documented reason.

### Step 2: Build an Information Lifecycle Inventory

**Goal:** Identify what information exists and how it moves through the system.

**Actions:**

1. Create one inventory row for each information type and handling condition.
2. Record business purpose, source, collection method, users, lifecycle actions,
   storage locations, retrieval/indexing, retention, and disposal.
3. Record every interface's sender, recipient, direction, purpose, frequency, and
   data elements at the least sensitive useful level of detail.
4. Include administrative tooling, logs, backups, exports, analytics, automation,
   and non-production handling when they affect the boundary.
5. Mark uncertainty explicitly. Do not infer data types from names or labels.

**Outputs:**

- Sanitized information lifecycle inventory.
- Interface and sharing inventory.

**Verification:**

- [ ] Each information type has a business purpose and owner.
- [ ] Each interface identifies its purpose and direction.
- [ ] Logs, backups, exports, and non-production handling are accounted for.

### Step 3: Reconcile Applicable Assessment Inputs

**Goal:** Prepare evidence for authorized decisions without deciding the result.

**Actions:**

1. Identify privacy-relevant information and potential linkability; record the
   context, purpose, authority, retention, and sharing evidence.
2. Identify information that may require safeguarding or dissemination controls;
   record the candidate authority and controlling organization.
3. Map mission functions and information types to relevant authoritative sources
   used for system categorization; record provisional values separately from any
   final approved value.
4. Identify mission, critical-service, dependency, and information-concentration
   evidence that an authorized official may need for criticality screening.
5. Reconcile contradictions across inventories, diagrams, contracts, records,
   privacy artifacts, continuity plans, and system documentation.

**Outputs:**

- Evidence register with source, date, owner, confidence, and sanitized reference.
- Decision-request list with supporting evidence and known gaps.

**Verification:**

- [ ] Every candidate decision cites a source or is marked `needs-review`.
- [ ] Provisional assessments are not presented as final determinations.
- [ ] Conflicting evidence has an assigned resolver and due date.

### Step 4: Produce a Decision Package

**Goal:** Give authorized reviewers a concise, traceable package.

**Actions:**

1. Summarize the system boundary, mission, information types, interfaces, and
   material changes.
2. List decision requests separately for privacy, information safeguarding,
   security categorization, and criticality screening as applicable.
3. For each request, identify the authorized decision role, authoritative source,
   evidence references, assumptions, and unresolved items.
4. State what this package does not establish. Do not claim that the system is
   authorized, compliant, categorized, classified, or designated.

**Outputs:**

- Sanitized decision package using the output contract below.

**Verification:**

- [ ] Each request names an authorized human decision owner.
- [ ] No conclusion is presented as approved without an approval record.
- [ ] The package contains no sensitive data or internal system details.

### Step 5: Route, Record, and Reassess

**Goal:** Close the assessment loop without losing unresolved risk.

**Actions:**

1. Submit the package through the agency's approved review channels.
2. Record the decision reference, date, scope, conditions, and reassessment trigger.
3. Track unresolved items until an accountable owner resolves them.
4. Reassess after material changes to information types, interfaces, automation,
   mission functions, retention, recovery needs, or boundary.

**Verification:**

- [ ] Decision records are stored in the approved system of record.
- [ ] Outstanding items have owners and due dates.
- [ ] Reassessment triggers are documented.

## Output Contract

```markdown
## Summary
<Scope, review trigger, and assessment status.>

## Evidence Inventory
<Sanitized information types, lifecycle coverage, interfaces, sources, owners, and confidence.>

## Decision Requests
<One row per authorized privacy, safeguarding, categorization, or criticality decision needed.>

## Unresolved Items
<Evidence gaps, conflicts, accountable owner, and due date.>
```

## Common Issues

| Issue | Cause | Resolution |
| --- | --- | --- |
| A data category has no authority | A label was treated as a determination | Preserve the candidate and request information-owner or program review. |
| An interface was omitted | The inventory covered only primary application flows | Reconcile against identity, logging, backup, support, and data-sharing documentation. |
| A provider authorization is treated as a system decision | Inherited services were confused with workload impact | Analyze the system's information and mission consequences separately. |
| An assessment is declared final | Evidence collection was mistaken for approval | Route the decision to the authorized official and record the decision reference. |

## Exit Criteria

The workflow is complete when the package has a defined boundary, a sanitized
information and interface inventory, traceable evidence, explicit decision owners,
and recorded unresolved items. Final privacy, safeguarding, categorization, and
criticality outcomes remain subject to the agency's authorized process.

## References

- [FIPS PUB 199](https://csrc.nist.gov/pubs/fips/199/final)
- [NIST SP 800-60 Volume I](https://csrc.nist.gov/pubs/sp/800/60/v1/r1/final)
- [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- [OMB Circular A-130](https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf)
- [CUI Registry](https://www.archives.gov/cui/registry/category-list)
- [Agentic Coding Playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
