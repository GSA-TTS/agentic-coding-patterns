# Decision: opt-in volatile Podman runtime with a separate persistent store

**Status:** experimental; metadata only, not workload qualified

## Context

Podman keeps both persistent storage and transient runtime state. Persisting its
runroot or libpod temporary directory through a guest stop/start can retain stale
boot state. Changing those paths underneath an existing database is not an
implicit migration strategy. A separate store makes the lifecycle explicit and
leaves the default agent store alone.

The operator reports a native MSB **0.7.11**, Podman **5.7** metadata-only
stop/start observation: a fresh tmpfs at the same runtime paths, with the separate
persistent graphroot retained, preserved a named volume's content hash. This is
bounded operator-provided evidence, not a test run of this helper. No raw
transcript, exact engine patch version, image digest, or volume hash is included
here. It is not evidence of container execution, build success, resource
enforcement, or compatibility with another backend/version. Offline fixtures
likewise cannot qualify the native lifecycle.

## Decision

Add a Python-standard-library helper, [managed-runtime.py](../../scripts/managed-runtime.py),
delivered and invoked explicitly by the operator. Do not wire it into the kit
spec, installer, startup phases, Docker wrapper, or either existing verifier.
It never installs software, mounts filesystems, edits engine configuration,
changes graph drivers, resets storage, migrates data, changes cgroups, or grants
sudo access. The only root action is preparing new runtime directories.

### Runtime ownership and boot preparation

The operator must independently provision a dedicated tmpfs mounted **exactly**
at `/run/acq-oci-runtime`, owned by the current guest root UID 0 with mode 0755,
and explicit positive size no greater than 128 MiB. A tmpfs ancestor, a bind of
a subtree, a non-tmpfs mount, duplicate exact mounts, or a nested mount is not
accepted. The helper reads `/proc/self/mountinfo` before writing and requires a
writable mount whose filesystem root is `/`. Directory-descriptor walks reject
symlinks at every component; root preparation also rejects non-root-owned or
group/world-writable ancestors. These checks assume a trustworthy guest kernel
and no concurrent privileged mount changes; they are not mount attestation.

`--guest prepare --user agent` requires root and a passwd-resolved non-root
account. It creates `/run/acq-oci-runtime/UID` with mode 0700, containing two
0700 directories: `storage` (runroot) and `libpod` (tmpdir). Ownership passes to
the selected user only after the new tree is complete. Repeating preparation
validates an existing complete tree without changing it. A wrong owner, mode,
symlink, missing child, or interrupted root-owned tree is a refusal, not a
repair opportunity. Root never recursively chowns user-controlled contents.
After a guest restart with fresh tmpfs, prepare is required again.

### Persistent store initialization

As the agent, `--guest init-store` first requires valid prepared runtime paths.
It creates missing `.local/share` directories under the passwd home and then
exclusively creates `~/.local/share/acq-oci-runtime` (0700), an empty `store`
directory (0700), and `managed-store.json` (0600). The strict JSON marker binds
version, numeric UID, passwd home, graphroot, runroot and tmpdir. A pending file
is flushed before an exclusive link publishes the marker; its pending link is
then removed. An interrupted write has no published marker, and interruption
between linking and unlinking leaves a hardlinked marker that exec refuses.
Duplicate or
unknown keys, incorrect JSON types, symlinks, hardlinked markers, oversized or
malformed records, and binding mismatches are refused at exec time.

**Any existing dedicated state parent makes init-store fail**, even if empty,
valid, or left incomplete after interruption. Existing nonempty foreign storage
is never adopted. This is deliberate: initialization is one-time, not repair or
idempotent migration. Failure may leave the new parent, store or partial marker;
exec requires the complete valid marker and store. The helper never rolls back
by recursively deleting a path. An operator must reconcile interrupted state
offline, retain any data, and approve recovery independently. A valid existing
store is used with `exec`, not initialized again.

The marker binds paths, not a tmpfs mount ID: runtime paths intentionally remain
stable while tmpfs is fresh on each boot. It is not a signature or integrity
proof of user-owned persistent data. The agent/operator can edit or replace that
data outside this helper. Keep a single writer and do not modify the directory
tree concurrently with helper operations.

### Execution contract

Every command requires `--guest`, a Linux process, matching real/effective UIDs,
and the selected passwd account. `--guest` is an acknowledgment, **not guest
detection**. `init-store` and `exec` reject root; there is no root Podman fallback.

