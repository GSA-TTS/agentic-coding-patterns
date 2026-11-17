---
title: "Bounded runtime model preparation"
description: "Trusted guest discovery and atomic OpenCode preparation, separate from host launch wiring."
status: experimental
tier: 2
last_updated: "2026-11-17"
---

# Bounded runtime model preparation

## Decision

Provide an explicit preparation CLI for plain-terminal OpenCode on MSB. This is
not a launch barrier. The host consumer still has to validate v3 manifests,
materialize immutable read-only facts and snapshots, select the trusted adapter,
and bind successful preparation to its generation and launch attempt. Keep the
production USAi manifest on v2 until that consumer is ready and qualified.
OpenChamber, Paseo, Pi and SBX required-mode wiring are not part of this slice.

The sole initial adapter is `usai-openai-list/v1`, for provider `usai` with its
owned `USAI_API_KEY` credential name. It reads routes only from host-validated
facts and accepts HTTPS, port 443, and the exact declared host. No redirects,
provider executables, dynamic imports, or provider-supplied mapping code run.
The runtime is a guest component, not a host-control tool or a sandbox itself.

### Host projection descriptor

For live-required mode the future v3 host projector must also write a regular,
read-only `models/providers/usai/discovery.json` beneath its supplied root:

```json
{
  "schemaVersion": "acq-runtime-discovery/v1",
  "providerId": "usai",
  "adapter": "usai-openai-list/v1"
}
```

These are the only allowed fields. The host writes this descriptor only after
validating a v3 manifest and its closed discovery adapter selection. This is
materialized control data, not a provider-selected executable or a signature.
Its trust depends on the host's immutable, read-only projection. Missing,
unknown or mismatched descriptors fail before any request. Existing v2
facts-plus-snapshot inputs remain usable only with explicit snapshot mode,
which needs no descriptor and makes no network requests. This slice defines
the projector contract; it does not implement that host projector.

## Membership and metadata

Live-required is the default. Every required membership request must return a
bounded, valid HTTP 200 JSON list. Failure cannot become an empty result or a
snapshot fallback. An empty validated inventory or successful empty list is
authoritative. Explicit snapshot mode reports `snapshot-nonlive`.
Recognized nonterminal pagination signals (`has_more`, next/cursor/token fields,
`links.next`, or pagination/meta containers) reject the entire response, even
with empty `data`. This adapter never follows pages or treats a partial page as
the complete inventory. Terminal false/null/empty continuation markers are
accepted; malformed markers fail closed.

The canonical USAi core owns matching, names and the known non-chat filter.
Runtime callers own hostile-input limits. Live membership does not prove
capabilities. A single optional unauthenticated request to the fixed public
`https://models.dev/api.json` endpoint follows all membership requests. Its
limits and prices are unverified enrichment; upstream capabilities are not copied. A
missing or malformed match leaves unknown values absent. Recommendations from
the staged snapshot are retained only for IDs in the surviving membership.

Validated curated `reasoning` and `inputModalities` from the host snapshot are
retained only on exact advertised IDs, never via fuzzy matching or a sibling
alias. Their per-field result provenance is `snapshot-exact-id`; upstream
enrichment fields are marked `models.dev-unverified`. Provenance is diagnostic
result data, not an OpenCode config option. The snapshot format does not separate
provider-sourced limits/prices from authoring fallback values, so none of its
limits or prices are copied into a live result. The current membership adapter
does not recognize provider-limit fields either. Thus there are no proven
provider limits to prioritize in this adapter; the canonical core retains its
provider-first rule for any future provenance-qualified inputs. Optional upstream
limits must also be positive safe integers before leaving the enrichment
boundary. An unusable context or output value is omitted independently, without
discarding membership or the other usable value. Unknown limits
stay absent when upstream metadata is unavailable. Explicit nonlive snapshot
mode preserves snapshot limits as before, without claiming them as live facts.

## Bounds and transaction

