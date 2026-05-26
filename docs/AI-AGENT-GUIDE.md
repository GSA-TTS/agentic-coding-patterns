# AI Agent Integration Guide

> **Audience:** AI agents, tool developers, automation engineers
> **Purpose:** Programmatic pattern discovery and integration
> **Status:** Living document

## Overview

This guide explains how AI agents and automated systems can discover, evaluate, and integrate patterns from this repository.

## Quick Start for AI Agents

### 1. Parse INDEX.yaml

The repository catalog is machine-readable:

```python
import yaml
from pathlib import Path

# Load pattern index
with open('INDEX.yaml') as f:
    index = yaml.safe_load(f)

# Access patterns by type
skills = index['patterns']['skills']
prompts = index['patterns']['prompts']
agents = index['patterns']['agents']
workflows = index['patterns']['workflows']
lessons = index['patterns']['lessons']

print(f"Total patterns: {index['stats']['total_patterns']}")
```

### 2. Filter Patterns

Filter by status, type, and metadata:

```python
# Find recommended patterns only
recommended = [
    p for p in skills
    if p.get('status') == 'recommended'
]

# Find security-related patterns (requires reading frontmatter)
def has_tag(pattern_path, tag):
    with open(pattern_path) as f:
        content = f.read()
        # Extract and parse frontmatter
        if content.startswith('---\n'):
            parts = content.split('---\n', 2)
            if len(parts) >= 3:
                fm = yaml.safe_load(parts[1])
                return tag in fm.get('tags', [])
    return False

security_patterns = [
    p for p in skills
    if has_tag(p['path'], 'security')
]
```

### 3. Read Pattern Frontmatter

Every pattern has structured frontmatter:

```python
def parse_pattern(path):
    """Extract frontmatter and content from a pattern file."""
    with open(path) as f:
        content = f.read()

    if not content.startswith('---\n'):
        return None, content

    parts = content.split('---\n', 2)
    if len(parts) < 3:
        return None, content

    frontmatter = yaml.safe_load(parts[1])
    body = parts[2]

    return frontmatter, body

# Example usage
fm, body = parse_pattern('skills/secure-code-review/SKILL.md')

print(f"Pattern: {fm['title']}")
print(f"Status: {fm['status']}")
print(f"Tags: {fm.get('tags', [])}")
print(f"Portability: {fm.get('portability', {})}")
```

### 4. Check Portability

Determine if a pattern works with your tool:

```python
def is_compatible(frontmatter, tool_name):
    """Check if pattern is compatible with a tool."""
    portability = frontmatter.get('portability', {})
    return portability.get(tool_name, False)

# Check OpenCode compatibility
if is_compatible(fm, 'opencode'):
    print("✓ Compatible with OpenCode")

# Supported tools:
# - opencode: OpenCode SKILL.md format
# - cursor: Cursor .cursorrules
# - claude_projects: Claude Projects
# - chatgpt: ChatGPT custom instructions
# - generic_llm: Generic LLM prompting
```

## Pattern Selection Logic

### By User Intent

Match user intent to pattern triggers:

```python
def find_patterns_for_intent(intent_keywords, patterns):
    """Find patterns matching user intent."""
    matches = []

    for p in patterns:
        fm, _ = parse_pattern(p['path'])
        if fm is None:
            continue

        triggers = fm.get('triggers', [])
        tags = fm.get('tags', [])

        # Match keywords against triggers and tags
        if any(kw in triggers or kw in tags for kw in intent_keywords):
            matches.append({
                'pattern': p,
                'frontmatter': fm
            })

    return matches

# Example: Find code review patterns
results = find_patterns_for_intent(
    ['code review', 'security'],
    index['patterns']['skills']
)
```

### By Status Level

Prefer stable patterns for production:

```python
def filter_by_status(patterns, min_status='experimental'):
    """Filter patterns by minimum status level."""
    status_order = {
        'experimental': 0,
        'recommended': 1,
        'deprecated': -1
    }

    min_level = status_order.get(min_status, 0)

    return [
        p for p in patterns
        if status_order.get(p.get('status', 'experimental'), 0) >= min_level
    ]

# Production use: only recommended patterns
production_ready = filter_by_status(
    index['patterns']['skills'],
    min_status='recommended'
)
```

