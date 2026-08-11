---
id: federal-service-blueprint
version: "1.0.0"
title: "Federal Service Blueprint"
type: skill
description: "Plan federal digital service user flows, touchpoints, and requirements before generating code"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - designers
  - product-managers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Service Overview"
      - "User Journey"
      - "Technical Requirements"
      - "Compliance Considerations"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "frontend"
  - "compliance"
  - "documentation"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "plan service"
  - "blueprint"
  - "service design"
  - "user journey"

tags:
  - "frontend"
  - "planning"
  - "service-design"
  - "documentation"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Plan federal digital services before coding"
    - "Map user journeys and touchpoints"
    - "Identify technical and compliance requirements"
    - "Create implementation roadmap"
  exclusions:
    - "Not a replacement for full service design process"
    - "Does not replace stakeholder research"
    - "Not for detailed technical architecture"

collection: digital-service
routing:
  task_types:
    - "plan"
    - "discover"
  input_artifacts:
    - "artifact-brief"
  output_artifacts:
    - "service-blueprint"
    - "documentation"
  prefer_when:
    - "the request is to plan/map a federal service end to end"
  avoid_when:
    - "the request is to build a specific web page or form (front-end implementation)"
  aliases:
    - "service design"
    - "user journey map"
    - "blueprint plan"
---

# Skill: Federal Service Blueprint

Plan a federal digital service by mapping user journeys, identifying touchpoints, and documenting technical and compliance requirements before generating code.

## When to Use

- Starting a new federal digital service from scratch
- Planning a major redesign or feature addition
- User asks "plan a service" or "what do I need to build?"
- Before using other frontend skills (uswds-prototype, form-flow, etc.)

## Prerequisites

- Basic understanding of the service purpose
- Knowledge of target user groups
- Awareness of any regulatory or compliance requirements

## Procedure

### Step 1: Define Service Overview

Document the basics:

- [ ] **Service name** — What is this service called?
- [ ] **Purpose** — What problem does it solve?
- [ ] **Target users** — Who will use this service?
- [ ] **Primary goal** — What should users accomplish?
- [ ] **Success metrics** — How will we measure success?

### Step 2: Map User Journey

Identify the steps users take:

1. **Awareness** — How do users learn about the service?
2. **Entry** — Where do users start?
3. **Authentication** (if needed) — How do users prove identity?
4. **Core flow** — What steps do users take?
5. **Decision points** — Where do users make choices?
6. **Exit** — What happens when users complete the task?
7. **Follow-up** — What happens after completion?

Example:

```markdown
## User Journey: Benefits Application

1. **Awareness**: User learns about benefits from agency website
2. **Entry**: User clicks "Apply for Benefits" button
3. **Eligibility check**: User answers screening questions
4. **Account creation**: User creates account or signs in
5. **Application form**: User completes multi-step form
6. **Document upload**: User uploads supporting documents
7. **Review**: User reviews and confirms application
8. **Submission**: User submits application
9. **Confirmation**: User receives confirmation number and email
10. **Follow-up**: User checks status online or receives decision by mail
```

### Step 3: Identify Touchpoints

List all pages, screens, or interactions:

| Touchpoint | Type | Purpose | Priority |
|------------|------|---------|----------|
| Landing page | Informational | Explain service | High |
| Eligibility screener | Interactive | Determine eligibility | High |
| Sign-in page | Authentication | Verify identity | High |
| Application form (Step 1) | Transactional | Collect personal info | High |
| Application form (Step 2) | Transactional | Collect program info | High |
| Document upload | Transactional | Collect evidence | Medium |
| Review page | Transactional | Confirm before submit | High |
| Confirmation page | Informational | Acknowledge receipt | High |
| Status tracker | Informational | Show progress | Medium |

### Step 4: Define Technical Requirements

Document what's needed:

#### Content Requirements

- [ ] Page titles and headings
- [ ] Body content and instructions
- [ ] Form field labels
- [ ] Error messages
- [ ] Help text and tooltips
- [ ] Confirmation messages

#### Functional Requirements

- [ ] Form validation rules
- [ ] Data storage/submission
- [ ] File upload (types, size limits)
- [ ] Authentication method (Login.gov, etc.)
- [ ] Email notifications
- [ ] PDF generation (for records)

#### Accessibility Requirements

- [ ] Section 508 compliance required
- [ ] WCAG 2.1 AA conformance
- [ ] Screen reader compatibility
- [ ] Keyboard navigation
- [ ] Mobile responsive design

#### Design Requirements

- [ ] Use USWDS 3.x components
- [ ] Agency-specific branding guidelines
- [ ] Color contrast requirements
- [ ] Logo and header requirements

### Step 5: Document Compliance Considerations

