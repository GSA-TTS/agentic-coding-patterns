import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, lstat, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import os from "node:os";

const helper = new URL("../files/home/paseo-set-worktrees-root.mjs", import.meta.url);
const startup = await readFile(new URL("../files/home/paseo-start.sh", import.meta.url), "utf8");
const seed = startup.slice(startup.indexOf("seed_initial_worktrees_root()"), startup.indexOf("# Daemon bind."));

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-initialize-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paseoHome = path.join(home, ".paseo");
  const workspace = path.join(home, "guest primary");
  await mkdir(workspace);
  await copyFile(helper, path.join(home, "paseo-set-worktrees-root.mjs"));
  const env = { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, ACQ_WORKSPACE: workspace, PASEO_CONFIG_LOCK_TIMEOUT_MS: "50" };
  const args = (root, initialize = true) => [helper.pathname, "--paseo-home", paseoHome, "--root", root, ...(initialize ? ["--initialize-only"] : [])];
  const run = (root, initialize = true) => spawnSync(process.execPath, args(root, initialize), { env, encoding: "utf8", timeout: 5000 });
  const shell = (overrides = {}, prefix = "") => spawnSync("sh", ["-c", prefix + seed], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000 });
  return { home, paseoHome, workspace, env, args, run, shell, config: path.join(paseoHome, "config.json") };
}

test("startup-first seeds before install; normal attach is unchanged, override still changes", async (t) => {
  const f = await fixture(t);
  const result = f.shell({ ACQ_CLONE: "1" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const root = `${f.workspace}/.paseo-worktrees`;
  assert.equal(JSON.parse(await readFile(f.config)).worktrees.root, root);
  assert.equal(f.run(root, false).stdout, "unchanged\n");
  assert.equal(f.run(`${f.home}/override/.paseo-worktrees`, false).stdout, "changed\n");
  assert.ok(startup.indexOf("if ! seed_initial_worktrees_root;") < startup.indexOf('NPM_BIN="$(npm prefix'));
});

test("attach-first root and warm configuration survive initialization byte-for-byte", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run(`${f.home}/other/.paseo-worktrees`, false).stdout, "changed\n");
  const before = await readFile(f.config, "utf8");
  assert.equal(f.run(`${f.workspace}/.paseo-worktrees`).stdout, "existing\n");
  assert.equal(f.shell().status, 0);
  assert.equal(await readFile(f.config, "utf8"), before);
});

for (const kind of ["empty", "malformed", "directory", "dangling-symlink"]) {
  test(`initialize-only preserves existing ${kind}`, async (t) => {
    const f = await fixture(t);
    await mkdir(f.paseoHome);
    if (kind === "directory") await mkdir(f.config);
    else if (kind === "dangling-symlink") await symlink("missing", f.config);
    else await writeFile(f.config, kind === "empty" ? "" : "invalid-json");
    const before = await lstat(f.config);
    const content = kind === "empty" || kind === "malformed" ? await readFile(f.config, "utf8") : null;
    const result = f.run(`${f.workspace}/.paseo-worktrees`);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "existing\n");
    assert.equal((await lstat(f.config)).ino, before.ino);
    if (content !== null) assert.equal(await readFile(f.config, "utf8"), content);
  });
}

test("physical guest workspace ignores CDPATH and clone source guesses", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.home, "alias");
  await symlink(f.workspace, alias);
  const result = f.shell({ ACQ_WORKSPACE: alias, CDPATH: "/nonexistent", ACQ_CLONE: "1" });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(await readFile(f.config)).worktrees.root, `${f.workspace}/.paseo-worktrees`);
});

test("invalid workspace/home and unavailable node leave seeding inactive", async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { ACQ_WORKSPACE: "" }, { ACQ_WORKSPACE: "relative" },
    { ACQ_WORKSPACE: `${f.home}/missing` }, { PASEO_HOME: "relative" }, { PASEO_HOME: "~/custom" },
    { PASEO_HOME: `${f.home}/trailing ` }, { PASEO_HOME: `${f.home}/alias/../custom` },
    { PASEO_HOME: `${f.home}/./custom` }, { PASEO_HOME: `${f.home}//custom` },
  ]) {
    const result = f.shell(overrides, 'node() { printf "unexpected helper invocation" >&2; return 1; }\n');
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    await assert.rejects(lstat(f.config), { code: "ENOENT" });
  }
  assert.equal(f.shell({}, 'command() { return 1; }\n').status, 0);
  await assert.rejects(lstat(f.config), { code: "ENOENT" });
});

