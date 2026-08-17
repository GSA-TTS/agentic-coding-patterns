# Decision: gate the "open your browser" signal on full UI readiness (immutable-cache boot race)

**Status:** accepted

## Context

The Paseo web UI intermittently rendered a **black page** in the browser that
**persisted across reloads**, even though the daemon was healthy. Extensive
host-side probing established the facts:

- The daemon serves content-hashed UI assets (e.g. the ~15 MB entry bundle
  `/_expo/static/js/web/index-<hash>.js`) with `Cache-Control: public,
  max-age=31536000, immutable`, precompressed, negotiated by `Accept-Encoding`.
- Fetched over the published host port, the bundle is **byte-for-byte identical**
  to the on-disk artifact (SHA-256 match) and **Brotli-decodes** to the exact
  uncompressed size. Transport and artifact are healthy — repeatably, on every
  path (in-guest, create-time published port, and `ssh -L`).
- The browser console showed `net::ERR_CONTENT_DECODING_FAILED 200 (OK)` on the
  `br` bundle, and the request sat "pending" then failed.
- **A hard reload with cache disabled (or an Incognito window) rendered the app.**

### Root cause

A **first-load race that poisons the browser's HTTP cache.** During the boot
window — after `/api/health` answers but before the daemon is fully serving the
large hashed bundle — a browser that loads the page can cache a **partial/broken**
response. Because the asset is `immutable`, Chrome keeps replaying that broken
cached body and fails to decode it on **every** later reload, until the cache is
cleared. This is **not** an msb relay bug, **not** a truncation on the wire, and
**not** a bad artifact — it is stale client state created by opening the UI too
early. (An earlier hypothesis blaming msb's published-port relay for chunked
truncation was investigated and **retracted**; see the correction on
microsandbox#1330 and the git history of this kit.)

Contributing factors we intentionally did **not** change:

- The daemon rejecting cleartext HTTP/2 upgrade (`400 Invalid Upgrade header`) is
  a red herring — browsers use HTTP/1.1 over `http://` and never trigger it.
- Unknown paths (e.g. `/sw.js`) fall back to `index.html` (HTML with a JS-ish
  URL); latent, but the app registers no service worker, so it is not the cause.

## Decision

**Do not tell the user the UI is ready until the entry bundle is fully
serveable — not merely when `/api/health` answers.** The kit's entrypoint shim
(`files/home/paseo-agent-shim`) gains a `ui_ready()` check that:

1. confirms `/api/health`,
2. reads `index.html`, extracts the hashed entry bundle,
3. fetches that bundle with `Accept-Encoding: br` (what a browser sends), **without
   decoding**, and requires the received byte count to equal the daemon's on-disk
   `.br` artifact size (the bundle is chunked, so there is no `Content-Length` to
   compare against).

The shim waits on `ui_ready()` before printing "READY — safe to open," and when
it is not yet ready prints a WAIT notice plus the one-time remedy (disable-cache
hard reload / Incognito) in case the user already opened it.

`scripts/verify` gains a browser-accurate check in step 5b: it fetches the bundle
with `Accept-Encoding: br` and **Brotli-decodes it with Node's
`zlib.brotliDecompressSync`**, asserting the decoded length equals the identity
baseline. This models the exact `ERR_CONTENT_DECODING_FAILED` failure mode and
does not depend on the host `curl`'s codec support.

## Consequences

- Following the printed instructions no longer opens the UI during the poisoning
  window, so the persistent black page is avoided on the happy path.
- If a user still opens early (or has a poisoned cache from before), the remedy is
  documented and one-time: disable-cache hard reload or Incognito.
- The kit does not (and cannot from outside the app) change the assets'
  `immutable` cache policy; the mitigation is timing + guidance, not altering
  Paseo's caching. If Paseo later exposes a knob to weaken `immutable` on the
  entry document, revisit.
- `verify` now catches a genuine br/decoding regression (corrupt or short bundle)
  that the previous identity-only check would miss.

## Verification

- `ui_ready()` logic exercised against a live daemon: on-disk `.br` size
  (2,506,699) equals the `Accept-Encoding: br` wire bytes → ready.
- Node `brotliDecompressSync` decodes the served bundle to 15,779,639 bytes;
  a truncated `.br` yields `ERR:unexpected end of file` (negative test).
- `sh -n` / `bash -n` clean on the shim and `verify`; offline gate passes.

## Links

- Tracking / narrative: GSA-TTS/agentic-coding-patterns#318.
- Retraction of the earlier msb-relay theory: microsandbox#1330.
- `files/home/paseo-agent-shim` (`ui_ready`), `scripts/verify` (step 5b),
  `TROUBLESHOOTING.md` ("Black page that persists on reload").
