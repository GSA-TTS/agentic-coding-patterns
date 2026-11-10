#!/usr/bin/env node
// paseo-assert-daemon-config.mjs — fail closed unless config.json contains the
// daemon settings this kit requires before launching an unauthenticated daemon.

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolvePaseoHome(explicit) {
  if (explicit && explicit.trim()) return path.resolve(explicit.trim());
  const env = process.env.PASEO_HOME;
  if (env && env.trim()) {
    const raw = env.trim();
    if (raw === "~") return homedir();
    if (raw.startsWith("~/")) return path.join(homedir(), raw.slice(2));
    return path.resolve(raw);
  }
  return path.join(homedir(), ".paseo");
}

function parseArgs(argv) {
  const args = { paseoHome: undefined, listen: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--paseo-home") {
      args.paseoHome = argv[++i];
    } else if (arg === "--listen") {
      args.listen = argv[++i];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.listen) throw new Error("missing required --listen <host:port>");
  return args;
}

export function assertDaemonConfig({ paseoHome, listen }) {
  const configPath = path.join(resolvePaseoHome(paseoHome), "config.json");
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(`cannot read required daemon config ${configPath}: ${err.message}`);
  }

  const failures = [];
  if (config?.daemon?.listen !== listen) {
    failures.push(`daemon.listen=${JSON.stringify(config?.daemon?.listen)}`);
  }
  if (config?.features?.webUi?.enabled !== true) {
    failures.push(`features.webUi.enabled=${JSON.stringify(config?.features?.webUi?.enabled)}`);
  }
  if (config?.daemon?.relay?.enabled !== false) {
    failures.push(`daemon.relay.enabled=${JSON.stringify(config?.daemon?.relay?.enabled)}`);
  }
  if (failures.length > 0) {
    throw new Error(`config.json missing required daemon settings: ${failures.join(", ")}`);
  }
}

// Run the assertion only when this file is the program being run. Compare
// canonical paths, never the strings Node hands us: `import.meta.url` names the
// module file Node resolved, while `process.argv[1]` is the path that was typed.
// On Windows a `C:\...` argv makes a `file://${...}` template produce
// `file://C:\...` against `import.meta.url`'s `file:///C:/...`; a launch through
// a symlink, a directory junction, or a differently-cased path on a
// case-insensitive filesystem disagrees the same way. Either mismatch skips the
// assertion and exits 0 having checked nothing, which for a guard that must fail
// closed is the worst possible outcome — so resolve both sides first.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // An unresolvable script path (or `node -e`, which has none) means this
    // file is being imported, not run.
    return false;
  }
}

if (isMainModule()) {
  try {
    assertDaemonConfig(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}
