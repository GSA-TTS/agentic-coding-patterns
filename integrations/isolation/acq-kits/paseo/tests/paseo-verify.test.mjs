import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

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
