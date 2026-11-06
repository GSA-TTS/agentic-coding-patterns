import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run this test runner only in the independently approved workspace sandbox.
test('managed runtime offline Python fixtures', { timeout: 30000 }, () => {
  const suite = fileURLToPath(new URL('./managed-runtime-test.py', import.meta.url));
  const result = spawnSync('python3', ['-I', '-B', suite], {
    encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, LANG: 'C' },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