### By Dependencies

Check pattern dependencies:

```python
def check_dependencies(frontmatter):
    """Check if pattern has dependencies."""
    requires = frontmatter.get('requires', {})

    anchors = requires.get('anchors', [])
    skills = requires.get('skills', [])

    return {
        'has_dependencies': bool(anchors or skills),
        'anchors': anchors,
        'skills': skills
    }

# Example
deps = check_dependencies(fm)
if deps['has_dependencies']:
    print(f"Requires: {deps['skills']}")
```

## Understanding Output Contracts

Patterns define expected outputs:

```python
def get_output_contract(frontmatter):
    """Extract output contract from frontmatter."""
    output = frontmatter.get('output', {})
    contract = output.get('contract', {})

    return {
        'format': output.get('format', 'markdown'),
        'required_sections': contract.get('required_sections', []),
        'prohibited_content': contract.get('prohibited_content', [])
    }

# Example
contract = get_output_contract(fm)

print(f"Output format: {contract['format']}")
print(f"Must include sections: {contract['required_sections']}")
print(f"Must NOT include: {contract['prohibited_content']}")
```

### Validate Output

Ensure generated output meets contract:

```python
def validate_output(output_text, contract):
    """Validate output against contract."""
    errors = []

    # Check required sections
    for section in contract['required_sections']:
        if f"## {section}" not in output_text:
            errors.append(f"Missing required section: {section}")

    # Check prohibited content
    for prohibited in contract['prohibited_content']:
        if prohibited.lower() in output_text.lower():
            errors.append(f"Contains prohibited content: {prohibited}")

    return {
        'valid': len(errors) == 0,
        'errors': errors
    }
```

## Integration Examples

### OpenCode SKILL.md

Loading patterns into OpenCode:

```python
# OpenCode can directly load SKILL.md files
# Place patterns in .opencode/skills/

import shutil
from pathlib import Path

def integrate_to_opencode(pattern_path, opencode_dir='.opencode/skills'):
    """Copy pattern to OpenCode skills directory."""
    Path(opencode_dir).mkdir(parents=True, exist_ok=True)

    # Copy pattern file
    dest = Path(opencode_dir) / Path(pattern_path).name
    shutil.copy(pattern_path, dest)

    print(f"✓ Integrated to OpenCode: {dest}")

# Example
integrate_to_opencode('skills/secure-code-review/SKILL.md')
```

### Cursor .cursorrules

Converting patterns to Cursor rules:

```python
def convert_to_cursorrules(pattern_path, output_path='.cursorrules'):
    """Convert pattern to Cursor .cursorrules format."""
    fm, body = parse_pattern(pattern_path)

    # Extract key sections
    rules = f"""# {fm['title']}

{fm.get('description', '')}

## Rules

{body}

## Prohibited Content
{', '.join(fm['output']['contract']['prohibited_content'])}
"""

    with open(output_path, 'w') as f:
        f.write(rules)

    print(f"✓ Converted to Cursor rules: {output_path}")
```

### Claude Projects

Formatting for Claude custom instructions:

```python
def format_for_claude(pattern_path):
    """Format pattern for Claude Projects custom instructions."""
    fm, body = parse_pattern(pattern_path)

    instructions = f"""You are a {fm['title']}.

{fm.get('scope', {}).get('intended_use', [''])[0]}

Follow this pattern:

{body}

Critical: Never include {', '.join(fm['output']['contract']['prohibited_content'])}.
"""

    return instructions

# Example
claude_instructions = format_for_claude('skills/secure-code-review/SKILL.md')
```

## Quality Gates

Patterns define quality requirements:

