// opendesign-relay.mjs — loopback-preserving TCP relay for the OpenDesign kit.
//
// WHY THIS EXISTS
//
// OpenDesign gates a number of its own API routes on the request PEER address
// being loopback (upstream apps/daemon/src/http/local-daemon-request.ts,
// `requireLocalDaemonRequest`). That guard inspects `req.socket.remoteAddress`
// and the Host header, and it is applied to routes the browser UI calls
// directly — including `GET /api/diagnostics/export` (Settings -> About ->
// Export diagnostics) and `POST /api/strategies/od-next/rollout`.
//
// acq/msb create-time port publishing dials the sandbox GUEST NETWORK address,
// not guest loopback. So a daemon bound to 0.0.0.0 sees a guest-network peer
// for every browser request arriving from the host, and those routes answer
// 403 Forbidden even though the rest of the UI works. Binding the daemon to
// loopback alone is not an option either: then the published port has nothing
// to connect to.
//
// This relay resolves the conflict. The daemon binds 127.0.0.1 only. The relay
// binds the guest network address(es) and forwards each connection to
// 127.0.0.1 from localAddress 127.0.0.1, so the daemon always observes a
// loopback peer. It is a plain byte relay: no parsing, no header rewriting, so
// websockets, SSE, and streaming responses pass through untouched.
//
// SECURITY POSTURE (unchanged by this file)
//
// The relay does not widen exposure. The guest network interface was already
// the reachable surface when the daemon bound 0.0.0.0; the host side of the
// mapping remains loopback-only, which is the kit's actual boundary. See
// docs/decisions/disable-api-auth-loopback-boundary.md. The relay deliberately
// does NOT rewrite the Host header: OpenDesign's own origin middleware already
// accepts the loopback Host a browser sends to a published localhost port.
//
// Fail-soft, like the rest of the kit: a bind failure is logged and the process
// keeps serving whatever else bound, rather than taking the UI down.

import net from 'node:net';
import os from 'node:os';

const PORT = Number.parseInt(process.argv[2] ?? '', 10);
const TARGET_HOST = '127.0.0.1';
// How often to look for interfaces that appeared after startup. The relay may
// win the race against sandbox network setup on a cold boot.
const RESCAN_INTERVAL_MS = Number.parseInt(
  process.env.OPENDESIGN_RELAY_RESCAN_MS ?? '10000',
  10,
);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[relay] usage: opendesign-relay.mjs <port> (got ${JSON.stringify(process.argv[2])})`);
  process.exit(2);
}

const log = (...parts) => {
  console.log(`${new Date().toISOString()} [relay]`, ...parts);
};

/**
 * Publishable addresses: every non-internal IPv4/IPv6 address on the guest.
 * `internal` is Node's own flag for loopback, which the daemon already owns —
 * binding it here would collide with the daemon on the same port.
 */
function publishableAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 'IPv6') continue;
      // A link-local IPv6 address needs its scope id to bind, and carries no
      // routable meaning for a published port. Skip it rather than log a
      // recurring EINVAL.
      if (entry.family === 'IPv6' && entry.address.toLowerCase().startsWith('fe80:')) continue;
      found.push(entry.address);
    }
  }
  return [...new Set(found)];
}

const bound = new Set();
// Addresses whose bind failed for a reason a rescan will never fix. Retrying
// them every interval would turn one misconfiguration into an endless log.
const permanentlyFailed = new Set();

function relayConnection(client) {
  const upstream = net.connect({
    port: PORT,
    host: TARGET_HOST,
    localAddress: TARGET_HOST,
  });
  // A relay must not inherit the default 'error' -> throw behaviour on either
  // side: a client that hangs up mid-response, or a daemon restart, is normal
  // operation here and must not take the relay down.
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  // No timeouts: SSE run streams and websockets are long-lived by design.
  client.pipe(upstream);
  upstream.pipe(client);
}

function bind(address) {
  if (bound.has(address) || permanentlyFailed.has(address)) return;
  const server = net.createServer(relayConnection);
  server.on('error', (err) => {
    bound.delete(address);
    const code = err?.code;
    if (code === 'EADDRINUSE') {
      // Something already serves this address:port — most likely a previous
      // relay generation, or a daemon still bound to 0.0.0.0 from an older kit
      // version. Either way the port is reachable, which is the goal.
      log(`address already in use, leaving it alone: ${address}:${PORT}`);
      permanentlyFailed.add(address);
      return;
    }
    if (code === 'EADDRNOTAVAIL' || code === 'EINVAL') {
      // The interface went away between scan and bind. A later rescan can
      // legitimately retry this one.
      log(`address unavailable (will retry): ${address}:${PORT} (${code})`);
      return;
    }
    log(`bind failed: ${address}:${PORT} (${code ?? err?.message})`);
    permanentlyFailed.add(address);
  });
  server.listen(PORT, address, () => {
    bound.add(address);
    log(`forwarding ${address}:${PORT} -> ${TARGET_HOST}:${PORT}`);
  });
}

function scan() {
  const addresses = publishableAddresses();
  if (addresses.length === 0 && bound.size === 0) {
    log('no non-loopback address yet; will rescan');
  }
  for (const address of addresses) bind(address);
}

log(`starting for port ${PORT}; daemon expected on ${TARGET_HOST}:${PORT}`);
scan();
const rescan = setInterval(scan, RESCAN_INTERVAL_MS);
rescan.unref?.();
// Keep the process alive even during a window where nothing is bound (cold
// boot, or every interface temporarily gone), so the rescan can recover
// instead of the supervisor thrashing.
setInterval(() => {}, 1 << 30);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`received ${signal}; exiting`);
    process.exit(0);
  });
}
