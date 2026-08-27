import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  expandMountToProjectDirs,
  hasGitEntry,
  projectDirsFromMounts,
} from "../files/home/paseo-register-mounts.mjs";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "paseo-register-mounts-"));
}

test("hasGitEntry accepts .git directories", async () => {
  const dir = await tempDir();
  await mkdir(path.join(dir, ".git"));

  assert.equal(hasGitEntry(dir), true);
});

test("hasGitEntry accepts .git files", async () => {
  const dir = await tempDir();
  await writeFile(path.join(dir, ".git"), "gitdir: /tmp/example\n");

  assert.equal(hasGitEntry(dir), true);
});

test("mount with no direct child repos falls back to mount itself", async () => {
  const mount = await tempDir();
  await mkdir(path.join(mount, "scratch"));

  assert.deepEqual(expandMountToProjectDirs(mount), [mount]);
});

test("mount with direct child repos expands to those repos only", async () => {
  const mount = await tempDir();
  const repoA = path.join(mount, "repo-a");
  const repoB = path.join(mount, "repo-b");
  const scratch = path.join(mount, "scratch-not-a-repo");
  await mkdir(path.join(repoA, ".git"), { recursive: true });
  await mkdir(repoB);
  await writeFile(path.join(repoB, ".git"), "gitdir: /tmp/example\n");
  await mkdir(scratch);

  assert.deepEqual(expandMountToProjectDirs(mount).sort(), [repoA, repoB].sort());
});

test("mount that is itself a repo is not expanded into nested repos", async () => {
  const mount = await tempDir();
  await mkdir(path.join(mount, ".git"));
  await mkdir(path.join(mount, "nested", ".git"), { recursive: true });

  assert.deepEqual(expandMountToProjectDirs(mount), [mount]);
});

test("direct child symlink to repo directory is accepted", async () => {
  const mount = await tempDir();
  const externalRepo = await tempDir();
  await mkdir(path.join(externalRepo, ".git"));
  const linkedRepo = path.join(mount, "linked-repo");
  await symlink(externalRepo, linkedRepo);

  assert.deepEqual(expandMountToProjectDirs(mount), [linkedRepo]);
});

test("missing mount falls back without throwing", async () => {
  const dir = await tempDir();
  const missing = path.join(dir, "missing");

  assert.deepEqual(expandMountToProjectDirs(missing), [missing]);
});

test("projectDirsFromMounts de-duplicates expanded project paths", async () => {
  const mount = await tempDir();
  const repo = path.join(mount, "repo");
  await mkdir(path.join(repo, ".git"), { recursive: true });

  assert.deepEqual(projectDirsFromMounts([mount, repo]), [repo]);
});
