"""Offline tests: injected Podman transport and synthetic proc/cgroup evidence.

Run in the review sandbox; never invoke an installed OCI engine in these tests.
"""

import copy
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "integrations/isolation/acq-kits/oci-engine/scripts/verify_resources.py"
SPEC = importlib.util.spec_from_file_location("oci_resource_verifier", SCRIPT)
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)
ID = "a" * 64
IMAGE = "example.com/library/probe@sha256:" + "b" * 64
INFO = {"host": {"security": {"rootless": True}, "cgroupVersion": "v2", "cgroupControllers": ["memory", "cpu", "pids"]}}
INSPECT = [
    {
        "Id": ID,
        "State": {"Running": True, "Pid": 42},
        "Config": {"User": "65534:65534"},
        "Mounts": [],
        "HostConfig": {"NetworkMode": "none"},
    }
]


class Fake:
    def __init__(self, responses=None):
        self.responses = {
            ("info", "--format=json"): (0, json.dumps(INFO)),
            ("image", "exists", IMAGE): (0, ""),
            ("create",): (0, ID + "\n"),
            ("start", ID): (0, ID),
            ("container", "inspect", ID): (0, json.dumps(INSPECT)),
            ("rm", "--force", "--time=0", ID): (0, ID),
            ("container", "exists", ID): (1, ""),
        }
        self.responses.update(responses or {})
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        result = self.responses[("create",) if args[0] == "create" else args]
        if isinstance(result, Exception):
            raise result
        return result


