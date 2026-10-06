# model-router (acq mixin kit)

An [acq](https://github.com/GSA-TTS/agentic-coding-quickstart) **mixin kit**
(`schemaVersion: hybrid/v1`) that ships a small, dependency-free **stdio MCP
server** and registers it with OpenCode so the agent gets one tool,
`model_select`. The tool suggests the **smallest/cheapest available model** that
still satisfies a coding request's demands (reasoning depth, context length,
image input) — or **abstains** when no model switch is warranted.

## Why

Running an expensive model on a one-line typo fix wastes money; running a weak
model on an architecture problem wastes a turn. A quick, up-front "which model
fits this request?" check keeps model choice proportional to the task — the same
idea behind the public
[`jev-skill-router`](https://github.com/ydmw74/jev-skill-router), applied to
**models** instead of skills.

## Advisory tool vs. automatic proxy (planned)

This kit is **advisory**: the `model_select` tool *recommends* a model; the agent
(or you) decides whether to adopt it. OpenCode gives a tool no hook to change the
active model mid-turn, so this kit cannot auto-switch.

A separate, **planned** kit — `model-router-proxy` — will make routing automatic
by pointing OpenCode's `usai` `baseURL` at a running **model-router-service**
(an OpenAI-compatible proxy that inspects each prompt, picks a model via a graded
reasoning score + a cheap LLM judge, and forwards transparently). That is the
request-path counterpart to this advisory tool, and the two compose (proxy for
auto-switch, this tool for in-agent visibility). See the proposal in
[`docs/proposals/model-router-proxy-kit.md`](docs/proposals/model-router-proxy-kit.md)
(tracking only — it lands after the service is ready).

## Inspiration, not copy

This kit mirrors the **shape** of `jev-skill-router` (a stdio MCP server that
suggests at most one choice, with "ignore it if it does not fit" framing). It
does **not** copy its scripts, prompt bodies, or skill bodies, and it deliberately
replaces that project's **proprietary, paid TypeSafe "Jev" Decisions API** (two
network LLM-judge calls per request) with a **local, deterministic,
zero-dependency Python scorer**. See
[`docs/decisions/0001-local-scorer-not-proprietary-api.md`](docs/decisions/0001-local-scorer-not-proprietary-api.md).

## What it does

- **Drops a tiny MCP server** (`files/home/model-router/*.py`) — pure Python
  standard library, no pip, no venv, no ML model, no network at runtime.
- **Registers it with OpenCode** at startup by **merging** a single
  `mcp.model-router` entry into the global config (preserving every other key and
  MCP server — see
  [`docs/decisions/0002-...`](docs/decisions/0002-stdio-mcp-server-merged-into-opencode-config.md)).
- **Installs a companion skill** (`SKILL.md`) that tells the agent WHEN to call
  `model_select` and that an abstain is a valid answer.

## The tool

```
model_select(request: str, max_cost_rank?: int)
  → { decision: "suggest" | "abstain",
      suggested: str|null, suggested_name: str|null,
      demands: [str], reason: str, shortlist: [str], excluded: [...],
      suggestion_block: str }
```

- `decision: suggest` — `suggested` is the cheapest model covering the detected
  demands; `reason` explains why; `excluded` lists why cheaper/other models were
  dropped.
- `decision: abstain` — keep the current model (e.g. a plain prose question, or
  no model covers a hard requirement).
- `max_cost_rank` — optional cost ceiling (`1` = cheapest tier); pricier models
  are excluded, so a user can cap routing to cheaper models.

## How it decides (deterministic, offline)

1. The request is reduced to the **capabilities it demands** — `reasoning`,
   `coding`, `fast`, `long_context`, `vision` — via transparent keyword cues
   (`model_router.py`).
2. Each model family has an explicit **capability profile + cost rank**
   (`catalog.py`), reviewed as data.
3. The scorer suggests the **cheapest model that covers every demanded
   capability** and meets hard limits (context window, vision), or **abstains**.

Everything is explainable and unit-tested — no embeddings, no vector DB, no paid
API. At a ~10-model catalog this is cheaper, clearer, and more reliably testable
than semantic ranking (the same rationale as the repo's own
`.agents/skills/meta/pattern-router`).

## Candidate roster (where the models come from)

In priority order:

1. **`MODEL_ROUTER_CATALOG`** — path to a JSON file of
   `{ id, name, capabilities, context, cost_rank }` profiles. Operator override;
   use this to supply a fully custom, vendor-agnostic roster.
2. **`MODEL_ROUTER_LIVE_IDS`** — path to a USAi `/models` snapshot
   (`{ "data": [ { "id": ... } ] }`). Each live id is mapped to its family's
   bundled capability profile, so the router suggests **real catalog ids**.
3. **Bundled default** — a hand-authored capability profile per USAi model family
   (Claude / GPT / Gemini / Llama / Cohere). Keeps the kit fully functional
   offline.

