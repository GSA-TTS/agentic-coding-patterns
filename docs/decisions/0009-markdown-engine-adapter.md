# 0009: Use the pinned Markdown engine through a repository adapter

- Status: Proposed
- Date: 2026-11-17

## Context

CI and pre-commit already call one repository wrapper. That wrapper delegated
file selection and reporting to a general-purpose CLI. We need only a fixed
Markdown selection, check mode, one-pass fixes and a file count. Keeping the
same lint engine while removing the CLI's glob dependency chain gives us a
smaller tooling dependency graph without replacing the rules.

The compatibility baseline is `markdownlint-cli` 0.49.1 with `markdownlint`
0.41.1, `markdown-it` 14.3.3 and HTML parsing enabled. The investigation inspected
the CLI's `prepareFileList`, `readConfiguration`, `lintAndPrint` and diagnostic
formatter, and the engine's maintained synchronous and fix APIs.

## Proposed decision

Keep `.github/linters/run-markdownlint.mjs` as the entry point, called from the
repository root. Pin `markdownlint` 0.41.1, `markdown-it` 14.3.3, `js-yaml` 4.3.2
and `ignore` 7.0.11 directly. Retain the existing `katex` 0.18.2 override. These
are existing dependencies promoted or retained, not new parsers. All five have
MIT licenses; transitive licenses remain recorded in the npm lockfile. Node 22
or later is required by the engine and matches the existing CI major version.

Use `markdownlint/sync` for `readConfig` and `lint`, and `markdownlint` for
`applyFixes`. Supply a `markdown-it` factory with `html: true`. Pass the existing
rule configuration unchanged. In particular, the historical `frontMatter`
string stays inside `config`: it was not a top-level engine option in the CLI.
Default engine frontmatter parsing and inline configuration remain in effect.

Use native filesystem enumeration for the one supported pattern, `**/*.md`.
This is not a generic glob framework. The complete selected list is shared by
check, fix and count modes:

- Include hidden files and directories, spaces and Unicode names.
- Match `.md` case-sensitively on Linux and case-insensitively on macOS and
  Windows, following the old CLI's platform policy.
- Keep root-relative exclusions for `node_modules`,
  `.github/linters/node_modules`, `deleteme`, `templates` and `CHANGELOG.md`.
  Nested directories with those names are not blanket exclusions. A literal
  exclusion naming a real directory excludes its subtree; one naming a symlink
  is an exact-path exclusion, as in the CLI's `lstat` handling.
- Exclude descendants of any `fixtures` path segment, case-sensitively on all
  platforms. Do not reinterpret these fixed exclusions as gitignore patterns.
- Apply optional `.markdownlintignore` using the maintained `ignore` package,
  including its default case-insensitive matching and negation semantics.
- Preserve lexical symlink aliases, including `skills` and `.agents/skills`.
  Track directory ancestry per branch, not a global realpath visited set.

For fixes, lint each selected file, apply its reported fixes once, then lint the
whole selection again. Do not repeat fixes until clean or claim that every
violation is fixable. Preserve warning-only exit status 0, lint-error status 1,
unexpected-error status 4, and the CLI's sorted stderr diagnostics, including
line, optional column, severity, rule names, detail and context.

## Intentional differences

- Read only the working directory's required `.markdownlint.yaml`, with the
  engine's `extends` behavior and YAML parser. Do not merge ambient `run-con`
  configuration, environment overrides, alternate auto-discovered files or
  user-level configuration. Missing or malformed required configuration fails
  closed rather than silently falling back to defaults.
- Support only no-argument check mode, `--fix` and `--count-only`. Reject other
  arguments, including positional paths and unused CLI flags. Count wins when
  combined with fix, as before, and does not load the lint configuration.
- Count the actual lint selection. The former count-only glob call did not
  apply `.markdownlintignore`, differed on literal exclusions and used a
  different case policy on macOS/Windows. Its count is not the parity oracle.
- Fail on an empty final selection, filesystem discovery failures, broken
  links, ancestor cycles and symlinks escaping the repository. Do not report
  successful partial coverage. Fixed excluded directories are not traversed.
- Sort selected lexical paths deterministically before linting and fixing.
  Diagnostics retain the CLI's locale-based diagnostic ordering. As before,
  fixes are not transactional: a later failure can follow earlier file writes.

## Validation and delivery gates

The Node tests under `.github/linters/tests` exercise actual filesystem fixtures
and engine APIs, not source-text assertions. They are included in `make
test-kits`. That target requires the linter npm dependencies to be installed;
the CI job running it must provision those dependencies before execution.

The optional migration suite accepts `MARKDOWNLINT_BASELINE_CLI`, the absolute
path to an independently installed and reviewed CLI 0.49.1 using the original
lockfile. Its test-only custom rule records every selected lexical filename,
including clean files. Compare the complete real-repository and synthetic
selections, check diagnostics, fix diagnostics, exit codes and fixed bytes.
Do not infer selection parity from diagnostics alone. Normal offline tests do
not install or run the removed CLI.

Before adoption, generate and inspect the replacement lockfile in the isolated
tooling environment. Verify a clean frozen install, absence of the removed
CLI/glob chain and `npm audit --audit-level=moderate` without suppression.
Run normal hooks, validators and `make test-kits` in the workspace sandbox,
plus the migration suite. Validate actual macOS/Windows behavior when runners
are available; simulated platform selection tests do not establish native
filesystem parity. Permission-negative tests require an unprivileged POSIX
runner. Independent fixed-head review and human approval are still required.

## Provenance and rollback

The baseline npm source archives were integrity-verified during investigation:

- `markdownlint-cli` 0.49.1:
  `sha512-qpYqJbSYf3jv57bdnFmCaZ/Wlu6IYHp2b6SOKrKBJ7OnPrDHIKmx4NERWH49QH9viTI6yO6raVDDn5nrf60VQQ==`
- `markdownlint` 0.41.1:
  `sha512-qHKeU2E1bdyNAT077go2FVTNXvYcktN5IHtF6XyeD1l0PClxzSp2tUApAV14ORI8DGX4H9bNKZEzelZp4qn8IA==`

The adapter calls maintained APIs; it does not vendor the CLI or introduce a
general CLI compatibility layer. To roll back, restore the previous wrapper,
package manifest and lockfile together. Reassess dependency audit results
before using that rollback; rollback is not authorization to bypass a gate.