Exec verifies preparation, ownership and the manifest, then replaces itself with
`/usr/bin/podman`, passing explicit `--remote=false`, `--root`, `--runroot`,
`--tmpdir`, and `--cgroup-manager=cgroupfs`. The environment is replaced with only
passwd-derived `HOME` and `USER`, fixed `PATH=/usr/bin:/bin` and `LANG=C`, and
`XDG_RUNTIME_DIR=/run/acq-oci-runtime/UID`. No inherited PODMAN, CONTAINER, DOCKER,
loader, Python, proxy, storage or other configuration variables are forwarded.
Invoke Python with `-I -B` so Python startup itself also ignores inherited
Python configuration. This does not sanitize a compromised interpreter or host
launcher before it starts; trusted delivery and execution are prerequisites.

The intentionally small literal grammar accepts only:

- `info` or `info --format json`
- `images`
- `image exists REFERENCE`
- `volume ls` or `volume ls --format json`
- `volume exists NAME`, `volume inspect NAME`, or `volume create NAME`

The last forms accept one non-option reference/name token from a conservative
character set. There are no other flags, nested workload commands, global
options before or after the subcommand, remote controls, arbitrary formats,
mount options or driver options. This avoids global-option overrides rather
than trying to implement all of Podman's parser. Invalid arguments fail before
state checks or engine invocation. Podman validates names and references itself;
its exit status is preserved. A named volume create is a metadata/store write,
not a container workload test. There is no automatic volume deletion.

**This helper is NOT a security sandbox or an argument permission system.** The
agent can invoke Podman directly and controls its writable graphroot. The fixed
grammar is a compatibility boundary, not authorization against hostile users.
No claim is made that default `podman`, the Docker wrapper, or the resource
verifier shares the managed store; they do not acquire these flags implicitly.

### Existing configuration and unresolved cgroup prerequisites

Replacing environment variables does **not** disable system/user configuration
files. In particular, `/etc/containers/containers.conf` or the user's
`~/.config/containers/containers.conf` can specify a prototype `cgroup_parent`.
The helper neither hides that effect nor supplies a replacement parent. It
forces the requested cgroup manager only, not a cgroup hierarchy, delegation,
resource limit, or storage driver. Operators must review compatible on-disk
configuration before opting in. A conflicting configuration may cause even
metadata operations to fail; changing it is a separate reviewed operation.

Future workload execution remains blocked pending native evidence for both the
direct parent/delegation path used by new guest exec processes and freezer
support. A controller listing or a working metadata command is insufficient.
On cgroup v2, delegation and migration permissions govern which processes can
enter which groups; a later exec process is not proven to inherit an earlier
setup shell's group. Domain-controller rules also constrain a parent containing
processes. A proposed parent must therefore be checked for the actual execution
path, not inferred from setup. The kernel's `cgroup.freeze` interface and its
reported frozen state are distinct from memory/cpu/pids controller availability;
a runtime expecting freezer operations can still fail where these are missing
or not writable. These are separate prerequisites, not problems repaired by
moving storage into tmpfs.

Durable public source anchors (version-pinned; not a claim that these are the
native guest's exact kernel/runtime revisions):

- [Linux v6.12 cgroup-v2 documentation](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/cgroup-v2.rst):
  “Delegation”, “No Internal Process Constraint”, and `cgroup.freeze` describe
  migration permissions, process placement and asynchronous freezer state.
- [Podman v5.7.0 CLI manual source](https://github.com/containers/podman/blob/v5.7.0/docs/source/markdown/podman.1.md):
  global root/runroot/tmpdir, cgroup manager and local/remote configuration.
- [Podman v5.7.0 run manual source](https://github.com/containers/podman/blob/v5.7.0/docs/source/markdown/podman-run.1.md):
  cgroup-parent selection belongs to workload configuration, not storage repair.

No workload qualification follows until those execution-path prerequisites and
live kernel resource limits are measured in the intended guest. Do not remove
limits, disable cgroups, or change the existing resource verifier to obtain a
green result. See [resource qualification](resource-qualification.md).

## Validation and integration limits

[Python fixtures](../../tests/managed-runtime-test.py) use temporary directories
and injected mount/identity/exec functions; they do not mount, chown real users,
invoke Podman or run container workloads. The [Node wrapper](../../tests/managed-runtime.test.mjs)
fits `node --test 'tests/*.test.mjs'`. Both must run only in the independently
approved workspace sandbox. They are not a substitute for native testing.

Repository `make test-kits` includes the OCI kit glob. The existing kit CI job
therefore runs these offline fixtures; it does not perform native guest tests.

## Links / tracking

- Managed-runtime implementation: [GSA-TTS/agentic-coding-patterns#588](https://github.com/GSA-TTS/agentic-coding-patterns/issues/588).
- Native cgroup execution follow-up: [GSA-TTS/agentic-coding-quickstart#2029](https://github.com/GSA-TTS/agentic-coding-quickstart/issues/2029).
