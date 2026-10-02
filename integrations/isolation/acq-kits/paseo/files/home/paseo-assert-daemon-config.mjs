#!/usr/bin/env node
// paseo-assert-daemon-config.mjs — fail closed unless config.json contains the
// daemon settings this kit requires before launching an unauthenticated daemon.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertDaemonConfig(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}
