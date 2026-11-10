# Decision: separate guest-local resource qualification from storage verification

**Status:** experimental

## Context

A working installation, storage layer mount, non-root agent UID, or configured
marker does not establish resource enforcement. Rootless Podman may operate with
missing cgroup delegation. The legacy `scripts/verify` combines installation and
storage checks with two-state reporting and a UID fallback when the rootless
field is absent. Retrofitting that script would obscure this narrower contract.

## Decision

Add [scripts/verify-resources](../../scripts/verify-resources) and its isolated
Python standard-library helper as an explicit **guest-local** operation. The
wrapper uses `python3 -I -B`. The operator selects the intended guest, trusted
installed Podman executable, and preloaded digest-qualified image; the script
does not select a backend or contact an image registry. `--guest` acknowledges
placement but cannot attest that a Linux machine is a guest.

Use an allowlisted environment and `--remote=false` rather than honoring inherited
Docker/Podman remote settings. Require explicit JSON rootless boolean true,
cgroup v2, and memory/cpu/pids delegation before creating a probe. Do not mutate
cgroups, install dependencies, request root, or degrade into an unlimited run.

Create separately from start to obtain ownership of a full container ID before
image execution. Override the entrypoint; constrain the probe to network none,
non-root user, dropped capabilities, no-new-privileges, memory 128 MiB, CPU quota
one CPU, and 32 PIDs. Ignore image volumes and disable healthchecks and logging.
No bind mounts are supplied. A 120-second sleep leaves a finite observation
window without a resource-exhaustion workload. CLI calls are individually bounded
to 10 seconds and 64 KiB combined output, with no retries and bounded CLI reap.
Step traces identify the active operation and exact owned ID without echoing
engine stderr or the environment.

Inspect requested configuration only for identity and probe-policy checks.
Resource qualification comes from the guest kernel: join the live inspected PID's
unified membership to the guest reader's cgroup2 mount root, then read leaf
`memory.max`, `cpu.max`, and `pids.max`. Reject traversal, unmapped/ambiguous
mounts, symlinks, missing or malformed evidence. Verify live UID/capability/NNP
evidence and repeat process start-time, membership, and engine PID checks.

The verdict is a function of the coverage record, following
[the shared reporter](../../../verify-report.sh): 0 measured success, 1 measured
failure, 3 incomplete evidence without a measured failure. `finally` removes only
the exact returned full ID and checks absence. Lost create identity, cleanup
failure, transport failure or interruption can never pass. Signals are recorded;
subsequent probe operations stop while bounded cleanup remains available.

## Limits and follow-up evidence

- This is a point-in-time qualification of this guest/user/store/image. It trusts
  the installed executable, guest kernel, and operator-selected image; it is not
  an attestation against a compromised guest or hostile engine.
- Only the documented Podman JSON schema is accepted. Unsupported schemas and
  restricted `/proc` or cgroup visibility are unverified, not rootless inferred
  from UID and not successful on the strength of a marker.
- Kernel leaf limits must match exactly. Ancestors may impose tighter limits;
  the result is not a performance guarantee or outer sandbox resource claim.
- Path/identity rechecks reduce races but are not an atomic snapshot. A concurrent
  privileged guest process can still invalidate evidence. Reads assume functioning
  local procfs/cgroupfs; uninterruptible kernel I/O cannot be bounded in user space.
- A create response lost before a valid ID leaves ownership unknown. Report this
  and require operator reconciliation rather than deleting by name or sweeping
  unrelated containers. SIGKILL, guest failure, and lost cleanup transport can
  leave artifacts even though the probe command has a finite lifetime.
- [Offline tests](../../../../../../scripts/tests/test_oci_resource_verifier.py)
  exercise injected transport, kernel schemas, malformed/degraded results,
  deadlines, output bounds and signals. They prove verifier behavior, not actual
  engine enforcement. Live qualification remains a separately authorized guest
  run with the selected preloaded image.

See the [kit README](../../README.md#resource-qualification-guest-only-experimental)
for invocation and the [storage decision](port-oci-engine-failsoft-and-vfs-fallback.md)
for the independent installation/storage lifecycle.
