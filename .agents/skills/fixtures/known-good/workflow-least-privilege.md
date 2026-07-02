# Known-good fixture: least-privilege, SHA-pinned workflow

> **Synthetic** — the "should NOT be flagged" counterpart for
> `least-privilege-review` / `agentic-actions-auditor` / `dependency-analysis`.

```yaml
name: build
on:
  pull_request:
    branches: [main]

# Minimal scope: read-only token is all a build needs.
permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # Pinned to a full commit SHA (version in the trailing comment).
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - run: make build
```

Why this is clean: read-only token (least privilege), a safe `pull_request`
trigger (not `pull_request_target`), a SHA-pinned action, and
`persist-credentials: false`. A review should raise no finding.
