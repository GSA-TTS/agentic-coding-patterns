import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const verify = await readFile(new URL("../scripts/verify", import.meta.url), "utf8");
const start = verify.indexOf("daemon_status_is_running() {");
const end = verify.indexOf("\nsbx_ports_out() {", start);
const statusCheck = verify.slice(start, end);
const rootCheckStart = verify.indexOf("check_worktrees_root() {");
const rootCheckEnd = verify.indexOf("\npin_out=", rootCheckStart);
assert.ok(rootCheckStart > 0 && rootCheckEnd > rootCheckStart);
const rootCheck = verify.slice(rootCheckStart, rootCheckEnd);

function isRunning(status) {
  const result = spawnSync("bash", ["-c", `${statusCheck}\ndaemon_status_is_running`], {
    input: JSON.stringify(status),
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return result.status === 0;
}

test("accepts legacy and Paseo 0.13 daemon status shapes", () => {
  for (const status of [
    { status: "running" },
    { state: "running" },
    { localDaemon: { status: "running" } },
    { localDaemon: { state: "running" } },
    { localDaemon: "running" },
  ]) {
    assert.equal(isRunning(status), true, JSON.stringify(status));
  }
});

test("rejects non-running and malformed daemon status", () => {
  assert.equal(isRunning({ localDaemon: "stopped" }), false);
  assert.equal(isRunning({}), false);
  const result = spawnSync("bash", ["-c", `${statusCheck}\ndaemon_status_is_running`], {
    input: "not json",
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
});

test("worktree check reads the exact nested root, not a matching unrelated field", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-verify-root-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, ".paseo"));
  const config = path.join(home, ".paseo/config.json");
  const pinLine = verify.split("\n").find((line) => line.startsWith('pin_out="$(in_sbx '));
  assert.ok(pinLine, "verifier must have an executable root query");
  function root() {
    const result = spawnSync("bash", ["-c", `in_sbx() { bash -c "$1"; }\n${pinLine}\npin_out="${"${pin_out%PROBE_DONE}"}"\nprintf '%s' "$pin_out"`], {
      env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  await writeFile(config, JSON.stringify({ other: { root: "/primary/.paseo-worktrees" }, worktrees: { root: "/wrong/.paseo-worktrees" } }));
  assert.equal(root(), "valid:/wrong/.paseo-worktrees");
  function verdict() {
    const result = spawnSync("bash", ["-c", `${rootCheck}\nfail=0; skipped=0; ok() { printf 'PASS:%s\\n' "$1"; }; bad() { fail=$((fail+1)); printf 'FAIL:%s\\n' "$1"; }; skip() { skipped=$((skipped+1)); printf 'SKIP:%s\\n' "$1"; }; check_worktrees_root "/primary/.paseo-worktrees" "${root()}"; [ "$fail" -eq 0 ] || exit 1; [ "$skipped" -eq 0 ] || exit 3`], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    return result;
  }
  assert.equal(verdict().status, 3);
  assert.match(verdict().stdout, /SKIP:worktrees.root/);
  await writeFile(config, JSON.stringify({ worktrees: { root: "/primary/.paseo-worktrees" } }));
  assert.equal(root(), "valid:/primary/.paseo-worktrees");
  assert.equal(verdict().status, 0);
  assert.match(verdict().stdout, /PASS:configured worktrees.root/);
  await writeFile(config, JSON.stringify({ worktrees: { root: "/primary/my project/.paseo-worktrees" } }));
  assert.equal(root(), "valid:/primary/my project/.paseo-worktrees");
  await writeFile(config, "{invalid");
  assert.equal(root(), "invalid");
  assert.equal(verdict().status, 1);
  await writeFile(config, JSON.stringify({ worktrees: { root: "relative/path" } }));
  assert.equal(root(), "invalid");
  assert.equal(verdict().status, 1);
  await writeFile(config, JSON.stringify({ worktrees: { root: "  " } }));
  assert.equal(root(), "invalid");
  assert.equal(verdict().status, 1);
  await writeFile(config, JSON.stringify({ worktrees: { root: "/primary/.paseo-worktrees\u0000" } }));
  assert.equal(root(), "invalid");
  assert.equal(verdict().status, 1);
  await rm(config);
  assert.equal(root(), "missing");
  assert.equal(verdict().status, 3);
  assert.match(verdict().stdout, /SKIP:no config exists/);
  const guestProbe = verify.split("\n").find((line) => line.startsWith('pin_out="$(in_sbx '));
  assert.ok(guestProbe);
  const transport = spawnSync("bash", ["-c", `in_sbx() { return 1; }\n${guestProbe}\ncase "$pin_out" in *PROBE_DONE) : ;; *) pin_out=transport ;; esac\nprintf '%s' "$pin_out"`], { encoding: "utf8", timeout: 5000 });
  assert.ifError(transport.error);
  assert.equal(transport.stdout, "transport");
});

test("project comparison keeps spaced and canonicalized guest paths literal", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-verify-project-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const physical = path.join(home, "physical");
  const alias = path.join(home, "alias");
  const project = path.join(alias, "a space", "it's-repo");
  await mkdir(path.join(physical, "a space", "it's-repo"), { recursive: true });
  await symlink(physical, alias);
  const source = verify.split("\n");
  const first = source.findIndex((line) => line.includes("quote_guest_path()"));
  const last = source.findIndex((line, at) => at > first && line.includes('guest_rw_a="$(guest_physical_path'));
  assert.ok(first > 0 && last > first, "verifier must resolve guest paths before comparison");
  const helpers = source.slice(first, source.findIndex((line, at) => at > first && line.includes('  # Expected set:'))).join("\n");
  const script = `${helpers}\nin_sbx() { bash -c "$1"; }\nexpected=$(guest_physical_path "$1")\n[ "$expected" = "$2" ] || exit 1\nproject_roots="$3"\nregistered_fixture_path "$1" "$expected"`;
  const canonical = path.join(physical, "a space", "it's-repo");
  for (const [registered, status] of [[project, 0], [canonical, 0], [path.join(home, "other"), 1]]) {
    const result = spawnSync("bash", ["-c", script, "test", project, canonical, registered], {
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, status, result.stderr);
  }
  const loopStart = verify.indexOf('      while IFS= read -r m; do', verify.indexOf('  # Expected set:'));
  const loopEnd = verify.indexOf('      done <<< "$expected_projects"', loopStart);
  assert.ok(loopStart > 0 && loopEnd > loopStart, "aggregate check must read project paths line by line");
  const loop = verify.slice(loopStart, loopEnd + '      done <<< "$expected_projects"'.length);
  for (const [registered, missing] of [[project, false], [canonical, false], [path.join(home, "other"), true]]) {
    const aggregateScript = `${helpers}\nin_sbx() { bash -c "$1"; }\nexpected_projects="$1"\nproject_roots="$2"\nmissing=""\n${loop}\n[ -z "$missing" ]`;
    const result = spawnSync("bash", ["-c", aggregateScript, "test", project, registered], {
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, missing ? 1 : 0, result.stderr);
  }
  // Simulate a guest that mounts only the physical host spelling: the alias
  // itself is absent across the boundary, just like host /var vs guest
  // /private/var on macOS.
  const hostMapScript = `${helpers}\nin_sbx() { case "$1" in *"$GUEST_ALIAS"*) return 1;; esac; bash -c "$1"; }\nexpected=$(guest_physical_path "$1" host)\n[ "$expected" = "$2" ] || exit 1\nproject_roots="$2"\nregistered_fixture_path "$1" "$expected"`;
  const hostMap = spawnSync("bash", ["-c", hostMapScript, "test", project, canonical], {
    env: { ...process.env, GUEST_ALIAS: alias }, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(hostMap.error);
  assert.equal(hostMap.status, 0, hostMap.stderr);
});

test("port override rejects guest shell source and out-of-range ports", () => {
  const start = verify.indexOf('PASEO_PORT="${PASEO_PORT:-6767}"');
  const end = verify.indexOf('\nREMOVED_DAEMON_LAUNCH_PATTERN=', start);
  assert.ok(start > 0 && end > start);
  const guard = verify.slice(start, end);
  for (const [port, status, normalized] of [["6767", 0, "6767"], ["00080", 0, "80"], ["0", 1], ["65536", 1], ["6767;id", 1], ["1$(id)", 1], ["-1", 1]]) {
    const result = spawnSync("bash", ["-c", `${guard}\nprintf 'port=%s\\n' "$PASEO_PORT"`], {
      env: { ...process.env, PASEO_PORT: port }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, status, port);
    if (normalized) assert.equal(result.stdout, `port=${normalized}\n`);
    else assert.equal(result.stdout, "");
  }
});

test("cache ownership probe treats missing completion as unverified", () => {
  const start = verify.indexOf('cache_probe="$(in_sbx ');
  const end = verify.indexOf('\ninfo "7. Respawn supervisor', start);
  assert.ok(start > 0 && end > start);
  const check = verify.slice(start, end);
  for (const [probe, verdict] of [["", "SKIP"], ["CACHE_ABSENT", "SKIP"], ["CACHE_PROBE_DONE", "PASS"], ["/foreign/file\nCACHE_PROBE_DONE", "FAIL"]]) {
    const script = `in_sbx() { printf '%s' "$PROBE"; }\nok() { printf 'PASS'; }; bad() { printf 'FAIL'; }; skip() { printf 'SKIP'; };\n${check}`;
    const result = spawnSync("bash", ["-c", script], { env: { ...process.env, PROBE: probe }, encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.stdout, verdict);
  }
});

test("host reachability is not credited without an in-guest identity baseline", () => {
  const start = verify.indexOf('    if [ "$h_rc" -eq 0 ] && [ "$h_code" = "200" ]');
  const end = verify.indexOf('\n    # BROWSER-ACCURATE check:', start);
  assert.ok(start > 0 && end > start);
  const check = verify.slice(start, end);
  for (const [baseline, hostSize, verdict] of [["", "15000000", "SKIP"], ["15000000", "15000000", "PASS"], ["15000000", "14000000", "FAIL"]]) {
    const script = `g_size="$1"; h_size="$2"; h_rc=0; h_code=200; h_out="200 $h_size"; g_stat="200 $g_size"; HOST_HP=127.0.0.1:6767; host_fetch_ok=""; ok() { printf 'PASS'; }; bad() { printf 'FAIL'; }; skip() { printf 'SKIP'; };\n${check}\n[ -z "$host_fetch_ok" ] || printf ':REACHABLE'`;
    const result = spawnSync("bash", ["-c", script, "test", baseline, hostSize], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.stdout, verdict === "PASS" ? "PASS:REACHABLE" : verdict);
  }
});
