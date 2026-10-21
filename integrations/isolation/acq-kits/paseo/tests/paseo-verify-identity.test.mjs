import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDir, "../scripts/paseo-verify-identity");

async function mockCommand(dir, name, body) {
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
}

test("rejects invalid CONTAINER_PORT values before probing", () => {
  for (const port of ["", "0", "08", "65536", "70000", "0x1A6F", "nope", " 6767"]) {
    const result = spawnSync("bash", [script, "example"], {
      encoding: "utf8",
      env: { CONTAINER_PORT: port, PATH: process.env.PATH },
    });

    assert.equal(result.status, 2, `CONTAINER_PORT=${JSON.stringify(port)}`);
    assert.match(result.stderr, /CONTAINER_PORT must be a decimal port/);
    assert.doesNotMatch(result.stderr, /acq not on PATH/);
  }
});

test("normalizes server-id newlines before KEY=value framing", async () => {
  const source = await readFile(script, "utf8");
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-identity-home-"));
  try {
    await writeFile(path.join(home, "server-id"), "srv_safe\nEXTERNAL=999\n");
    const result = spawnSync("sh", ["-lc", 'printf "SERVER_ID=%s\\n" "$(cat "$1/server-id" | tr -d "\\n")"', "_", home], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "SERVER_ID=srv_safeEXTERNAL=999\n");
    assert.doesNotMatch(result.stdout, /^EXTERNAL=/m);
    assert.match(source, /SERVER_ID=.*cat .*server-id.*tr -d "\\n"/);
    assert.match(source, /DAEMON_PID=.*paseo\.pid.*\| head -1/);
    assert.match(source, /\^srv_\[A-Za-z0-9_-\]\+\$/);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("fails when the configured guest port is absent from /proc/net/tcp", async () => {
  const mocks = await mkdtemp(path.join(os.tmpdir(), "paseo-identity-mocks-"));
  try {
    await mockCommand(mocks, "acq", `
if [ "$1" = ports ]; then
  printf '127.0.0.1:6767\\n'
else
  printf 'SERVER_ID=srv_safe\\nDAEMON_PID=1\\nVM_UPTIME=1\\nBIND=00000000:1A6E\\nHEALTH={"status":"ok"}\\nEXTERNAL=0\\nLOOPBACK=0\\n'
fi`);
    await mockCommand(mocks, "curl", "printf '{\"status\":\"ok\"}'");
    await mockCommand(mocks, "node", `
if [ "$1" = -e ]; then
  printf '127.0.0.1\\n'
else
  printf 'localhost: srv_safe\\n127.0.0.1: srv_safe\\nipv4-mapped: srv_safe\\n'
fi`);

    const result = spawnSync("bash", [script, "example"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${mocks}:${process.env.PATH}`, CONTAINER_PORT: "6767" },
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /guest bind for :1A6F not found in \/proc\/net\/tcp/);
    assert.match(result.stdout, /RESULT: FAIL/);
  } finally {
    await rm(mocks, { force: true, recursive: true });
  }
});