```python
def check_quality_gates(frontmatter):
    """Extract quality gate requirements."""
    gates = frontmatter.get('quality_gates', {})

    return {
        'readability_max_grade': gates.get('readability_max_grade', 10),
        'citations_required': gates.get('citations_required', False),
        'min_examples': gates.get('min_examples', 0)
    }

# Validate output meets quality gates
def validate_readability(text, max_grade=10):
    """Check Flesch-Kincaid grade level."""
    # Implementation depends on readability library
    # pip install textstat
    import textstat
    grade = textstat.flesch_kincaid_grade(text)
    return grade <= max_grade
```

## Best Practices

### 1. Cache Pattern Index

Don't re-parse INDEX.yaml on every request:

```python
class PatternCache:
    """Cache pattern index for efficient access."""

    def __init__(self, index_path='INDEX.yaml'):
        self.index_path = index_path
        self._cache = None
        self._last_modified = None

    def get_index(self):
        """Get cached index or reload if modified."""
        current_mtime = Path(self.index_path).stat().st_mtime

        if self._cache is None or current_mtime != self._last_modified:
            with open(self.index_path) as f:
                self._cache = yaml.safe_load(f)
            self._last_modified = current_mtime

        return self._cache

cache = PatternCache()
index = cache.get_index()
```

### 2. Validate Before Use

Always check frontmatter before using a pattern:

```python
def validate_pattern(frontmatter):
    """Validate pattern has required fields."""
    required = ['id', 'version', 'title', 'type', 'status']

    missing = [f for f in required if f not in frontmatter]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")

    # Check version format
    version = frontmatter['version']
    if not re.match(r'^\d+\.\d+\.\d+$', version):
        raise ValueError(f"Invalid version format: {version}")

    return True
```

### 3. Handle Deprecation

Check for deprecated patterns:

```python
def check_deprecation(frontmatter):
    """Check if pattern is deprecated and find replacement."""
    if frontmatter['status'] == 'deprecated':
        replacement = frontmatter.get('replaces_with')
        return {
            'deprecated': True,
            'replacement': replacement,
            'message': f"Use {replacement} instead"
        }
    return {'deprecated': False}

# Example
deprecation = check_deprecation(fm)
if deprecation['deprecated']:
    print(f"⚠️ {deprecation['message']}")
```

### 4. Error Handling

Gracefully handle missing or invalid patterns:

```python
def safe_load_pattern(path):
    """Safely load pattern with error handling."""
    try:
        fm, body = parse_pattern(path)
        if fm is None:
            return {'error': 'No valid frontmatter', 'path': path}

        validate_pattern(fm)

        return {
            'success': True,
            'frontmatter': fm,
            'body': body
        }
    except FileNotFoundError:
        return {'error': 'Pattern not found', 'path': path}
    except yaml.YAMLError as e:
        return {'error': f'Invalid YAML: {e}', 'path': path}
    except ValueError as e:
        return {'error': str(e), 'path': path}
```

## Complete Example: Pattern Discovery System

