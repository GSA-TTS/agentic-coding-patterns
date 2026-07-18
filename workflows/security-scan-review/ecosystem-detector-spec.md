# Ecosystem Detector — Spec (deterministic, offline)

> A small deterministic helper the `security-scan-review` workflow calls in
> step 1. No LLM, no network. Same repo state → identical output. Language of
> implementation TBD at build (shell or Python stdlib); this is the behavior
> contract + test plan, not an implementation.

## Purpose

Answer one question: **which ecosystems are present, so which scanners should
run?** This is a set-membership problem, not a "what % is language X" problem —
so a simple manifest-glob detector is sufficient (a linguist-class tool like
`enry` is a future option, not needed for v1).

## Inputs / outputs

- **Input:** a repo path (and optionally a diff/base ref to scope detection).
- **Output:** a normalized JSON array of
  `{ ecosystem, confidence: high|medium|low, evidence_files: [...] , dir: <manifest dir> }`.

## Algorithm

1. **File universe (deterministic):**
   - If `.git` exists: `git ls-files` (inherently honors `.gitignore`).
   - Else: walk the tree, pruning `node_modules, vendor, third_party, dist,
     build, out, .venv, venv, target, .terraform, bin, obj, __pycache__, .git,
     .gradle`. Sort for stable order.
2. **Manifest/lockfile pass (authoritative → confidence high):**
   - python: `pyproject.toml, requirements*.txt, Pipfile, setup.py, setup.cfg, poetry.lock, uv.lock`
   - javascript/typescript: `package.json, package-lock.json, yarn.lock, pnpm-lock.yaml` (+ `tsconfig.json`/`.ts` census → typescript)
   - go: `go.mod, go.sum`
   - java/kotlin: `pom.xml, build.gradle, build.gradle.kts, settings.gradle` (`.kts` → kotlin)
   - rust: `Cargo.toml, Cargo.lock`
   - ruby: `Gemfile, Gemfile.lock, *.gemspec`
   - dotnet: `*.csproj, *.fsproj, *.sln, packages.config`
   - php: `composer.json, composer.lock`
   - terraform: `*.tf, *.tf.json, .terraform.lock.hcl`
   - docker: `Dockerfile, *.dockerfile, docker-compose.yml`
   - kubernetes: `*.yaml` with `apiVersion:`/`kind:` (best-effort)
   - Record the manifest's **directory** (enables monorepo sub-project scoping).
   - Lockfile present → high; manifest-only → high; build-config-only → medium.
3. **Extension census (corroboration → medium/low):** over the de-noised universe,
   count source extensions to (a) split JS vs TS, (b) detect manifest-less
   languages (bare C, pure shell). Census-only detection → medium/low.
4. **Shebang pass (targeted):** first line of extension-less files in `bin/`,
   `scripts/`, root → shell/python/node/ruby.
5. **Secrets is universal:** always emit `any` so a secrets scanner runs.
6. **Normalize:** merge per ecosystem, dedupe evidence, highest confidence wins,
   sort by (confidence, ecosystem).

## Edge cases (must handle)

- **Monorepo / polyglot:** emit the *set* (union) of ecosystems with per-dir
  evidence; never collapse to one "primary."
- **IaC-only:** `.tf`/Dockerfile/k8s, no app manifest → terraform/docker/kubernetes,
  not "no ecosystem."
- **Docs-only:** mostly `.md` → emit `docs-only`; run only secrets scanning.
- **Vendored/generated inflation:** handled by git-ls-files + prune list.
- **Empty repo:** emit empty set (workflow reports "nothing to scan").

## Test plan (fixtures)

Deterministic fixtures under a `fixtures/` tree, each asserting the exact output set:

- `py-poetry/` (pyproject+poetry.lock) → python:high
- `node-ts/` (package.json+tsconfig+*.ts) → typescript:high, javascript:medium
- `go-mod/` → go:high
- `monorepo/` (root go.mod + `frontend/package.json`) → {go:high (dir=.), javascript:high (dir=frontend)}
- `iac-only/` (*.tf + Dockerfile) → terraform:high, docker:high
- `docs-only/` (*.md) → docs-only
- `vendored/` (tiny go app + huge node_modules) → go:high, NOT javascript (pruned)
- every fixture also yields `any` (secrets)

Determinism assertion: run twice, byte-identical output.
