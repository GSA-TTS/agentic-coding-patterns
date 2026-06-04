# Frontend Skills Deterministic Tools

This directory contains portable deterministic tools for objective scoring in frontend skills. These tools complement the AI-assisted review with reproducible, automated checks.

## Tools

### readability_score.py

Minimal readability scoring tool for federal plain language compliance.

**Source:** Extracted from [cloud-gov/style-management-service](https://github.com/cloud-gov/style-management-service) (CC0 public domain)

**Dependencies:**
```bash
pip install textstat
```

**Usage:**
```bash
# Basic analysis
python3 readability_score.py content.md

# JSON output for CI integration
python3 readability_score.py --json content.md

# Custom thresholds
python3 readability_score.py --threshold 10 --min-ease 50 content.md

# From stdin
cat content.md | python3 readability_score.py -
```

**Federal Plain Language Targets:**
| Metric | Target | Source |
|--------|--------|--------|
| Flesch-Kincaid Grade | ≤8 | PlainLanguage.gov |
| Flesch Reading Ease | ≥60 | Higher = easier |
| Avg Sentence Length | ≤20 words | Plain Writing Act |
| Passive Voice | <10% | Federal style guides |

**Exit Codes:**
- `0`: Passed all thresholds
- `2`: Failed one or more thresholds

---

## Recommended External Tools

### Vale (Prose Linter)

For comprehensive plain language, accessibility, and USWDS checks, use [Vale](https://vale.sh).

**Installation:**
```bash
# macOS
brew install vale

# Linux (via package manager or binary)
# See: https://vale.sh/docs/vale-cli/installation/

# Windows
choco install vale
```

**Quick Start (using included config):**
```bash
cd .agents/skills/frontend/tools

# Download style packages (Google, proselint, write-good)
vale sync

# Run checks on frontend skills
vale ../

# Run checks on examples
vale ../../../../examples/frontend/
```

**With cloud.gov style-management-service (federal-specific rules):**
```bash
# Clone the full style pack repository
git clone https://github.com/cloud-gov/style-management-service

# Use PlainLanguage profile (18 style packs)
vale --config style-management-service/profiles/documentation.vale.ini /path/to/content

# Use USWDS profile (includes component terminology)
vale --config style-management-service/profiles/uswds.vale.ini /path/to/content

# Use Federal profile (strictest plain language rules)
vale --config style-management-service/profiles/federal.vale.ini /path/to/content
```

**Available Style Packages:**

| Package | Purpose | Source |
|---------|---------|--------|
| Google | Google developer documentation style | Vale Package Hub |
| proselint | Prose linting for jargon, cliches | Vale Package Hub |
| write-good | Passive voice, weasel words | Vale Package Hub |
| PlainLanguage | Federal plain language rules | cloud-gov/style-management-service |
| Accessibility | WCAG-related content patterns | cloud-gov/style-management-service |
| USWDS | Design system terminology | cloud-gov/style-management-service |

### axe-core (Accessibility)

For HTML accessibility testing:
```bash
npm install -g @axe-core/cli
axe output.html --exit
```

### html-validate (HTML Structure)

For semantic HTML validation:
```bash
npm install -g html-validate
html-validate output.html
```

### Lighthouse (Web Audits)

For comprehensive web quality audits:
```bash
npm install -g lighthouse
lighthouse https://example.gov --only-categories=accessibility --output=json
```

---

## Integration with Skills

Each frontend skill references these tools in its verification steps:

| Skill | Primary Tool | Alternative |
|-------|--------------|-------------|
| `plain-language-review` | `readability_score.py` | Vale PlainLanguage |
| `accessibility-review` | axe-core | Vale Accessibility |
| `uswds-prototype` | html-validate | Vale USWDS |

---

## License

Tools in this directory are released under CC0 1.0 Universal (public domain), consistent with their source (cloud-gov/style-management-service).