Identify regulatory requirements:

#### Privacy and Security

- [ ] Privacy Act Statement required?
- [ ] System of Records Notice (SORN) exists?
- [ ] Privacy Impact Assessment (PIA) completed?
- [ ] Data encryption required (at rest and in transit)
- [ ] ATO status and requirements

#### Paperwork Reduction Act (PRA)

- [ ] Collecting information from 10+ people?
- [ ] OMB control number assigned?
- [ ] Burden estimate calculated?
- [ ] PRA notice language required on form

#### Plain Language

- [ ] Content reviewed for plain language?
- [ ] Reading level target (typically 8th grade)
- [ ] 18F Content Guide followed?

#### Accessibility

- [ ] Section 508 testing plan
- [ ] Accessibility statement page
- [ ] Alternative access method (phone, mail, in-person)

### Step 6: Create Implementation Plan

Break work into phases:

**Phase 1: Foundation**
- [ ] Landing page (informational)
- [ ] Basic page structure and navigation

**Phase 2: Core Flow**
- [ ] Authentication integration
- [ ] Multi-step form
- [ ] Form validation

**Phase 3: Supporting Features**
- [ ] Document upload
- [ ] Status tracking
- [ ] Email notifications

**Phase 4: Refinement**
- [ ] User testing and iteration
- [ ] Accessibility testing
- [ ] Plain language review
- [ ] Performance optimization

### Step 7: Generate Blueprint Document

Produce a complete planning document with:

1. **Service Overview** — Name, purpose, users, goals
2. **User Journey** — Step-by-step flow
3. **Touchpoints** — List of pages/screens
4. **Technical Requirements** — Content, functional, accessibility, design
5. **Compliance Considerations** — Privacy, PRA, accessibility
6. **Implementation Plan** — Phased approach

## Verification

After creating the blueprint, confirm:

- [ ] User journey is complete (awareness → follow-up)
- [ ] All touchpoints are identified
- [ ] Technical requirements are specific
- [ ] Compliance needs are documented
- [ ] Implementation plan is realistic
- [ ] Human review is planned

## Examples

### Example 1: Simple Informational Service

**Service:** Agency resource library

**User Journey:**
1. User searches for topic
2. User browses results
3. User reads resource
4. User downloads PDF (optional)

**Touchpoints:**
- Home page with search
- Search results page
- Resource detail page
- Download confirmation

**Technical Requirements:**
- Search functionality
- Content management system
- PDF generation
- USWDS card components

**Compliance:**
- Section 508 (accessible PDFs)
- No PII collected
- No authentication required

### Example 2: Transactional Service

**Service:** Grant application portal

**User Journey:**
1. User learns about grant opportunity
2. User checks eligibility
3. User creates account (Login.gov)
4. User completes application (multi-step)
5. User uploads supporting documents
6. User submits application
7. User receives confirmation
8. User checks status periodically

**Touchpoints:**
- Landing page
- Eligibility screener
- Login.gov integration
- Application form (5 steps)
- Document upload page
- Review and submit page
- Confirmation page
- Status dashboard

**Technical Requirements:**
- Login.gov integration
- Multi-step form with save/resume
- File upload (PDF, up to 10MB)
- Email notifications
- Backend API for submission
- Data encryption (at rest and in transit)

**Compliance:**
- PRA clearance (OMB control number)
- Privacy Act Statement
- Section 508 testing
- SORN reference
- ATO at Moderate impact level

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Start coding without planning | Create blueprint first |
| Assume you know all requirements | Document and validate assumptions |
| Skip compliance research | Identify PRA, privacy, accessibility needs early |
| Plan everything in one phase | Break into incremental phases |
| Forget about error states | Plan for errors, edge cases, and help |

## Human Review Gate

**Before implementation:**

A human MUST:

1. Validate user journey with actual users or stakeholders
2. Confirm compliance requirements with legal/privacy teams
3. Verify technical feasibility with engineers
4. Approve phasing and timeline
5. Review content for accuracy and tone

**This skill produces planning artifacts, not deployment-ready designs.**

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md) — Generate pages after planning
- [uswds-form-flow](../uswds-form-flow/SKILL.md) — Build forms identified in blueprint
- [accessibility-review](../accessibility-review/SKILL.md) — Validate accessibility after build

## References

- [Digital.gov Service Design](https://digital.gov/topics/customer-experience/)
- [18F Methods (GitHub source)](https://github.com/18F/methods)
- [USWDS Design Principles](https://designsystem.digital.gov/design-principles/)
- [U.S. Digital Service Playbook](https://playbook.cio.gov/)
- [OMB Circular A-11](https://www.whitehouse.gov/omb/information-for-agencies/circulars/) (PRA guidance)
