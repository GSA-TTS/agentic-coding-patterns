"""Contract tests for the acq-kit `scripts/verify` verdict discipline.

`integrations/isolation/acq-kits/verify-report.sh` gives converted kits a
five-state verdict (`ok`/`bad`/`unver`/`skip`/`warn`) whose exit code is a
function of a coverage record, not a failure counter — this distinguishes "we
checked and it passed" from "nothing ran" and from "we could not check this
part." These tests keep that contract in force as kits adopt it.

CI does not run the kit verify scripts because they need a live sandbox. These
tests execute the shared reporting library in an isolated shell and statically
check that converted scripts use it.

MIGRATION STATE: the conversion is deliberately staged. `UNCONVERTED` lists the
kits still on the old pattern. Each test asserts the contract for converted kits
AND asserts that `UNCONVERTED` still describes reality, so the allowlist cannot
rot in either direction — a kit that gets converted without being removed from
the list fails, and a listed kit that silently reverts fails too.
"""

from __future__ import annotations

import re
import shlex
import shutil
import subprocess
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
# and CONVERTED is a hard error (see test_every_kit_is_classified) — the
# alternative, treating an unclassified kit as converted by subtraction, lets a
# new kit silently inherit a contract it does not implement.
UNCONVERTED = {
    "agentic-coding-playbook",
    "oci-engine",
    "opencode",
    "openchamber",
    "opendesign",
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
SHARED_REPORTER_SOURCE = re.compile(r'^\s*\.\s+"\$KIT_DIR/\.\./verify-report\.sh"\s*(?:#.*)?$', re.MULTILINE)


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


@pytest.mark.parametrize(
    ("reporters", "expected"),
    [
        pytest.param([], 3, id="zero-activity"),
        pytest.param(["ok"], 0, id="pass"),
        pytest.param(["bad"], 1, id="failure"),
        pytest.param(["ok", "unver"], 3, id="pass-and-unverified"),
        pytest.param(["skip"], 3, id="skip-only"),
        pytest.param(["ok", "skip", "warn"], 0, id="pass-skip-and-warn"),
    ],
)
def test_library_verdict_contract(reporters: list[str], expected: int):
    commands = [f". {shlex.quote(str(LIB))}", "verify_reset"]
    commands.extend(f'{reporter} "contract fixture"' for reporter in reporters)
    commands.append('verify_verdict "Contract fixture"')

    result = subprocess.run(
        ["sh", "-c", "\n".join(commands)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == expected, result.stdout + result.stderr


def test_every_kit_is_classified():
    """A kit in neither set is a hard error, not a default.

    The failure message names the real problem directly: a kit appeared that
    nobody classified, rather than failing a different test with a misleading
    cause (e.g. "does not source lib/verify-report.sh").
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
    reset = re.search(r"^\s*verify_reset\s*(?:#.*)?$", text, re.MULTILINE)
    assert SHARED_REPORTER_SOURCE.search(text), f'{kit}/scripts/verify does not source "$KIT_DIR/../verify-report.sh"'
    assert reset, f"{kit}/scripts/verify sources the library but never calls verify_reset, so its counters are unset"


def test_shared_library_source_must_be_the_command_operand():
    text = ". other.sh # verify-report.sh\n"
    assert not SHARED_REPORTER_SOURCE.search(text)


@pytest.mark.parametrize("kit", sorted(_converted()))
def test_missing_sbx_is_unverified(kit: str, tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for command in ("dirname", "mktemp", "rm"):
        executable = shutil.which(command)
        assert executable, f"test prerequisite missing: {command}"
        (bin_dir / command).symlink_to(executable)

    bash = shutil.which("bash")
    assert bash, "test prerequisite missing: bash"
    result = subprocess.run(
        [bash, str(_converted()[kit])],
        env={"PATH": str(bin_dir)},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 3, result.stdout + result.stderr
    assert "UNVERIFIED" in result.stdout
    assert "sbx not on PATH" in result.stdout


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
    """Shared reporter functions must remain the active implementations.

    Local `ok()`/`skip()` definitions bypass the shared coverage counters and
    invalidate the verdict contract.
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
    verdicts = re.findall(r"^\s*verify_verdict(?:\s|$)", text, re.MULTILINE)
    assert verdicts, f"{kit}/scripts/verify never calls verify_verdict"

    # A gate that prints a summary header but reaches no verdict is a gate whose
    # result is discarded.
    headers = len(re.findall(r'info\s+"Summary"', text))
    assert headers == 0, (
        f'{kit}/scripts/verify still prints its own info "Summary" header '
        f"({headers}); verify_verdict prints the summary itself, so a hand-rolled "
        "header means a gate bypassing the contract"
    )


def test_no_silent_skip_remains_in_converted_kits():
    """Skip and unverified outcomes must update the coverage record.

    Bare `echo "  SKIP..."` and `NOTE:` messages bypass the shared counters;
    converted kits use `skip` or `unver` instead.
    """
    offenders: list[str] = []
    for kit, path in sorted(_converted().items()):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r'\s*echo\s+"\s*(SKIP|NOTE)', line):
                offenders.append(f"{kit}/scripts/verify:{lineno}: {line.strip()}")
    assert not offenders, (
        "converted kits still report skips via bare echo, which increments no counter:\n  " + "\n  ".join(offenders)
    )


def _readme_classification(label: str, *, required: bool) -> set[str]:
    """Kits the acq-kits README lists for one side of the staged migration.

    Scans the whole paragraph after the heading, not just its first sentence, so
    a later claim in the same paragraph cannot contradict the list unnoticed.

    `required=False` treats a missing section as the empty set. That is the
    documented end state for the unconverted side: when migration completes the
    README drops that carve-out, and an absent section then means "no kits",
    not "the README is malformed".
    """
    text = (ACQ_KITS / "README.md").read_text(encoding="utf-8")
    match = re.search(rf"\*\*{label} kits\*\* — (.*?)(?:\n\n|\Z)", text, re.S)
    if match is None:
        assert not required, f"acq-kits/README.md has no '**{label} kits** — ...' paragraph"
        return set()
    # Kit names are the backticked tokens that name a real verify script; other
    # backticked tokens in the paragraph (exit codes, file names) are prose.
    scripts = _verify_scripts()
    return {token for token in re.findall(r"`([^`]+)`", match.group(1)) if token in scripts}


@pytest.mark.parametrize(
    ("label", "expected", "required"),
    [("Converted", CONVERTED, True), ("Unconverted", UNCONVERTED, False)],
)
def test_readme_classification_matches_this_suite(label: str, expected: set[str], required: bool):
    """The README's per-kit split must match the authoritative classification.

    The README documents exit codes `0`/`1`/`3` as the verdict contract, and
    that contract only holds for converted kits. A README naming the wrong kits
    tells a caller to trust a `0` from a kit whose `0` does not distinguish
    "every check passed" from "a check could not run". Deriving both lists from
    the README paragraph fails a README-only edit and a suite-only edit alike,
    so the two cannot drift as kits migrate.
    """
    documented = _readme_classification(label, required=required)
    assert documented == expected, (
        f"acq-kits/README.md lists {label.lower()} kits {sorted(documented)} but this suite "
        f"classifies {sorted(expected)}. Update the README section when a kit migrates: "
        f"README-only={sorted(documented - expected)}, suite-only={sorted(expected - documented)}"
    )
