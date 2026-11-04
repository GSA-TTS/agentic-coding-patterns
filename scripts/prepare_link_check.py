"""Check a pending release comparison against its immutable PR head, not a future tag."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPOSITORY = "GSA-TTS/agentic-coding-patterns"
VERSION = r"[0-9]+\.[0-9]+\.[0-9]+"
HEADING = re.compile(
    rf"^## \[({VERSION})\]\(https://github\.com/{REPOSITORY}/compare/"
    rf"v({VERSION})\.\.\.v({VERSION})\) \([0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}\)$"
)


def first_heading(text: str) -> re.Match[str] | None:
    """Do not search past a malformed first release heading."""
    for line in text.splitlines():
        if line.startswith("## "):
            return HEADING.fullmatch(line)
    return None


def pending_comparison(event_name: str, event: dict, changelog: str, base: str) -> dict | None:
    """Return one exact replacement only for the same-repository release-bot PR."""
    if event_name != "pull_request":
        return None
    pr = event.get("pull_request", {})
    head = pr.get("head", {})
    target = pr.get("base", {})
    if not (
        event.get("repository", {}).get("full_name") == REPOSITORY
        and head.get("repo", {}).get("full_name") == REPOSITORY
        and target.get("repo", {}).get("full_name") == REPOSITORY
        and head.get("ref") == "release-please--branches--main"
        and target.get("ref") == "main"
        and pr.get("user", {}).get("login") == "github-actions[bot]"
        and pr.get("user", {}).get("type") == "Bot"
    ):
        return None
    sha = head.get("sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("release head is not an immutable commit SHA")
    new, old = first_heading(changelog), first_heading(base)
    if new is None or old is None:
        raise ValueError("release comparison heading is malformed")
    version, previous, destination = new.groups()
    if version != destination or previous != old.group(1):
        raise ValueError("release comparison does not match the base release")
    if tuple(map(int, version.split("."))) <= tuple(map(int, previous.split("."))):
        raise ValueError("pending release version must increase")
    prefix = f"https://github.com/{REPOSITORY}/compare/v{previous}..."
    # JavaScript RegExp consumes this pattern; only literal URL characters need escaping.
    return {"pattern": "^" + re.escape(prefix + "v" + version) + "$", "replacement": prefix + sha}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--event", type=Path, required=True)
    parser.add_argument("--changelog", type=Path, required=True)
    parser.add_argument("--base-changelog", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    rule = pending_comparison(
        args.event_name, json.loads(args.event.read_text()), args.changelog.read_text(), args.base_changelog.read_text()
    )
    if rule is not None:
        config = json.loads(args.config.read_text())
        config.setdefault("replacementPatterns", []).append(rule)
        args.config.write_text(json.dumps(config, indent=2) + "\n")
        print("Pending release comparison will be checked against its immutable PR head.")


if __name__ == "__main__":
    main()
