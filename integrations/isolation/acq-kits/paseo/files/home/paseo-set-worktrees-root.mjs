#!/usr/bin/env node
// paseo-set-worktrees-root.mjs — idempotently set `worktrees.root` in Paseo's
// $PASEO_HOME/config.json to a caller-provided ABSOLUTE path, WITHOUT clobbering
// any other config the daemon has written.
//
// WHY: Paseo keeps agent git worktrees under a SINGLE GLOBAL root
// (`worktrees.root`), laid out <root>/<projectHash>/<slug>. There is no
// per-project root, and a RELATIVE `worktrees.root` resolves against PASEO_HOME
// (not the project cwd) — so to place worktrees under a project directory the
// value MUST be an absolute path. The kit's `opencode` wrapper runs in the
// primary-workspace cwd on `acq run`, computes <PWD>/.paseo-worktrees, and calls
// this script to persist it. The daemon reads `worktrees.root` only at boot (no
// SIGHUP / no runtime reread), so the wrapper bounces the daemon afterward.
//
// USAGE:
//   node paseo-set-worktrees-root.mjs --root <absolute-path> [--paseo-home <dir>]
//
// EXIT / OUTPUT (single line to stdout, for the wrapper to branch on):
//   changed   — config.json was updated (worktrees.root differed); caller should
//               bounce the daemon.
//   unchanged — worktrees.root already equals <root>; no write, no bounce needed.
//   error: <message>  (on stderr; exit code 1) — could not read/parse/write.
//
// SAFETY: this is a read-modify-write of a JSON file. It preserves every existing
// key, only sets/overwrites `worktrees.root` (and creates the `worktrees` object
// if absent). It refuses a non-absolute root (Paseo would resolve it against
// PASEO_HOME, defeating the purpose). It writes atomically (temp file + rename)
// with private 0600 perms, matching how Paseo itself stores config.json.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = { root: undefined, paseoHome: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") {
      args.root = argv[++i];
    } else if (a === "--paseo-home") {
      args.paseoHome = argv[++i];
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!args.root) throw new Error("missing required --root <absolute-path>");
  return args;
}

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

function main() {
  const { root, paseoHome: paseoHomeArg } = parseArgs(process.argv.slice(2));

  if (!path.isAbsolute(root)) {
    // A relative root would be resolved by Paseo against PASEO_HOME, not the
    // project — refuse rather than silently mis-place worktrees.
    throw new Error(`--root must be an absolute path (got: ${root})`);
  }

  const paseoHome = resolvePaseoHome(paseoHomeArg);
  const configPath = path.join(paseoHome, "config.json");

  // Read the existing config if present. The daemon initializes config.json on
  // first start; if it isn't there yet (we ran before the daemon), start from an
  // empty object — the daemon deep-merges persisted config on load, and our
  // atomically-written file becomes the base it reads next boot.
  let config = {};
  if (existsSync(configPath)) {
    let raw;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (err) {
      throw new Error(`cannot read ${configPath}: ${err.message}`);
    }
    if (raw.trim().length > 0) {
      try {
        config = JSON.parse(raw);
      } catch (err) {
        throw new Error(`cannot parse ${configPath} as JSON: ${err.message}`);
      }
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`${configPath} is not a JSON object`);
      }
    }
  }

  const current =
    config.worktrees && typeof config.worktrees === "object"
      ? config.worktrees.root
      : undefined;

  if (current === root) {
    process.stdout.write("unchanged\n");
    return;
  }

  // Set (or create) worktrees.root, preserving all other keys — including any
  // sibling keys under `worktrees` (e.g. servicePorts).
  const nextWorktrees =
    config.worktrees && typeof config.worktrees === "object" && !Array.isArray(config.worktrees)
      ? { ...config.worktrees }
      : {};
  nextWorktrees.root = root;
  config.worktrees = nextWorktrees;

  // Atomic private write: temp file in the same dir + rename, mode 0600.
  mkdirSync(paseoHome, { recursive: true });
  const tmpPath = path.join(paseoHome, `.config.json.tmp-${process.pid}`);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, serialized, { mode: 0o600 });
    renameSync(tmpPath, configPath);
  } catch (err) {
    throw new Error(`cannot write ${configPath}: ${err.message}`);
  }

  process.stdout.write("changed\n");
}

try {
  main();
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
}
