---
name: safe-shell-script-author
id: safe-shell-script-author
version: "1.0.0"
title: "Safe Shell Script Author"
type: skill
description: "Draft safe Bash scripts to a clean-script standard (set -euo pipefail, mktemp + trap cleanup, quoted expansions, dry-run default, shellcheck/shfmt-clean) — never curl|sh, eval, or secret dumps; used when a task asks for a new shell script"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - security

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Summary"
      - "Script"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "Destructive Commands Without Guards"
      - "curl-pipe-to-shell"
      - "eval on External Data"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "write a bash script"
  - "shell script"
  - "cleanup script"
  - "set -euo pipefail"
  - "safe script"
  - "automation script"

tags:
  - "security"
  - "bash"
  - "shell"
  - "scripting"
  - "code-generation"

categories:
  - "security"
  - "development"

risk_tier: moderate
human_review_required: true
allowed_tools: []
network_policy: deny
write_policy: deny
script_policy: author-only

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Draft a new Bash script from a stated intent, to the clean-script standard"
    - "Emit safe defaults: strict mode, temp-file cleanup, quoted expansions, dry-run"
    - "Explain why each safety property is present so a human can review it"
  exclusions:
    - "Does NOT execute or run the scripts it drafts — a human runs them"
    - "Not for reviewing or fixing existing scripts (that is a review task)"
    - "Not a substitute for shellcheck/shfmt or a human security review"
    - "Not for languages other than Bash/POSIX shell"

source_inspiration: []  # No external source; grounded in the playbook's own standards.

changelog:
  - version: "1.0.0"
    date: "2026-07-01"
    change_type: minor
    summary: "Initial version — drafts safe Bash to a clean-script standard (strict mode, mktemp + trap, quoted vars, dry-run default), refuses curl|sh/eval/secret dumps, never executes."

collection: engineering
routing:
  task_types:
    - "author"
  input_artifacts:
    - "artifact-brief"
  output_artifacts:
    - "shell-script"
  prefer_when:
    - "the request is to author a safe shell/bash script"
  aliases:
    - "bash author"
    - "safe script"
    - "automation script"
---

# Skill: Safe Shell Script Author

Draft a **new Bash script** from a stated intent, built to a **clean-script
standard**: strict mode (`set -euo pipefail`), `mktemp` + `trap` cleanup, quoted
expansions, a `--help` usage block, and a **dry-run default** that needs
`--apply` to mutate anything. The output is a script plus a short rationale for
each safety property.

