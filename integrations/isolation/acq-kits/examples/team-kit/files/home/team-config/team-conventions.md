# Team conventions (template)

Replace this file with your team's conventions. It is loaded into every agent
session in every sandbox the kit applies to, so keep it short and operational:
the agent pays a context cost for every line.

Good content, in rough priority order:

- The team's repos and how they relate (which one is the source of truth).
- Tooling rules the agent cannot infer ("use `glab`, not `gh`, for our GitLab
  repos").
- Hard boundaries ("never X"; what needs a human, such as merging).
- Known traps in your environment, each with the safe alternative.
- Never print the environment (`env`, `printenv`): it contains secret
  placeholders that must not enter a transcript.

Keep repo-specific instructions in each repo's own `AGENTS.md`. This file is
for what is true across all of the team's sandboxes.
