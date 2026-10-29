import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const startup = await readFile(new URL("../files/home/paseo-start.sh", import.meta.url), "utf8");
const publication = startup.slice(startup.indexOf("publish_paseo_cli() {"), startup.indexOf("# --- Persist daemon configuration"));

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-cli-path-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const state = path.join(home, "state");
  const publicBin = path.join(home, ".local/bin");
  await mkdir(state);
  await mkdir(publicBin, { recursive: true });
  const link = path.join(publicBin, "paseo");
  const env = { HOME: home, STATE_DIR: state, NPM_BIN: path.join(home, "global/bin"), PATH: `${publicBin}:/usr/bin:/bin` };
  async function install(prefix = ".npm-global", label = "kit") {
    const bin = path.join(home, prefix, "bin");
    const target = path.join(home, prefix, "lib/node_modules/@getpaseo/cli/bin/paseo");
    await mkdir(bin, { recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `#!/bin/sh\nprintf '%s\\n' '${label}' "$@"\nexit 23\n`, { mode: 0o755 });
    await symlink(target, path.join(bin, "paseo"));
    return target;
  }
  function run(script = publication, overrides = {}) {
    const result = spawnSync("sh", ["-c", script], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    return result;
  }
  return { home, state, link, env, install, run };
}

test("publishes only after installation, resolves kit before global, and forwards CLI arguments/status", async (t) => {
  const f = await fixture(t);
  assert.match(f.run().stderr, /could not publish managed CLI link/);
  await assert.rejects(lstat(f.link), { code: "ENOENT" });
  await f.install("global", "global");
  const target = await f.install();
  assert.equal(f.run().stderr, "");
  assert.equal(await readlink(f.link), target);
  const cli = f.run('paseo "two words" "--flag"');
  assert.equal(cli.status, 23);
  assert.equal(cli.stdout, "kit\ntwo words\n--flag\n");
  const real = f.run('readlink -f "$(command -v paseo)"');
  assert.equal(real.stdout.trim(), target);
});

test("default prefix works, repeated publication is idempotent, and owned stale link repairs", async (t) => {
  const f = await fixture(t);
  const old = await f.install("global");
  f.run();
  const before = await lstat(f.link);
  assert.equal(f.run().stderr, "");
  assert.equal((await lstat(f.link)).ino, before.ino);
  await rm(old);
  const next = await f.install();
  assert.equal(f.run().stderr, "");
  assert.equal(await readlink(f.link), next);
  assert.equal(await readFile(path.join(f.state, "paseo-cli-link-target"), "utf8"), `${next}\n`);
});

for (const kind of ["file", "directory", "symlink", "changed-link"]) {
  test(`preserves foreign ${kind} destination`, async (t) => {
    const f = await fixture(t);
    await f.install();
    if (kind === "file") await writeFile(f.link, "foreign");
    else if (kind === "directory") await mkdir(f.link);
    else await symlink("foreign-target", f.link);
    if (kind === "changed-link") await writeFile(path.join(f.state, "paseo-cli-link-target"), "old-managed-target\n");
    const before = await lstat(f.link);
    assert.match(f.run().stderr, /preserving/);
    assert.equal((await lstat(f.link)).ino, before.ino);
    if (kind === "file") assert.equal(await readFile(f.link, "utf8"), "foreign");
  });
}

test("failed link operation warns explicitly and allows startup continuation", async (t) => {
  const f = await fixture(t);
  await f.install();
  const result = f.run(`ln() { return 1; }\n${publication}\nprintf continued`);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "continued");
  assert.match(result.stderr, /could not publish managed CLI link/);
  await assert.rejects(lstat(f.link), { code: "ENOENT" });
});

test("publication stays outside install-only branch and leaves opencode intact", async (t) => {
  const f = await fixture(t);
  const opencode = path.join(f.home, ".local/bin/opencode");
  await writeFile(opencode, "existing-wrapper");
  await f.install();
  f.run();
  assert.equal(await readFile(opencode, "utf8"), "existing-wrapper");
  assert.ok(startup.indexOf("publish_paseo_cli()") > startup.indexOf("command -v paseo >/dev/null 2>&1 || {"));
  assert.ok(startup.indexOf("if ! publish_paseo_cli;") < startup.indexOf("# --- Persist daemon configuration"));
});

test("real startup publishes on version-match resume without npm installation", async (t) => {
  const f = await fixture(t);
  const target = await f.install();
  await writeFile(target, '#!/bin/sh\nprintf "0.13.0\\n"\n', { mode: 0o755 });
  const bin = path.join(f.home, "stubs");
  await mkdir(bin);
  for (const [name, body] of Object.entries({
    npm: 'if [ "$1" = prefix ]; then printf "%s\\n" "$HOME/global"; else : > "$HOME/unexpected-install"; exit 1; fi',
    node: "exit 0",
    pgrep: "exit 0",
  })) {
    await writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  await writeFile(path.join(f.home, "paseo-timing.sh"), 'paseo_timing() { :; }\n');
  const result = f.run(startup, { PATH: `${bin}:${f.env.PATH}` });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(await readlink(f.link), target);
  await assert.rejects(lstat(path.join(f.home, "unexpected-install")), { code: "ENOENT" });
});

test("receipt write failure is visible and unreceipted destination is preserved on retry", async (t) => {
  const f = await fixture(t);
  const target = await f.install();
  const result = f.run(`printf() { return 1; }\n${publication}`);
  assert.match(result.stderr, /could not publish managed CLI link/);
  assert.equal(await readlink(f.link), target);
  // A failed receipt write leaves an empty receipt, not ownership evidence.
  await rm(path.join(f.state, "paseo-cli-link-target"));
  assert.match(f.run().stderr, /preserving existing CLI destination/);
  assert.equal(await readlink(f.link), target);
});