### Versioned failure outcome (no fallback)

Successful JS return values and CLI stdout retain their existing shapes. A failed
child or preparation CLI now writes one closed JSON object to stdout and exits
**1**, including transient failures:

```json
{"schemaVersion":"acq-runtime-model-outcome/v1","outcome":"failure","stage":"membership","reason":"provider-unavailable","failureClass":"transient"}
```

Those five fields are mandatory and no others are accepted. Failure JSON is at
most 1,024 UTF-8 bytes, including whitespace. The parent caps the pipe, then
requires failure exit 1, valid UTF-8, bounded JSON with no duplicate keys, the
exact field set, known version, and an allowed stage/reason/class combination.
Exit 0 requires the existing success envelope, never a failure envelope. Signals,
other exits, malformed/truncated output, extra properties, unknown types and
oversized output are hard failures. A structured failure plus nonzero exit is
expected; a nonzero exit alone is not transient evidence. Child stderr is
discarded. Host-facing stderr remains the fixed human-readable failure line.
Neither stream includes exceptions, raw status values, URLs, headers, credentials,
digests or filesystem paths in a failure. JS rejection errors expose the same
closed object as `error.outcome`; internal propagation uses a private WeakMap,
not a duck-typed exception property. The internal reason table lives in
`integrations/providers/usai/scripts/runtime-model-outcome.mjs`.

Allowed stage/reason pairs (class is hard unless marked transient):

| Stage | Reasons |
| --- | --- |
| `input` | `invalid-input` |
| `trust` | `invalid-trust` |
| `membership` | `authentication`, `response-identity`, `tls`, `http-refused`, `invalid-response`, `unknown` |
| `membership` (transient) | `provider-throttled`, `provider-unavailable`, `connection`, `request-abort` |
| `child` | `child-protocol`, `child-crash` |
| `preparation` | `parent-deadline`, `lock`, `render`, `unknown` |

Transient HTTP classification requires an observed 429 or 500–599 response from
the exact requested provider URL with no redirect. Missing or mismatched response
identity takes precedence over status. Only the membership call made after host
facts validation enables transient classification. Authentication, TLS/trust,
unsafe input, identity, partial/malformed JSON, protocol, crash, lock, render and
unknown failures remain hard. Input and curated capabilities are checked before
network use; no exception-message substring determines classification.

