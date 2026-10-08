import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const startup = join(import.meta.dirname, "../files/home/paseo-start.sh");

function runReconcile({ startedAt, commandLine, bootTime = 2_000 }) {
  const root = mkdtempSync(join(tmpdir(), "paseo-reconcile-"));
  const home = join(root, "home");
  const proc = join(root, "proc");
  const state = join(root, "state");
  mkdirSync(home);
  mkdirSync(proc);
  writeFileSync(join(proc, "stat"), `btime ${bootTime}\n`);

  const supervisor = spawn("sh", ["-c", `trap 'rm -f "$1"; rm -rf "$FAKE_PROC_ROOT/$$"; exit 0' TERM INT; while :; do sleep 1; done`, "sh", join(home, "paseo.pid")], {
    env: { ...process.env, FAKE_PROC_ROOT: proc },
    stdio: "ignore",
  });
  mkdirSync(join(proc, String(supervisor.pid)));
  writeFileSync(join(proc, String(supervisor.pid), "cmdline"), `${commandLine}\0`);
  writeFileSync(join(proc, String(supervisor.pid), "stat"), `1 (sh) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345\n`);
  writeFileSync(join(proc, String(supervisor.pid), "status"), `Name:\tsh\nUid:\t${process.getuid()}\t${process.getuid()}\t${process.getuid()}\t${process.getuid()}\n`);
  writeFileSync(join(home, "paseo.pid"), JSON.stringify({ pid: supervisor.pid, startedAt }));

  let result;
  try {
    result = execFileSync("sh", [startup], {
      env: {
        ...process.env,
        HOME: home,
        PASEO_HOME: home,
        XDG_STATE_HOME: state,
        PASEO_PROC_ROOT: proc,
        PASEO_KERNEL_BOOT_TIME: String(bootTime),
        PASEO_START_RECONCILE_TEST: "1",
      },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    result = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  supervisor.kill("SIGKILL");
  const logPath = join(state, "paseo", "paseo-start.log");
  return { home, log: existsSync(logPath) ? readFileSync(logPath, "utf8") : "", result };
}

test("reconciles a live supervisor with a pre-boot lock", () => {
  const { home, log } = runReconcile({
    startedAt: "1970-01-01T00:00:01Z",
    commandLine: "node supervisor-entrypoint.js",
  });
  assert.equal(existsSync(join(home, "paseo.pid")), false, `the supervisor trap releases the lock (${log})`);
  assert.match(log, /restored supervisor stopped and lock released/);
});

test("does not interrupt a post-boot supervisor lock", () => {
  const { home, log } = runReconcile({
    startedAt: "1970-01-01T00:33:20Z",
    commandLine: "node supervisor-entrypoint.js",
    bootTime: 2_000,
  });
  assert.match(readFileSync(join(home, "paseo.pid"), "utf8"), /startedAt/);
  assert.doesNotMatch(log, /stopping restored/);
});

test("leaves malformed and ambiguously owned locks untouched", () => {
  const malformed = runReconcile({ startedAt: "not-a-time", commandLine: "node supervisor-entrypoint.js" });
  assert.match(readFileSync(join(malformed.home, "paseo.pid"), "utf8"), /not-a-time/);
  assert.match(`${malformed.log}${malformed.result}`, /malformed or ambiguous/);

  const ambiguous = runReconcile({ startedAt: "1970-01-01T00:00:01Z", commandLine: "node unrelated-process.js" });
  assert.match(readFileSync(join(ambiguous.home, "paseo.pid"), "utf8"), /startedAt/);
  assert.match(ambiguous.log, /not the Paseo supervisor/);
});
