---
id: plain-language-review
version: "1.0.0"
title: "Federal Plain Language Review"
type: skill
description: "Review content for federal plain language compliance following PlainLanguage.gov guidelines"

status: experimental
owners:
  - "@community"

primary_personas:
  - developers
  - content-designers
  - technical-writers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Issues Found"
      - "Recommended Edits"
      - "Plain Language Score"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Absolute compliance certifications"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "plain language"
  - "simplify"
  - "readability"
  - "review content"
  - "improve clarity"

tags:
  - "frontend"
  - "content"
  - "plain-language"
  - "documentation"
  - "usability"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Review user-facing content for clarity"
    - "Identify jargon and complex language"
    - "Suggest plain language alternatives"
    - "Improve readability for federal digital services"
  exclusions:
    - "Not for legal or regulatory text requiring specific wording"
    - "Does not replace professional content design"
    - "Not a replacement for user research"
    - "Does not validate technical accuracy"
---

# Skill: Federal Plain Language Review

Review content for compliance with federal plain language guidelines. Identifies complex language, jargon, and readability issues. Provides specific recommendations to improve clarity for general audiences.

## When to Use

- Reviewing page content before publication
- Simplifying technical documentation for public audiences
- Improving readability of instructions or forms
- User asks "make this clearer" or "simplify this text"
- Before user testing with non-expert audiences

## Prerequisites

- Text content to review (HTML, Markdown, or plain text)
- Understanding of the target audience
- Context about required technical terms or legal language

## Procedure

### Step 1: Identify Target Audience

Clarify who will read this content:

- [ ] General public (8th grade reading level)
- [ ] Subject matter experts (higher technical vocabulary acceptable)
- [ ] Specific demographic (age, language proficiency)

### Step 2: Run Readability Analysis

Check readability metrics:

- **Flesch-Kincaid Grade Level** — Target: 8th grade or below for general public
- **Sentence length** — Target: 15-20 words average
- **Paragraph length** — Target: 3-5 sentences
- **Passive voice frequency** — Target: <10% of sentences

### Step 3: Check for Common Issues

Scan for plain language violations:

#### Jargon and Complex Terms

- [ ] Government acronyms without definitions
- [ ] Technical terms without explanations
- [ ] Legal language that could be simplified
- [ ] Industry-specific terminology

#### Sentence Structure

- [ ] Long sentences (>25 words)
- [ ] Passive voice ("The form must be submitted" → "Submit the form")
- [ ] Buried verbs ("make a determination" → "determine")
- [ ] Double negatives ("not ineligible" → "eligible")

#### Word Choice

- [ ] Formal words ("utilize" → "use")
- [ ] Redundant phrases ("in order to" → "to")
- [ ] Vague language ("various", "several", "a number of")
- [ ] Hidden verbs ("conduct an investigation" → "investigate")

#### Organization

- [ ] Logical flow (most important information first)
- [ ] Clear headings that describe section content
- [ ] Bulleted or numbered lists for related items
- [ ] Short paragraphs with one main idea each

### Step 4: Provide Specific Edits

For each issue, provide:

1. **Original text** — Problematic passage
2. **Issue** — Why it's hard to understand
3. **Suggested edit** — Plain language alternative

Example:

```markdown
**Original:** "Utilization of this application necessitates the provision of documentation."
**Issue:** Formal words, buried verbs, passive voice
**Suggested:** "To use this application, provide documentation."
```

### Step 5: Calculate Plain Language Score

Assign a simple score based on compliance:

| Score | Meaning | Characteristics |
|-------|---------|-----------------|
| **Excellent (90-100)** | Fully compliant | Grade 8 or below, minimal jargon, clear structure |
| **Good (75-89)** | Mostly compliant | Grade 9-10, some jargon with definitions |
| **Needs Improvement (60-74)** | Partially compliant | Grade 11-12, frequent jargon or passive voice |
| **Poor (<60)** | Not compliant | Above grade 12, heavy jargon, complex structure |

### Step 6: Prioritize Recommendations

Organize edits by impact:

1. **Critical** — Blocks understanding for general audiences
2. **High** — Significantly reduces clarity
3. **Medium** — Improves readability
4. **Low** — Minor stylistic improvements

### Step 7: Generate Report

Produce:

1. **Issues Found** — Categorized list with examples
2. **Recommended Edits** — Specific before/after suggestions
3. **Plain Language Score** — Overall assessment with grade level

## Verification

After review, confirm:

- [ ] Readability metrics are calculated
- [ ] Jargon is identified and defined or replaced
- [ ] Sentence length averages 15-20 words
- [ ] Passive voice is <10% of sentences
- [ ] Recommendations are specific and actionable

## Examples

### Example 1: Complex Instructions

**Input:**

> In order to determine your eligibility for benefits, it is necessary for you to provide documentation that substantiates your claim. The utilization of acceptable forms of identification is required prior to the submission of your application.

**Issues Found:**

| Issue | Priority | Description |
|-------|----------|-------------|
| Buried verbs | High | "make a determination" → "determine" |
| Passive voice | High | "it is necessary" → active voice |
| Formal words | Medium | "utilize" → "use", "substantiates" → "supports" |
| Wordy phrases | Medium | "in order to" → "to", "prior to" → "before" |

**Recommended Edits:**

```markdown
**Original:**
In order to determine your eligibility for benefits, it is necessary for you to provide documentation that substantiates your claim. The utilization of acceptable forms of identification is required prior to the submission of your application.

**Revised:**
To check if you're eligible for benefits, provide documents that support your claim. You must show acceptable ID before you submit your application.

**Changes:**
- "In order to determine" → "To check"
- "it is necessary for you to provide" → "provide" (active voice)
- "substantiates" → "support"
- "utilization of" → removed
- "prior to the submission" → "before you submit"

**Reading Level:** Grade 7 (was Grade 13)
```

**Plain Language Score:** 85/100 (Good) after edits

### Example 2: Undefined Acronym

**Input:**

> Submit your FOIA request through the online portal.

**Issues Found:**

| Issue | Priority | Description |
|-------|----------|-------------|
| Undefined acronym | Critical | General public may not know "FOIA" |

**Recommended Edits:**

```markdown
**Original:**
Submit your FOIA request through the online portal.

**Revised:**
Submit your Freedom of Information Act (FOIA) request through the online portal.

Or for the general public:
Submit your records request through the online portal. (Learn more about FOIA requests)
```

**Plain Language Score:** 95/100 (Excellent) after edits

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Use jargon without definitions | Define acronyms on first use |
| Write long sentences (30+ words) | Break into 2-3 shorter sentences |
| Use passive voice extensively | Use active voice ("Submit the form") |
| Bury verbs in nouns ("make a decision") | Use direct verbs ("decide") |
| Say "utilize" or "leverage" | Say "use" |
| Write "in order to" | Write "to" |
| Use vague terms ("various", "several") | Use specific numbers |
| Organize by department structure | Organize by user needs |

## Plain Language Checklist

Use this checklist for quick review:

- [ ] Content is organized with most important info first
- [ ] Headings are clear and descriptive
- [ ] Sentences average 15-20 words
- [ ] Active voice used (>90% of sentences)
- [ ] Technical terms are defined on first use
- [ ] Acronyms are spelled out on first use
- [ ] Lists are used for related items
- [ ] Paragraphs are short (3-5 sentences)
- [ ] Reading level is grade 8 or below
- [ ] Instructions use "you" and imperative verbs

## Human Review Gate

**Before publishing:**

A human MUST:

1. Verify technical accuracy (simplified language still correct?)
2. Check that required legal language is preserved
3. Test with representative users
4. Confirm tone matches agency voice
5. Review in context of full page or document

**This skill improves clarity; it does not validate accuracy or legal compliance.**

## Related Patterns

- [uswds-prototype](../uswds-prototype/SKILL.md) — Create pages with clear content from the start
- [accessibility-review](../accessibility-review/SKILL.md) — Plain language improves cognitive accessibility
- [uswds-form-flow](../uswds-form-flow/SKILL.md) — Clear forms use plain language

## References

- [PlainLanguage.gov](https://www.plainlanguage.gov/)
- [Federal Plain Language Guidelines](https://www.plainlanguage.gov/guidelines/)
- [18F Content Guide](https://content-guide.18f.gov/)
- [Plain Language Action and Information Network (PLAIN)](https://www.plainlanguage.gov/about/program-history/)
- [Plain Writing Act of 2010](https://www.gpo.gov/fdsys/pkg/PLAW-111publ274/pdf/PLAW-111publ274.pdf)
