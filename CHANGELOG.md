# Changelog

## [1.8.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.7.0...v1.8.0) (2026-08-04)


### Features

* **acq-kits:** openchamber wrapper owns a shared opencode server ([#234](https://github.com/GSA-TTS/agentic-coding-patterns/issues/234)) ([0e04073](https://github.com/GSA-TTS/agentic-coding-patterns/commit/0e04073056b792ee07840cbca3bf6f1a794d834f))
* **acq-kits:** startup script owns the shared server for a terminal-free openchamber ([#246](https://github.com/GSA-TTS/agentic-coding-patterns/issues/246)) ([d27c22b](https://github.com/GSA-TTS/agentic-coding-patterns/commit/d27c22bb068465abfcbbd13260a25bd59683d156))
* **communications:** design-artifact pack + workflow + multi-artifact output ([#241](https://github.com/GSA-TTS/agentic-coding-patterns/issues/241)) ([#270](https://github.com/GSA-TTS/agentic-coding-patterns/issues/270)) ([74f198e](https://github.com/GSA-TTS/agentic-coding-patterns/commit/74f198e554f62ec42d061d10055ab93571159770)), closes [#237](https://github.com/GSA-TTS/agentic-coding-patterns/issues/237)
* **integrations:** add backend-aware pricing to USAi provider ([#281](https://github.com/GSA-TTS/agentic-coding-patterns/issues/281)) ([acdfae8](https://github.com/GSA-TTS/agentic-coding-patterns/commit/acdfae88217738f82f6a2a2456fb7b048a565394))
* **kits:** add bundle provenance schema + permission/drift guards ([#273](https://github.com/GSA-TTS/agentic-coding-patterns/issues/273)) ([#274](https://github.com/GSA-TTS/agentic-coding-patterns/issues/274)) ([5c55bcf](https://github.com/GSA-TTS/agentic-coding-patterns/commit/5c55bcf9fc77947b145a828f75877797ebd6d178))
* **kits:** add neutral publishedPorts + background to hybrid/v1 schema ([#276](https://github.com/GSA-TTS/agentic-coding-patterns/issues/276)) ([bf8add3](https://github.com/GSA-TTS/agentic-coding-patterns/commit/bf8add33c70191a8e4b6648780dbde480fc4227c))
* **meta:** add data-driven pattern-router + deterministic scorer ([#239](https://github.com/GSA-TTS/agentic-coding-patterns/issues/239)) ([#266](https://github.com/GSA-TTS/agentic-coding-patterns/issues/266)) ([2a805a9](https://github.com/GSA-TTS/agentic-coding-patterns/commit/2a805a9506a5a3ab2b8c552fc4b0e0ef265c1298)), closes [#237](https://github.com/GSA-TTS/agentic-coding-patterns/issues/237)
* **openchamber:** adopt neutral publishedPorts + background; sbx+msb parity ([#283](https://github.com/GSA-TTS/agentic-coding-patterns/issues/283)) ([6230faa](https://github.com/GSA-TTS/agentic-coding-patterns/commit/6230faa53ae88e125f04521ab8eee932eeaacdbc))
* **patterns:** classify patterns + deprecate safe-code-review [MERGE AFTER [#266](https://github.com/GSA-TTS/agentic-coding-patterns/issues/266)] ([#240](https://github.com/GSA-TTS/agentic-coding-patterns/issues/240)) ([#267](https://github.com/GSA-TTS/agentic-coding-patterns/issues/267)) ([ea6ea67](https://github.com/GSA-TTS/agentic-coding-patterns/commit/ea6ea6731ae8af3c3c376b5749c9f3bb3c2099c0))
* **schema:** add collection + routing taxonomy foundation ([#238](https://github.com/GSA-TTS/agentic-coding-patterns/issues/238)) ([#245](https://github.com/GSA-TTS/agentic-coding-patterns/issues/245)) ([25508e4](https://github.com/GSA-TTS/agentic-coding-patterns/commit/25508e41a8e956016268b6a38ef1c127bcf25b6b)), closes [#237](https://github.com/GSA-TTS/agentic-coding-patterns/issues/237)
* **workflows:** language-aware security-scan-review workflow ([#229](https://github.com/GSA-TTS/agentic-coding-patterns/issues/229)) [MERGE AFTER playbook[#157](https://github.com/GSA-TTS/agentic-coding-patterns/issues/157)] ([#230](https://github.com/GSA-TTS/agentic-coding-patterns/issues/230)) ([325b5b0](https://github.com/GSA-TTS/agentic-coding-patterns/commit/325b5b0fdbb740efb821186678ebfbef3c7d26e3))


### Bug Fixes

* **acq-kits:** reject shell-metachar paths in kit specs ([#225](https://github.com/GSA-TTS/agentic-coding-patterns/issues/225)) ([#236](https://github.com/GSA-TTS/agentic-coding-patterns/issues/236)) ([eb8a68c](https://github.com/GSA-TTS/agentic-coding-patterns/commit/eb8a68c870afa6b810d2b298ea4d3791b67215d8))
* **playbook-kit:** fetch via GitHub REST tarball for cross-backend auth (quickstart[#203](https://github.com/GSA-TTS/agentic-coding-patterns/issues/203)) ([#269](https://github.com/GSA-TTS/agentic-coding-patterns/issues/269)) ([3fcde8e](https://github.com/GSA-TTS/agentic-coding-patterns/commit/3fcde8ee396bf9841de47f6f7886db088164243d))
* **router:** stop broad workflow/trigger from displacing specific skills ([#271](https://github.com/GSA-TTS/agentic-coding-patterns/issues/271)) ([#272](https://github.com/GSA-TTS/agentic-coding-patterns/issues/272)) ([c39396d](https://github.com/GSA-TTS/agentic-coding-patterns/commit/c39396dbbee677e70890bb2cc101c18953e733e3))

## [1.7.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.6.0...v1.7.0) (2026-07-17)


### Features

* **acq-kits:** add environment vocabulary to hybrid/v1 schema ([#227](https://github.com/GSA-TTS/agentic-coding-patterns/issues/227)) ([7181d21](https://github.com/GSA-TTS/agentic-coding-patterns/commit/7181d2150004570ba81b8006b52c318d55fb2bf0))
* **acq-kits:** convert openchamber to hybrid/v1 and move to acq-kits/ ([#224](https://github.com/GSA-TTS/agentic-coding-patterns/issues/224)) ([900d2fa](https://github.com/GSA-TTS/agentic-coding-patterns/commit/900d2fa007c1cb4a32dfad59f0e974260c6fe1ba))

## [1.6.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.5.0...v1.6.0) (2026-07-16)


### Features

* **integrations:** add neutral hybrid/v1 acq-kits + schema + registry ([#221](https://github.com/GSA-TTS/agentic-coding-patterns/issues/221)) ([f386458](https://github.com/GSA-TTS/agentic-coding-patterns/commit/f386458c67ffd6c3757bf2f7b98af499f0962ab9))
* **sbx-kits:** add opt-in openchamber mixin kit ([#220](https://github.com/GSA-TTS/agentic-coding-patterns/issues/220)) ([9af380f](https://github.com/GSA-TTS/agentic-coding-patterns/commit/9af380f0d85ee07721c3f0b919809a68989f1aee))

## [1.5.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.4.0...v1.5.0) (2026-07-07)


### Features

* **ci:** add unsafe-shell-pattern scanner + wire into CI (M3 [#154](https://github.com/GSA-TTS/agentic-coding-patterns/issues/154), [#155](https://github.com/GSA-TTS/agentic-coding-patterns/issues/155)) ([#210](https://github.com/GSA-TTS/agentic-coding-patterns/issues/210)) ([f281707](https://github.com/GSA-TTS/agentic-coding-patterns/commit/f281707bac48fc494f5403ccf980b9759c17eed5))
* **integrations:** relax usai-provider permissions for sandbox use ([#201](https://github.com/GSA-TTS/agentic-coding-patterns/issues/201)) ([6cb6cde](https://github.com/GSA-TTS/agentic-coding-patterns/commit/6cb6cde94f228073555837028cb5150b7c80005a))
* **integrations:** vendor git-ssh-sign sbx mixin kit ([#200](https://github.com/GSA-TTS/agentic-coding-patterns/issues/200)) ([b791e04](https://github.com/GSA-TTS/agentic-coding-patterns/commit/b791e04a4dd6b97fe2cf172897e8cb3e9ddef1a1))
* **sbx-kits:** usai kit merges into global opencode config ([#216](https://github.com/GSA-TTS/agentic-coding-patterns/issues/216)) ([5de0f3b](https://github.com/GSA-TTS/agentic-coding-patterns/commit/5de0f3b53c5bd1ac514fdf8b50a7fd2afbad86c8))
* **schema:** add name field + tighten skill schema (additionalProperties: false) ([#202](https://github.com/GSA-TTS/agentic-coding-patterns/issues/202)) ([3f298d1](https://github.com/GSA-TTS/agentic-coding-patterns/commit/3f298d1cab567e1d7d2bce52fefd045ceba2ab85))
* **skills:** add Security Skills Pack M2 — 7 security review/authoring skills ([#205](https://github.com/GSA-TTS/agentic-coding-patterns/issues/205)) ([c736287](https://github.com/GSA-TTS/agentic-coding-patterns/commit/c7362877873f461603d0172c90ea6b517b2791d0))
* **skills:** Security Skills Pack M2 updates — secure-code-review + dependency-analysis ([#206](https://github.com/GSA-TTS/agentic-coding-patterns/issues/206)) ([f5e6898](https://github.com/GSA-TTS/agentic-coding-patterns/commit/f5e68980b341ae2fe4d8fc7f191b966e620fcbb9))
* **test:** security-skill fixtures + runner assertions (M3 [#156](https://github.com/GSA-TTS/agentic-coding-patterns/issues/156)/[#157](https://github.com/GSA-TTS/agentic-coding-patterns/issues/157)/[#158](https://github.com/GSA-TTS/agentic-coding-patterns/issues/158), [#203](https://github.com/GSA-TTS/agentic-coding-patterns/issues/203)) ([#212](https://github.com/GSA-TTS/agentic-coding-patterns/issues/212)) ([ecde334](https://github.com/GSA-TTS/agentic-coding-patterns/commit/ecde3349e398ed77e9bd796b44797c3483004ee0))


### Bug Fixes

* **ci:** suppress low adhoc-packages zizmor findings in frontend-skills-qa ([#215](https://github.com/GSA-TTS/agentic-coding-patterns/issues/215)) ([259ea27](https://github.com/GSA-TTS/agentic-coding-patterns/commit/259ea2704de68c324b4d0d18674b5369d5e0d406))

## [1.4.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.3.0...v1.4.0) (2026-07-01)


### Features

* **agents:** add sbx mixin kits for USAi provider, playbook, and zscaler cert ([#191](https://github.com/GSA-TTS/agentic-coding-patterns/issues/191)) ([598a57c](https://github.com/GSA-TTS/agentic-coding-patterns/commit/598a57cb9f5fd2e279046a5e740a7e9ea8173c71))

## [1.3.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.2.0...v1.3.0) (2026-06-30)


### Features

* **schema:** adopt categories taxonomy + additive security-governance fields ([#151](https://github.com/GSA-TTS/agentic-coding-patterns/issues/151)) ([#185](https://github.com/GSA-TTS/agentic-coding-patterns/issues/185)) ([a2aa1ac](https://github.com/GSA-TTS/agentic-coding-patterns/commit/a2aa1ac808a929430d46dcab62d1d53854550bfb))

## [1.2.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.1.1...v1.2.0) (2026-06-23)


### Features

* **outreach:** Add explainer-video and explainer-gif skills + outreach category ([#141](https://github.com/GSA-TTS/agentic-coding-patterns/issues/141)) ([1497b8c](https://github.com/GSA-TTS/agentic-coding-patterns/commit/1497b8c0700522e9999c5a9ba1cbc93e4c4ef359))
* **skills:** add over-engineering-review skill (ponytail-inspired) ([#140](https://github.com/GSA-TTS/agentic-coding-patterns/issues/140)) ([4209152](https://github.com/GSA-TTS/agentic-coding-patterns/commit/42091523cb4b91637dff437ea04e7b566f841300))

## [1.1.1](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.1.0...v1.1.1) (2026-06-22)


### Bug Fixes

* **ci:** Make Readability Check advisory-only so it can't block PRs ([#132](https://github.com/GSA-TTS/agentic-coding-patterns/issues/132)) ([b8ade77](https://github.com/GSA-TTS/agentic-coding-patterns/commit/b8ade774de3c6f99c3f0d93250805cb2abe0d61e))
* gitleaks config auto-load + markdownlint depth-2 globs ([#138](https://github.com/GSA-TTS/agentic-coding-patterns/issues/138)) ([0397900](https://github.com/GSA-TTS/agentic-coding-patterns/commit/039790075b91cff135f9f5f5317288ad4d826040))

## [1.1.0](https://github.com/GSA-TTS/agentic-coding-patterns/compare/v1.0.0...v1.1.0) (2026-06-10)


### Features

* **ci:** add frontend skills QA workflow ([#97](https://github.com/GSA-TTS/agentic-coding-patterns/issues/97)) ([001ad5a](https://github.com/GSA-TTS/agentic-coding-patterns/commit/001ad5a27fbe08d031e0754d382f06403758d938))
* migrate skills/ to .agents/skills/ per Agent Skills standard ([#82](https://github.com/GSA-TTS/agentic-coding-patterns/issues/82)) ([4e7e888](https://github.com/GSA-TTS/agentic-coding-patterns/commit/4e7e888c6508dfe5f3f1f6e869da5371bdb7267e)), closes [#81](https://github.com/GSA-TTS/agentic-coding-patterns/issues/81)
* **skills:** add deterministic tools for frontend skills ([a1e6fe9](https://github.com/GSA-TTS/agentic-coding-patterns/commit/a1e6fe93aba5ab73ea13822a68e60b06d10945f3))
* **skills:** add USWDS-first federal frontend skills pack ([#95](https://github.com/GSA-TTS/agentic-coding-patterns/issues/95)) ([94887ff](https://github.com/GSA-TTS/agentic-coding-patterns/commit/94887ff6fd109ab700eb7f3f3a349f448d0cd1f9))
* **skills:** expand P2 frontend skills ([#100](https://github.com/GSA-TTS/agentic-coding-patterns/issues/100), [#101](https://github.com/GSA-TTS/agentic-coding-patterns/issues/101)) ([cd97acd](https://github.com/GSA-TTS/agentic-coding-patterns/commit/cd97acd64ae0a7feb9ad01136dfcfcc59c6c0211))


### Bug Fixes

* **ci:** repair frontend-skills-qa startup failure and harden filename handling ([#118](https://github.com/GSA-TTS/agentic-coding-patterns/issues/118)) ([e88c4da](https://github.com/GSA-TTS/agentic-coding-patterns/commit/e88c4da15881a567c9e9d81bf9910a7ff1483971)), closes [#113](https://github.com/GSA-TTS/agentic-coding-patterns/issues/113)

## 1.0.0 (2026-05-28)


### Features

* Add AI Agent Integration Guide and tool examples ([aeb4672](https://github.com/GSA-TTS/agentic-coding-patterns/commit/aeb46726384f514b20989a1d4ab2215781a1d207))
* Add Dependabot and security hardening ([46eef8c](https://github.com/GSA-TTS/agentic-coding-patterns/commit/46eef8c568059650d143fde49bd3e151aac5c79e))
* bootstrap agentic-coding-patterns repository ([763c423](https://github.com/GSA-TTS/agentic-coding-patterns/commit/763c423298dad49e4a174e561b90ba9839a570c0))
* **ci:** Add GitHub Actions CI workflow and harden dependencies ([8ae8df1](https://github.com/GSA-TTS/agentic-coding-patterns/commit/8ae8df1bd1f07ec8b5df9ab8d9f20f8e597e7772))
* **ci:** Add pip-audit security scanning and SECURITY.md ([a45cf3d](https://github.com/GSA-TTS/agentic-coding-patterns/commit/a45cf3d7966d679b6f44067224f5c442fedb928b))
* **cli:** Add pattern discovery tool ([12a16ca](https://github.com/GSA-TTS/agentic-coding-patterns/commit/12a16ca04a5cb8fc3f1a22fe331106952a7197f2)), closes [#27](https://github.com/GSA-TTS/agentic-coding-patterns/issues/27)
* **github:** Add issue and PR templates for Epic [#9](https://github.com/GSA-TTS/agentic-coding-patterns/issues/9) ([7a3d660](https://github.com/GSA-TTS/agentic-coding-patterns/commit/7a3d660f23b0adb0d88335c2a94823f9310ccea3))
* **security:** Add CodeQL workflow for Python code scanning ([6492b59](https://github.com/GSA-TTS/agentic-coding-patterns/commit/6492b59b1e5bff0937c7f8e01617a4197182cda8)), closes [#33](https://github.com/GSA-TTS/agentic-coding-patterns/issues/33)
* **testing:** implement readability_max assertion type ([#73](https://github.com/GSA-TTS/agentic-coding-patterns/issues/73)) ([97e2950](https://github.com/GSA-TTS/agentic-coding-patterns/commit/97e2950654d24f051495dd3858d61504d0f004db)), closes [#60](https://github.com/GSA-TTS/agentic-coding-patterns/issues/60)
* **testing:** implement skill test runner for test-cases.yml ([5cab4ff](https://github.com/GSA-TTS/agentic-coding-patterns/commit/5cab4ff7f8c52e039b1a9273196d1bc94a74da8d)), closes [#16](https://github.com/GSA-TTS/agentic-coding-patterns/issues/16)


### Bug Fixes

* **build:** Add build-system config and fix license format ([5b04acd](https://github.com/GSA-TTS/agentic-coding-patterns/commit/5b04acd4b7236c3e7f18b71503f4cc9a75699ec4))
* **ci:** Compare parsed YAML data in generate-check ([b0d2061](https://github.com/GSA-TTS/agentic-coding-patterns/commit/b0d2061eff2f9276a216c86afa350c7b3d2465ca)), closes [#18](https://github.com/GSA-TTS/agentic-coding-patterns/issues/18)
* **ci:** Disable INDEX.yaml generate-check in CI ([9da57b7](https://github.com/GSA-TTS/agentic-coding-patterns/commit/9da57b75e7cc100a3c7f6413dd0b9d7e68940e9c)), closes [#18](https://github.com/GSA-TTS/agentic-coding-patterns/issues/18)
* **ci:** Normalize dict keys for YAML comparison ([12e26cd](https://github.com/GSA-TTS/agentic-coding-patterns/commit/12e26cd31553deda8866210faab49b6c40404e57)), closes [#18](https://github.com/GSA-TTS/agentic-coding-patterns/issues/18)
* **ci:** Remove generated date from INDEX.yaml ([a99d37c](https://github.com/GSA-TTS/agentic-coding-patterns/commit/a99d37c5668e9529c00976164e44596c410928dc)), closes [#18](https://github.com/GSA-TTS/agentic-coding-patterns/issues/18)
* **ci:** remove GITHUB_TOKEN secret from release workflow ([#77](https://github.com/GSA-TTS/agentic-coding-patterns/issues/77)) ([52f1bfb](https://github.com/GSA-TTS/agentic-coding-patterns/commit/52f1bfb4d91970da74b39d259478140be06ff848))
* **ci:** Remove Python 3.11 from CI matrix ([8517a04](https://github.com/GSA-TTS/agentic-coding-patterns/commit/8517a044effbf68b48076a49b814d05ded734fd6))
* **docs:** remove broken conversion-guide.md links ([#71](https://github.com/GSA-TTS/agentic-coding-patterns/issues/71)) ([cca41de](https://github.com/GSA-TTS/agentic-coding-patterns/commit/cca41de0829100ca9900e72450a642f5fccf87a9))
* **docs:** repair broken internal links ([#59](https://github.com/GSA-TTS/agentic-coding-patterns/issues/59)) ([369cabc](https://github.com/GSA-TTS/agentic-coding-patterns/commit/369cabc6c1c1bcc5988269a0c970788005212d1b)), closes [#57](https://github.com/GSA-TTS/agentic-coding-patterns/issues/57)
* **validation:** Add context-aware filtering to sensitive terms validator ([c9867ed](https://github.com/GSA-TTS/agentic-coding-patterns/commit/c9867ed6d9f8676860ca6a45f321e982fff03875)), closes [#13](https://github.com/GSA-TTS/agentic-coding-patterns/issues/13)