Model-provider configuration and the live model LIST are the separate
[`usai-provider`](../usai-provider/) kit's job; compose the two with two `--kit`
flags. This kit only **routes** among whatever models are available.

## Usage

```bash
acq create --name dev opencode /path/to/project \
  # compose with the provider + catalog kit:
  # (acq's extra-kit mechanism — see acq docs)
```

The kit is a `mixin`, so it composes with the `opencode`, `usai-provider`, and
other GSA kits.

## Permissions / egress

**None.** This kit declares no `caps.network.allow`: the scorer and MCP server
make zero network calls. The only runtime requirement is `python3` on PATH
(standard library only). This is the smallest egress surface in the kit family.

## Fail-soft

A model router is an optional convenience. Missing `python3`, an unparseable
global config, or any scorer error degrades to "no suggestion / keep current
model" and exits 0 — it never fails the sandbox. The install step also
**self-tests** the scorer at startup, so a syntax/typo regression surfaces in the
log rather than silently at the first tool call.

## If your global config has comments (JSONC)

The startup merge uses stdlib `json`, which cannot round-trip JSONC comments. If
your existing `~/.config/opencode/opencode.jsonc` carries comments, the merge
step **leaves it untouched** and logs a note. Add this block by hand:

```jsonc
"mcp": {
  "model-router": {
    "type": "local",
    "command": ["python3", "/home/agent/model-router/mcp_server.py"],
    "enabled": true
  }
}
```

## Tuning the routing policy

The capability profiles and cost ranks are **coarse, conservative data**, not a
benchmark leaderboard. Tune `catalog.py` in a reviewed change as your measured
misroutes evolve, or override entirely with `MODEL_ROUTER_CATALOG`.

## Future: optional semantic scoring

The deterministic scorer under-detects demands only when a request shares no
keyword cue with any capability (a safe abstain). If measured misroutes justify
it, a semantic scorer (e.g. an Ollama-served GGUF embedding model, or an embedded
ONNX model) can be added as an **opt-in behind an env flag** without changing the
`model_select` contract. We ship deterministic-first on purpose — see
[`docs/decisions/0001-...`](docs/decisions/0001-local-scorer-not-proprietary-api.md).

## Central / shared server (many sandboxes, one policy)

By default each sandbox scores **locally** — no server, no network. For a fleet,
you can run **one central decision server** and point every sandbox at it via
**adapter mode** (`MODEL_ROUTER_ADAPTER_URL`), so routing policy lives in one
place. Two interchangeable backends sit behind one HTTP contract:

- **Open-source** (`http_server.py`) — the same scorer exposed over HTTP;
  stateless, zero-dependency, recommended.
- **TypeSafe/Jev** — a thin central shim you own that forwards to the proprietary
  Decisions API (the key stays central; no sandbox holds it).

Adapter mode is opt-in and **fail-soft**: any central-server failure falls back to
the local scorer for that turn. Full operator guide — running the server,
packaging, egress allow-listing, token handling, and hardening — is in
[`docs/central-server.md`](docs/central-server.md); the rationale is
[`docs/decisions/0003-central-shared-server.md`](docs/decisions/0003-central-shared-server.md).

## Testing

```bash
npm test            # from this kit dir — runs the offline unit tests
# or:
python3 tests/test_model_router.py
```

## Verifying

```bash
./scripts/verify              # offline gate (schema + scorer self-test)
RUN_ACQ=1 ./scripts/verify    # live: create a sandbox, assert the tool is registered
```

## Layout

```
model-router/
├── spec.yaml                              # the kit (hybrid/v1)
├── files/home/
│   ├── model-router/
│   │   ├── mcp_server.py                  # stdio MCP server (stdlib only)
│   │   ├── model_router.py                # deterministic request→model scorer
│   │   ├── catalog.py                     # capability profiles + roster loading
│   │   ├── adapter.py                     # optional client → central endpoint (adapter mode)
│   │   ├── http_server.py                 # run the scorer as a central HTTP service
│   │   └── SKILL.md                       # companion skill (copied into skills dir)
│   └── model-router-install.sh            # startup: self-test + register + install skill
├── skill/SKILL.md                         # source of the companion skill
├── scripts/verify                         # offline gate + opt-in live check
├── tests/                                 # offline unit tests + fixtures
├── docs/
│   ├── central-server.md                  # running a shared decision server for all sandboxes
│   └── decisions/                         # numbered design decision records
├── package.json                           # npm test shim
└── README.md
```

## Parity note (acq backends)

Written entirely in the neutral `hybrid/v1` vocabulary (`files` / `commands`)
with no backend shortcut. Both `sbx` and `msb` drop the Python payload and run
the identical startup self-test + config-merge + skill-install step. No published
port (the server speaks stdio to its OpenCode host). No egress on either backend.
