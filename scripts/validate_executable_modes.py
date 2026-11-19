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
from pathlib import Path, PurePosixPath


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


IndexEntries = dict[str, list[tuple[str, str, str]]]

_REGULAR_MODES = frozenset({"100644", "100755"})


def _git_executable() -> str:
    git = shutil.which("git")
    if git is None:
        raise ExecutableModeError("git is required to verify recorded executable modes")
    return git


def git_index_entries(root: Path) -> IndexEntries:
    """Read every index entry as ``(mode, object id, stage)``, keeping unmerged stages."""

    git = _git_executable()
    try:
        result = subprocess.run(  # noqa: S603 -- fixed Git subcommand; root is a local CLI input.
            [git, "-C", str(root), "ls-files", "--stage", "-z"],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", "replace").strip()
        raise ExecutableModeError(f"git ls-files --stage failed: {detail or error}") from error

    records: IndexEntries = {}
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_id, stage = metadata.decode("ascii").split()
        except (UnicodeDecodeError, ValueError) as error:
            raise ExecutableModeError("git returned an invalid index record") from error
        path = raw_path.decode("utf-8", "surrogateescape")
        records.setdefault(path, []).append((mode, object_id, stage))
    return records


def git_index_modes(root: Path) -> dict[str, list[tuple[str, str]]]:
    """Return ``(mode, stage)`` per index path, preserving unmerged stages."""

    return {
        path: [(mode, stage) for mode, _object_id, stage in entries]
        for path, entries in git_index_entries(root).items()
    }


def _read_indexed_text(root: Path, entries: IndexEntries, path: str) -> str:
    """Read a staged blob, never the working tree, so discovery matches the index under test."""

    staged = entries[path]
    if staged[0][2] != "0" or staged[0][0] not in _REGULAR_MODES:
        raise ExecutableModeError(f"{path} is unmerged or not a regular file in the index; resolve it first")
    try:
        result = subprocess.run(  # noqa: S603 -- fixed Git subcommand; object id comes from git itself.
            [_git_executable(), "-C", str(root), "cat-file", "blob", staged[0][1]],
            check=True,
            capture_output=True,
        )
        return result.stdout.decode("utf-8")
    except (subprocess.CalledProcessError, UnicodeDecodeError) as error:
        raise ExecutableModeError(f"could not read staged content of {path}") from error


def _load_yaml(text: str) -> object:
    import yaml

    return yaml.safe_load(text)


def _is_kit_spec(path: PurePosixPath) -> bool:
    parts = path.parts
    return (
        len(parts) >= 4
        and parts[:2] == ("integrations", "isolation")
        and parts[2].endswith("-kits")
        and parts[-1] == "spec.yaml"
    )


def discover_executable_paths(root: Path, entries: IndexEntries | None = None) -> set[str]:
    """Return only repository entrypoints that actually require exec permission.

    Discovery reads the Git index (paths and staged manifest contents), not the
    working tree, so an unstaged deletion or edit cannot hide a staged
    declaration. Guest payloads are selected from declared ``files[].mode``
    values, provider normalizers from their manifests, and named direct
    kit-script entrypoints. Python and Node files launched through an
    interpreter are excluded unless a distribution contract names them as a
    normalizer.
    """

    entries = git_index_entries(root) if entries is None else entries
    expected: set[str] = set()
    for path_text in sorted(entries):
        path = PurePosixPath(path_text)
        if _is_kit_spec(path):
            spec = _load_yaml(_read_indexed_text(root, entries, path_text))
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
                    expected.add((path.parent / entry["source"]).as_posix())

            for name in DIRECT_KIT_SCRIPT_NAMES:
                entrypoint = (path.parent / "scripts" / name).as_posix()
                if entrypoint in entries:
                    expected.add(entrypoint)
        elif path.name == "provider-input.json" and path.parts[0] == "integrations":
            manifest = json.loads(_read_indexed_text(root, entries, path_text))
            normalizer = manifest.get("normalizerPath") if isinstance(manifest, dict) else None
            if isinstance(normalizer, str):
                expected.add((path.parent / normalizer).as_posix())

    return expected


def validate_executable_modes(root: Path, expected: Iterable[str] | None = None) -> None:
    """Require each expected entrypoint to be a stage-0 ``100755`` Git entry."""

    index = git_index_entries(root)
    expected_paths = discover_executable_paths(root, index) if expected is None else set(expected)
    failures: list[str] = []
    for path in sorted(expected_paths):
        staged = [(mode, stage) for mode, _object_id, stage in index.get(path, [])]
        if not staged:
            failures.append(f"{path} (not tracked; add it to Git)")
        elif staged != [("100755", "0")]:
            found = ", ".join(f"{mode} stage {stage}" for mode, stage in staged)
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
