# Evidence & Measurement Guidance

Reference for talking about the value of agentic coding **honestly** — how to
label evidence, how to handle conflicting research, and which metrics to use vs.
avoid. Consumed mainly by `agentic-value-analyst`, but usable by any explainer.

## 1. Label every claim by evidence class

Never state a value claim without making its basis clear. Use these five classes:

| Class | Meaning | How to phrase |
|-------|---------|---------------|
| **Published research** | An external, methodologically transparent study | "External research (DORA 2024 / METR 2026) reports…" |
| **Measured local** | A first-party, countable figure from our own systems | "Measured in our repos (GitHub, pulled <date>): …" |
| **Anecdotal** | An individual observation, not systematically measured | "Anecdotally, engineers report…" |
| **Hypothesis** | A reasoned expectation we have not tested | "We expect, but have not measured, …" |
| **Expected future** | A benefit contingent on work not yet done | "As X matures, we anticipate…" |

A claim with no class is not ready to ship. If you cannot classify it, cut it.

## 2. Handle conflicting and time-sensitive evidence

The evidence on AI-assisted development is genuinely mixed and moves fast.

- Early controlled studies have shown AI **slowing** experienced developers on
  familiar tasks; later self-reported data shows gains. Both can be true for
  different tasks, tools, and skill levels.
- Autocomplete-style assistants and agentic workflows are **different
  interventions** — do not treat evidence about one as evidence about the other.
- Effect depends on task suitability (boilerplate and investigation benefit more
  than novel, deeply-contextual design work) and on developer experience.

**How to present it:** show the range, name the disagreement, and do not anchor
on a single multiplier. "Does AI make developers 50% faster?" has no honest
single-number answer — explain *what it depends on* instead.

## 3. Prefer defensible delivery metrics

Good metrics measure delivery and quality outcomes, are countable, and are hard
to game without also improving the work:

- issue → first-working-implementation time
- pull-request cycle time; change lead time; review time
- change failure rate; rework rate
- defects caught before merge; security findings caught before merge
- documentation updated alongside the change
- repetitive-investigation time saved
- onboarding time for new team members
- reusable skill/pattern adoption; number of teams/projects using shared capabilities
- developer satisfaction — with the caveat that it is self-reported

Pair any effort metric with a quality/outcome metric so throughput is never read
as value on its own.

## 4. Avoid vanity and misleading metrics

These look like productivity but are not; do not present them as value:

- **Lines of AI-generated code** — more code is a cost, not an outcome.
- **Prompt count / token count** — usage, not value; higher can mean less
  efficient.
- **Number of agents spawned** — activity, not outcome.
- **Raw pull-request count without quality/context** — effort, not value; easy to
  inflate.

If asked about one of these, name why it misleads and offer the defensible
metric that answers the real question.

## 5. Cost / value framing

- Distinguish **cost-avoidance estimate** from **audited savings** — say which.
- If there is no without-AI control group, say so; it makes any figure an
  estimate, not a measurement.
- Show the method and the single largest assumption; lead with the conservative
  figure.
- Separate **countable** inputs (e.g., merged-PR counts) from **modeled** levers
  (e.g., hours-saved-per-change).

## 6. The honesty test

Before a value statement ships, it should pass all of:

1. Is it labeled with an evidence class?
2. Would an engineer who knows the system agree it is accurate?
3. Does it avoid implying the agent acted without human review?
4. If it is a number, is its basis (and its limits) stated?
5. Is it a defensible metric, not a vanity one?

If any answer is "no," revise or cut the claim.
