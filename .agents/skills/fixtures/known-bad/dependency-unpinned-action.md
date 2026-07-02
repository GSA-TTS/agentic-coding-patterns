# Known-bad fixture: unpinned GitHub Action

> **Synthetic** — for exercising `dependency-analysis` (Action SHA-pinning) /
> `agentic-actions-auditor`. Demonstrates an Action pinned to a mutable tag.

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      # ANTI-PATTERN: mutable tag, not a commit SHA — the tag can be re-pointed.
      - uses: some-org/publish-action@v3
      - run: echo "publishing"
```

What a review should flag: `some-org/publish-action@v3` is pinned to a mutable
tag; pin to a full commit SHA (with the version in a trailing comment) so the
resolved code cannot change under the tag.