test("lock timeout and helper command failure warn without claiming successful seed", async (t) => {
  const f = await fixture(t);
  await mkdir(f.paseoHome);
  await mkdir(path.join(f.paseoHome, ".config-json.lock"));
  const locked = f.shell();
  assert.equal(locked.status, 0);
  assert.match(locked.stderr, /initial workspace root could not be seeded/);
  await assert.rejects(lstat(f.config), { code: "ENOENT" });
  const failed = f.shell({}, 'node() { return 1; }\n');
  assert.match(failed.stderr, /initial workspace root could not be seeded/);
});

for (const firstIsInitializer of [true, false]) {
  test(`locked ordering: ${firstIsInitializer ? "initializer" : "attach"} publishes before waiting transaction`, async (t) => {
    const f = await fixture(t);
    await mkdir(f.paseoHome);
    const lock = path.join(f.paseoHome, ".config-json.lock");
    await mkdir(lock);
    const firstRoot = `${f.home}/first/.paseo-worktrees`;
    const secondRoot = `${f.home}/second/.paseo-worktrees`;
    // Observe an actual failed mkdir on the held lock before publishing config.
    // This catches existence checks incorrectly moved before lock acquisition.
    const observed = path.join(f.home, "lock-observed");
    const preload = path.join(f.home, "observe-lock.cjs");
    await writeFile(preload, `const fs = require('node:fs');
const original = fs.mkdirSync;
fs.mkdirSync = function (...args) {
  try { return original(...args); } catch (error) {
    if (args[0] === ${JSON.stringify(lock)} && error.code === 'EEXIST') fs.writeFileSync(${JSON.stringify(observed)}, 'observed');
    throw error;
  }
};
require('node:module').syncBuiltinESMExports();\n`);
    const child = spawn(process.execPath, ["--require", preload, ...f.args(secondRoot, !firstIsInitializer)], { env: { ...f.env, PASEO_CONFIG_LOCK_TIMEOUT_MS: "5000" } });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const done = once(child, "exit");
    let sawLock = false;
    for (let i = 0; i < 200; i++) {
      try { await lstat(observed); sawLock = true; break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await delay(10);
    }
    assert.ok(sawLock, "child must have encountered the held config lock");
    await writeFile(f.config, JSON.stringify({ worktrees: { root: firstRoot } }));
    await rm(lock, { recursive: true });
    const [code] = await done;
    assert.equal(code, 0);
    assert.equal(output, firstIsInitializer ? "changed\n" : "existing\n");
    assert.equal(JSON.parse(await readFile(f.config)).worktrees.root, firstIsInitializer ? secondRoot : firstRoot);
  });
}

test("unambiguous absolute custom home is supported", async (t) => {
  const f = await fixture(t);
  const custom = path.join(f.home, "custom home");
  assert.equal(f.shell({ PASEO_HOME: custom }).status, 0);
  assert.equal(JSON.parse(await readFile(path.join(custom, "config.json"))).worktrees.root, `${f.workspace}/.paseo-worktrees`);
  await assert.rejects(lstat(f.config), { code: "ENOENT" });
});

test("failed atomic write leaves config absent and releases the helper lock", async (t) => {
  const f = await fixture(t);
  const preload = path.join(f.home, "deny-write.cjs");
  await writeFile(preload, `const fs = require('node:fs');
const original = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  if (String(file).includes('.config.json.tmp-')) throw Object.assign(new Error('fixture denied write'), { code: 'EACCES' });
  return original(file, ...args);
};
require('node:module').syncBuiltinESMExports();\n`);
  const result = spawnSync(process.execPath, ["--require", preload, ...f.args(`${f.workspace}/.paseo-worktrees`)], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot write/);
  await assert.rejects(lstat(f.config), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(f.paseoHome, ".config-json.lock")), { code: "ENOENT" });
});
