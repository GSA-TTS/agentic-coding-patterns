import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = new URL("../files/home/paseo-set-worktrees-root.mjs", import.meta.url);

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "paseo-set-worktrees-root-"));
}

async function runSetRoot(paseoHome, root, env = {}) {
  return execFileAsync(process.execPath, [script.pathname, "--paseo-home", paseoHome, "--root", root], {
    env: { ...process.env, ...env },
    timeout: 35_000,
  });
}

test("sets worktrees.root without clobbering daemon settings", async () => {
  const paseoHome = await tempDir();
  await writeFile(
    path.join(paseoHome, "config.json"),
    JSON.stringify({
      daemon: { listen: "0.0.0.0:6767", relay: { enabled: false } },
      features: { webUi: { enabled: true } },
    }),
  );
  const root = path.join(paseoHome, "project", ".paseo-worktrees");

  const first = await runSetRoot(paseoHome, root);
  const second = await runSetRoot(paseoHome, root);
  const config = JSON.parse(await readFile(path.join(paseoHome, "config.json"), "utf8"));

  assert.equal(first.stdout, "changed\n");
  assert.equal(second.stdout, "unchanged\n");
  assert.equal(config.worktrees.root, root);
  assert.equal(config.daemon.listen, "0.0.0.0:6767");
  assert.equal(config.daemon.relay.enabled, false);
  assert.equal(config.features.webUi.enabled, true);
});

test("fails closed when the shared config lock is held", async () => {
  const paseoHome = await tempDir();
  await mkdir(path.join(paseoHome, ".config-json.lock"));

  await assert.rejects(
    runSetRoot(paseoHome, path.join(paseoHome, ".paseo-worktrees"), {
      PASEO_CONFIG_LOCK_TIMEOUT_MS: "50",
    }),
    /cannot lock/,
  );

  await rm(path.join(paseoHome, ".config-json.lock"), { recursive: true, force: true });
});
