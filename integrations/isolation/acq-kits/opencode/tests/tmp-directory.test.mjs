import test from "node:test"
import assert from "node:assert/strict"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import os from "node:os"

const spec = await readFile(new URL("../spec.yaml", import.meta.url), "utf8")
const startup = spec.match(/  - phase: startup\n    user: "0"\n    description: Prepare private OpenCode scratch directory for the agent user\n    command:\n      - sh\n      - -c\n      - \|\n((?:        .*\n)+)/)
assert.ok(startup, "scratch directory preparation must be wired as a root startup command")
const body = startup[1].replace(/^        /gm, "")

const idShim = `#!/bin/sh
[ -n "$FAKE_UID" ] || exit 1
[ "$2" = agent ] || exit 1
case "$1" in -u) echo "$FAKE_UID" ;; -g) echo "$FAKE_GID" ;; *) exit 1 ;; esac
`

// Records the requested ownership, then installs with the caller's real ids
// (the test cannot chown to arbitrary ids without root).
const installShim = `#!/bin/sh
echo "$*" >> "$INSTALL_LOG"
n=$#
while [ "$n" -gt 0 ]; do
  a=$1; shift; n=$((n - 1))
  case "$a" in
    -o) shift; n=$((n - 1)); set -- "$@" -o "$REAL_UID" ;;
    -g) shift; n=$((n - 1)); set -- "$@" -g "$REAL_GID" ;;
    *) set -- "$@" "$a" ;;
  esac
done
exec /usr/bin/install "$@"
`

async function fixture(t, { agent = { uid: process.getuid(), gid: process.getgid() } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-tmp-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "opencode")
  const bin = path.join(root, "bin")
  const installLog = path.join(root, "install.log")
  await mkdir(bin)
  await writeFile(path.join(bin, "id"), idShim, { mode: 0o755 })
  await writeFile(path.join(bin, "install"), installShim, { mode: 0o755 })
  // Exercise real install/chmod without requiring root or touching /tmp/opencode.
  const command = body.replaceAll("/tmp/opencode", directory)
  const run = () => spawnSync("/bin/sh", ["-c", command], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      INSTALL_LOG: installLog,
      REAL_UID: String(process.getuid()),
      REAL_GID: String(process.getgid()),
      ...(agent ? { FAKE_UID: String(agent.uid), FAKE_GID: String(agent.gid) } : {}),
    },
    encoding: "utf8",
  })
  const installCalls = async () => readFile(installLog, "utf8").catch(() => "")
  return { root, directory, run, installCalls }
}

test("root startup resolves the agent's UID/GID by name without recursive changes", () => {
  assert.match(body, /id -u agent/)
  assert.match(body, /id -g agent/)
  assert.match(body, /install -d -o "\$agent_uid" -g "\$agent_gid" -m 0700 \/tmp\/opencode/)
  assert.doesNotMatch(body, /\b1000\b/)
  assert.doesNotMatch(body, /(?:chown|chmod)\s+-R/)
  assert.ok(spec.indexOf(startup[0]) < spec.indexOf("description: Render current provider inputs"))
})

test("startup uses a non-1000 agent uid/gid reported by the sandbox", async (t) => {
  const { directory, run, installCalls } = await fixture(t, { agent: { uid: 2345, gid: 2346 } })
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(await installCalls(), /-d -o 2345 -g 2346 -m 0700 \S+\/opencode/)
  assert.ok((await stat(directory)).isDirectory())
})

test("startup fails closed when the agent user does not exist", async (t) => {
  const { directory, run, installCalls } = await fixture(t, { agent: null })
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /user 'agent' not found/)
  assert.equal(await installCalls(), "")
  await assert.rejects(stat(directory))
})

test("startup creates a private writable directory and is idempotent", async (t) => {
  const { directory, run } = await fixture(t)
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(run().status, 0)
    const info = await stat(directory)
    assert.equal(info.uid, process.getuid())
    assert.equal(info.gid, process.getgid())
    assert.equal(info.mode & 0o777, 0o700)
    await writeFile(path.join(directory, "agent-output"), "synthetic output")
  }
})

test("startup repairs directory permissions without changing existing contents", async (t) => {
  const { directory, run } = await fixture(t)
  await mkdir(directory)
  const file = path.join(directory, "existing-output")
  await writeFile(file, "preserved")
  await chmod(file, 0o640)
  await chmod(directory, 0o755)
  assert.equal(run().status, 0)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.equal(await readFile(file, "utf8"), "preserved")
  assert.equal((await stat(file)).mode & 0o777, 0o640)
})

test("startup refuses symlinks without modifying their target", async (t) => {
  const { root, directory, run } = await fixture(t)
  const target = path.join(root, "unrelated")
  await mkdir(target)
  await chmod(target, 0o750)
  await symlink(target, directory)
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /refusing symlink/)
  assert.ok((await lstat(directory)).isSymbolicLink())
  assert.equal((await stat(target)).mode & 0o777, 0o750)
})

test("startup refuses a non-directory without replacing it", async (t) => {
  const { directory, run } = await fixture(t)
  await writeFile(directory, "preserved")
  assert.notEqual(run().status, 0)
  assert.equal(await readFile(directory, "utf8"), "preserved")
})
