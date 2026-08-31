#!/usr/bin/env node
// paseo-register-mounts.mjs — pre-populate Paseo PROJECTS from the host
// directories mounted into this sandbox, so the web UI already lists mounted
// repos the moment you connect (no manual "Add project" per repo).
//
// WHY THIS EXISTS: acq bind-mounts one or more host project directories into the
// guest. Paseo, however, only learns about a project when something opens it
// (the `acq run` entrypoint opens the FIRST/primary mount via the shim; the
// others are invisible until you add them by hand). This helper registers EVERY
// mounted host project directory with the daemon at startup, idempotently.
//
// HOW IT TALKS TO THE DAEMON: there is no `paseo project add` CLI verb. The only
// side-effect-free registration path is the daemon's `project.add.request`,
// exposed by the bundled client as `client.addProject(cwd)`:
//   * idempotent — the same rootPath returns the same projectId (no duplicates),
//   * works for non-git dirs (registered as kind "non_git"),
//   * returns { project: null, errorCode: "directory_not_found" } for a bad path
//     instead of throwing.
// Before registering, a qualifying mount is expanded: if the mount is itself a
// Git repo, register it; otherwise register direct child dirs that have a `.git`
// entry; if none exist, fall back to the mount itself. The child scan is shallow
// by design. (Alternatives were rejected: `workspace create` mints a NEW
// workspace record every call — workspace spam across restarts — and `terminal
// create` leaves a stray terminal behind. See
// docs/decisions/prepopulate-projects-from-mounts.md.)
//
// We import the CLI's OWN connector (dist/utils/client.js -> connectToDaemon) so
// we reuse its socket/localhost resolution and need no host/port here. The CLI
// package dir is resolved portably from the `paseo` bin symlink, so this works
// whether the CLI was already present in the default global npm prefix or was
// installed into the kit's per-user ~/.npm-global prefix (see paseo-start.sh).
//
// WHICH MOUNTS COUNT (backend-agnostic — no reliance on the source-name token,
// which is a per-path hash on msb and the literal "host" on sbx, i.e. NOT a
// stable key across users or backends): a mount is treated as a host project
// directory when ALL of these hold, read from /proc/mounts:
//   1. fstype == "virtiofs"                      (the host-share fstype both
//                                                 acq backends use)
//   2. mounted read-write                        (ro mounts are SKIPPED by
//                                                 requirement)
//   3. the target is an existing DIRECTORY       (excludes sbx's /etc/resolv.conf
//                                                 and /etc/hosts, which are bind
//                                                 FILES over virtiofs)
//   4. the target is NOT under a system prefix    (/etc /run /proc /sys /dev, or
//                                                 "/" itself)
//   5. the target's basename does NOT start "."   (skips the backend runtime dir
//                                                 — /.msb today, and any future
//                                                 /.<backend> by convention —
//                                                 without hard-coding a name)
//
// FAIL-OPEN: project pre-population is a convenience, never a reason to break the
// sandbox. Every per-directory add is isolated in try/catch, the daemon
// connection is always closed, and the process ALWAYS exits 0 — even if the
// daemon is unreachable or some adds fail. Errors are logged for diagnosis.

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Target-path prefixes we never treat as a host project (system / pseudo mounts).
// Matching is prefix-aware: an exact match or a "<prefix>/" child both count.
const SYSTEM_PREFIXES = ["/etc", "/run", "/proc", "/sys", "/dev"];

function log(msg) {
  process.stdout.write(`paseo-register-mounts: ${msg}\n`);
}

// Resolve the @getpaseo/cli package directory from the `paseo` bin on PATH, so
// we can import its connector regardless of the install prefix. `paseo` is a
// symlink to <pkg>/bin/paseo; the package root is two levels up from that.
function resolveCliClientModuleUrl() {
  let binPath;
  try {
    binPath = execFileSync("sh", ["-c", "command -v paseo"], {
      encoding: "utf8",
    }).trim();
  } catch {
    binPath = "";
  }
  if (!binPath) {
    throw new Error("could not locate the `paseo` CLI on PATH");
  }
  const realBin = realpathSync(binPath); // <pkg>/bin/paseo
  const pkgDir = dirname(dirname(realBin)); // <pkg>
  const clientPath = resolve(pkgDir, "dist/utils/client.js");
  // Fail early with a clear message if the internal path moved in a CLI bump.
  statSync(clientPath);
  return pathToFileURL(clientPath).href;
}

