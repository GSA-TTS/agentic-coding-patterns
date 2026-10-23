import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, symlink, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const payload = new URL("../files/home/", import.meta.url);
const marker = /^PASEO_KIT_TIMING v1 event=([a-z_]+) uptime_s=([0-9]+\.[0-9]+) rc=([0-9]+)$/;

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-timing-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = path.join(home, "bin");
  await mkdir(bin);
  await copyFile(new URL("paseo-timing.sh", payload), path.join(home, "paseo-timing.sh"));
  await writeFile(path.join(home, "paseo-set-worktrees-root.mjs"), "");
  const stub = (name, body) => writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  await stub("node", 'printf "%s\\n" "${ROOT_RESULT:-changed}"');
  await stub("paseo", 'exit "${RESTART_RC:-7}"');
  await stub("pgrep", "exit 1");
  await stub("sleep", ":");
  await stub("find", 'printf "%s\\n" "$HOME/bundle.br"');
  await writeFile(path.join(home, "bundle.br"), "abcd");
  await stub("curl", `
case "$*" in
  */api/health)
    if [ ! -f "$HOME/probed" ]; then : > "$HOME/probed"; exit 7; fi ;;
  *size_download*) printf '%s' "\${BUNDLE_SIZE:-4}" ;;
  *) printf '%s' '<script src="/_expo/static/js/web/index-ab12.js"></script>' ;;
esac`);
  return { home, stub, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } };
}

function run(script, env, args = [], options = {}) {
  const result = spawnSync("sh", ["-c", script, "test", ...args], {
    env, encoding: "utf8", timeout: 10000, ...options,
  });
  assert.ifError(result.error);
  return result;
}

function records(text) {
  return text.split("\n").filter((line) => line.startsWith("PASEO_KIT_TIMING ")).map((line) => {
    const parsed = marker.exec(line);
    assert.ok(parsed, `invalid marker: ${line}`);
    return { event: parsed[1], time: Number(parsed[2]), rc: Number(parsed[3]) };
  });
}

function ordered(events, expected) {
  let at = -1;
  for (const event of expected) {
    at = events.indexOf(event, at + 1);
    assert.notEqual(at, -1, `missing or out-of-order event: ${event}`);
  }
}

