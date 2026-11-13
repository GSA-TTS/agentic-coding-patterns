"""Verify executable entrypoints are recorded executable in Git's index.

Shared host mounts can report permission bits that differ from a checkout. This
gate therefore checks the staged Git mode, which is what a fresh CI checkout
receives. It deliberately does not infer intent from shebangs or repair modes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path


class ExecutableModeError(ValueError):
    """An executable entrypoint is absent from Git or has the wrong Git mode."""


# Host entrypoints invoked directly by the kit documentation and test contracts.
# Keep this narrow: adjacent Python helpers are run through an interpreter and
# intentionally remain non-executable. Add a name only when its direct-execution
# contract is introduced.
DIRECT_KIT_SCRIPT_NAMES = frozenset(
    {
        "verify",
        "verify-resources",
        "detach-probe",
        "investigate-shell-autostop",
        "paseo-probe3",
        "paseo-verify-identity",
    }
)


def _load_yaml(path: Path) -> object:
    import yaml

    return yaml.safe_load(path.read_text(encoding="utf-8"))


def discover_executable_paths(root: Path) -> set[str]:
    """Return only repository entrypoints that actually require exec permission.

    Guest payloads are selected from declared ``files[].mode`` values, provider
    normalizers from their manifests, and named direct kit-script entrypoints.
    Python and Node files launched through an interpreter are excluded unless a
    distribution contract names them as a normalizer.
    """

    expected: set[str] = set()
    kit_roots = root.glob("integrations/isolation/*-kits")
    for kits_root in kit_roots:
        for spec_path in kits_root.rglob("spec.yaml"):
            spec = _load_yaml(spec_path)
            if not isinstance(spec, dict):
                continue
            for entry in spec.get("files", []) or []:
                if not isinstance(entry, dict) or not isinstance(entry.get("source"), str):
                    continue
                try:
                    is_executable = int(str(entry.get("mode", "0")), 8) & 0o111
                except ValueError:
                    continue  # The kit schema validator reports malformed guest modes.
                if is_executable:
                    expected.add((spec_path.parent / entry["source"]).relative_to(root).as_posix())

            scripts_dir = spec_path.parent / "scripts"
            for name in DIRECT_KIT_SCRIPT_NAMES:
                entrypoint = scripts_dir / name
                if entrypoint.is_file():
                    expected.add(entrypoint.relative_to(root).as_posix())

    for manifest_path in root.glob("integrations/**/provider-input.json"):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        normalizer = manifest.get("normalizerPath") if isinstance(manifest, dict) else None
        if isinstance(normalizer, str):
            expected.add((manifest_path.parent / normalizer).relative_to(root).as_posix())

    return expected


def git_index_modes(root: Path) -> dict[str, list[tuple[str, str]]]:
    """Read every index entry, preserving unmerged stages and unusual filenames."""

    git = shutil.which("git")
    if git is None:
        raise ExecutableModeError("git is required to verify recorded executable modes")
    try:
        result = subprocess.run(  # noqa: S603 -- fixed Git subcommand; root is a local CLI input.
            [git, "-C", str(root), "ls-files", "--stage", "-z"],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", "replace").strip()
        raise ExecutableModeError(f"git ls-files --stage failed: {detail or error}") from error

    records: dict[str, list[tuple[str, str]]] = {}
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, _object_id, stage = metadata.decode("ascii").split()
        except (UnicodeDecodeError, ValueError) as error:
            raise ExecutableModeError("git returned an invalid index record") from error
        path = raw_path.decode("utf-8", "surrogateescape")
        records.setdefault(path, []).append((mode, stage))
    return records


def validate_executable_modes(root: Path, expected: Iterable[str] | None = None) -> None:
    """Require each expected entrypoint to be a stage-0 ``100755`` Git entry."""

    expected_paths = discover_executable_paths(root) if expected is None else set(expected)
    records = git_index_modes(root)
    failures: list[str] = []
    for path in sorted(expected_paths):
        entries = records.get(path)
        if entries is None:
            failures.append(f"{path} (not tracked; add it to Git)")
        elif entries != [("100755", "0")]:
            found = ", ".join(f"{mode} stage {stage}" for mode, stage in entries)
            failures.append(f"{path} (expected 100755 stage 0; found {found})")
    if failures:
        raise ExecutableModeError(
            "Git index must record required executable entrypoints as 100755 stage 0:\n  - "
            + "\n  - ".join(failures)
            + "\nStage new files and use git update-index --chmod=+x only for the intended paths."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    try:
        validate_executable_modes(args.root.resolve())
    except (ExecutableModeError, OSError, json.JSONDecodeError) as error:
        print(f"executable-mode validation failed: {error}", file=sys.stderr)
        return 1
    print("Git executable modes are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