> **This skill DRAFTS scripts; it never executes them.** Every script it emits
> defaults to dry-run and must be read and run by a human. It refuses to produce
> `curl | sh`, `eval` on external data, or code that dumps secrets. Authoritative
> secure-coding policy lives in the
> [agentic-coding-playbook](https://github.com/GSA-TTS/agentic-coding-playbook);
> this skill points there rather than restating it.

## When to Use

- A task asks you to write a new Bash automation, cleanup, or setup script
- You want a safe skeleton (strict mode, cleanup, dry-run) as a starting point
- You need the "why" behind each safety choice for a review

## When NOT to Use

- To **run** a script — this skill only drafts; a human executes
- To review or repair an **existing** script (that is a separate review task)
- For non-shell languages (Python, Go, etc.)
- When the request itself is unsafe (see When NOT to Use → refuse, below)

## Prerequisites

- A clear statement of what the script should do (inputs, outputs, side effects)
- Locally: `shellcheck` and `shfmt` available to lint/format the draft
- The playbook secure-code-generation rules for reference (see References)

## Procedure

### 1. Gather intent

Confirm the goal, inputs, and any **side effects** (files touched, dirs deleted,
services called). If the request needs a destructive action (delete, overwrite,
network call), note it — it will be gated behind `--apply` and guards.

If the intent is inherently unsafe and cannot be made safe — e.g. "pipe this URL
straight into bash", "eval this user string", "print all env vars including
secrets" — **decline** and explain the safer alternative instead of emitting it.

### 2. Emit the clean-script skeleton

Draft the script on this skeleton. Every property below is required:

- **Strict mode:** first real line is `set -euo pipefail`
- **Safe IFS:** `IFS=$'\n\t'` to avoid word-splitting surprises
- **Temp files via `mktemp`:** never a fixed `/tmp/foo` path
- **Cleanup trap:** `trap cleanup EXIT INT TERM` removes temp files on any exit
- **Quote all expansions:** `"$var"`, `"$@"`, `"${arr[@]}"` — never bare `$var`
- **Usage / `--help`:** a `usage()` function and arg parsing
- **Dry-run default:** the script previews actions by default; only `--apply`
  performs mutations. Guard each destructive line on the apply flag.
- **No `curl | sh`:** download and verify to a temp file, then act — never pipe
  a remote body straight into a shell
- **No `eval`** on external or untrusted data
- **No secret dumps:** never `printenv` / `env` / echo credentials or tokens

### 3. Lint mentally (shellcheck + shfmt)

Read the draft as `shellcheck` would: unquoted vars, unset-var use, masked exit
codes, `cd` without `|| exit`. Read it as `shfmt` would: consistent indentation
and spacing. Fix issues before presenting. Note that the human should still run
both tools for real.

### 4. Present with rationale

Return the Output Contract below: a short Summary, the fenced `bash` script, and
a one-line rationale for each safety property so a reviewer can verify intent.

## Clean-Script Standard

A drafted script MUST satisfy every item:

- [ ] `set -euo pipefail` is the first executable line
- [ ] `IFS=$'\n\t'` set to tame word-splitting
- [ ] All variable expansions are quoted (`"$var"`, `"$@"`)
- [ ] Temp files created with `mktemp`; no fixed temp paths
- [ ] `trap cleanup EXIT INT TERM` removes temp files
- [ ] A `usage()` / `--help` block documents flags
- [ ] Dry-run is the **default**; `--apply` is required to mutate
- [ ] Destructive commands (`rm`, overwrite) are guarded by the apply flag
- [ ] No `curl … | sh` / `wget … | sh`
- [ ] No `eval` on external data
- [ ] No printing of environment variables or secrets

## Output Contract

```markdown
## Summary
<1-3 sentences: what the script does, its default dry-run behavior, and the guard on mutations.>

## Script
​```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
# ... the safe script ...
​```

Rationale:
- **Strict mode / IFS:** stop on errors and unset vars; tame word-splitting.
- **mktemp + trap:** temp files are unique and always cleaned up.
- **Quoted expansions:** no accidental splitting or globbing.
- **Dry-run default:** previews actions; `--apply` required to change anything.
- **No curl|sh / eval / secret dumps:** avoids remote-code and disclosure risks.
```

## Verification

Confirm the emitted script:

- Contains `set -euo pipefail`
- Quotes its variable expansions and includes a `trap` cleanup
- **Defaults to dry-run** (a `--apply` flag gates every mutation)
- Has both required sections (`Summary`, `Script`)

And contains **none** of:

- `curl … | sh` or `wget … | sh` (pipe-to-shell)
- `eval` on external/untrusted data
- `rm -rf` without a guard (never an unguarded `rm -rf /` or `rm -rf "$var"`
  where `$var` could be empty)
- `printenv` / `env` output or any echo of secrets/tokens

## Examples

### Example 1 — safe file-cleanup script (dry-run + trap)

Intent: "Delete `*.tmp` files older than 7 days under a given directory."

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

APPLY=0
TARGET_DIR=""
WORKFILE=""

usage() { echo "Usage: cleanup-tmp.sh --dir <path> [--apply] [--help]"; }

cleanup() { [[ -n "${WORKFILE}" && -f "${WORKFILE}" ]] && rm -f "${WORKFILE}"; }
trap cleanup EXIT INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) TARGET_DIR="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "${TARGET_DIR}" || ! -d "${TARGET_DIR}" ]]; then
  echo "Error: --dir must be an existing directory" >&2
  usage; exit 2
fi

WORKFILE="$(mktemp)"
find "${TARGET_DIR}" -type f -name '*.tmp' -mtime +7 -print >"${WORKFILE}"

while IFS= read -r file; do
  if [[ "${APPLY}" -eq 1 ]]; then
    rm -f -- "${file}"; echo "deleted: ${file}"
  else
    echo "[dry-run] would delete: ${file}"
  fi
done <"${WORKFILE}"
```

Rationale: strict mode + safe IFS; `mktemp` list file with a `trap` that removes
it; every deletion is guarded by `--apply`; expansions are quoted; `rm -f --`
cannot consume a flag-like or empty path.

### Example 2 — good vs rejected pattern (download)

- **Rejected (never emit):** `curl -fsSL https://example/install.sh | sh` — pipes
  an unverified remote body straight into a shell.
- **Good (emit instead):** download to a `mktemp` file, show/verify it, then run
  only under `--apply`:

```bash
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
curl -fsSL "$URL" -o "$tmp"
echo "[dry-run] fetched installer to $tmp; review before running"
[[ "${APPLY}" -eq 1 ]] && bash "$tmp"
```

### Example 3 — refusing an unsafe request

Intent: "Write a script that prints every environment variable so I can grab the
API token."

Response: **Decline.** Dumping the environment exposes secrets. Draft instead a
script that reads only the one **named, non-secret** variable it needs, or reads
credentials from a secret store at runtime — never echoes them.

## References

- The [clean-script standard](../../../docs/clean-script-standard.md) — the
  authoritative required/prohibited checklist this skill emits to (enforced by
  the unsafe-pattern scanner).
- Secure code generation (never restated here):
  [playbook `AGENTS.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/AGENTS.md)
  §5, and
  [`CODING_PRACTICES.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
- ShellCheck (static analysis for shell): <https://www.shellcheck.net/>
- shfmt (shell formatter): <https://github.com/mvdan/sh>
- Governance model for security skills:
  [`docs/security-skill-governance.md`](../../../docs/security-skill-governance.md)
