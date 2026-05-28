# Cursor Integration Examples

This directory shows how to convert patterns from this repository into Cursor .cursorrules format.

## Overview

Cursor uses `.cursorrules` files for AI behavior customization. Patterns can be converted to this format with some adaptation.

## Quick Conversion

```bash
# Manual conversion from SKILL.md to .cursorrules
python convert_to_cursorrules.py skills/secure-code-review/SKILL.md
```

## Example Conversions

- [Documentation Review → .cursorrules](./documentation-review.cursorrules)

## Key Differences

| Pattern (SKILL.md) | Cursor (.cursorrules) |
|-------------------|-----------------------|
| YAML frontmatter | Plain text rules |
| Structured sections | Freeform instructions |
| Output contracts | Implicit expectations |
| Machine-readable | Human-readable focus |

## Best Practices

### 1. Simplify Frontmatter

Cursor doesn't parse YAML, so convert frontmatter to comments:

```
# Pattern: Documentation Review
# Status: experimental
# Version: 1.0.0

You are a documentation reviewer...
```

### 2. Extract Core Instructions

Focus on the procedure, not the metadata:

```markdown
## Procedure

1. Review README.md for completeness
2. Check inline code comments
3. Validate examples work
4. Verify links are not broken
```

→ Becomes:

```
When reviewing documentation:
1. Check README completeness
2. Verify code comments
3. Test all examples
4. Validate links
```

### 3. Include Prohibitions

Convert `prohibited_content` to explicit rules:

```
IMPORTANT: Never include:
- Secrets or API keys
- PII (Personally Identifiable Information)
- Internal URLs or system details
```

## See Also

- [Cursor Documentation](https://cursor.sh/docs)
- [AI Agent Integration Guide](../../docs/AI-AGENT-GUIDE.md)
- [Pattern Templates](../../templates/)
