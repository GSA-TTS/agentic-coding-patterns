#!/usr/bin/python3 -I
"""Opt-in guest metadata helper; not a sandbox. See ../docs/decisions/managed-runtime.md."""

import argparse
import json
import os
import pwd
import re
import stat
import sys
from contextlib import contextmanager, suppress
from pathlib import Path

RUNTIME = Path("/run/acq-oci-runtime")
ROOT_UID = 0
MAX_SIZE = 128 * 1024 * 1024
MAX_MOUNTINFO_BYTES = 1024 * 1024
MAX_MOUNTINFO_LINES = 4096
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
MARKER = "managed-store.json"


class Refused(Exception):
    """Prerequisite absent or state not owned by this helper."""


def require(condition, message):
    if not condition:
        raise Refused(message)


def parts(path):
    text = str(path)
    require(text.startswith("/") and "\x00" not in text, "absolute path required")
    result = text.split("/")[1:]
    require(all(p not in ("", ".", "..") for p in result), "non-canonical path")
    return result


def directory_owner(fd, uid, mode=None):
    st = os.fstat(fd)
    require(stat.S_ISDIR(st.st_mode) and st.st_uid == uid, "wrong directory owner/type")
    actual = stat.S_IMODE(st.st_mode)
    require(actual == mode if mode is not None else not actual & 0o022, "unsafe directory mode")


