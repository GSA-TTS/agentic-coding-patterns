# Executive Audience Profiles

Reusable reference for adapting a technical explanation to a specific executive
audience. **This is reference material, not a set of skills** — the explainer
skills read these profiles to choose emphasis, not to change the facts.

## How to use

1. Identify the audience (or audiences).
2. Lead with what they care about; include the technical detail they actually
   need; omit detail they do not.
3. Never change a fact to suit an audience. Adapt framing and depth, not truth.

---

## CIO / CTO — technology strategy & delivery

- **Cares about:** delivery speed and predictability, engineering capacity,
  maintainability, total cost, avoiding lock-in, how this fits existing systems.
- **Needs to understand:** where agents accelerate delivery vs. where humans
  still decide; that controls (review, CI, deploy gates) are unchanged; the
  three-repo split (practices / local-dev tooling / shared knowledge).
- **Does not need:** sandbox implementation internals, individual NIST control IDs.
- **Lead with:** capacity and cycle-time framing, honestly labeled.
- **Watch for:** treating throughput (PR counts) as value; be explicit that
  throughput is effort, not outcome.

## CISO — security & risk

- **Cares about:** attack surface, blast radius, credential handling, auditability,
  separation of duties, what happens when something is compromised.
- **Needs to understand:** the sandbox isolates work and bounds blast radius but
  is not a perfect guarantee (image-provenance/SI-7 caveat); deny-by-default
  egress; that secrets handling differs by backend (the msb vs. sbx/USAi caveat)
  — state it precisely; the agent cannot self-approve or self-merge; audit trail.
- **Needs the detail:** the specific controls (AC-5, AC-6, SC-7, AU-2/3/12) and
  their honest limits.
- **Does not need:** narrative/business-value framing up front.
- **Watch for:** overclaiming isolation or "secrets never enter the sandbox" —
  a CISO will (correctly) probe it; get it right or lose credibility.

## CAIO — AI governance & responsible use

- **Cares about:** human accountability, model governance, evidence quality,
  avoiding hype, alignment with federal AI guidance (NIST AI RMF, OMB memos).
- **Needs to understand:** the human is author of record and fully accountable;
  the agent is a tool operating under a behavioral contract; evidence is labeled
  (published / measured / anecdotal / hypothesis / future), not asserted.
- **Does not need:** low-level sandbox mechanics.
- **Watch for:** unsupported productivity multipliers; conflating a model with an
  agent; implying autonomy.

## Agency / program executive (SES) — mission outcomes

- **Cares about:** does this help the mission, is it safe, is it defensible, what
  does it cost, why should we continue/fund it.
- **Needs to understand:** the plain-language "what it is" and "why it matters";
  that humans stay accountable; that value is real but honestly bounded.
- **Does not need:** engineering vocabulary — define every term used, or avoid it.
- **Lead with:** the mission framing and the one-sentence value, then the honest caveats.
- **Watch for:** jargon; assume no software background but do not condescend.

## COO / operations leadership — throughput & reliability

- **Cares about:** consistency, reduced repetitive/manual work, onboarding time,
  reliability, whether this creates operational risk.
- **Needs to understand:** which repetitive engineering/ops work agents can
  absorb (investigation, docs, tests, triage) and which decisions stay human;
  that the process and its controls are unchanged.
- **Does not need:** model/harness distinctions in depth.
- **Watch for:** implying head-count replacement; frame as capacity and
  consistency, not staff reduction.

## Acquisition / financial leadership — cost & value

- **Cares about:** cost, cost-avoidance, defensibility of any dollar figure,
  contract/vendor implications, sustainability.
- **Needs to understand:** how any value figure was derived and its limits
  (estimate vs. audited); that metrics are countable where claimed; no lock-in.
- **Needs the detail:** the measurement basis (see the measurement guidance).
- **Does not need:** technical architecture.
- **Watch for:** point-estimate ROI with no method; always show the basis and lead
  with the conservative figure.

---

## Shared rules across all audiences

- Humans remain accountable in every framing. Never imply the agent decides,
  approves, or ships on its own.
- Security claims are only as strong as the cited ground truth; do not inflate.
- Prefer one accurate sentence over five vague ones.
- If a fact is unknown, say so — do not fill the gap with a plausible guess.