test("timing requires exact opt-in and rejects arbitrary labels/status text", async (t) => {
  const { home, env } = await fixture(t);
  const script = '. "$HOME/paseo-timing.sh"; paseo_timing shim_begin; paseo_timing "private-path"; paseo_timing shim_end "private-value"';
  for (const value of [undefined, "0", "true", "1\nprivate-value"]) {
    const result = run(script, { ...env, ...(value === undefined ? {} : { PASEO_KIT_TIMING: value }) });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  }
  await assert.rejects(readFile(path.join(home, ".local/state/paseo/paseo-timing.log")), { code: "ENOENT" });
  const result = run(script, { ...env, PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  assert.deepEqual(records(result.stderr).map((r) => r.event), ["shim_begin"]);
  assert.equal(await readFile(path.join(home, ".local/state/paseo/paseo-timing.log"), "utf8"), result.stderr);
});

test("shim brackets failed restart, health retry, and complete UI asset check", async (t) => {
  const { home, env } = await fixture(t);
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  const rows = records(result.stderr);
  ordered(rows.map((r) => r.event), ["shim_begin", "root_begin", "root_changed", "root_end", "restart_begin", "restart_end", "fallback_begin", "fallback_end", "health_wait_begin", "health_probe_begin", "health_probe_end", "health_probe_begin", "health_probe_end", "health_wait_end", "ui_wait_begin", "ui_probe_begin", "ui_health_begin", "ui_health_end", "ui_index_begin", "ui_index_end", "ui_find_begin", "ui_find_end", "ui_bundle_begin", "ui_bundle_end", "ui_size_begin", "ui_size_end", "ui_probe_end", "ui_wait_end", "shim_end"]);
  assert.equal(rows.find((r) => r.event === "restart_end").rc, 7);
  assert.deepEqual(rows.filter((r) => r.event === "health_probe_end").map((r) => r.rc), [7, 0]);
  assert.equal(rows.find((r) => r.event === "ui_wait_end").rc, 0);
  rows.forEach((row, i) => { if (i) assert.ok(row.time >= rows[i - 1].time); });
  assert.match(result.stdout, /The web UI is READY now/);
  assert.deepEqual(records(await readFile(path.join(home, ".local/state/paseo/paseo-timing.log"), "utf8")), rows);
});

test("successful restart skips fallback; unchanged root skips restart", async (t) => {
  const { env } = await fixture(t);
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const success = run(script, { ...env, PASEO_KIT_TIMING: "1", RESTART_RC: "0" });
  assert.equal(success.status, 0);
  const rows = records(success.stderr);
  assert.equal(rows.find((r) => r.event === "restart_end").rc, 0);
  assert.ok(!rows.some((r) => r.event === "fallback_begin"));
  const unchanged = run(script, { ...env, PASEO_KIT_TIMING: "1", ROOT_RESULT: "unchanged" });
  assert.equal(unchanged.status, 0);
  assert.ok(!records(unchanged.stderr).some((r) => r.event === "restart_begin"));
});

test("timing does not change rejected-bundle readiness or normal output", async (t) => {
  const { env } = await fixture(t);
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const off = run(script, { ...env, BUNDLE_SIZE: "3" });
  const on = run(script, { ...env, BUNDLE_SIZE: "3", PASEO_KIT_TIMING: "1" });
  assert.equal(off.status, 0);
  assert.equal(on.status, off.status);
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.stderr.split("\n").filter((line) => !line.startsWith("PASEO_KIT_TIMING ")).join("\n"), off.stderr);
  assert.doesNotMatch(on.stdout, /The web UI is READY now/);
  assert.equal(records(on.stderr).find((r) => r.event === "ui_wait_end").rc, 1);
  assert.equal(records(off.stderr).length, 0);
});

test("actual supervisor loop records exit and unchanged backoff before relaunch", async (t) => {
  const { env, stub } = await fixture(t);
  const startup = await readFile(new URL("paseo-start.sh", payload), "utf8");
  const loop = startup.match(/\( sh -c '([\s\S]*?)' "supervisor:paseo-daemon"/)[1];
  await stub("sleep", '[ "$1" = 5 ] || exit 99; if [ -f "$HOME/slept" ]; then kill -TERM "$PPID"; else : > "$HOME/slept"; fi');
  const result = run(loop, { ...env, PASEO_KIT_TIMING: "1" }, ["5", "unused"]);
  assert.equal(result.signal, "SIGTERM");
  const rows = records(result.stderr);
  ordered(rows.map((r) => r.event), ["daemon_launch", "daemon_exit", "backoff_begin", "backoff_end", "daemon_launch", "daemon_exit", "backoff_begin"]);
  assert.equal(rows.find((r) => r.event === "daemon_exit").rc, 7);
});

test("diagnostic overlay opts in without enabling the normal kit", async () => {
  const normal = await readFile(new URL("../spec.yaml", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../diagnostics/timing/spec.yaml", import.meta.url), "utf8");
  assert.doesNotMatch(normal, /PASEO_KIT_TIMING:/);
  assert.match(normal, /source: files\/home\/paseo-timing\.sh/);
  assert.match(overlay, /environment:\n  PASEO_KIT_TIMING: "1"/);
  assert.doesNotMatch(overlay, /^(caps|commands|files|publishedPorts):/m);
});

test("startup records configuration and existing-supervisor path without starting services", async (t) => {
  const { env, stub } = await fixture(t);
  await stub("npm", 'printf "%s\\n" "$HOME/npm"');
  await stub("paseo", 'case "$*" in --version) printf "0.12.0\\n" ;; esac');
  await stub("pgrep", "exit 0");
  const script = await readFile(new URL("paseo-start.sh", payload), "utf8");
  const result = run(script, { ...env, PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  assert.deepEqual(records(result.stderr).map((r) => r.event), ["startup_begin", "startup_path_done", "version_begin", "version_end", "config_begin", "config_end", "supervisor_existing"]);
  const off = run(script, env);
  assert.equal(off.status, result.status);
  assert.equal(off.stderr, "");
});

test("timing log write failure reports a fixed warning and remains observational", async (t) => {
  const { home, env } = await fixture(t);
  await mkdir(path.join(home, ".local/state/paseo/paseo-timing.log"), { recursive: true });
  const result = run('. "$HOME/paseo-timing.sh"; paseo_timing shim_begin; printf finished', { ...env, PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "finished");
  assert.match(result.stderr, /paseo: timing log write failed/);
  assert.equal(records(result.stderr).length, 1);
});

async function packageLayout(home, layout, size = 4, prefixName = "alternate prefix") {
  const prefix = path.join(home, prefixName);
  const cli = path.join(prefix, "lib/node_modules/@getpaseo/cli");
  const server = layout === "nested"
    ? path.join(cli, "node_modules/@getpaseo/server")
    : path.join(prefix, "lib/node_modules/@getpaseo/server");
  await mkdir(path.join(cli, "bin"), { recursive: true });
  await mkdir(path.join(prefix, "bin"), { recursive: true });
  await writeFile(path.join(cli, "bin/paseo"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await symlink(path.join(cli, "bin/paseo"), path.join(prefix, "bin/paseo"));
  const artifact = path.join(server, "dist/server/web-ui/_expo/static/js/web/index-ab12.js.br");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, "x".repeat(size));
  return { cli, server, artifact, bin: path.join(prefix, "bin") };
}

for (const layout of ["nested", "hoisted"]) {
  test(`UI uses exact artifact from ${layout} CLI installation without filesystem search`, async (t) => {
    const { home, env, stub } = await fixture(t);
    const installed = await packageLayout(home, layout);
    await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
    // A decoy returned by the compatibility search must not supply the size.
    await writeFile(path.join(home, "bundle.br"), "wrong-size");
    const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
    const result = run(script, { ...env, PATH: `${installed.bin}:${env.PATH}`, PASEO_KIT_TIMING: "1" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /The web UI is READY now/);
    ordered(records(result.stderr).map((r) => r.event), ["ui_find_begin", "ui_find_end", "ui_bundle_begin", "ui_bundle_end", "ui_size_begin", "ui_size_end"]);
    await assert.rejects(readFile(path.join(home, "find-called")), { code: "ENOENT" });
  });
}

test("nested missing artifact uses compatibility search rather than a hoisted decoy", async (t) => {
  const { home, env, stub } = await fixture(t);
  const installed = await packageLayout(home, "hoisted", 9);
  await mkdir(path.join(installed.cli, "node_modules/@getpaseo/server"), { recursive: true });
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PATH: `${installed.bin}:${env.PATH}` });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  assert.equal(await readFile(path.join(home, "find-called"), "utf8"), "");
});

test("unknown CLI layout retains the original search and exact-size validation", async (t) => {
  const { home, env, stub } = await fixture(t);
  await packageLayout(home, "nested", 9); // Not the CLI selected by PATH.
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  assert.equal(await readFile(path.join(home, "find-called"), "utf8"), "");
});

test("fast-path size mismatch fails even when received body exceeds fallback threshold", async (t) => {
  const { home, env, stub } = await fixture(t);
  const installed = await packageLayout(home, "nested", 100002);
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PATH: `${installed.bin}:${env.PATH}`, BUNDLE_SIZE: "100001" });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /The web UI is READY now/);
  await assert.rejects(readFile(path.join(home, "find-called")), { code: "ENOENT" });
});

test("unreadable local artifact retains compatibility search", async (t) => {
  const { home, env, stub } = await fixture(t);
  const installed = await packageLayout(home, "nested", 9);
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  await chmod(installed.artifact, 0o000);
  // Root can read mode-000 files: drop the test subprocess to an unprivileged
  // uid in that case, allowing it to write only this disposable fixture home.
  await chmod(home, 0o777);
  const options = process.getuid() === 0 ? { uid: 65534, gid: 65534 } : {};
  const result = run(script, { ...env, PATH: `${installed.bin}:${env.PATH}` }, [], options);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  assert.equal(await readFile(path.join(home, "find-called"), "utf8"), "");
});

test("failed CLI realpath resolution retains compatibility search", async (t) => {
  const { home, env, stub } = await fixture(t);
  const installed = await packageLayout(home, "nested", 9);
  await stub("readlink", "exit 1");
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PATH: `${installed.bin}:${env.PATH}` });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  assert.equal(await readFile(path.join(home, "find-called"), "utf8"), "");
});

test("off-PATH per-user install supplies the exact artifact without changing restart lookup", async (t) => {
  const { home, env, stub } = await fixture(t);
  await packageLayout(home, "nested", 4, ".npm-global");
  await rm(path.join(home, "bin/paseo"));
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  // Artifact lookup must not make the earlier restart CLI available on PATH.
  assert.notEqual(records(result.stderr).find((r) => r.event === "restart_end").rc, 0);
  await assert.rejects(readFile(path.join(home, "find-called")), { code: "ENOENT" });
});

test("per-user artifact takes precedence over another CLI installation on PATH", async (t) => {
  const { home, env, stub } = await fixture(t);
  await packageLayout(home, "nested", 4, ".npm-global");
  const decoy = await packageLayout(home, "nested", 9);
  await stub("find", ': > "$HOME/find-called"; printf "%s\\n" "$HOME/bundle.br"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, PATH: `${decoy.bin}:${env.PATH}` });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  await assert.rejects(readFile(path.join(home, "find-called")), { code: "ENOENT" });
});

test("seeded unchanged root waits for delayed health then validates the full UI", async (t) => {
  const { home, env, stub } = await fixture(t);
  await stub("sleep", 'printf "%s\\n" "$1" >> "$HOME/sleeps"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, ROOT_RESULT: "unchanged", PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  const rows = records(result.stderr);
  ordered(rows.map((r) => r.event), ["root_unchanged", "health_wait_begin", "health_probe_end", "health_probe_end", "health_wait_end", "ui_wait_begin", "ui_size_end", "ui_wait_end", "shim_end"]);
  assert.deepEqual(rows.filter((r) => r.event === "health_probe_end").map((r) => r.rc), [7, 0]);
  assert.ok(!rows.some((r) => r.event === "restart_begin" || r.event === "fallback_begin"));
  assert.equal(rows.find((r) => r.event === "ui_wait_end").rc, 0);
  assert.equal(await readFile(path.join(home, "sleeps"), "utf8"), "1\n");
  assert.match(result.stdout, /The web UI is READY now/);
});

test("exhausted unchanged-root readiness retains 30 health and 60 UI sleeps despite exit zero", async (t) => {
  const { home, env, stub } = await fixture(t);
  await stub("curl", 'printf "probe\\n" >> "$HOME/curl-calls"; exit 7');
  await stub("sleep", 'printf "%s\\n" "$1" >> "$HOME/sleeps"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, ROOT_RESULT: "unchanged", PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  const rows = records(result.stderr);
  assert.equal(rows.filter((r) => r.event === "health_probe_begin").length, 30);
  assert.equal(rows.filter((r) => r.event === "ui_probe_begin").length, 61);
  assert.equal(rows.find((r) => r.event === "health_wait_end").rc, 7);
  assert.equal(rows.find((r) => r.event === "ui_wait_end").rc, 1);
  assert.equal(rows.find((r) => r.event === "shim_end").rc, 0);
  assert.equal((await readFile(path.join(home, "sleeps"), "utf8")), "1\n".repeat(90));
  // Includes the final diagnostic health probe after UI exhaustion.
  assert.equal((await readFile(path.join(home, "curl-calls"), "utf8")), "probe\n".repeat(92));
  assert.doesNotMatch(result.stdout, /The web UI is READY now/);
  assert.match(result.stdout, /web UI is still coming up/);
  assert.ok(!rows.some((r) => r.event === "restart_begin" || r.event === "fallback_begin"));
});

test("healthy unchanged-root attach uses one health probe and no sleeps", async (t) => {
  const { home, env, stub } = await fixture(t);
  await writeFile(path.join(home, "probed"), "");
  await stub("sleep", 'printf "%s\\n" "$1" >> "$HOME/sleeps"');
  const script = await readFile(new URL("paseo-agent-shim", payload), "utf8");
  const result = run(script, { ...env, ROOT_RESULT: "unchanged", PASEO_KIT_TIMING: "1" });
  assert.equal(result.status, 0);
  const rows = records(result.stderr);
  assert.equal(rows.filter((r) => r.event === "health_probe_begin").length, 1);
  assert.equal(rows.find((r) => r.event === "ui_wait_end").rc, 0);
  assert.match(result.stdout, /The web UI is READY now/);
  await assert.rejects(readFile(path.join(home, "sleeps")), { code: "ENOENT" });
});