class QualificationTests(unittest.TestCase):
    def qualify(self, fake, measure=lambda _: {"memory.max": "134217728"}):
        return v.qualify(fake, IMAGE, measure)

    def test_positive_schema_and_exact_cleanup(self):
        fake = Fake()
        self.assertEqual(v.verdict(self.qualify(fake)), 0)
        command = next(args for args in fake.calls if args[0] == "create")
        for flag in (
            "--pull=never",
            "--network=none",
            "--user=65534:65534",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--memory=128m",
            "--cpus=1",
            "--pids-limit=32",
            "--image-volume=ignore",
            "--no-healthcheck",
            "--log-driver=none",
            "--entrypoint=/bin/sh",
        ):
            self.assertIn(flag, command)
        self.assertEqual(command[-3:], (IMAGE, "-c", "exec sleep 120"))
        self.assertFalse(any(x.startswith(("--mount", "--volume")) for x in command))
        self.assertEqual(fake.calls[-2:], [("rm", "--force", "--time=0", ID), ("container", "exists", ID)])

    def test_info_missing_and_negative_schemas_gate_creation(self):
        cases = [({}, 3), ({"host": None}, 3)]
        for rootless, code in ((False, 1), ("true", 3), (1, 3), (None, 3)):
            info = copy.deepcopy(INFO)
            info["host"]["security"]["rootless"] = rootless
            cases.append((info, code))
        for field, value in (
            ("cgroupVersion", "v1"),
            ("cgroupControllers", []),
            ("cgroupControllers", "memory cpu pids"),
            ("cgroupControllers", ["cpu", "memory"]),
            ("cgroupControllers", [None]),
        ):
            info = copy.deepcopy(INFO)
            info["host"][field] = value
            cases.append((info, 3))
        for info, code in cases:
            with self.subTest(info=info):
                fake = Fake({("info", "--format=json"): (0, json.dumps(info))})
                self.assertEqual(v.verdict(self.qualify(fake)), code)
                self.assertEqual(len(fake.calls), 1)

    def test_missing_image_and_malformed_info(self):
        for responses in (
            {("image", "exists", IMAGE): (1, "")},
            {("info", "--format=json"): (0, "true")},
            {("info", "--format=json"): (0, "not json")},
            {("info", "--format=json"): (125, "{}")},
        ):
            fake = Fake(responses)
            self.assertEqual(v.verdict(self.qualify(fake)), 3)
            self.assertFalse(any(x[0] == "create" for x in fake.calls))

    def test_create_failure_never_claims_cleanup(self):
        for result in ((0, ""), (0, "short"), (0, ID + "\n" + ID), (125, ""), v.Unverified("timeout")):
            fake = Fake({("create",): result})
            records = self.qualify(fake)
            self.assertEqual(v.verdict(records), 3)
            self.assertTrue(any("cleanup cannot" in detail for _, detail in records))
            self.assertFalse(any(x[0] == "rm" for x in fake.calls))

    def test_valid_id_on_failed_create_is_cleaned(self):
        fake = Fake({("create",): (125, ID)})
        self.assertEqual(v.verdict(self.qualify(fake)), 3)
        self.assertIn(("rm", "--force", "--time=0", ID), fake.calls)
        self.assertNotIn(("start", ID), fake.calls)

    def test_start_inspect_and_cleanup_failures(self):
        for command in (
            ("start", ID),
            ("container", "inspect", ID),
            ("rm", "--force", "--time=0", ID),
            ("container", "exists", ID),
        ):
            for result in ((125, ""), v.Unverified("signal or timeout"), OSError("missing")):
                with self.subTest(command=command, result=result):
                    fake = Fake({command: result})
                    self.assertEqual(v.verdict(self.qualify(fake)), 3)
                    self.assertIn(("rm", "--force", "--time=0", ID), fake.calls)
                    self.assertIn(("container", "exists", ID), fake.calls)
        fake = Fake({("container", "exists", ID): (0, "")})
        self.assertEqual(v.verdict(self.qualify(fake)), 3)

    def test_inspect_schemas_and_wrong_policy(self):
        cases = [([], 3), ({}, 3), ([{}], 3), (INSPECT * 2, 3)]
        for field, value, code in (
            ("Pid", 0, 3),
            ("Pid", True, 3),
            ("Pid", "42", 3),
            ("Running", False, 3),
            ("Running", "true", 3),
        ):
            rows = copy.deepcopy(INSPECT)
            rows[0]["State"][field] = value
            cases.append((rows, code))
        for key, value, code in (
            ("Id", "b" * 64, 3),
            ("Mounts", [{}], 1),
            ("Mounts", None, 3),
            ("Config", {"User": "0"}, 1),
            ("HostConfig", {"NetworkMode": "host"}, 1),
        ):
            rows = copy.deepcopy(INSPECT)
            rows[0][key] = value
            cases.append((rows, code))
        for rows, code in cases:
            with self.subTest(rows=rows):
                fake = Fake({("container", "inspect", ID): (0, json.dumps(rows))})
                self.assertEqual(v.verdict(self.qualify(fake)), code)
                self.assertIn(("container", "exists", ID), fake.calls)

    def test_measurement_failure_always_cleans_and_retains_failure(self):
        for error, expected in ((v.Failed("wrong limits"), 1), (v.Unverified("missing cgroup"), 3)):

            def measure(_, error=error):
                raise error

            fake = Fake()
            self.assertEqual(v.verdict(self.qualify(fake, measure)), expected)
            self.assertEqual(fake.calls[-1], ("container", "exists", ID))
        self.assertEqual(v.verdict([]), 3)
        self.assertEqual(v.verdict([("PASS", "info"), ("UNVERIFIED", "cleanup")]), 3)
        self.assertEqual(v.verdict([("FAIL", "limit"), ("UNVERIFIED", "cleanup")]), 1)

    def test_pid_changes_between_inspections(self):
        fake = Fake()

        def measure(_):
            rows = copy.deepcopy(INSPECT)
            rows[0]["State"]["Pid"] = 43
            fake.responses[("container", "inspect", ID)] = (0, json.dumps(rows))
            return {}

        self.assertEqual(v.verdict(self.qualify(fake, measure)), 3)
        self.assertEqual(fake.calls[-1], ("container", "exists", ID))


class KernelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mount = Path(self.temp.name).resolve()
        self.group = self.mount / "probe"
        self.group.mkdir()
        self.stat = "42 (probe with ) spaces) S " + " ".join(["0"] * 18 + ["123"])
        self.data = {
            "/proc/42/stat": self.stat,
            "/proc/42/cgroup": "0::/delegated/probe\n",
            "/proc/self/mountinfo": f"1 2 0:3 /delegated {self.mount} rw - cgroup2 cgroup rw\n",
            "/proc/42/status": "Uid:\t1000\t1000\t1000\t1000\nCapEff:\t00000000\nNoNewPrivs:\t1\n",
            str(self.group / "memory.max"): "134217728\n",
            str(self.group / "pids.max"): "32\n",
            str(self.group / "cpu.max"): "100000 100000\n",
        }

    def read(self, path):
        return self.data[str(path)]

    def test_live_kernel_values_and_mount_root_translation(self):
        self.assertEqual(
            v.kernel_limits(42, self.read), {"memory.max": "134217728", "pids.max": "32", "cpu.max": "100000 100000"}
        )

    def test_wrong_limits_and_malformed_values(self):
        for name, value, error in (
            ("memory.max", "max", v.Failed),
            ("memory.max", "268435456", v.Failed),
            ("pids.max", "max", v.Failed),
            ("pids.max", "64", v.Failed),
            ("cpu.max", "max 100000", v.Failed),
            ("cpu.max", "200000 100000", v.Failed),
            ("cpu.max", "100000 0", v.Unverified),
            ("cpu.max", "junk", v.Unverified),
            ("memory.max", "junk", v.Unverified),
            ("pids.max", "", v.Unverified),
        ):
            with (
                self.subTest(name=name, value=value),
                patch.dict(self.data, {str(self.group / name): value}),
                self.assertRaises(error),
            ):
                v.kernel_limits(42, self.read)

    def test_unsafe_or_unmapped_membership_never_reads_limit_files(self):
        for text in (
            "0::/delegated/../probe",
            "0::/delegated/./probe",
            "0::relative",
            "0::/other/probe",
            "1:memory:/probe",
            "0::/probe\n0::/probe",
        ):
            with (
                self.subTest(text=text),
                patch.dict(self.data, {"/proc/42/cgroup": text}),
                self.assertRaises(v.Unverified),
            ):
                v.kernel_limits(42, self.read)

    def test_mount_schemas_and_symlink(self):
        for table in (
            "",
            "garbage",
            "1 - cgroup2",
            f"1 2 0:3 /delegated/.. {self.mount} rw - cgroup2 x rw",
            f"1 2 0:3 /delegated {self.mount} rw - tmpfs x rw",
        ):
            with self.subTest(table=table), self.assertRaises(v.Unverified):
                v.mount_path(v.membership("0::/delegated/probe"), table)
        alias = self.mount / "alias"
        alias.symlink_to(self.group)
        with self.assertRaises(v.Unverified):
            v.mount_path(v.membership("0::/delegated/alias"), self.data["/proc/self/mountinfo"])

    def test_escaped_mount_and_ambiguous_mapping(self):
        mount = self.mount / "with space"
        mount.mkdir()
        (mount / "probe").mkdir()
        escaped = str(mount).replace(" ", r"\040")
        table = f"1 2 0:3 /delegated {escaped} rw - cgroup2 x rw"
        member = v.membership("0::/delegated/probe")
        self.assertEqual(v.mount_path(member, table), mount / "probe")
        with self.assertRaises(v.Unverified):
            v.mount_path(member, table + "\n" + self.data["/proc/self/mountinfo"])

    def test_process_death_uid_privilege_and_missing_evidence(self):
        for status, error in (
            ("Uid: 0 0 0 0\nCapEff: 0\nNoNewPrivs: 1", v.Failed),
            ("Uid: 1000\n", v.Unverified),
            ("Uid: 1 1 1 1\nCapEff: 1\nNoNewPrivs: 1", v.Failed),
            ("Uid: 1 1 1 1\nCapEff: 0\nNoNewPrivs: 0", v.Failed),
        ):
            with patch.dict(self.data, {"/proc/42/status": status}), self.assertRaises(error):
                v.kernel_limits(42, self.read)
        with (
            patch.dict(self.data, {"/proc/42/stat": self.stat.replace(") S", ") Z")}),
            self.assertRaises(v.Unverified),
        ):
            v.kernel_limits(42, self.read)
        del self.data[str(self.group / "pids.max")]
        with self.assertRaises(KeyError):
            v.kernel_limits(42, self.read)

    def test_pid_reuse_and_migration(self):
        for target in ("/proc/42/stat", "/proc/42/cgroup"):
            calls = []

            def read(path, target=target, calls=calls):
                if path == target:
                    calls.append(path)
                    if len(calls) == 2:
                        return self.stat[:-3] + "124" if target.endswith("stat") else "0::/delegated/other"
                return self.read(path)

            with self.assertRaises(v.Unverified):
                v.kernel_limits(42, read)


