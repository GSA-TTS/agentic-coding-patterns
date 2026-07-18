# Security-Skill Intake Record — security-scan-review

> Required by the security-skill governance when a skill is inspired by an
> external source. Records provenance so the human reviewer can confirm no
> copying occurred.

## Skill

- **id:** `security-scan-review` (type: workflow)
- **Home:** `agentic-coding-patterns/workflows/security-scan-review/`

## Source inspiration

| Field | Value |
|-------|-------|
| Name | Alibaba open-code-review ("OCR", the `ocr` CLI) |
| URL | https://github.com/alibaba/open-code-review |
| License | Apache-2.0 |
| Origin | Alibaba (PRC-origin vendor) |
| Relationship | **source-reviewed** (Apache-2.0 permits study; we read the source to learn, executed nothing, ran no binary/installer) |

## What was taken (concepts only)

Architectural *ideas*, reimplemented in our own idiom as a prompt/workflow skill:

- The deterministic-engineering vs. LLM-agent split (deterministic steps must not go wrong; the agent handles interpretation).
- Category/severity finding taxonomy.
- Precision-over-recall stance.
- The general notion of a delegation mode (deterministic scaffolding, host agent reasons).

## What was explicitly NOT taken

- **No code copied.** No Go source, no scripts, no prompt bodies, no rule files were reproduced or transcribed.
- **No binary vendored or executed.** We did not run `ocr`, its `install.sh`, or any release artifact (PRC-origin binary that ingests source diffs and calls an LLM endpoint — out of bounds for this federal context).
- **We inverted their core design.** OCR is LLM-first (the model proposes findings, deterministic code anchors them). Our workflow is **scanner-first** (deterministic scanners find issues, the agent triages). We deliberately did not reproduce their LLM-first architecture.
- **We rejected recloning their compiled tool** (documented in the consensus vote): their one novel compiled piece — a snippet→line-range resolver — exists only because they lack scanner line numbers; our SARIF-native scanners provide positions for free.

## Federal additions absent from the source

- NIST 800-53 control mapping per finding (deterministic lookup, not LLM-inferred).
- Supply-chain vetting of every scanner (license, origin, telemetry) in the registry.
- Fail-closed on ambiguity + mandatory human gate.
- No-external-egress default; secret redaction before agent context; prompt-injection handling of scanner output.
- Provenance manifest (scanner/DB/model/ruleset versions + SARIF + diff hashes).

## Reviewer confirmation (to be completed at PR)

- [ ] Reviewer confirms no OCR code/text was copied.
- [ ] Reviewer confirms the PRC-origin binary was neither vendored nor executed.
- [ ] Reviewer confirms the scanner-first design and federal additions are our own.