```python
#!/usr/bin/env python3
"""
AI Agent Pattern Discovery System
Demonstrates programmatic pattern integration.
"""

import yaml
from pathlib import Path
from typing import Dict, List, Optional

class PatternDiscovery:
    """Discover and filter patterns for AI agents."""

    def __init__(self, repo_path: Path = Path('.')):
        self.repo_path = repo_path
        self.index_path = repo_path / 'INDEX.yaml'
        self.index = self._load_index()

    def _load_index(self) -> dict:
        """Load pattern index."""
        with open(self.index_path) as f:
            return yaml.safe_load(f)

    def find_by_intent(self, keywords: List[str],
                       pattern_type: Optional[str] = None) -> List[dict]:
        """Find patterns matching user intent."""
        results = []

        # Get patterns of specified type or all
        if pattern_type:
            patterns = self.index['patterns'].get(pattern_type, [])
        else:
            patterns = []
            for ptype in ['skills', 'prompts', 'agents', 'workflows']:
                patterns.extend(self.index['patterns'].get(ptype, []))

        for pattern in patterns:
            path = self.repo_path / pattern['path']
            fm, _ = self._parse_pattern(path)

            if fm and self._matches_intent(fm, keywords):
                results.append({
                    'pattern': pattern,
                    'frontmatter': fm,
                    'score': self._score_match(fm, keywords)
                })

        # Sort by relevance score
        return sorted(results, key=lambda x: x['score'], reverse=True)

    def _parse_pattern(self, path: Path) -> tuple:
        """Parse pattern file."""
        try:
            content = path.read_text()
            if not content.startswith('---\n'):
                return None, content

            parts = content.split('---\n', 2)
            if len(parts) < 3:
                return None, content

            return yaml.safe_load(parts[1]), parts[2]
        except Exception:
            return None, None

    def _matches_intent(self, frontmatter: dict, keywords: List[str]) -> bool:
        """Check if pattern matches intent keywords."""
        triggers = [t.lower() for t in frontmatter.get('triggers', [])]
        tags = [t.lower() for t in frontmatter.get('tags', [])]

        keywords_lower = [k.lower() for k in keywords]

        return any(
            kw in triggers or kw in tags
            for kw in keywords_lower
        )

    def _score_match(self, frontmatter: dict, keywords: List[str]) -> float:
        """Score pattern relevance to keywords."""
        score = 0.0

        # Boost for recommended status
        if frontmatter.get('status') == 'recommended':
            score += 10.0

        # Score trigger matches
        triggers = [t.lower() for t in frontmatter.get('triggers', [])]
        keywords_lower = [k.lower() for k in keywords]

        for kw in keywords_lower:
            if kw in triggers:
                score += 5.0

        # Score tag matches
        tags = [t.lower() for t in frontmatter.get('tags', [])]
        for kw in keywords_lower:
            if kw in tags:
                score += 2.0

        return score

# Example usage
if __name__ == '__main__':
    discovery = PatternDiscovery()

    # Find security review patterns
    results = discovery.find_by_intent(
        keywords=['security', 'code review'],
        pattern_type='skills'
    )

    print(f"Found {len(results)} matching patterns:\n")

    for r in results:
        fm = r['frontmatter']
        print(f"📋 {fm['title']}")
        print(f"   Status: {fm['status']}")
        print(f"   Score: {r['score']:.1f}")
        print(f"   Path: {r['pattern']['path']}")
        print()
```

## INDEX.yaml Schema Reference

```yaml
schema_version: "1.0"           # Index format version
repo: "owner/repo"              # GitHub repository
description: "Brief description"

patterns:
  skills: []                    # Array of skill patterns
  prompts: []                   # Array of prompt patterns
  agents: []                    # Array of agent patterns
  workflows: []                 # Array of workflow patterns
  lessons: []                   # Array of lesson patterns

stats:
  total_patterns: 13            # Total count
  skills: 4                     # Count by type
  prompts: 3
  agents: 3
  workflows: 2
  lessons: 1
```

### Pattern Entry Schema

Each pattern entry contains:

```yaml
path: "skills/example/SKILL.md"  # Relative file path
id: "example-pattern"             # Unique identifier
title: "Example Pattern"          # Human-readable name
type: "skill"                     # Pattern type
status: "experimental"            # Status level
```

## Frontmatter Schema Reference

### Required Fields

```yaml
id: "pattern-id"                  # kebab-case, immutable
version: "1.0.0"                  # Semantic version
title: "Pattern Title"            # Display name
type: skill                       # skill|prompt|agent|workflow|lesson
status: experimental              # experimental|recommended|deprecated
owners: ["@handle"]               # GitHub handles
primary_personas: ["developers"]  # Target users
requires:
  anchors: []                     # Dependencies
output:
  format: markdown                # Output format
  contract:
    required_sections: []         # Must-have sections
    prohibited_content: []        # Must-not-have content
quality_gates:
  readability_max_grade: 10       # Flesch-Kincaid level
  citations_required: false       # Require sources?
```

### Recommended Fields

```yaml
triggers: ["keyword"]             # Discovery keywords
tags: ["tag1", "tag2"]           # Categorization
description: "Brief overview"     # One-liner
portability:                      # Tool compatibility
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true
scope:
  intended_use: []                # What it's for
  exclusions: []                  # What it's NOT for
complexity_estimate:              # Time estimate
  setup_minutes: 5
  execution_minutes: 30
```

