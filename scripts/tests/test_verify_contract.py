"""Contract tests for the acq-kit `scripts/verify` verdict discipline.

WHY THIS FILE EXISTS

Every kit's `scripts/verify` used to end with:

    [ "$fail" -eq 0 ]

That is a two-state verdict. It answers "did anything fail?" and cannot answer
"did we actually check anything?", so two things were true of all eight scripts:

1. A run where NOTHING executed reported success — with `pass=0` and `fail=0` the
   test above is true, so the script printed "All checks passed." and exited 0.
2. A skipped check was indistinguishable from a passing one. Across the eight
   scripts there were 35 `skip`/NOTE sites and 9 `warn` sites that incremented
   no counter, including `git-ssh-sign` skipping its end-to-end signed-commit
   check — the kit's entire purpose — whenever no key was in the forwarded agent.

`integrations/isolation/acq-kits/verify-report.sh` replaces that with a
five-state contract whose verdict is a function of a coverage record. These tests
keep it that way.

NOTHING IN CI RUNS THESE SHELL SCRIPTS. They need a live sandbox, which this
repo's CI cannot create, and the repo has no shellcheck hook. So the contract is
enforced here, statically, by reading them as text — otherwise the next verify
script added would quietly reintroduce the defect.

MIGRATION STATE: the conversion is deliberately staged. `UNCONVERTED` lists the
kits still on the old pattern. Each test asserts the contract for converted kits
AND asserts that `UNCONVERTED` still describes reality, so the allowlist cannot
rot in either direction — a kit that gets converted without being removed from
the list fails, and a listed kit that silently reverts fails too.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ACQ_KITS = ROOT / "integrations/isolation/acq-kits"
# Lives at the acq-kits root beside validate-kits.py, NOT in a lib/ subdir:
# .gitignore carries the stock Python build-artifact block, whose `lib/` rule
# would silently exclude it from the repo. Two kits sourcing a file git never
# tracked would fail at run time with "No such file or directory".
LIB = ACQ_KITS / "verify-report.sh"

# Kits whose verify script has NOT yet been migrated to the shared contract.
# Shrink this as they are converted; it must reach empty.
#
# This is an explicit DENY list, not a default. A kit absent from both this set
# and CONVERTED is a hard error (see test_every_kit_is_classified), because the
# alternative -- treating an unclassified kit as converted -- is how a new kit
# silently inherits a contract it does not implement. That is not hypothetical:
# `oci-engine` landed on main while this change was in review, and the original
# set-subtraction classified it as converted, failing four tests with a
# misleading "does not source lib/verify-report.sh" instead of the true cause
# ("a kit appeared that nobody classified").
UNCONVERTED = {
    "agentic-coding-playbook",
    "oci-engine",
    "openchamber",
    "paseo",
    "pi-coding-agent",
    "zscaler-ca-certificate",
}

# Kits that HAVE adopted the shared contract. Listing them explicitly, rather
# than deriving them by subtraction, is what makes an unclassified kit visible.
CONVERTED = {
    "git-ssh-sign",
    "usai-provider",
}

# The old two-state verdict. Its absence is the thing being enforced.
LEGACY_VERDICT = re.compile(r'\[\s*"\$fail"\s+-eq\s+0\s*\]')


def _verify_scripts() -> dict[str, Path]:
    found = {p.parent.parent.name: p for p in sorted(ACQ_KITS.glob("*/scripts/verify"))}
    # Guard the guard: if the glob stops matching, every test below would pass
    # vacuously over an empty set. That is the exact "no evidence read as a pass"
    # defect these tests exist to prevent.
    assert found, f"no scripts/verify found under {ACQ_KITS} — this suite cannot pass vacuously"
    return found


def _converted() -> dict[str, Path]:
    return {k: p for k, p in _verify_scripts().items() if k in CONVERTED}


def test_shared_library_exists_and_defines_the_five_states():
    assert LIB.is_file(), f"missing shared verdict library at {LIB}"
    text = LIB.read_text(encoding="utf-8")
    for fn in ("ok()", "bad()", "unver()", "skip()", "warn()", "verify_verdict()", "verify_reset()"):
        assert fn in text, f"{LIB.name} does not define {fn}"


def test_library_verdict_degrades_on_unverified_and_on_zero_checks():
    """The two branches that distinguish this from the old verdict.

    Asserted structurally rather than by running the shell, so the test stays
    hermetic: if either branch is deleted, the library silently becomes the
    two-state verdict again and every caller regresses at once.
    """
    text = LIB.read_text(encoding="utf-8")
    assert re.search(r'\[\s*"\$pass"\s+-eq\s+0\s*\]', text), (
        "verify_verdict no longer has a zero-checks-ran branch — a run that executed nothing would report a pass"
    )
    assert re.search(r'\[\s*"\$unverified"\s+-gt\s+0\s*\]', text), (
        'verify_verdict no longer degrades on unverified checks — "could not check" would be reported as a pass'
    )
    assert "return 3" in text, "verify_verdict no longer has a distinct could-not-check exit code"


def test_every_kit_is_classified():
    """A kit in neither set is a hard error, not a default.

    This is the test that would have named the real problem when `oci-engine`
    appeared: the failure message says "a kit appeared that nobody classified"
    rather than four confusing assertions about a missing `source` line.
    """
    scripts = _verify_scripts()
    classified = CONVERTED | UNCONVERTED

    unclassified = scripts.keys() - classified
    assert not unclassified, (
        f"verify script(s) in no classification set: {sorted(unclassified)}. "
        "Add each to CONVERTED (if it sources verify-report.sh) or to "
        "UNCONVERTED (if it is still on the old two-state verdict). A kit is "
        "never converted by default."
    )

    phantom = classified - scripts.keys()
    assert not phantom, f"classification sets name kits with no verify script: {sorted(phantom)} — remove them"

    overlap = CONVERTED & UNCONVERTED
    assert not overlap, f"kits in both sets: {sorted(overlap)}"


def test_unconverted_allowlist_is_accurate():
    """The allowlist must describe reality, in both directions."""
    scripts = _verify_scripts()

    unknown = UNCONVERTED - scripts.keys()
    assert not unknown, f"UNCONVERTED names kits with no verify script: {sorted(unknown)} — remove them from the list"

    for kit in sorted(UNCONVERTED):
        text = scripts[kit].read_text(encoding="utf-8")
        assert "verify-report.sh" not in text, (
            f"{kit} now sources the shared library but is still listed as "
            "UNCONVERTED — remove it from the allowlist so it is covered by the "
            "contract tests"
        )

    assert _converted(), "no kit has adopted the shared contract — these tests would pass vacuously over an empty set"


@pytest.mark.parametrize("kit", sorted(_converted()))
def test_converted_kit_sources_the_shared_library(kit: str):
    text = _converted()[kit].read_text(encoding="utf-8")
    assert "verify-report.sh" in text, f"{kit}/scripts/verify does not source lib/verify-report.sh"
    assert "verify_reset" in text, (
        f"{kit}/scripts/verify sources the library but never calls verify_reset, so its counters are unset"
    )


@pytest.mark.parametrize("kit", sorted(_converted()))
def test_converted_kit_has_no_legacy_two_state_verdict(kit: str):
    text = _converted()[kit].read_text(encoding="utf-8")
    hits = LEGACY_VERDICT.findall(text)
    assert not hits, (
        f'{kit}/scripts/verify still gates on [ "$fail" -eq 0 ] ({len(hits)} '
        "occurrence(s)). That verdict reports success when zero checks ran and "
        "when checks were skipped; use verify_verdict instead"
    )


@pytest.mark.parametrize("kit", sorted(_converted()))
def test_converted_kit_does_not_shadow_the_shared_reporters(kit: str):
    """A local redefinition silently restores the old behaviour.

    A kit could source the library and then define its own `ok()`/`skip()` that
    increments nothing — passing every other test here while behaving exactly as
    before.
    """
    text = _converted()[kit].read_text(encoding="utf-8")
    for fn in ("ok", "bad", "unver", "skip", "warn", "info"):
        shadow = re.compile(rf"^\s*{fn}\s*\(\)\s*\{{", re.MULTILINE)
        assert not shadow.search(text), f"{kit}/scripts/verify redefines {fn}() locally, shadowing the shared contract"


@pytest.mark.parametrize("kit", sorted(_converted()))
def test_converted_kit_reports_every_gate(kit: str):
    """Each `info "Summary"`-style gate must end in a verify_verdict call.

    openchamber, paseo and pi-coding-agent each have three gates; a conversion
    that replaced only the first would leave the others reporting nothing.
    """
    text = _converted()[kit].read_text(encoding="utf-8")
    verdicts = text.count("verify_verdict")
    assert verdicts >= 1, f"{kit}/scripts/verify never calls verify_verdict"

    # A gate that prints a summary header but reaches no verdict is a gate whose
    # result is discarded.
    headers = len(re.findall(r'info\s+"Summary"', text))
    assert headers == 0, (
        f'{kit}/scripts/verify still prints its own info "Summary" header '
        f"({headers}); verify_verdict prints the summary itself, so a hand-rolled "
        "header means a gate bypassing the contract"
    )


def test_no_silent_skip_remains_in_converted_kits():
    """A bare `echo "  SKIP..."` or `NOTE:` increments no counter.

    That is how a skipped check became indistinguishable from a passing one. In a
    converted kit these must be `skip`/`unver` calls instead.
    """
    offenders: list[str] = []
    for kit, path in sorted(_converted().items()):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r'\s*echo\s+"\s*(SKIP|NOTE)', line):
                offenders.append(f"{kit}/scripts/verify:{lineno}: {line.strip()}")
    assert not offenders, (
        "converted kits still report skips via bare echo, which increments no counter:\n  " + "\n  ".join(offenders)
    )
