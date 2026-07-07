# Known-bad fixture: over-broad CI workflow permissions

> **Synthetic** — for exercising `least-privilege-review` / `agentic-actions-auditor`.
> Not a real workflow. Demonstrates an over-broad `GITHUB_TOKEN` grant.

```yaml
name: build
on: [push]

# ANTI-PATTERN: repository-wide write granted to every job.
permissions: write-all

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
```

What a review should flag: `permissions: write-all` grants far more than a build
needs; scope to the minimum (e.g. `contents: read`). This is a least-privilege
finding, not an agent-injection one.
