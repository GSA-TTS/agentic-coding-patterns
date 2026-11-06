---
title: "Retire the Prime Agent kit and dedicated USAi emitter"
status: "proposed"
date: "2026-11-06"
decision_makers: ["Patterns maintainers"]
category: "isolation-kits"
impact_level: "breaking"
---

# ADR 0004 - Retire Prime Agent

## Context

The Prime Agent integration shipped as a kit skeleton: its install and kernel
bootstrap scripts were placeholders. A dedicated USAi emitter populated its
committed `models.json`, but that artifact did not make the kit operational.
Keeping this scaffold in the active registry suggests a supported path that the
repository does not provide.

## Decision

Remove the `integrations/isolation/acq-kits/prime-agent/` tree, its registry
entry, the dedicated `integrations/providers/usai/emitters/prime-agent.mjs`
emitter, and the emitter and generated-artifact tests. Do not retain a stub kit,
alias, or automatic fallback under the retired name.

[OpenCode](../../integrations/isolation/acq-kits/opencode/) and
[Pi](../../integrations/isolation/acq-kits/pi-coding-agent/) are the reference
harnesses. This does not remove other harness patterns, including Goose and
Codex, or promise feature or operational parity. Pi's kit provides CLI
installation only; its USAi model configuration remains deferred. The neutral
provider catalog, snapshot, and refresh contract remain in place.

## Migration and compatibility

This is a breaking removal for consumers that select the retired kit path or
import its emitter. Old immutable commit pins still contain the legacy files;
removal from the current tree neither changes those pins nor uninstalls anything
from an existing sandbox.

1. Review the selected kit references in the consuming configuration. Remove
   the retired kit selection before adopting a revision without it.
2. Choose OpenCode or Pi explicitly and follow that kit's README. Do not silently
   substitute one for the other. Pi still requires manual provider setup as
   documented by its kit; it is not a drop-in USAi-configured replacement.
3. Review credentials, egress, tool permissions, and model choices for the chosen
   harness. There is **no automatic configuration conversion**, including from
   the legacy `models.json`.
4. Recreate and verify the sandbox using the consumer's supported lifecycle.
   Quickstart references and any pin update require a separate change in that
   repository; this Patterns change does not update them.

## History and verification

Keep released CHANGELOG entries and historical facts in earlier ADRs. Dated
notes on those ADRs point here so they are not mistaken for current support.
The shared kit drift suite checks that the removed assets and dedicated invokes
stay absent while the OpenCode and Pi kit entries and payloads remain.

## Links / tracking

- GSA-TTS/agentic-coding-patterns#584
