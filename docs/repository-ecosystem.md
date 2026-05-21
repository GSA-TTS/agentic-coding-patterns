# Repository Ecosystem

> **Purpose:** Explain the relationship between playbook, patterns, and quickstart repositories

## Overview

The **agentic coding workspace** consists of three complementary GSA-TTS repositories that work together to support AI-assisted software development.

```
┌─────────────────────────────────┐
│   agentic-coding-playbook       │  ← UPSTREAM (Authoritative)
│   - Federal policies            │
│   - Compliance standards        │
│   - Security controls           │
│   - FIPS Moderate baseline      │
└───────────────┬─────────────────┘
                │
                │  Provides policy and standards
                ▼
┌─────────────────────────────────┐
│   agentic-coding-patterns       │  ← THIS REPOSITORY
│   - Community patterns          │
│   - Reusable skills             │
│   - Tool examples               │
│   - CC0-1.0 (public)            │
└───────────────┬─────────────────┘
                │
                │  Provides implementation patterns
                ▼
┌─────────────────────────────────┐
│   agentic-coding-quickstart     │  ← DOWNSTREAM (Consumer)
│   - SBX execution setup         │
│   - USAi endpoint config        │
│   - Credential injection        │
│   - FIPS Low (pilot scope)      │
└─────────────────────────────────┘
```

## Repository Roles

### Playbook (Upstream Authority)
**Repository:** `GSA-TTS/agentic-coding-playbook`
**License:** CC0-1.0
**Purpose:** Policy, standards, and compliance guidance

**What belongs here:**
- Federal information security requirements
- GSA/TTS coding standards
- Security control mappings (NIST SP 800-53)
- Compliance guidance (FISMA, FedRAMP)
- Security control documentation
- Validation framework

**What does NOT belong:**
- Specific implementation patterns (that's patterns repo)
- Tool configuration (that's quickstart repo)
- Executable code (limited to validators)

**Relationship:** AUTHORITATIVE — When standards conflict, playbook wins.

### Patterns (This Repository)
**Repository:** `GSA-TTS/agentic-coding-patterns`
**License:** CC0-1.0
**Purpose:** Community patterns and reusable skills

**What belongs here:**
- Reusable skills (code review, testing, documentation)
- Prompt templates for common tasks
- Agent instruction patterns (AGENTS.md examples)
- Tool-specific examples (OpenCode, Cursor, Claude)
- Lessons learned from practitioners
- Workflow patterns

**What does NOT belong:**
- Security policy (reference playbook instead)
- Execution environment setup (that's quickstart)
- Compliance requirements (cite playbook)
- Internal/sensitive examples

**Relationship:** CONSUMER — Follows playbook guidance, provides patterns for quickstart.

### Quickstart (Downstream Consumer)
**Repository:** `GSA-TTS/agentic-coding-quickstart`
**License:** CC0-1.0
**Purpose:** Execution environment setup and configuration

**What belongs here:**
- SBX (Sandbox) container configuration
- USAi endpoint setup
- Credential injection patterns
- Environment-specific configuration
- Tool installation and setup
- Integration testing

**What does NOT belong:**
- General patterns (that's patterns repo)
- Policy documentation (reference playbook)
- Reusable skills (contribute to patterns repo)

**Relationship:** CONSUMER — Uses patterns from patterns repo, follows playbook policy.

## When to Use Each Repository

### Use **Playbook** when you need:
- Official GSA/TTS security policy
- Compliance requirements (FISMA, FedRAMP)
- Security control mappings
- Federal information security guidance
- Coding standards (official)

### Use **Patterns** when you need:
- Reusable code review patterns
- Testing procedures
- Documentation templates
- Tool-specific examples
- Community best practices
- Prompt templates

### Use **Quickstart** when you need:
- Local development environment setup
- SBX container configuration
- USAi endpoint connection
- Credential management
- Tool installation guides

## Content Ownership

| Content Type | Owner | Authority |
|--------------|-------|-----------|
| Security policy | Playbook | Authoritative |
| Compliance requirements | Playbook | Authoritative |
| Coding standards | Playbook | Authoritative |
| Community patterns | Patterns | Community-driven |
| Execution setup | Quickstart | Implementation guide |

## Cross-Repository Guidelines

### Referencing Playbook from Patterns
**Do:**
```markdown
For security controls, see [SECURITY-CONTROLS.md](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/SECURITY-CONTROLS.md) in the playbook.
```

**Don't:**
- Copy security policy into patterns repo
- Make compliance claims without citing playbook
- Duplicate standards documentation

### Referencing Patterns from Quickstart
**Do:**
```markdown
For code review patterns, see [secure-code-review](https://github.com/GSA-TTS/agentic-coding-patterns/tree/main/skills/secure-code-review) in the patterns repository.
```

**Don't:**
- Copy patterns into quickstart (link instead)
- Create quickstart-specific patterns (contribute upstream to patterns repo)

### Pattern Drift Prevention
If you find patterns diverging between repos:
1. Identify the authoritative source (usually playbook for policy, patterns for implementation)
2. Create an issue in the downstream repo
3. Reference the upstream source
4. Update downstream to match upstream

**Example:** If `CODING_PRACTICES.md` differs between playbook and quickstart, playbook is authoritative. File an issue in quickstart to sync.

## Impact Levels and Compliance

| Repository | FIPS Level | ATO Status | Scope |
|------------|------------|------------|-------|
| Playbook | Moderate | ATO-ready guidance | Full SDLC |
| Patterns | N/A (public) | Public patterns | Reusable patterns |
| Quickstart | Low | Pre-ATO (pilot) | Local dev only |

**When working across repos:** Default to **FIPS Moderate** constraints unless explicitly scoped to local development.

## Contribution Flow

### Contributing a New Pattern
1. Create pattern in **patterns repo** (not playbook or quickstart)
2. Reference playbook policy where applicable
3. Ensure pattern is reusable across contexts
4. Use `experimental` status initially
5. Link to pattern from quickstart if relevant

### Updating Security Policy
1. Create PR in **playbook repo**
2. Update patterns repo if implementation patterns need changes
3. Update quickstart if environment changes needed
4. Maintain consistency across all three

### Reporting Security Issues
Report in the repository where the issue exists:
- **Policy issue:** Report in playbook
- **Pattern security flaw:** Report in patterns
- **Environment vulnerability:** Report in quickstart

## Version Compatibility

All three repositories are independently versioned. No strict version coupling required.

**Best practice:** Document which playbook version your patterns/quickstart configuration follows:
```markdown
This pattern follows guidance from agentic-coding-playbook v0.6.x.
```

## Questions?

- **Which repo for my content?** See "When to Use Each Repository" above
- **Policy vs pattern?** Policy → playbook, Pattern → patterns
- **Setup vs usage?** Setup → quickstart, Usage → patterns

## References

- [Playbook README](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/README.md)
- [Quickstart README](https://github.com/GSA-TTS/agentic-coding-quickstart/blob/main/README.md)
- [Workspace AGENTS.md](../../AGENTS.md) (workspace root)
