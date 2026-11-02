"""Bounded, guest-local qualification. No host adapter, installation, or repair.

Uses the coverage/exit semantics of ../../verify-report.sh without sourcing shell.
The operator supplies a trusted installed Podman and a trusted preloaded image.
"""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import selectors
import signal
import subprocess
import sys
import time


LIMIT = 65536
TIMEOUT = 10
CID = re.compile(r"[0-9a-f]{64}")
IMAGE = re.compile(
    r"(?:localhost|[a-z0-9]+(?:[.-][a-z0-9]+)+)(?::[0-9]+)?/"
    r"[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}"
)


class Unverified(Exception):
    """Evidence is missing, malformed, interrupted, or unavailable."""


class Failed(Exception):
    """A measured prerequisite or limit is wrong."""


def verdict(records):
    if any(state == "FAIL" for state, _ in records):
        return 1
    if not records or any(state == "UNVERIFIED" for state, _ in records):
        return 3
    return 0 if any(state == "PASS" for state, _ in records) else 3


def trace(message):
    print("verify-resources: " + message, file=sys.stderr, flush=True)


def read_text(path):
    with open(path, "rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise Unverified("kernel evidence exceeds output bound")
    return data.decode("utf-8", errors="strict")


def local_environment():
    # Allowlist, not a denylist: no inherited remote, connection, proxy, storage,
    # loader, Python, or Docker settings. Preserve the real user's local store.
    uid = os.getuid()
    return {
        "PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
        "HOME": pwd.getpwuid(uid).pw_dir,
        "XDG_RUNTIME_DIR": f"/run/user/{uid}",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus",
    }


class Transport:
    def __init__(self, executable):
        self.executable = executable
        self.env = local_environment()

    def __call__(self, *args):
        trace(f"podman {args[0]} (deadline {TIMEOUT}s, output {LIMIT} bytes)")
        # A pipe reader bounds output while it arrives; communicate() alone
        # would allow a verbose or wedged engine to exhaust verifier memory.
        proc = subprocess.Popen(
            [self.executable, "--remote=false", *args], env=self.env,
            cwd="/", stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, start_new_session=True,
        )
        output = {proc.stdout: bytearray(), proc.stderr: bytearray()}
        deadline = time.monotonic() + TIMEOUT
        try:
            with selectors.DefaultSelector() as selector:
                for stream in output:
                    selector.register(stream, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise Unverified("Podman transport timed out")
                    for key, _ in selector.select(min(remaining, 0.1)):
                        chunk = os.read(key.fileobj.fileno(), 8192)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            output[key.fileobj].extend(chunk)
                            if sum(map(len, output.values())) > LIMIT:
                                raise Unverified("Podman output exceeded bound")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Unverified("Podman transport timed out")
                code = proc.wait(timeout=remaining)
            if code < 0:
                raise Unverified("Podman transport terminated by signal")
            return code, output[proc.stdout].decode("utf-8", errors="strict")
        finally:
            # Also kill descendants retaining pipes on exceptional exits. This
            # group is the CLI transport, not a substitute for container cleanup.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                raise Unverified("Podman transport could not be reaped")
            finally:
                proc.stdout.close()
                proc.stderr.close()


def checked(call, *args):
    code, text = call(*args)
    if code != 0:
        raise Unverified(f"Podman {args[0]} unavailable (exit {code})")
    return text


def info_gate(info):
    host = info["host"]
    rootless = host["security"]["rootless"]
    if rootless is False:
        raise Failed("Podman reports rootful operation")
    if rootless is not True:
        raise Unverified("rootless must be JSON boolean true")
    if host["cgroupVersion"] != "v2":
        raise Unverified("cgroup v2 is unavailable")
    controllers = host["cgroupControllers"]
    if not isinstance(controllers, list) or not all(isinstance(x, str) for x in controllers):
        raise Unverified("malformed delegated-controller report")
    if not {"memory", "cpu", "pids"}.issubset(controllers):
        raise Unverified("memory/cpu/pids controllers are not all delegated")


def absolute_parts(value):
    # Do not normalize away traversal. mountinfo escapes are decoded before this.
    if not value.startswith("/") or "\x00" in value:
        raise Unverified("non-absolute kernel cgroup path")
    if any(part in (".", "..") for part in value.split("/")):
        raise Unverified("unsafe kernel cgroup path")
    return PurePosixPath(value)


def membership(text):
    lines = text.strip().splitlines()
    if len(lines) != 1 or not lines[0].startswith("0::"):
        raise Unverified("expected one unified cgroup membership")
    return absolute_parts(lines[0][3:])


def mount_path(member, mountinfo):
    candidates = set()
    for line in mountinfo.splitlines():
        fields = line.split()
        if "-" not in fields:
            raise Unverified("malformed mountinfo")
        separator = fields.index("-")
        if separator < 6 or len(fields) < separator + 4:
            raise Unverified("malformed mountinfo")
        if fields[separator + 1] != "cgroup2":
            continue
        def decode(value):
            value = re.sub(r"\\(040|011|012|134)", lambda m: chr(int(m[1], 8)), value)
            if "\\" in value:
                raise Unverified("unsupported mountinfo escape")
            return absolute_parts(value)
        root, mount = decode(fields[3]), decode(fields[4])
        try:
            relative = member.relative_to(root)
        except ValueError:
            continue
        candidates.add(Path(str(mount / relative)))
    if len(candidates) != 1:
        raise Unverified("no unique cgroup2 mount maps the live PID membership")
    path = candidates.pop()
    # cgroupfs has no symlinks. Refuse unexpected guest filesystem redirection.
    if path.resolve(strict=True) != path:
        raise Unverified("cgroup path resolves through a symlink")
    return path


def process_identity(pid, read):
    text = read(f"/proc/{pid}/stat")
    # comm may contain spaces and parentheses; fields after its final ')' start
    # at stat field 3. starttime is field 22 and binds repeated observations.
    fields = text[text.rindex(")") + 2:].split()
    if fields[0] in ("Z", "X"):
        raise Unverified("probe PID is not live")
    return int(fields[19])


def kernel_limits(pid, read=read_text):
    identity = process_identity(pid, read)
    member_text = read(f"/proc/{pid}/cgroup")
    group = mount_path(membership(member_text), read("/proc/self/mountinfo"))
    status = dict(line.split(":", 1) for line in read(f"/proc/{pid}/status").splitlines() if ":" in line)
    uids = status["Uid"].split()
    if len(uids) != 4 or not all(x.isdecimal() for x in uids):
        raise Unverified("malformed live PID uid evidence")
    if "0" in uids:
        raise Failed("probe has a root guest uid")
    if int(status["CapEff"], 16) != 0 or status["NoNewPrivs"].strip() != "1":
        raise Failed("probe capability/no-new-privileges policy is not effective")
    memory = read(group / "memory.max").strip()
    pids = read(group / "pids.max").strip()
    cpu = read(group / "cpu.max").split()
    for value in (memory, pids):
        if value != "max" and not value.isdecimal():
            raise Unverified("malformed kernel limit")
    if len(cpu) != 2 or not cpu[1].isdecimal() or int(cpu[1]) <= 0:
        raise Unverified("malformed cpu.max period")
    if cpu[0] != "max" and not cpu[0].isdecimal():
        raise Unverified("malformed cpu.max quota")
    if (process_identity(pid, read) != identity or
            read(f"/proc/{pid}/cgroup") != member_text):
        raise Unverified("probe PID identity or membership changed during measurement")
    if memory != "134217728" or pids != "32" or cpu[0] != cpu[1]:
        raise Failed("live kernel limits differ from memory=128MiB, cpus=1, pids=32")
    return {"memory.max": memory, "cpu.max": " ".join(cpu), "pids.max": pids}


def live_pid(call, cid):
    rows = json.loads(checked(call, "container", "inspect", cid))
    if not isinstance(rows, list) or len(rows) != 1:
        raise Unverified("expected one container inspect record")
    row = rows[0]
    if row["Id"] != cid or row["State"]["Running"] is not True:
        raise Unverified("inspect did not identify the live probe")
    pid = row["State"]["Pid"]
    if type(pid) is not int or pid <= 0:
        raise Unverified("missing live guest PID")
    if row["Config"]["User"] != "65534:65534":
        raise Failed("probe container user differs from explicit non-root user")
    if row["HostConfig"]["NetworkMode"] != "none":
        raise Failed("probe network mode differs from none")
    mounts = row["Mounts"]
    if not isinstance(mounts, list):
        raise Unverified("malformed container mount report")
    if mounts:
        raise Failed("probe unexpectedly has engine-configured mounts")
    return pid


EVIDENCE_ERRORS = (Unverified, OSError, ValueError, KeyError, TypeError, IndexError,
                   subprocess.TimeoutExpired)


def qualify(call, image, measure=kernel_limits):
    records = []
    cid = None
    creation_attempted = False
    try:
        info_gate(json.loads(checked(call, "info", "--format=json")))
        records.append(("PASS", "explicit rootless v2 delegated-controller report"))
        checked(call, "image", "exists", image)
        creation_attempted = True
        # Create separately from start so the exact ID is owned before any image
        # process runs. Ignore image-declared volumes; no bind/mount arguments.
        create_code, cid_text = call(
            "create", "--pull=never", "--network=none", "--user=65534:65534",
            "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=128m",
            "--cpus=1", "--pids-limit=32", "--image-volume=ignore", "--read-only",
            "--no-healthcheck", "--log-driver=none", "--env=PATH=/usr/bin:/bin",
            "--entrypoint=/bin/sh", image, "-c", "exec sleep 120",
        )
        cid_text = cid_text.strip()
        if not CID.fullmatch(cid_text):
            raise Unverified("create returned no unique full container ID")
        cid = cid_text
        trace("owned probe ID " + cid)
        if create_code != 0:
            raise Unverified(f"Podman create unavailable (exit {create_code})")
        checked(call, "start", cid)
        pid = live_pid(call, cid)
        trace("read live guest PID kernel limits")
        limits = measure(pid)
        if live_pid(call, cid) != pid:
            raise Unverified("probe PID changed after measurement")
        records.append(("PASS", "live kernel limits " + json.dumps(limits, sort_keys=True)))
    except Failed as exc:
        records.append(("FAIL", str(exc)))
    except EVIDENCE_ERRORS as exc:
        records.append(("UNVERIFIED", "qualification evidence unavailable: " + str(exc)))
    finally:
        # SIGINT/TERM during cleanup must not interrupt the only cleanup attempt.
        # The handler records interruption; final verdict remains nonzero.
        if cid is not None:
            trace("remove exact owned probe ID and verify absence")
            try:
                checked(call, "rm", "--force", "--time=0", cid)
            except EVIDENCE_ERRORS as exc:
                records.append(("UNVERIFIED", "cleanup removal: " + str(exc)))
            try:
                code, _ = call("container", "exists", cid)
                if code != 1:
                    raise Unverified("probe absence not established after cleanup")
                records.append(("PASS", "exact probe ID absent; container exists returned 1"))
            except EVIDENCE_ERRORS as exc:
                records.append(("UNVERIFIED", "cleanup: " + str(exc)))
        elif creation_attempted:
            records.append(("UNVERIFIED", "create outcome has no owned ID; cleanup cannot be verified"))
    return records


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        raise Unverified("arguments: " + message)


def main(argv=None):
    parser = Arguments(description="Run only INSIDE the intended Linux guest as its non-root agent.")
    parser.add_argument("--guest", action="store_true", required=True,
                        help="acknowledge this is the intended guest (not host detection)")
    parser.add_argument("--podman", required=True, help="absolute installed local Podman executable")
    parser.add_argument("--image", required=True, help="trusted preloaded registry/name@sha256:digest")
    interrupted = []
    def on_signal(signum, _frame):
        interrupted.append(signum)
    old = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    records = []
    try:
        args = parser.parse_args(argv)
        if sys.platform != "linux":
            raise Unverified("guest-local verifier requires Linux")
        if os.getuid() == 0 or os.geteuid() == 0:
            raise Failed("run as the non-root guest agent, never root")
        executable = Path(args.podman)
        if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK):
            raise Unverified("--podman must name an absolute installed executable")
        if not IMAGE.fullmatch(args.image):
            raise Unverified("--image must be fully qualified and pinned by sha256 digest")
        transport = Transport(str(executable))
        def call(*command):
            # Once interrupted, allow only exact-ID cleanup commands.
            cleanup = command[0] == "rm" or command[:2] == ("container", "exists")
            if interrupted and not cleanup:
                raise Unverified("qualification interrupted")
            return transport(*command)
        records = qualify(call, args.image)
    except Failed as exc:
        records.append(("FAIL", str(exc)))
    except EVIDENCE_ERRORS as exc:
        records.append(("UNVERIFIED", str(exc)))
    finally:
        if interrupted:
            records.append(("UNVERIFIED", "signal interrupted qualification"))
        for sig, handler in old.items():
            signal.signal(sig, handler)
    for state, detail in records:
        print(f"{state}: {detail}", flush=True)
    code = verdict(records)
    print("RESOURCE QUALIFICATION: " + {0: "PASS", 1: "FAIL", 3: "UNVERIFIED"}[code], flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
