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

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-tmp-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, "opencode")
  // Exercise real install/chmod without requiring root or touching /tmp/opencode.
  const command = body.replaceAll("/tmp/opencode", directory)
    .replace("-o 1000 -g 1000", `-o ${process.getuid()} -g ${process.getgid()}`)
  const run = () => spawnSync("/bin/sh", ["-c", command], {
    env: { PATH: "/usr/bin:/bin" }, encoding: "utf8",
  })
  return { root, directory, run }
}

test("root startup assigns the sandbox agent's numeric UID/GID without recursive changes", () => {
  assert.match(body, /install -d -o 1000 -g 1000 -m 0700 \/tmp\/opencode/)
  assert.doesNotMatch(body, /(?:chown|chmod)\s+-R/)
  assert.ok(spec.indexOf(startup[0]) < spec.indexOf("description: Render current provider inputs"))
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
