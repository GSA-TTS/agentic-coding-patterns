import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { createHash } from "node:crypto";
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

test("rejects malformed HOST_HP overrides before probing", async (t) => {
  const mocks = await mkdtemp(path.join(os.tmpdir(), "paseo-identity-host-"));
  t.after(() => rm(mocks, { force: true, recursive: true }));
  await mockCommand(mocks, "acq", "exit 9");
  await mockCommand(mocks, "node", "exit 9");
  await mockCommand(mocks, "curl", "exit 9");
  for (const host of ["localhost:6767", "127.0.0.1:0", "127.0.0.1:08", "127.0.0.1:6767/path", "127.0.0.1:6767@other", "127.0.0.1:65536"]) {
    const result = spawnSync("bash", [script, "example"], {
      encoding: "utf8", env: { ...process.env, PATH: `${mocks}:${process.env.PATH}`, HOST_HP: host }, timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2, host);
    assert.match(result.stderr, /HOST_HP must be 127\.0\.0\.1/);
  }
});

test("automatic host mapping selects only the configured guest port", async (t) => {
  const mocks = await mkdtemp(path.join(os.tmpdir(), "paseo-identity-ports-"));
  t.after(() => rm(mocks, { recursive: true, force: true }));
  await mockCommand(mocks, "acq", 'printf "%s\\n" "$MOCK_PORTS"');
  await mockCommand(mocks, "node", "exit 9");
  await mockCommand(mocks, "curl", "exit 9");
  for (const [rows, port, status] of [
    ["sandbox 8080 -> host 127.0.0.1:12345 (create-time -p)\nsandbox 6767 -> host 127.0.0.1:22336 (create-time -p)", "22336", 0],
    ["sandbox 6767 -> host 127.0.0.1:22336 (create-time -p)\nsandbox 8080 -> host 127.0.0.1:12345 (create-time -p)", "22336", 0],
    ["sandbox 8080 -> host 127.0.0.1:12345 (create-time -p)", "", 2],
    ["sandbox 6767 -> host 127.0.0.1:22336\nsandbox 6767 -> host 127.0.0.1:22337", "", 2],
    ["sandbox 6767 -> host 127.0.0.1:22336\nsandbox 6767 -> host 0.0.0.0:22337", "", 2],
  ]) {
    const result = spawnSync("bash", [script, "example"], {
      env: { ...process.env, HOST_HP: "", MOCK_PORTS: rows, HEALTH_GRACE: "0", PATH: `${mocks}:${process.env.PATH}` },
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    if (status === 2) {
      assert.equal(result.status, 2);
      assert.match(result.stderr, /expected exactly one IPv4 host mapping/);
    } else {
      assert.match(result.stdout, new RegExp(`host mapping:\\s+127\\.0\\.0\\.1:${port}`));
      assert.notEqual(result.status, 2);
    }
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
  printf 'sandbox 6767 -> host 127.0.0.1:6767 (create-time -p)\\n'
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

test("age discrepancy is advisory only after host and guest IDs agree", async () => {
  const source = await readFile(script, "utf8");
  const ageStart = source.indexOf('AGE_DISCREPANCY=""');
  const ageEnd = source.indexOf("\n# ------------------------------------------- 4.", ageStart);
  const verdictStart = source.indexOf('if [ -z "$IPV4_ID" ]');
  const verdictEnd = source.indexOf('\nif is_num "${PROBE_TIMEOUTS:-}"', verdictStart);
  assert.ok(ageStart > 0 && ageEnd > ageStart && verdictStart > ageEnd && verdictEnd > verdictStart);
  const checks = `${source.slice(ageStart, ageEnd)}\n${source.slice(verdictStart, verdictEnd)}`;
  const harness = `is_num() { case "$1" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }\n` +
    `ok() { printf 'PASS:%s\\n' "$1"; }; bad() { printf 'FAIL:%s\\n' "$1"; }; ` +
    `warn() { printf 'WARN:%s\\n' "$1"; }; note() { :; };\n` +
    `LISTEN_AGE="$1"; SBX_VM_UPTIME="$2"; HOST_IDS="$3"; SBX_SERVER_ID="$4"; ` +
    `HOST_ID_COUNT="$5"; IPV4_ID="$6"; GUEST_RUNTIME_ID="$4"; TMP=$(mktemp); ` +
    `printf 'localhost: %s\\n127.0.0.1: %s\\nipv4-mapped: %s\\n' "$3" "$3" "$3" > "$TMP"; ORPHAN_SLACK=120;\n${checks}\nrm -f "$TMP"`;
  function run(listenerAge, guestUptime, hostId, guestId, count = "1") {
    const result = spawnSync("bash", ["-c", harness, "test", listenerAge, guestUptime, hostId, guestId, count, hostId], {
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  assert.match(run("130000", "1000", "srv_same", "srv_same"), /WARN:listener elapsed time/);
  assert.doesNotMatch(run("130000", "1000", "srv_same", "srv_same"), /FAIL:/);
  assert.match(run("130000", "1000", "srv_wrong", "srv_guest"), /FAIL:MISMATCH/);
  assert.match(run("130000", "1000", "srv_wrong", "srv_guest"), /FAIL:listener elapsed time/);
  assert.match(run("130000", "1000", "", "srv_guest", "0"), /FAIL:published 127\.0\.0\.1 endpoint did not provide/);
  assert.match(run("1000", "1000", "srv_same", "srv_same"), /PASS:listener elapsed time is within/);
  assert.match(run("", "1000", "srv_same", "srv_same"), /WARN:listener age or guest uptime unavailable/);
});

test("failed identity guidance never recommends killing this sandbox VM", async () => {
  const source = await readFile(script, "utf8");
  const start = source.indexOf("Remediation for a stale host forwarder");
  const next = source.indexOf("RESULT: PASS WITH WARNINGS", start);
  assert.equal(start, -1, "stale-forwarder instructions must not include a generic kill sequence");
  assert.match(source, /Never kill an 'msb machine --name \$SBX' process/);
  assert.doesNotMatch(source.slice(source.indexOf("Diagnosis for a failed identity check"), next), /kill -9|kill <listener-pid>/);
});

test("whole identity gate requires the published IPv4 server ID before downgrading post-sleep age", async (t) => {
  const mocks = await mkdtemp(path.join(os.tmpdir(), "paseo-identity-full-"));
  t.after(() => rm(mocks, { force: true, recursive: true }));
  await mockCommand(mocks, "acq", `
if [ "$1" = exec ]; then
  case "$*" in *'node -e'*) printf '127.0.0.1: %s\n' "$MOCK_GUEST_RUNTIME" ;; *)
    printf 'SERVER_ID=%s\nDAEMON_PID=12\nVM_UPTIME=1000\nBIND=00000000:1A6F\nHEALTH={"status":"ok"}\nEXTERNAL=0\nLOOPBACK=0\n' "$MOCK_GUEST_ID" ;;
  esac
elif [ "$1" = ports ]; then printf '127.0.0.1:6767\n'; else exit 3; fi`);
  await mockCommand(mocks, "lsof", "printf 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nmsb 432 agent 7u IPv4 0 0t0 TCP *:6767 (LISTEN)\n'");
  await mockCommand(mocks, "ps", `
case "$*" in
  *'command='*) printf 'msb machine --name example\n' ;;
  *'ppid='*) printf '1\n' ;;
  *'etime='*) printf '1-12:00:00\n' ;;
  *) printf 'PID PPID STARTED ELAPSED\n432 1 now 1-12:00:00\n' ;;
esac`);
  await mockCommand(mocks, "curl", "printf '{\"status\":\"ok\"}'");
  await mockCommand(mocks, "node", 'if [ "$1" = -e ] && [ "$4" = host ]; then printf "%s\\n" "$MOCK_WS_ROWS"; else printf "127.0.0.1\\n"; fi');
  const cases = [
    { name: "same daemon after host sleep", guest: "srv_one", rows: "localhost: srv_one\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 0, expected: /RESULT: PASS WITH WARNINGS/ },
    { name: "wrong daemon", guest: "srv_one", runtime: "srv_other", rows: "localhost: srv_one\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 1, expected: /MISMATCH/ },
    { name: "only localhost has an ID", guest: "srv_one", rows: "localhost: srv_one\n127.0.0.1: timeout\nipv4-mapped: timeout", exit: 1, expected: /published 127\.0\.0\.1 endpoint did not provide/ },
    { name: "published IPv4 only after sleep", guest: "srv_one", rows: "localhost: timeout\n127.0.0.1: srv_one\nipv4-mapped: timeout", exit: 0, expected: /only the published IPv4 route is verified/ },
    { name: "IPv4 serves another daemon", guest: "srv_one", rows: "localhost: srv_other\n127.0.0.1: srv_other\nipv4-mapped: srv_other", exit: 1, expected: /MISMATCH/ },
    { name: "arbitrary frame text is not an ID", guest: "srv_one", rows: "localhost: invalid server_info srv_one\n127.0.0.1: invalid server_info srv_one\nipv4-mapped: invalid server_info srv_one", exit: 1, expected: /published 127\.0\.0\.1 endpoint did not provide/ },
    { name: "missing guest runtime ID", guest: "srv_one", runtime: "timeout", rows: "localhost: srv_one\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 1, expected: /guest daemon did not provide/ },
    { name: "stale guest file", guest: "srv_old", runtime: "srv_one", rows: "localhost: srv_one\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 0, expected: /file differs from the live guest daemon/ },
    { name: "host alias disagrees but IPv4 agrees", guest: "srv_one", rows: "localhost: srv_other\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 0, expected: /other loopback aliases.*only the published IPv4 route is verified|localhost route srv_other/ },
    { name: "multiple guest replies cannot establish identity", guest: "srv_one", runtime: "srv_one\n127.0.0.1: srv_other", rows: "localhost: srv_one\n127.0.0.1: srv_one\nipv4-mapped: srv_one", exit: 1, expected: /guest daemon did not provide/ },
  ];
  for (const scenario of cases) {
    const result = spawnSync("bash", [script, "example"], {
      env: { ...process.env, PATH: `${mocks}:${process.env.PATH}`, HOST_HP: "127.0.0.1:6767", HEALTH_GRACE: "0", MOCK_GUEST_ID: scenario.guest, MOCK_GUEST_RUNTIME: scenario.runtime ?? scenario.guest, MOCK_WS_ROWS: scenario.rows },
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, scenario.exit, `${scenario.name}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, scenario.expected, scenario.name);
    if (scenario.exit === 0) {
      assert.match(result.stdout, /listener elapsed time exceeds guest uptime/);
      assert.doesNotMatch(result.stdout, /RESULT: FAIL/);
    }
  }
});

test("WebSocket probe requires a structured server_info response", async (t) => {
  const source = await readFile(script, "utf8");
  const begin = source.indexOf("const net = require('net');");
  const end = source.indexOf("\nNODE\n", begin);
  assert.ok(begin > 0 && end > begin);
  const probe = source.slice(begin, end).replace("const port = Number(process.argv[2] || 6767);", "const port = Number(process.argv[1]);");
  let response = '{"type":"server_info","serverId":"srv_real"}';
  let invalidUpgrade = false;
  let invalidFrame = false;
  const server = net.createServer((socket) => {
    let sent = false;
    let awaitingHello = false;
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (sent) return;
      if (!awaitingHello) {
        const end = received.indexOf("\r\n\r\n");
        if (end < 0) return;
        const key = received.subarray(0, end).toString().match(/Sec-WebSocket-Key: ([^\r\n]+)/)?.[1];
        assert.ok(key, "client must send WebSocket upgrade key");
        const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        received = received.subarray(end + 4);
        awaitingHello = !invalidUpgrade;
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${invalidUpgrade ? "invalid" : accept}\r\n\r\n`);
        if (invalidUpgrade) return;
      }
      if (received.length < 6) return;
      assert.equal(received[0], 0x81, "client hello must be a final text frame");
      assert.ok(received[1] & 0x80, "client frame must be masked");
      let length = received[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (received.length < 4) return;
        length = received.readUInt16BE(2);
        offset = 4;
      }
      assert.ok(length < 65536);
      if (received.length < offset + 4 + length) return;
      const mask = received.subarray(offset, offset + 4);
      const hello = Buffer.from(received.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < hello.length; i++) hello[i] ^= mask[i % 4];
      assert.equal(JSON.parse(hello.toString()).type, "hello");
      sent = true;
      const payload = Buffer.from(response);
      socket.end(Buffer.concat([
        Buffer.from([invalidFrame ? 0x01 : 0x81, payload.length]), payload,
      ]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function probeOnce() {
    const child = spawn("node", ["-e", probe, String(server.address().port)], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (bytes) => { output += bytes; });
    const exit = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(exit, 0);
    return output;
  }
  assert.match(await probeOnce(), /^127\.0\.0\.1: srv_real$/m);
  response = '{"type":"other","detail":"srv_fake"}';
  assert.match(await probeOnce(), /^127\.0\.0\.1: invalid server_info$/m);
  response = 'text containing srv_fake';
  assert.match(await probeOnce(), /^127\.0\.0\.1: invalid server_info$/m);
  invalidUpgrade = true;
  response = '{"type":"server_info","serverId":"srv_real"}';
  assert.match(await probeOnce(), /^127\.0\.0\.1: invalid WebSocket upgrade$/m);
  invalidUpgrade = false;
  invalidFrame = true;
  assert.match(await probeOnce(), /^127\.0\.0\.1: invalid server_info$/m);
});
