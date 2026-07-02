# Security-Skill Validation — Worked Examples

> How the pieces fit: a **fixture** (a defanged known-bad or known-good input) is
> fed to a security skill, and the skill's **report** is asserted against the
> skill's output contract using the test-runner assertions. This doc shows the
> end-to-end pattern for authors adding or reviewing security skills.

## The pieces

| Piece | Where | Role |
|-------|-------|------|
| Fixture | [`.agents/skills/fixtures/`](../.agents/skills/fixtures/) | The *input* the skill reviews (synthetic, defanged) |
| Skill | `.agents/skills/<skill>/SKILL.md` | Produces a review *report* |
| Test-case | `.agents/skills/<skill>/tests/test-cases.yml` | Asserts the report meets the contract |
| Runner | `scripts/run_test_cases.py` (`make test-cases`) | Executes the assertions |
| Standard | [`clean-script-standard.md`](clean-script-standard.md) | Prohibited shell patterns (enforced by `scripts/scan_unsafe_shell.py`) |

> A test-case's `input.content` is an **expected-output fixture** — a sample of
> the report the skill should produce — checked against the contract. It is not
> fed *to* the skill at runtime; these tests validate the *shape and safety* of
> conformant output, not a live model call.

## Assertion types for security skills

Added in issue #157 (plus the `literal` option from #203):

- **`flags_finding`** — the report must contain ALL listed literal signals (the
  finding class + the recommended fix). Proves the skill catches a known-bad.
- **`no_false_positive`** — the report must contain NONE of the listed
  finding-signal literals. Proves the skill does not over-report on a known-good.
- **`no_prohibited`** with **`literal: true`** — literal-substring match, so a
  shell string like `curl | sh` is not misread as a regex alternation.
- Existing: `contains`, `not_contains`, `has_sections`, `has_pattern`,
  `no_prohibited` (regex default), `readability_max`.

## Example 1 — assert a skill FLAGS a known-bad input

A `least-privilege-review` test-case, using a fixture that shows an over-broad
`GITHUB_TOKEN` grant:

```yaml
- id: flags-overbroad-token
  name: "Flags a write-all GITHUB_TOKEN grant"
  input:
    type: literal
    content: |
      ## Summary
      Reviewed 1 workflow; 1 least-privilege finding.

      ## Findings
      - **Grant:** permissions: write-all
      - **Why flagged:** grants more than the build needs.
      - **Fix:** scope to contents: read.
  assertions:
    - type: has_sections
      sections: ["Summary", "Findings"]
    - type: flags_finding
      patterns: ["write-all", "contents: read"]
```

## Example 2 — assert a skill does NOT over-report on a known-good input

```yaml
- id: clean-workflow-not-flagged
  name: "A least-privilege, SHA-pinned workflow is not flagged"
  input:
    type: literal
    content: |
      ## Summary
      No least-privilege findings. Token is read-only, action SHA-pinned.

      ## Findings
      None.
  assertions:
    - type: no_false_positive
      patterns: ["FAIL", "flagged", "severity: high", "write-all"]
```

## Example 3 — literal `no_prohibited` (safety, #203)

Assert the skill's own output never emits a live pipe-to-shell, without the regex
footgun:

```yaml
- type: no_prohibited
  literal: true
  patterns:
    - "| sh"
    - "eval $"
```

## Running

```bash
make test-cases        # all suites
python scripts/run_test_cases.py .agents/skills/<skill>/tests/test-cases.yml
```

## Authoring checklist

- [ ] Fixtures are synthetic and defanged (see fixtures/README.md safety rules).
- [ ] Each security skill has a `flags_finding` case (catches a known-bad) and a
      `no_false_positive` case (clean on a known-good).
- [ ] A `no_prohibited` safety case (prefer `literal: true` for shell strings)
      proves the skill's own report ships no live payload/secret.
- [ ] `make test-cases`, `make validate`, and `make scan-shell` all pass.
