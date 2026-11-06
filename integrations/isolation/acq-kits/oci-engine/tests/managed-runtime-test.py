"""Offline only: real temporary directories, injected kernel/identity, no Podman.

Run with python3 -I -B inside the approved workspace sandbox, never on the host.
"""

import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "managed_runtime", Path(__file__).resolve().parents[1] / "scripts/managed-runtime.py"
)
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class ManagedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # Resolve the fixture base only (macOS /tmp may itself be a symlink).
        self.base = Path(self.temp.name).resolve()
        self.mount = self.base / "runtime"
        self.mount.mkdir(mode=0o755)
        self.mount.chmod(0o755)
        self.home = self.base / "home"
        self.home.mkdir(mode=0o700)
        self.uid = os.getuid()
        self.user = SimpleNamespace(pw_uid=self.uid, pw_gid=os.getgid(), pw_name="agent", pw_dir=str(self.home))
        self.start_patch("RUNTIME", self.mount)
        self.start_patch("ROOT_UID", self.uid)
        self.start_patch("mountinfo", lambda: self.mount_record())
        # Host temp ancestors are outside the fixture ownership model. All
        # fixture directories still use the real owner/mode validator.
        real_owner = runtime.directory_owner
        ancestors = {(p.stat().st_dev, p.stat().st_ino) for p in self.base.parents}

        def fixture_owner(fd, uid, mode=None):
            st = os.fstat(fd)
            if mode is None and (st.st_dev, st.st_ino) in ancestors:
                return
            real_owner(fd, uid, mode)

        self.start_patch("directory_owner", fixture_owner)
        self.chown = self.start_patch("os.fchown", lambda fd, uid, gid: None)
        self.execve = self.start_patch("os.execve")

    def start_patch(self, name, *args):
        p = patch.object(runtime, name, *args) if "." not in name else patch("os." + name.split(".", 1)[1], *args)
        value = p.start()
        self.addCleanup(p.stop)
        return value

    def mount_record(self, *, size="131072k", fs="tmpfs", root="/", target=None):
        target = str(target or self.mount).replace(" ", "\\040")
        return f"42 1 0:99 {root} {target} rw,nosuid,nodev - {fs} tmpfs rw,size={size}\n"

    def ready(self):
        runtime.prepare(self.user)
        runtime.init_store(self.user)

    def snapshot(self):
        rows = []
        for path in self.base.rglob("*"):
            st = path.lstat()
            data = (
                os.readlink(path)
                if stat.S_ISLNK(st.st_mode)
                else path.read_bytes()
                if stat.S_ISREG(st.st_mode)
                else None
            )
            rows.append((str(path.relative_to(self.base)), st.st_mode, st.st_uid, st.st_gid, data))
        return sorted(rows)

    def refusal(self, operation):
        before = self.snapshot()
        with self.assertRaises((runtime.Refused, OSError, ValueError, IndexError)):
            operation()
        self.assertEqual(self.snapshot(), before)
        self.execve.assert_not_called()

    def test_missing_wrong_oversized_ambiguous_and_nested_mounts_refuse_without_writes(self):
        records = [
            "",
            self.mount_record(fs="ext4"),
            self.mount_record(root="/subtree"),
            self.mount_record(size="129m"),
            self.mount_record(size="0"),
            self.mount_record(size="50%"),
            self.mount_record(size=""),
            self.mount_record(target=self.base),
            self.mount_record() * 2,
            self.mount_record() + self.mount_record(target=self.mount / "nested"),
            self.mount_record().replace(" rw,nosuid", " ro,nosuid"),
            "malformed",
        ]
        for record in records:
            with self.subTest(record=record), patch.object(runtime, "mountinfo", return_value=record):
                self.refusal(lambda: runtime.prepare(self.user))
                self.refusal(lambda: runtime.init_store(self.user))

    def test_prepare_idempotent_private_stable_paths(self):
        runtime.prepare(self.user)
        before = self.snapshot()
        runtime.prepare(self.user)
        self.assertEqual(self.snapshot(), before)
        for path in (
            self.mount / str(self.uid),
            self.mount / str(self.uid) / "storage",
            self.mount / str(self.uid) / "libpod",
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
        self.execve.assert_not_called()

    def test_root_mode_owner_and_symlink_components_refuse(self):
        self.mount.chmod(0o777)
        self.refusal(lambda: runtime.prepare(self.user))
        self.mount.chmod(0o755)
        with patch.object(runtime, "ROOT_UID", self.uid + 1):
            self.refusal(lambda: runtime.prepare(self.user))
        original = self.base / "original"
        self.mount.rename(original)
        self.mount.symlink_to(original, target_is_directory=True)
        self.refusal(lambda: runtime.prepare(self.user))

    def test_prepare_never_repairs_existing_uid_tree(self):
        uid_dir = self.mount / str(self.uid)
        uid_dir.mkdir(mode=0o700)
        self.refusal(lambda: runtime.prepare(self.user))
        uid_dir.rmdir()
        uid_dir.symlink_to(self.home, target_is_directory=True)
        self.refusal(lambda: runtime.prepare(self.user))
        uid_dir.unlink()
        runtime.prepare(self.user)
        storage = uid_dir / "storage"
        storage.rmdir()
        storage.symlink_to(self.home, target_is_directory=True)
        self.refusal(lambda: runtime.prepare(self.user))

    def test_podman_sticky_private_libpod_directory_is_accepted(self):
        self.ready()
        libpod = self.mount / str(self.uid) / "libpod"
        libpod.chmod(0o1700)
        runtime.prepare(self.user)
        runtime.execute(self.user, ["info"])
        self.execve.assert_called_once()
        self.execve.reset_mock()
        libpod.chmod(0o1777)
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_fresh_store_is_bound_and_second_init_refuses(self):
        self.ready()
        state = runtime.state_path(self.user)
        self.assertEqual(list((state / "store").iterdir()), [])
        self.assertEqual(json.loads((state / runtime.MARKER).read_text()), runtime.manifest(self.user))
        runtime.verify_store(self.user)
        self.refusal(lambda: runtime.init_store(self.user))

    def test_fresh_runtime_same_paths_retains_persistent_data(self):
        self.ready()
        sentinel = runtime.state_path(self.user) / "store" / "sentinel"
        sentinel.write_bytes(b"persistent fixture, not a native volume qualification")
        before = sentinel.read_bytes()
        uid_dir = self.mount / str(self.uid)
        (uid_dir / "storage").rmdir()
        (uid_dir / "libpod").rmdir()
        uid_dir.rmdir()
        self.refusal(lambda: runtime.execute(self.user, ["info"]))
        runtime.prepare(self.user)
        runtime.verify_store(self.user)
        self.assertEqual(sentinel.read_bytes(), before)

    def test_missing_preparation_and_lost_mount_refuse(self):
        self.refusal(lambda: runtime.init_store(self.user))
        self.ready()
        with patch.object(runtime, "mountinfo", return_value=""):
            self.refusal(lambda: runtime.execute(self.user, ["images"]))

    def test_store_owner_and_hardlinked_marker_refuse(self):
        self.ready()
        state = runtime.state_path(self.user)
        real_stat = os.fstat

        def wrong_owner(fd):
            st = real_stat(fd)
            return SimpleNamespace(st_mode=st.st_mode, st_uid=self.uid + 1, st_dev=st.st_dev, st_ino=st.st_ino)

        with patch.object(os, "fstat", side_effect=wrong_owner):
            self.refusal(lambda: runtime.verify_store(self.user))
        os.link(state / runtime.MARKER, state / "linked-marker")
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_writable_store_ancestor_refuses(self):
        self.ready()
        (self.home / ".local").chmod(0o777)
        self.refusal(lambda: runtime.execute(self.user, ["images"]))

    def test_empty_foreign_and_partial_state_are_not_adopted(self):
        runtime.prepare(self.user)
        state = runtime.state_path(self.user)
        state.mkdir(parents=True, mode=0o700)
        self.refusal(lambda: runtime.init_store(self.user))
        (state / "store").mkdir(mode=0o700)
        (state / "store" / "foreign-data").write_text("keep")
        self.refusal(lambda: runtime.init_store(self.user))
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_interrupted_marker_write_stays_refused(self):
        runtime.prepare(self.user)
        with (
            patch.object(runtime.json, "dump", side_effect=OSError("injected interruption")),
            self.assertRaises(OSError),
        ):
            runtime.init_store(self.user)
        self.refusal(lambda: runtime.init_store(self.user))
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_interrupted_marker_publication_stays_refused(self):
        runtime.prepare(self.user)
        real_unlink = os.unlink

        def interrupt(path, *args, **kwargs):
            if path == ".managed-store.pending":
                raise OSError("injected publication interruption")
            return real_unlink(path, *args, **kwargs)

        with patch.object(os, "unlink", side_effect=interrupt), self.assertRaises(OSError):
            runtime.init_store(self.user)
        self.refusal(lambda: runtime.init_store(self.user))
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_home_ancestor_symlink_refuses_without_writes(self):
        runtime.prepare(self.user)
        destination = self.base / "destination"
        destination.mkdir()
        (self.home / ".local").symlink_to(destination, target_is_directory=True)
        self.refusal(lambda: runtime.init_store(self.user))
        self.assertEqual(list(destination.iterdir()), [])

    def test_corrupt_strict_marker_bindings(self):
        self.ready()
        marker = runtime.state_path(self.user) / runtime.MARKER
        original = runtime.manifest(self.user)
        corruptions = ["{", "[]", "{}", "x" * 4097, '{"version":1,"version":1}', json.dumps({**original, "extra": 1})]
        for key, value in (
            ("version", True),
            ("uid", -1),
            ("home", "/elsewhere"),
            ("graphroot", "/elsewhere"),
            ("runroot", "/elsewhere"),
            ("tmpdir", "/elsewhere"),
        ):
            corruptions.append(json.dumps({**original, key: value}))
        for text in corruptions:
            with self.subTest(text=text[:80]):
                marker.write_text(text)
                self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_marker_mode_symlink_and_store_symlink_refuse(self):
        self.ready()
        state = runtime.state_path(self.user)
        marker = state / runtime.MARKER
        marker.chmod(0o644)
        self.refusal(lambda: runtime.execute(self.user, ["info"]))
        marker.chmod(0o600)
        saved = state / "saved"
        marker.rename(saved)
        marker.symlink_to(saved)
        self.refusal(lambda: runtime.execute(self.user, ["info"]))
        marker.unlink()
        saved.rename(marker)
        (state / "store").rmdir()
        (state / "store").symlink_to(self.home, target_is_directory=True)
        self.refusal(lambda: runtime.execute(self.user, ["info"]))

    def test_argument_refusals_precede_writes_and_engine_calls(self):
        for args in (
            [],
            ["--root", "/forbidden", "info"],
            ["info", "--root=/forbidden"],
            ["info", "--remote"],
            ["--connection=x", "images"],
            ["image", "exists", "--remote=true"],
            ["run", "alpine"],
            ["volume", "create", "v", "--opt", "device=/etc"],
            ["volume", "ls", "--", "--url=x"],
            ["system", "reset"],
        ):
            with self.subTest(args=args):
                self.refusal(lambda args=args: runtime.execute(self.user, args))

    def test_fixed_argv_and_environment_do_not_inherit_configuration(self):
        self.ready()
        with patch.dict(
            os.environ,
            {
                "PODMAN_CONNECTIONS_CONF": "/bad",
                "CONTAINER_HOST": "ssh://bad",
                "DOCKER_HOST": "unix:///bad",
                "LD_PRELOAD": "/bad",
                "PYTHONPATH": "/bad",
                "HOME": "/bad",
                "PATH": "/bad",
            },
        ):
            runtime.execute(self.user, ["info", "--format", "json"])
        executable, argv, env = self.execve.call_args.args
        paths = runtime.manifest(self.user)
        self.assertEqual(executable, "/usr/bin/podman")
        self.assertEqual(
            argv,
            [
                executable,
                "--remote=false",
                "--root",
                paths["graphroot"],
                "--runroot",
                paths["runroot"],
                "--tmpdir",
                paths["tmpdir"],
                "--cgroup-manager=cgroupfs",
                "info",
                "--format",
                "json",
            ],
        )
        self.assertEqual(
            env,
            {
                "HOME": str(self.home),
                "USER": "agent",
                "PATH": "/usr/bin:/bin",
                "LANG": "C",
                "XDG_RUNTIME_DIR": str(self.mount / str(self.uid)),
            },
        )

    def test_supported_metadata_grammar(self):
        for args in (
            ["info"],
            ["images"],
            ["volume", "ls"],
            ["volume", "ls", "--format", "json"],
            ["image", "exists", "docker.io/library/example@sha256:abc"],
            ["volume", "create", "probe"],
            ["volume", "inspect", "probe"],
            ["volume", "exists", "probe"],
        ):
            runtime.metadata_args(args)

    def test_cli_identity_and_platform_refusals(self):
        selected = SimpleNamespace(pw_uid=1001, pw_gid=1001, pw_name="agent", pw_dir=str(self.home))
        with (
            patch.object(runtime.pwd, "getpwnam", return_value=selected),
            patch.object(runtime.sys, "platform", "linux"),
            redirect_stderr(io.StringIO()),
        ):
            for uid, euid, action in (
                (0, 0, "exec"),
                (0, 0, "init-store"),
                (1001, 1001, "prepare"),
                (1002, 1002, "exec"),
                (1001, 0, "prepare"),
            ):
                with patch.object(os, "getuid", return_value=uid), patch.object(os, "geteuid", return_value=euid):
                    self.assertEqual(runtime.main(["--guest", action]), 1)
            with patch.object(os, "getuid", return_value=1001), patch.object(os, "geteuid", return_value=1001):
                self.assertEqual(runtime.account("agent"), selected)
                self.assertEqual(runtime.main(["--guest", "exec"]), 1)
                with patch.object(runtime.sys, "platform", "darwin"):
                    self.assertEqual(runtime.main(["--guest", "exec", "--", "info"]), 1)
            selected.pw_uid = 0
            with patch.object(os, "getuid", return_value=0), patch.object(os, "geteuid", return_value=0):
                self.assertEqual(runtime.main(["--guest", "prepare"]), 1)
        self.execve.assert_not_called()

    def test_cli_requires_guest_and_resolvable_user(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                runtime.main(["init-store"])
            with (
                patch.object(runtime.sys, "platform", "linux"),
                patch.object(os, "getuid", return_value=1001),
                patch.object(os, "geteuid", return_value=1001),
                patch.object(runtime.pwd, "getpwnam", side_effect=KeyError("missing")),
            ):
                self.assertEqual(runtime.main(["--guest", "init-store", "--user", "missing"]), 1)
        self.execve.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