function isUnderSystemPrefix(target) {
  if (target === "/") return true;
  return SYSTEM_PREFIXES.some(
    (prefix) => target === prefix || target.startsWith(`${prefix}/`),
  );
}

// Un-escape the octal escapes the kernel uses in /proc/mounts fields (space =
// \040, tab = \011, newline = \012, backslash = \134).
function unescapeMountField(field) {
  return field.replace(/\\(\d{3})/g, (_, oct) =>
    String.fromCharCode(parseInt(oct, 8)),
  );
}

export function hasGitEntry(dir) {
  return existsSync(join(dir, ".git"));
}

export function expandMountToProjectDirs(mount) {
  // If the mount itself is a repo, preserve the existing one-mount-one-project
  // behavior rather than expanding nested repos or submodules beneath it.
  if (hasGitEntry(mount)) return [mount];

  let entries;
  try {
    entries = readdirSync(mount, { withFileTypes: true });
  } catch {
    return [mount];
  }

  const childRepos = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(mount, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = statSync(child).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir && hasGitEntry(child)) childRepos.push(child);
  }

  return childRepos.length > 0 ? childRepos : [mount];
}

export function projectDirsFromMounts(mounts) {
  const seen = new Set();
  const projects = [];
  for (const mount of mounts) {
    for (const project of expandMountToProjectDirs(mount)) {
      if (seen.has(project)) continue;
      seen.add(project);
      projects.push(project);
    }
  }
  return projects;
}

// Parse /proc/mounts and return the set of host-project target directories,
// applying the backend-agnostic rule documented in the header.
export function discoverProjectMounts() {
  let raw;
  try {
    raw = readFileSync("/proc/mounts", "utf8");
  } catch (err) {
    log(`cannot read /proc/mounts: ${err.message}`);
    return [];
  }

  const seen = new Set();
  const targets = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    // fields: source target fstype options dump pass
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const fstype = parts[2];
    if (fstype !== "virtiofs") continue;

    const options = parts[3].split(",");
    // The first option token is the ro/rw flag on Linux mounts. Skip ro.
    if (options[0] !== "rw") continue;

    const target = unescapeMountField(parts[1]);
    if (isUnderSystemPrefix(target)) continue;
    // Skip backend runtime dirs by convention (/.msb, future /.<backend>).
    if (basename(target).startsWith(".")) continue;

    // Must be a real directory (excludes bind-mounted files like /etc/hosts,
    // already covered by the prefix rule, but also any odd file-over-virtiofs).
    let isDir = false;
    try {
      isDir = statSync(target).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

async function main() {
  const mounts = discoverProjectMounts();
  if (mounts.length === 0) {
    log("no read-write host project mounts found; nothing to register");
    return;
  }
  log(`found ${mounts.length} qualifying host mount(s): ${mounts.join(", ")}`);
  const projects = projectDirsFromMounts(mounts);
  log(
    `registering ${projects.length} project director${projects.length === 1 ? "y" : "ies"}: ${projects.join(", ")}`,
  );

  let connectToDaemon;
  try {
    ({ connectToDaemon } = await import(resolveCliClientModuleUrl()));
  } catch (err) {
    log(`could not load the Paseo CLI daemon client: ${err.message}`);
    return; // fail-open
  }

  let client;
  try {
    client = await connectToDaemon({});
  } catch (err) {
    log(`could not connect to the Paseo daemon: ${err.message}`);
    return; // fail-open (daemon may still be coming up on a very early boot)
  }

  try {
    for (const dir of projects) {
      try {
        const res = await client.addProject(dir);
        if (res && res.project && res.project.projectId) {
          log(`registered ${res.project.projectId}  ${dir}`);
        } else {
          const reason =
            (res && (res.error || res.errorCode)) || "unknown error";
          log(`skipped ${dir}: ${reason}`);
        }
      } catch (err) {
        log(`skipped ${dir}: ${err.message}`);
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

// Always exit 0 — never let project pre-population fail the sandbox.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
    .catch((err) => {
      log(`unexpected error: ${err && err.message ? err.message : String(err)}`);
    })
    .finally(() => {
      process.exit(0);
    });
}
