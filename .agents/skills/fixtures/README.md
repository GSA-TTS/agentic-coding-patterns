# Security-Skill Fixture Catalog

Safe, **defanged** known-bad and known-good inputs for exercising the security
skills' `tests/test-cases.yml`. Every fixture here is **synthetic** — no real
secrets, PII, CUI, working exploit payloads, live IOCs, or internal hostnames.
Prohibited patterns appear only as **clearly-labeled anti-patterns** so the
unsafe-shell scanner and the sensitive-terms scan both pass.

## Layout

```text
fixtures/
├── known-bad/    # inputs a security skill SHOULD flag (defanged)
└── known-good/   # inputs a security skill should NOT flag
```

## How fixtures are used

A skill's `tests/test-cases.yml` references a fixture with an `input.type:
file_path` and asserts the skill's behavior with the security assertions added
in issue #157:

- `flags_finding` — the (expected-output) report must contain ALL listed literal
  signals (the finding class + the fix). Proves the skill catches a known-bad.
- `no_false_positive` — the report must contain NONE of the listed finding
  signals. Proves the skill does not over-report on a known-good.
- `no_prohibited` with `literal: true` — literal-substring match (issue #203),
  so shell strings like `curl | sh` are not misread as regex.

> These fixtures are the **inputs** a skill reviews. The skill's *report* is what
> a test-case asserts against; see `docs/security-skill-validation.md` for the
> end-to-end example.

## Safety rules for fixtures

- Placeholder secrets only, and shaped so they can't be mistaken for real:
  `AKIA_EXAMPLE_NOT_A_REAL_KEY`, `ghp_EXAMPLE_ONLY`, `password = "…"`.
- Real prohibited shell (e.g. `curl … | sh`) appears only in a
  ` ```bash anti-pattern ` fence or with a `# anti-pattern` marker.
- Synthetic hostnames use `.example` / `.test`; synthetic IPs use `192.0.2.0/24`
  (RFC 5737 TEST-NET).
- No live IOCs, no real incident data, no working exploit code.

## Catalog

| Fixture | Kind | Demonstrates |
|---------|------|--------------|
| `known-bad/workflow-overbroad-permissions.md` | bad | over-broad `permissions: write-all` in a CI workflow |
| `known-bad/dependency-unpinned-action.md` | bad | GitHub Action pinned to a mutable tag, not a SHA |
| `known-good/workflow-least-privilege.md` | good | a correctly scoped, SHA-pinned workflow |
