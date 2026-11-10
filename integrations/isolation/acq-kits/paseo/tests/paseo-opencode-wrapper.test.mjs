import test from "node:test";
import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const wrapper = new URL("../files/home/.local/bin/opencode", import.meta.url);

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-opencode-wrapper-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const shadow = path.join(home, ".local/bin");
  const real = path.join(home, "real/bin");
  await mkdir(shadow, { recursive: true });
  await mkdir(real, { recursive: true });
  await writeFile(path.join(shadow, "opencode"), await readFile(wrapper), { mode: 0o755 });
  await writeFile(path.join(real, "opencode"), '#!/bin/sh\nprintf "real:%s\\n" "$@"\nexit 23\n', { mode: 0o755 });
  await writeFile(path.join(home, "paseo-agent-shim"), '#!/bin/sh\nprintf "shim\\n"\nexit 37\n', { mode: 0o755 });
  const env = { HOME: home, PATH: `${shadow}:${real}:/usr/bin:/bin` };
  function run(args, overrides = {}) {
    const result = spawnSync(path.join(shadow, "opencode"), args, {
      env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    return result;
  }
  return { home, run };
}

test("bare opencode outside PID 1 execs the real TUI without running the Paseo shim", async (t) => {
  const f = await fixture(t);
  const result = f.run([]);
  assert.equal(result.status, 23);
  assert.equal(result.stdout, "real:\n");
  assert.doesNotMatch(result.stdout + result.stderr, /shim|Paseo daemon/);
  await assert.rejects(readFile(path.join(f.home, ".paseo/config.json")), { code: "ENOENT" });
});

test("arguments are passed unchanged to the real opencode", async (t) => {
  const f = await fixture(t);
  const result = f.run(["run", "two words"]);
  assert.equal(result.status, 23);
  assert.equal(result.stdout, "real:run\nreal:two words\n");
});

test("a missing real opencode fails visibly outside PID 1", async (t) => {
  const f = await fixture(t);
  const result = f.run([], { PATH: `${path.join(f.home, ".local/bin")}:/usr/bin:/bin` });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /could not locate the real opencode binary/);
  assert.doesNotMatch(result.stdout, /shim/);
});

test("a later PATH alias to the wrapper is skipped rather than re-executed", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.home, "alias-bin");
  await mkdir(alias);
  await symlink(path.join(f.home, ".local/bin/opencode"), path.join(alias, "opencode"));
  const result = f.run([], { PATH: `${path.join(f.home, ".local/bin")}:${alias}:${path.join(f.home, "real/bin")}:/usr/bin:/bin` });
  assert.equal(result.status, 23);
  assert.equal(result.stdout, "real:\n");
});

test("an alias-only PATH fails visibly without recursion", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.home, "alias-bin");
  await mkdir(alias);
  await symlink(path.join(f.home, ".local/bin/opencode"), path.join(alias, "opencode"));
  const result = f.run([], { PATH: `${path.join(f.home, ".local/bin")}:${alias}:/usr/bin:/bin` });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /could not locate the real opencode binary/);
});

test("a later hard-link alias cannot cause recursive wrapper execution", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.home, "hardlink-bin");
  await mkdir(alias);
  await link(path.join(f.home, ".local/bin/opencode"), path.join(alias, "opencode"));
  const result = f.run([], { PATH: `${path.join(f.home, ".local/bin")}:${alias}:${path.join(f.home, "real/bin")}:/usr/bin:/bin` });
  assert.equal(result.status, 23);
  assert.equal(result.stdout, "real:\n");
});

test("PID-1 shim handoff precedes any readlink dependency", async () => {
  const source = await readFile(wrapper, "utf8");
  const pidBranch = source.indexOf('if [ "$#" -eq 0 ] && [ "$$" -eq 1 ]; then');
  const selfResolution = source.indexOf('self_canon="$(canon');
  assert.ok(pidBranch > 0 && selfResolution > pidBranch);
  assert.match(source.slice(pidBranch, selfResolution), /exec sh "\$SHIM"/);
});
