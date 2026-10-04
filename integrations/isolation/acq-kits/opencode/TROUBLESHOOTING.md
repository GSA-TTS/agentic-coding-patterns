# Troubleshooting - opencode kit

Failure modes specific to the opencode kit. They assume you applied the kit to a
sandbox (see [README.md](README.md)).

## `opencode` is not installed

**Symptoms:** `command -v opencode` returns nothing inside the sandbox, or acq's
agent-kit readiness gate reports that the `opencode` agent token is unavailable.

**Cause:** this kit fails soft on availability problems so sandbox creation can
continue. The install script leaves `opencode` absent when it cannot safely fetch,
verify, extract, or install the pinned release binary.

**Fix:** inspect the create-time install output and look for lines prefixed with
`opencode-kit(install):`.

Common causes:

- `OPENCODE_VERSION` or one of the architecture-specific SHA-256 pins was not set
  by `spec.yaml`.
- The sandbox architecture is not `x86_64`, `amd64`, `aarch64`, or `arm64`.
- `curl` is missing from the base image.
- The sandbox cannot reach `github.com` or `release-assets.githubusercontent.com`.
- The release tarball could not be extracted or did not contain an executable
  `opencode` member.
- `/usr/local/bin` could not be created or written by the root install step.

Recreate the sandbox after fixing the underlying cause; the install step runs at
create time.

## `SECURITY: sha256 mismatch`

**Symptoms:** the install log contains `SECURITY: sha256 mismatch`, and
`opencode` is absent.

**Cause:** the downloaded archive's SHA-256 did not match the pin in `spec.yaml`.
This is a fail-closed integrity refusal, not a transient availability degrade.
The script refuses to extract the mismatched archive and has no unpinned fallback.

**Fix:** do not bypass the check. Confirm the intended OpenCode release, download
both Linux release assets from the official GitHub Release, re-derive their
SHA-256 values locally, update all three pins in `spec.yaml` together, and rerun
`scripts/verify` before recreating the sandbox.

## `SECURITY: archive member 'opencode' is not a regular file`

**Symptoms:** the install log contains `SECURITY: archive member 'opencode' is
not a regular file`, and `opencode` is absent.

**Cause:** the verified archive's `opencode` entry is not an ordinary file. The
script rejects hardlinks, symlinks, device files, and other non-regular tar
members before extraction because installing one could trust or copy something
other than the release binary.

**Fix:** treat this as a release-asset integrity problem. Do not install the
archive manually. Re-check the upstream release asset and update the kit only
after a human review confirms the expected archive layout.

## `SECURITY: extracted 'opencode' member is a symlink`

**Symptoms:** the install log contains `SECURITY: extracted 'opencode' member is
a symlink`, and `opencode` is absent.

**Cause:** the verified archive passed the pre-extraction tar listing check but
extracted to a symlink on this platform. The script keeps this post-extraction
check as a second guard before installing into `/usr/local/bin`.

**Fix:** treat this as a release-asset integrity problem. Do not install the
archive manually. Re-check the upstream release asset and update the kit only
after a human review confirms the expected archive layout.

## The kit works on one host architecture but not another

**Symptoms:** `opencode` installs on an x64 sandbox but not an arm64 sandbox, or
vice versa.

**Cause:** the kit pins separate SHA-256 values for
`opencode-linux-x64.tar.gz` and `opencode-linux-arm64.tar.gz`. A missing or stale
pin for the current guest architecture makes the installer refuse to install an
unverified binary.

**Fix:** update the version and both architecture hashes in `spec.yaml` together.
Then run the kit's verifier, preferably on both x64 and arm64-capable hosts when
available.

## The verifier reports a schema skip

**Symptoms:** `scripts/verify` prints `SKIP python3 with jsonschema+pyyaml not
available`.

**Cause:** the offline schema check needs Python with `jsonschema` and `pyyaml`.
The skip does not mean the kit is invalid; it means the local host is missing the
validator dependencies.

**Fix:** run the repository setup first, or install the validation dependencies in
your development environment, then rerun `scripts/verify`.

## Live sandbox verification is skipped

**Symptoms:** `scripts/verify` prints `RUN_ACQ=1 not set - skipped live acq
sandbox verification`.

**Cause:** live sandbox creation is opt-in because it needs a working acq install
and sandbox-capable host.

**Fix:** run the live check from a host where `acq` is installed and authenticated:

```bash
RUN_ACQ=1 integrations/isolation/acq-kits/opencode/scripts/verify
```

Use `KEEP=1` only when you intentionally want to leave the temporary sandbox in
place for inspection.