## Common Use Cases

### Use Case 1: Code Review Assistant

```python
# Find code review patterns
discovery = PatternDiscovery()
patterns = discovery.find_by_intent(['code review', 'security'])

# Use the highest-scoring recommended pattern
for result in patterns:
    if result['frontmatter']['status'] == 'recommended':
        pattern_path = result['pattern']['path']
        fm, body = parse_pattern(pattern_path)

        # Apply pattern to user's code
        print(f"Using: {fm['title']}")
        print(f"Instructions:\n{body}")
        break
```

### Use Case 2: Documentation Generator

```python
# Find documentation patterns
doc_patterns = discovery.find_by_intent(
    ['documentation', 'readme'],
    pattern_type='skills'
)

# Check compatibility with current tool
for r in doc_patterns:
    fm = r['frontmatter']
    if fm.get('portability', {}).get('opencode', False):
        print(f"✓ {fm['title']} is OpenCode-compatible")
```

### Use Case 3: Workflow Automation

```python
# Find multi-step workflows
workflows = discovery.find_by_intent(
    ['issue', 'pull request'],
    pattern_type='workflows'
)

# Check dependencies before execution
for r in workflows:
    fm = r['frontmatter']
    deps = fm.get('requires', {})

    if not deps.get('skills'):
        print(f"✓ {fm['title']} - No dependencies")
    else:
        print(f"⚠️ {fm['title']} - Requires: {deps['skills']}")
```

## Troubleshooting

### Pattern Not Found

```python
def debug_pattern_discovery(pattern_id):
    """Debug why a pattern isn't found."""
    with open('INDEX.yaml') as f:
        index = yaml.safe_load(f)

    # Check all pattern types
    for ptype, patterns in index['patterns'].items():
        for p in patterns:
            if p['id'] == pattern_id:
                print(f"✓ Found in {ptype}: {p['path']}")
                return p

    print(f"✗ Pattern '{pattern_id}' not in INDEX.yaml")
    print("  Run: make generate")
```

### Invalid Frontmatter

```python
def validate_frontmatter_schema(frontmatter):
    """Validate frontmatter against schema."""
    import jsonschema

    # Load schema
    with open('schemas/skill.schema.json') as f:
        schema = json.load(f)

    try:
        jsonschema.validate(instance=frontmatter, schema=schema)
        print("✓ Frontmatter is valid")
        return True
    except jsonschema.ValidationError as e:
        print(f"✗ Invalid frontmatter: {e.message}")
        return False
```

### Output Doesn't Meet Contract

```python
def debug_output_validation(output, contract):
    """Debug why output validation fails."""
    print("Checking required sections:")
    for section in contract['required_sections']:
        if f"## {section}" in output:
            print(f"  ✓ {section}")
        else:
            print(f"  ✗ {section} - MISSING")

    print("\nChecking prohibited content:")
    for prohibited in contract['prohibited_content']:
        if prohibited.lower() in output.lower():
            print(f"  ✗ Found: {prohibited}")
        else:
            print(f"  ✓ Clean: {prohibited}")
```

## See Also

- [Contributing Guide](../CONTRIBUTING.md) - How to add patterns
- [Repository Structure](../README.md#repository-structure) - Directory layout
- [Pattern Status Levels](../README.md#content-status-levels) - Status meanings
- [JSON Schema](../schemas/skill.schema.json) - Validation schema

## Feedback

This is a living document. If you encounter issues or have suggestions:

1. File an issue: <https://github.com/GSA-TTS/agentic-coding-patterns/issues>
2. Include "AI Agent Guide" in the title
3. Describe your use case and what's unclear

## See Also

- [README](../README.md) — Human-friendly repository overview
- [CONTRIBUTING](../CONTRIBUTING.md) — Pattern contribution guide
- [Examples](../examples/) — Tool-specific integration examples (OpenCode, Cursor, Claude Projects)
- [Templates](../templates/) — Pattern templates with frontmatter

---

> **License:** CC0-1.0
> **Last Updated:** 2026-05-21
> **Maintainers:** GSA-TTS agentic coding team