@contextmanager
def directory(path, trusted=False):
    """Walk using directory descriptors: never follow a symlink component."""
    fd = os.open("/", DIRECTORY)
    try:
        if trusted:
            directory_owner(fd, ROOT_UID)
        for name in parts(path):
            child = os.open(name, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
            if trusted:
                directory_owner(fd, ROOT_UID)
        yield fd
    finally:
        os.close(fd)


def mountinfo():
    with Path("/proc/self/mountinfo").open("rb") as stream:
        data = stream.read(MAX_MOUNTINFO_BYTES + 1)
    require(len(data) <= MAX_MOUNTINFO_BYTES, "mountinfo exceeds 1 MiB")
    return data.decode("utf-8", errors="strict")


def unescape(value):
    return re.sub(r"\\(040|011|012|134)", lambda m: chr(int(m[1], 8)), value)


def verify_mount():
    matches = []
    lines = mountinfo().splitlines()
    require(len(lines) <= MAX_MOUNTINFO_LINES, "mountinfo exceeds 4096 lines")
    for line in lines:
        left, right = line.split(" - ", 1)
        fields, fs = left.split(), right.split()
        target = unescape(fields[4])
        require(not target.startswith(str(RUNTIME) + "/"), "nested runtime mount")
        if target == str(RUNTIME):
            matches.append((fields, fs))
    require(len(matches) == 1, "exact, unambiguous runtime mount required")
    fields, fs = matches[0]
    require(fields[3] == "/" and fs[0] == "tmpfs", "dedicated tmpfs required")
    require("rw" in fields[5].split(","), "writable tmpfs required")
    sizes = [x[5:] for x in fs[2].split(",") if x.startswith("size=")]
    require(len(sizes) == 1, "explicit bounded tmpfs size required")
    match = re.fullmatch(r"([0-9]+)([kKmM]?)", sizes[0])
    require(match is not None, "invalid tmpfs size")
    size = int(match[1]) * {"": 1, "k": 1024, "m": 1024 * 1024}[match[2].lower()]
    require(0 < size <= MAX_SIZE, "tmpfs size must be at most 128 MiB")


def account(name, preparing=False):
    require(sys.platform == "linux", "Linux guest required")
    require(os.getuid() == os.geteuid(), "setuid execution refused")
    require((os.geteuid() == 0) == preparing, "prepare needs root; other actions forbid root")
    user = pwd.getpwnam(name)
    require(user.pw_uid > 0, "non-root account required")
    if not preparing:
        require(os.getuid() == user.pw_uid, "run as the selected account")
    parts(user.pw_dir)
    require(user.pw_dir != "/", "account home required")
    return user


def private_child(parent, name, uid, allow_sticky=False):
    fd = os.open(name, DIRECTORY, dir_fd=parent)
    try:
        mode = stat.S_IMODE(os.fstat(fd).st_mode)
        require(mode == 0o700 or (allow_sticky and mode == 0o1700), "unsafe directory mode")
        directory_owner(fd, uid, mode)
    except BaseException:
        os.close(fd)
        raise
    return fd


@contextmanager
def runtime_root():
    verify_mount()  # Must precede every write, including prepare's mkdir.
    with directory(RUNTIME, trusted=True) as fd:
        directory_owner(fd, ROOT_UID, 0o755)
        yield fd


def check_runtime(parent, user):
    fd = private_child(parent, str(user.pw_uid), user.pw_uid)
    try:
        for name in ("storage", "libpod"):
            os.close(private_child(fd, name, user.pw_uid, allow_sticky=name == "libpod"))
    finally:
        os.close(fd)


def prepare(user):
    with runtime_root() as parent:
        name = str(user.pw_uid)
        try:
            os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            check_runtime(parent, user)
            return  # Never repair/chown an existing user-controlled tree as root.
        os.mkdir(name, 0o700, dir_fd=parent)
        fd = os.open(name, DIRECTORY, dir_fd=parent)
        try:
            directory_owner(fd, ROOT_UID, 0o700)
            for child in ("storage", "libpod"):
                os.mkdir(child, 0o700, dir_fd=fd)
                child_fd = os.open(child, DIRECTORY, dir_fd=fd)
                try:
                    os.fchown(child_fd, user.pw_uid, user.pw_gid)
                finally:
                    os.close(child_fd)
            os.fchown(fd, user.pw_uid, user.pw_gid)  # Publish only after complete.
        finally:
            os.close(fd)


def state_path(user):
    return Path(user.pw_dir) / ".local/share/acq-oci-runtime"


def manifest(user):
    runtime = RUNTIME / str(user.pw_uid)
    return {
        "version": 1,
        "uid": user.pw_uid,
        "home": user.pw_dir,
        "graphroot": str(state_path(user) / "store"),
        "runroot": str(runtime / "storage"),
        "tmpdir": str(runtime / "libpod"),
    }


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate marker key")
        result[key] = value
    return result


def verify_store(user):
    for path in (Path(user.pw_dir), Path(user.pw_dir) / ".local", Path(user.pw_dir) / ".local/share"):
        with directory(path) as ancestor:
            directory_owner(ancestor, user.pw_uid)
    with directory(state_path(user)) as fd:
        directory_owner(fd, user.pw_uid, 0o700)
        os.close(private_child(fd, "store", user.pw_uid))
        marker = os.open(MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(marker, "rb") as stream:
            st = os.fstat(stream.fileno())
            require(
                stat.S_ISREG(st.st_mode)
                and st.st_uid == user.pw_uid
                and stat.S_IMODE(st.st_mode) == 0o600
                and st.st_nlink == 1,
                "unsafe marker",
            )
            raw = stream.read(4097)
        require(len(raw) <= 4096, "oversized marker")
        data = json.loads(raw, object_pairs_hook=unique_object)
        expected = manifest(user)
        require(
            isinstance(data, dict)
            and data.keys() == expected.keys()
            and all(type(data[k]) is type(v) and data[k] == v for k, v in expected.items()),
            "marker binding/version mismatch",
        )


def init_store(user):
    with runtime_root() as parent:
        check_runtime(parent, user)
    # Existing state is never adopted, even if empty or left by a crash.
    with directory(Path(user.pw_dir)) as home:
        directory_owner(home, user.pw_uid)
        fd = os.dup(home)
        try:
            for name in (".local", "share"):
                with suppress(FileExistsError):
                    os.mkdir(name, 0o700, dir_fd=fd)
                child = os.open(name, DIRECTORY, dir_fd=fd)
                os.close(fd)
                fd = child
                directory_owner(fd, user.pw_uid)
            os.mkdir("acq-oci-runtime", 0o700, dir_fd=fd)
            child = os.open("acq-oci-runtime", DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
            directory_owner(fd, user.pw_uid, 0o700)
            os.mkdir("store", 0o700, dir_fd=fd)
            store = private_child(fd, "store", user.pw_uid)
            try:
                os.fsync(store)
            finally:
                os.close(store)
            pending = ".managed-store.pending"
            marker = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            with os.fdopen(marker, "w", encoding="utf-8") as stream:
                json.dump(manifest(user), stream, sort_keys=True)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            # Publish only a fully written marker, never adopt an interrupted file.
            os.link(pending, MARKER, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            os.unlink(pending, dir_fd=fd)
            os.fsync(fd)
        finally:
            os.close(fd)


def metadata_args(args):
    # Deliberately small compatibility grammar, not authorization for hostile users.
    # No global flags (including remote/storage/cgroup overrides) can reach Podman.
    fixed = [
        ("info",),
        ("info", "--format", "json"),
        ("images",),
        ("volume", "ls"),
        ("volume", "ls", "--format", "json"),
    ]
    if tuple(args) in fixed:
        return
    require(
        len(args) == 3
        and tuple(args[:2]) in {("image", "exists"), ("volume", "exists"), ("volume", "inspect"), ("volume", "create")},
        "unsupported metadata arguments; no global options or workload commands",
    )
    pattern = r"[A-Za-z0-9][A-Za-z0-9_.-]*" if args[0] == "volume" else r"[A-Za-z0-9][A-Za-z0-9_.:/@+-]*"
    require(re.fullmatch(pattern, args[2]) is not None, "invalid volume name or image reference")


def execute(user, args):
    metadata_args(args)
    with runtime_root() as parent:
        check_runtime(parent, user)
    with directory(Path(user.pw_dir)) as home:
        directory_owner(home, user.pw_uid)
    verify_store(user)
    paths = manifest(user)
    env = {
        "HOME": user.pw_dir,
        "USER": user.pw_name,
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "XDG_RUNTIME_DIR": str(RUNTIME / str(user.pw_uid)),
    }
    argv = [
        "/usr/bin/podman",
        "--remote=false",
        "--root",
        paths["graphroot"],
        "--runroot",
        paths["runroot"],
        "--tmpdir",
        paths["tmpdir"],
        "--cgroup-manager=cgroupfs",
        *args,
    ]
    os.execve(argv[0], argv, env)  # noqa: S606 — fixed local binary, validated metadata argv, allowlisted env.


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--guest", action="store_true", required=True)
    parser.add_argument("action", choices=("prepare", "init-store", "exec"))
    parser.add_argument("--user", default="agent")
    tokens = list(sys.argv[1:] if argv is None else argv)
    split = tokens.index("--") if "--" in tokens else len(tokens)
    options, args = parser.parse_args(tokens[:split]), tokens[split + 1 :]
    try:
        user = account(options.user, options.action == "prepare")
        require((split < len(tokens)) == (options.action == "exec"), "only exec requires -- PODMAN_ARGS")
        if options.action == "prepare":
            prepare(user)
        elif options.action == "init-store":
            init_store(user)
        else:
            execute(user, args)
        return 0
    except (Refused, OSError, ValueError, KeyError, IndexError, RecursionError) as error:
        print(f"managed-runtime: refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
