# Clean-Script Standard

> **Purpose:** The safety standard for any shell script authored in, generated
> by, or executed within this repository's patterns and skills. Skills that emit
> scripts (e.g. [`safe-shell-script-author`](../.agents/skills/safe-shell-script-author/SKILL.md))
> MUST produce scripts that meet this standard; the unsafe-pattern scanner
> enforces the prohibited list in CI.

This standard is **federal-first and agency-portable** — it encodes ordinary
secure-shell practice, aligned with the playbook's
[`CODING_PRACTICES.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
and secure-code-generation rules. It does not restate playbook policy; it is the
concrete shell checklist those rules imply.

## Required

Every shell script MUST:

1. **Strict mode header.** Start with `set -euo pipefail` (fail on error, unset
   variable, or failed pipe). Set `IFS=$'\n\t'` when word-splitting matters.
2. **Quote every expansion.** Use `"$var"`, `"${arr[@]}"`, `"$(cmd)"` — never a
   bare `$var` that can word-split or glob.
3. **Temp files via `mktemp`.** Never hardcode `/tmp/whatever`; use
   `tmp="$(mktemp)"` (or `mktemp -d`).
4. **Clean up with `trap`.** Register cleanup for `EXIT INT TERM`, e.g.
   `trap 'rm -f "$tmp"' EXIT`.
5. **Dry-run by default for destructive actions.** A script that deletes, moves,
   overwrites, or mutates external state MUST default to a preview and require an
   explicit `--apply` (or equivalent) flag to make changes.
6. **Repo-local writes only.** Write within the workspace/project directory; do
   not write outside it without an explicit, reviewed reason.
7. **A `--help`/usage block** describing arguments and the dry-run vs apply
   behavior.
8. **Pass `shellcheck` and `shfmt`.** Resolve or explicitly justify every
   `shellcheck` finding; format with `shfmt`.

Every shell script SHOULD:

- Prefer explicit, named arguments over positional ones for anything
  non-obvious.
- Check prerequisites (required commands on `PATH`) and fail with a clear
  message rather than a cryptic error mid-run.
- Keep functions small and single-purpose.

## Prohibited

A shell script MUST NOT contain any of the following. The unsafe-pattern scanner
([#154](https://github.com/GSA-TTS/agentic-coding-patterns/issues/154)) flags
these in tracked scripts and skill examples, failing CI on a violation:

| Prohibited pattern | Why |
|--------------------|-----|
| `curl … \| sh` / `wget … \| sh` / piping a remote script to an interpreter | Executes unreviewed remote code; unpinned, unverifiable supply chain |
| `eval` on external/untrusted input | Arbitrary code execution / injection |
| `exec` on untrusted input | Same |
| Unguarded `rm -rf` (especially `rm -rf /`, `rm -rf "$var"` with no guard) | Catastrophic deletion on an unset/empty variable |
| `chmod 777` (or other world-writable grants) | Over-broad permissions |
| `set +e` (disabling error-exit) without a scoped, justified reason | Silences failures |
| Dumping the environment (`env`, `printenv`, `export -p`) to a log/file/output | Can surface secrets outside the sandbox boundary |
| Reading host credential/dotfiles (`~/.ssh/*`, `~/.aws/*`, `~/.config/gcloud/*`, `~/.kube/*`, `.env`, `*.pem`, `*.key`) | Credential exposure / exfiltration surface |
| Hardcoded secrets, tokens, passwords, or private keys | Secret in source |

## Documented anti-patterns (allowed in teaching material)

Skill and doc authors legitimately need to *show* a prohibited pattern in order
to teach against it. A prohibited pattern is permitted **only** when it is
clearly marked as an anti-pattern — e.g. labeled `Rejected`, `never emit`,
`BAD`, `# anti-pattern`, or shown inside a "what not to do" example. The
unsafe-pattern scanner allowlists these clearly-marked teaching examples so it
does not false-positive on the pack's own guidance. An unmarked prohibited
pattern in an emitted or runnable script is a violation.

## Example — a clean script skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

usage() { printf 'Usage: %s [--apply] <target-dir>\n' "$0"; }

apply=0
case "${1:-}" in
  --apply) apply=1; shift ;;
  -h|--help) usage; exit 0 ;;
esac

target="${1:-}"
[ -n "$target" ] || { usage; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT INT TERM

# Preview by default; only mutate under --apply.
if [ "$apply" -eq 1 ]; then
  # ... perform the guarded change on "$target" ...
  printf 'applied changes to %s\n' "$target"
else
  printf '[dry-run] would change %s (re-run with --apply)\n' "$target"
fi
```

## References

- Playbook [`CODING_PRACTICES.md`](https://github.com/GSA-TTS/agentic-coding-playbook/blob/main/docs/CODING_PRACTICES.md)
  and secure code-generation rules (authoritative; not restated here).
- [`safe-shell-script-author`](../.agents/skills/safe-shell-script-author/SKILL.md)
  — the skill that drafts scripts to this standard.
- [ShellCheck](https://www.shellcheck.net/) and
  [shfmt](https://github.com/mvdan/sh) — the tooling this standard assumes.
