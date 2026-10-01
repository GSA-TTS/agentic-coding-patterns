import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertDaemonConfig } from "../files/home/paseo-assert-daemon-config.mjs";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "paseo-assert-daemon-config-"));
}

async function writeConfig(paseoHome, config) {
  await writeFile(path.join(paseoHome, "config.json"), `${JSON.stringify(config)}\n`);
}

test("accepts the required daemon settings", async () => {
  const paseoHome = await tempDir();
  await writeConfig(paseoHome, {
    daemon: { listen: "0.0.0.0:6767", relay: { enabled: false } },
    features: { webUi: { enabled: true } },
  });

  assert.doesNotThrow(() => assertDaemonConfig({ paseoHome, listen: "0.0.0.0:6767" }));
});

test("rejects a missing relay-disable setting", async () => {
  const paseoHome = await tempDir();
  await writeConfig(paseoHome, {
    daemon: { listen: "0.0.0.0:6767" },
    features: { webUi: { enabled: true } },
  });

  assert.throws(
    () => assertDaemonConfig({ paseoHome, listen: "0.0.0.0:6767" }),
    /daemon\.relay\.enabled=undefined/,
  );
});

test("rejects wrong listen and disabled web UI", async () => {
  const paseoHome = await tempDir();
  await writeConfig(paseoHome, {
    daemon: { listen: "127.0.0.1:6767", relay: { enabled: false } },
    features: { webUi: { enabled: false } },
  });

  assert.throws(
    () => assertDaemonConfig({ paseoHome, listen: "0.0.0.0:6767" }),
    /daemon\.listen="127\.0\.0\.1:6767".*features\.webUi\.enabled=false/,
  );
});