At the request I/O boundary only, connection evidence is limited to `ECONNRESET`,
`ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`,
`UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, and
`UND_ERR_SOCKET`. A bounded cause/aggregate graph is inspected; TLS/certificate
codes, unknown codes or exception types, unclassified leaf errors, cycles and
overlarge graphs defeat transient evidence. An explicit abort by this request's
controller is transient only at the I/O boundary, without harder evidence.
An error after any response bytes is hard truncation, not a transient read error.
Decoding, JSON parsing and shape/bounds checks are outside network-error catches.
The whole 45-second parent deadline is always hard: a child may be spinning in
synchronous parsing rather than waiting on the network. Optional metadata failure
still means `metadataOutcome: unavailable` on a live membership success.

This classification is not permission to reuse a prior result. The parent still
fails nonzero and discovery failures leave prior config untouched. Host-bound
last-good reuse, generation/credential epochs and freshness policy are deferred.

Membership requests are sequential, in provider order. The inventory cap is
eight providers and 500 models per provider, not a promise that eight slow requests
fit in the budget. The initial adapter rejects every provider except USAi.
Each request gets the smaller of 15 seconds and the remaining 45-second total.
Optional metadata leaves one second for publication. Maximum decoded bodies:
10 MiB membership, 32 MiB metadata, 4 MiB child result. Before the matching core,
JSON is checked for finite numeric tokens, depth (32), nodes (250,000), string token length (16,384),
container cardinality (20,000), duplicate keys and unsafe object keys. IDs are
bounded to 256 characters; upstream IDs have a separate 512-character printable
ASCII token bound (including established `@default` suffixes), still rejecting
unsafe object keys. Metadata has at most 20,000 model entries. The child
result still has a 4 MiB total cap; the parent independently checks the eight
provider and 500-model-per-provider bounds and rejects duplicate providers.

The parent holds the renderer's single config lock across discovery and
publication. Lock wait is five seconds, separate from the discovery budget;
required preparation never steals a stale lock. Recovery needs an operator to
confirm owner absence and arrange separate cleanup. Legacy snapshot rendering
retains its prior recovery behavior. The parent starts a child for synchronous
source parsing and matching, caps its output pipe before parsing, kills it with
SIGKILL on expiry or excess output, and waits for `close` before releasing the
lock. Credentials are in the child's minimal environment, not argv or IPC.

### Trusted guest CA input

The trusted guest launcher may supply `NODE_EXTRA_CA_CERTS` for enterprise TLS
trust, including the Zscaler kit's `/etc/ssl/certs/ca-certificates.crt`. The parent
validates this one environment setting before spawning: an absolute normalized
canonical path (no symlink components), readable nonempty regular file, at most
2 MiB, no group/other write bits, and not writable by the preparation user.
The host/guest provisioning layer must own its trust contents and parent
directories and prevent replacement throughout preparation. File checks do not
authenticate a CA or replace that trust boundary. Run preparation as the
unprivileged guest user, not root. A root-owned 0644 system bundle is acceptable
if not writable by that user; a separately staged bundle can use mode 0444.

Only `USAI_API_KEY` and this validated CA path enter the child environment. Node
loads the extra roots at child startup. No CA path comes from provider facts,
descriptors, metadata or CLI arguments. `NODE_OPTIONS`, TLS-disable settings and
other ambient runtime configuration are not forwarded; certificate and hostname
verification remain enabled. Without an extra CA path, Node's built-in trust
applies. Required discovery failure under either trust setup leaves config
untouched. Invalid configured CA paths fail rather than silently dropping trust.

The existing renderer composes base policy and user config and writes one
canonical file with embedded ownership metadata. It checks the deadline again
after flushing the temporary file and immediately before atomic rename. This
is an admission deadline, not a real-time filesystem guarantee: rename and
directory sync can finish later, and an I/O failure after rename cannot undo an
already visible commit. Discovery, validation and pre-rename failures leave the
prior canonical bytes untouched. No success record is emitted before commit.

## Standalone build and validation

`integrations/providers/usai/scripts/build-runtime-artifact.mjs` bundles a
closed ordered source list into the kit's `runtime-model-preparation.mjs`.
Per-module lexical scopes avoid symbol collisions. The generator has no new
dependency, network access or runtime evaluation; guest imports are Node
built-ins only. The artifact invokes itself by its actual path, so flat renamed
read-only staging does not break imports. Do not hand-edit generated bytes.

`make test-kits` checks exact generated-byte equality and runs offline adapter
and guest-artifact tests. Tests cover bounds, non-finite numbers, descriptor
binding, pagination refusal, exact-ID capabilities, missing inputs, invalid feeds,
metadata failure, empty success, snapshot labeling, synchronous-child timeout,
pipe caps, lock refusal, pre-rename failure and concurrent publication. The real
loopback TLS test generates synthetic CA/server material with OpenSSL at test
runtime and runs the generated parent and child, proving extra-root success,
untrusted-TLS refusal, credential separation and unsafe-limit omission through
publication. Its test-owned preload replaces native fetch with a buffered
`https.request` implementation using real loopback TLS. It does not qualify
production fetch streaming, redirects or DNS. There is no production network
override, preload option or disabled TLS check.
It requires OpenSSL and a non-root sandbox with loopback networking, not external
network access. No certificate/private-key files are committed. Execute
these only in an independently justified sandbox. Live MSB qualification and
host generation/attempt tests remain consumer work, not evidence supplied here.
