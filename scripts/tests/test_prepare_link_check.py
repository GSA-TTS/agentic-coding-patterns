"""The temporary release link target is exact and never a broad exclusion."""

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from prepare_link_check import REPOSITORY, pending_comparison

SHA = "a" * 40
BASE = f"# Changelog\n\n## [1.18.0](https://github.com/{REPOSITORY}/compare/v1.17.0...v1.18.0) (2026-10-28)\n"
PENDING = f"# Changelog\n\n## [1.19.0](https://github.com/{REPOSITORY}/compare/v1.18.0...v1.19.0) (2026-11-03)\n"
EVENT = {
    "repository": {"full_name": REPOSITORY},
    "pull_request": {
        "user": {"login": "github-actions[bot]", "type": "Bot"},
        "head": {"sha": SHA, "ref": "release-please--branches--main", "repo": {"full_name": REPOSITORY}},
        "base": {"ref": "main", "repo": {"full_name": REPOSITORY}},
    },
}


def test_exact_pending_url_checked_against_sha():
    rule = pending_comparison("pull_request", EVENT, PENDING, BASE)
    url = f"https://github.com/{REPOSITORY}/compare/v1.18.0...v1.19.0"
    assert re.fullmatch(rule["pattern"], url)
    assert rule["replacement"] == f"https://github.com/{REPOSITORY}/compare/v1.18.0...{SHA}"
    for other in (url + "/bad", url + "?bad", url.replace("1.19.0", "1.20.0"), url.replace("github.com", "other.test")):
        assert not re.fullmatch(rule["pattern"], other)


@pytest.mark.parametrize("name", ["push", "merge_group", "workflow_dispatch"])
def test_non_pr_has_no_exception(name):
    assert pending_comparison(name, EVENT, PENDING, BASE) is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("user", {"login": "contributor", "type": "User"}),
        ("head", {"sha": SHA, "ref": "release-please--branches--main", "repo": {"full_name": "other/fork"}}),
        ("head", {"sha": SHA, "ref": "feature", "repo": {"full_name": REPOSITORY}}),
    ],
)
def test_non_release_context_keeps_normal_checks(field, value):
    event = copy.deepcopy(EVENT)
    event["pull_request"][field] = value
    assert pending_comparison("pull_request", event, PENDING, BASE) is None


@pytest.mark.parametrize(
    "text",
    [
        PENDING.replace("v1.18.0...", "v0.0.0..."),
        PENDING.replace("[1.19.0]", "[1.20.0]"),
        PENDING.replace("github.com", "github.com.evil.test"),
        "## malformed\n" + PENDING,
        BASE,
    ],
)
def test_bad_heading_fails_closed(text):
    with pytest.raises(ValueError):
        pending_comparison("pull_request", EVENT, text, BASE)


def test_head_must_be_commit_not_branch():
    event = copy.deepcopy(EVENT)
    event["pull_request"]["head"]["sha"] = "main"
    with pytest.raises(ValueError):
        pending_comparison("pull_request", event, PENDING, BASE)


def test_cli_preserves_other_checks_and_credentials(tmp_path):
    config = {"ignorePatterns": [{"pattern": "^#"}], "httpHeaders": [{"headers": {"Authorization": "fixture"}}]}
    paths = {}
    files = {"event": json.dumps(EVENT), "changelog": PENDING, "base": BASE, "config": json.dumps(config)}
    for name, text in files.items():
        paths[name] = tmp_path / name
        paths[name].write_text(text)
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parents[1] / "prepare_link_check.py"),
            "--event-name",
            "pull_request",
            "--event",
            str(paths["event"]),
            "--changelog",
            str(paths["changelog"]),
            "--base-changelog",
            str(paths["base"]),
            "--config",
            str(paths["config"]),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    actual = json.loads(paths["config"].read_text())
    assert actual.pop("replacementPatterns") == [pending_comparison("pull_request", EVENT, PENDING, BASE)]
    assert actual == config
    assert "fixture" not in result.stdout + result.stderr


def test_replacement_uses_javascript_regexp_semantics():
    rule = pending_comparison("pull_request", EVENT, PENDING, BASE)
    url = f"https://github.com/{REPOSITORY}/compare/v1.18.0...v1.19.0"
    javascript = """
const rule = JSON.parse(process.argv[1]);
const url = process.argv[2];
const pattern = new RegExp(rule.pattern);
if (url.replace(pattern, rule.replacement) !== rule.replacement) process.exit(1);
for (const suffix of ['/bad', '?bad', '#bad']) {
  if ((url + suffix).replace(pattern, rule.replacement) !== url + suffix) process.exit(2);
}
"""
    subprocess.run(["node", "-e", javascript, json.dumps(rule), url], check=True, timeout=10)