class TransportTests(unittest.TestCase):
    def setUp(self):
        # Outer sandbox uses the host numeric UID, which need not have a passwd
        # entry. A real qualification requires the guest agent's local account.
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        account = patch.object(v.pwd, "getpwuid", return_value=SimpleNamespace(pw_dir=home.name))
        account.start()
        self.addCleanup(account.stop)

    def test_environment_is_allowlisted(self):
        with patch.dict(
            os.environ,
            {
                "DOCKER_HOST": "bad",
                "CONTAINER_HOST": "bad",
                "CONTAINER_CONNECTION": "bad",
                "LD_PRELOAD": "bad",
                "HTTP_PROXY": "bad",
                "PYTHONPATH": "bad",
            },
        ):
            env = v.local_environment()
        self.assertEqual(set(env), {"HOME", "PATH", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"})

    def test_fake_executable_output_timeout_signal_and_local_argv(self):
        # This executable is a Python fixture, never Podman. All subprocess work
        # remains inside the outer test sandbox and uses no engine or network.
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "fake-engine"
            popen = subprocess.Popen

            def fixture_process(argv, **kwargs):
                # /tmp is deliberately noexec in the review sandbox. Interpret
                # only this fixture using the already-installed Python binary.
                self.assertEqual(argv[0], str(fake))
                return popen([sys.executable, "-I", "-B", *argv], **kwargs)

            for body, expected in (
                ("import sys; print(sys.argv[1:])", "argv"),
                ("print('x' * 70000)", "error"),
                ("import time; time.sleep(5)", "error"),
                ("import os, signal; os.kill(os.getpid(), signal.SIGTERM)", "error"),
            ):
                fake.write_text(f"#!{sys.executable}\n{body}\n")
                fake.chmod(0o700)
                with patch.object(v, "TIMEOUT", 0.3), patch.object(v.subprocess, "Popen", side_effect=fixture_process):
                    call = v.Transport(str(fake))
                    if expected == "error":
                        with self.assertRaises(v.Unverified):
                            call("info")
                    else:
                        code, text = call("info")
                        self.assertEqual(code, 0)
                        self.assertIn("['--remote=false', 'info']", text)

    def test_input_validation_and_no_host_fallback(self):
        with patch.object(v.sys, "platform", "darwin"), patch.object(v, "Transport") as transport:
            self.assertEqual(v.main(["--guest", "--podman", "/usr/bin/podman", "--image", IMAGE]), 3)
            transport.assert_not_called()
        self.assertEqual(v.main([]), 3)
        for image in (
            "alpine",
            "docker.io/library/alpine:latest",
            "library/alpine@sha256:" + "a" * 64,
            "https://example.com/probe@sha256:" + "a" * 64,
        ):
            self.assertIsNone(v.IMAGE.fullmatch(image))

    def test_root_and_missing_executable_fail_before_transport(self):
        args = ["--guest", "--podman", "relative-podman", "--image", IMAGE]
        with patch.object(v.sys, "platform", "linux"), patch.object(v, "Transport") as transport:
            with patch.object(v.os, "getuid", return_value=0):
                self.assertEqual(v.main(args), 1)
            with patch.object(v.os, "getuid", return_value=1000), patch.object(v.os, "geteuid", return_value=1000):
                self.assertEqual(v.main(args), 3)
                args[2] = "/does-not-exist/podman"
                self.assertEqual(v.main(args), 3)
            transport.assert_not_called()

    def test_signal_never_passes_even_if_cleanup_finishes(self):
        fake = Fake()

        def factory(_):
            def call(*args):
                result = fake(*args)
                if args[0] == "start":
                    signal.raise_signal(signal.SIGTERM)
                return result

            return call

        with (
            patch.object(v.sys, "platform", "linux"),
            patch.object(v.os, "getuid", return_value=1000),
            patch.object(v.os, "geteuid", return_value=1000),
            patch.object(v, "Transport", side_effect=factory),
        ):
            self.assertEqual(v.main(["--guest", "--podman", sys.executable, "--image", IMAGE]), 3)
        self.assertEqual(fake.calls[-1], ("container", "exists", ID))


if __name__ == "__main__":
    unittest.main()
