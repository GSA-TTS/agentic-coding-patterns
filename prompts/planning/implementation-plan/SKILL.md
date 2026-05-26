---
id: implementation-plan
version: "1.0.0"
title: "Implementation Plan Generator"
type: prompt
description: "Generate structured implementation plans by breaking features into tasks with dependencies and estimates"

status: experimental
owners:
  - "@community"

primary_personas:
  - developers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Overview"
      - "Tasks"
      - "Dependencies"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "planning"
  - "implementation"
  - "breakdown"
  - "tasks"
  - "feature planning"

tags:
  - "planning"
  - "project-management"
  - "task-breakdown"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Break down features into implementable tasks"
    - "Identify dependencies between tasks"
    - "Estimate complexity"
  exclusions:
    - "Not for time estimation (story points only)"
    - "Not for resource allocation"
---

# Prompt: Implementation Plan Generator

Generate a structured implementation plan that breaks down a feature or requirement into concrete, actionable tasks.

## When to Use

- Starting work on a new feature
- Planning a refactoring effort
- Breaking down large user stories
- Creating sprint plans
- User needs "how should I implement this?"

## Prerequisites

- Feature description or requirements
- Understanding of the codebase architecture
- Access to system design (if applicable)

## Prompt

```
You are a technical architect helping break down a feature into an implementation plan.

## Feature Description
--- USER INPUT START ---
[User provides feature description or requirements here]
--- USER INPUT END ---

## Your Task

Create a detailed implementation plan with:

1. **Overview** - Brief summary of what will be built
2. **Architecture Decisions** - Key technical choices
3. **Tasks** - Numbered list of implementation tasks
4. **Dependencies** - Task relationships (Task X depends on Task Y)
5. **Risks** - Potential blockers or challenges
6. **Verification** - How to validate each task

## Task Format

For each task, provide:
- **Task ID**: T1, T2, T3, etc.
- **Title**: Brief description
- **Details**: What needs to be done
- **Complexity**: Simple | Medium | Complex
- **Dependencies**: Which tasks must complete first
- **Files affected**: Estimated files to create/modify
- **Verification**: How to know it's done

## Requirements

- Tasks should be completable in 1-4 hours each
- Break complex tasks into smaller sub-tasks
- Identify blocking dependencies explicitly
- Consider testing and documentation as separate tasks
- Flag any unknowns or assumptions

## Prohibited Content

Do NOT include:
- Secrets or credentials
- Internal system details not provided in input
- Customer data
- Time estimates in hours (use complexity instead)

## Output Structure

Provide your plan in this format:

### Overview
[Brief description]

### Architecture Decisions
- Decision 1 and rationale
- Decision 2 and rationale

### Tasks

**T1: Task Title**
- **Complexity**: Simple
- **Dependencies**: None
- **Details**: What to do
- **Files**: file1.py, file2.py
- **Verification**: How to verify

[Continue for all tasks...]

### Dependency Graph
```

T1 → T2 → T4
T1 → T3 → T4

```

### Risks and Unknowns
- Risk 1: Description and mitigation
- Unknown 1: What needs clarification

### Next Steps
1. First thing to do
2. Second thing to do
```

## Usage Example

### Input

```
Feature: Add user authentication with OAuth2

Requirements:
- Users can log in with Google
- Sessions last 24 hours
- Admin users have elevated permissions
```

### Expected Output

```markdown
### Overview
Implement OAuth2 authentication with Google, session management, and role-based access control.

### Architecture Decisions
- Use OAuth2 authorization code flow (more secure than implicit)
- Store sessions server-side with Redis (for horizontal scaling)
- Use JWT for session tokens (stateless, works across services)

### Tasks

**T1: Set up OAuth2 configuration**
- **Complexity**: Simple
- **Dependencies**: None
- **Details**: Register app with Google, get client ID/secret, configure redirect URI
- **Files**: config/oauth.py, .env.example
- **Verification**: Credentials load successfully

**T2: Implement OAuth2 flow**
- **Complexity**: Medium
- **Dependencies**: T1
- **Details**: Create /auth/login endpoint that redirects to Google, handle callback with authorization code
- **Files**: routes/auth.py, services/oauth_service.py
- **Verification**: Can complete full OAuth flow in browser

**T3: Session management**
- **Complexity**: Medium
- **Dependencies**: T2
- **Details**: Generate JWT, store in Redis, set HTTP-only cookie
- **Files**: services/session_service.py, models/session.py
- **Verification**: Sessions persist across requests

**T4: Role-based access control**
- **Complexity**: Simple
- **Dependencies**: T3
- **Details**: Add role field to user model, create @require_role decorator
- **Files**: models/user.py, decorators/auth.py
- **Verification**: Admin endpoints reject non-admin users

**T5: Add tests**
- **Complexity**: Medium
- **Dependencies**: T2, T3, T4
- **Details**: Unit tests for OAuth flow, session management, RBAC
- **Files**: tests/test_auth.py, tests/test_sessions.py
- **Verification**: All tests pass

**T6: Documentation**
- **Complexity**: Simple
- **Dependencies**: All above
- **Details**: Document setup, OAuth flow, session handling
- **Files**: docs/authentication.md
- **Verification**: Instructions are complete and accurate

### Dependency Graph
```

T1 → T2 → T5
     T2 → T3 → T5
          T3 → T4 → T5
                    T5 → T6

```

### Risks and Unknowns
- **Risk**: OAuth callback URL must be HTTPS in production (local dev uses HTTP)
  - **Mitigation**: Document production deployment requirements
- **Unknown**: Should sessions be invalidated on logout or just expire?
  - **Action**: Clarify with stakeholder

### Next Steps
1. Start with T1 (OAuth configuration)
2. Test OAuth flow manually before implementing session management
3. Create GitHub issues for T1-T6
```

## Verification

Check that the output:

- [ ] Tasks are granular (1-4 hours each)
- [ ] Dependencies are explicit
- [ ] Complexity is reasonable
- [ ] Verification criteria are clear
- [ ] No secrets or sensitive data included

## Related Patterns

- [test-generation](../../../skills/test-generation/SKILL.md) - Generate tests for implemented tasks
- [secure-code-review](../../../skills/secure-code-review/SKILL.md) - Review implementation for security

## References

- For federal project planning, see [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook)
