import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const verify = await readFile(new URL("../scripts/verify", import.meta.url), "utf8");
const start = verify.indexOf("daemon_status_is_running() {");
const end = verify.indexOf("\nsbx_ports_out() {", start);
const statusCheck = verify.slice(start, end);

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
    const result = spawnSync("bash", ["-c", `in_sbx() { bash -c "$1"; }\n${pinLine}\nprintf '%s' "$pin_out"`], {
      env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  await writeFile(config, JSON.stringify({ other: { root: "/primary/.paseo-worktrees" }, worktrees: { root: "/wrong/.paseo-worktrees" } }));
  assert.equal(root(), "/wrong/.paseo-worktrees");
  await writeFile(config, JSON.stringify({ worktrees: { root: "/primary/.paseo-worktrees" } }));
  assert.equal(root(), "/primary/.paseo-worktrees");
  await writeFile(config, "{invalid");
  assert.equal(root(), "");
});
