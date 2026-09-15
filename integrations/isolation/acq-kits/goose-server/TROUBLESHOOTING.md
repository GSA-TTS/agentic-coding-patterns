# Troubleshooting — goose-server kit

## goose Desktop can't connect / "connection refused" or times out

1. **Confirm the server is up in the guest** (send the kit secret, as Desktop does):

   ```bash
   acq exec <sandbox> -- sh -c 's="$GOOSE_SERVER__SECRET_KEY"; curl -fsS -H "X-Secret-Key: $s" http://127.0.0.1:3284/status && echo OK'
   ```

   - `OK` → the server is running; the problem is the host↔guest publish (see 2) or
     the Desktop secret/URL (see 4).
   - No output → the server is not up; see "Server did not start" below.

2. **Confirm the host port and use it exactly.**

   ```bash
   acq ports <sandbox>     # find the host port mapped to container 3284
   ```

   In goose Desktop → Settings → goose Server, the **URL** must be
   `http://127.0.0.1:<that-host-port>` (HTTP, not HTTPS, in v1), **Certificate
   Fingerprint** empty.

3. **"Empty reply from server" on the host port** (browser/Desktop) while the
   in-guest curl in step 1 works. This is the classic msb create-time-publish
   symptom when the server binds guest loopback instead of `0.0.0.0`. The kit sets
   `GOOSE_SERVE_HOST=0.0.0.0`; confirm it reached the guest:

   ```bash
   acq exec <sandbox> -- sh -c 'echo "$GOOSE_SERVE_HOST"'   # expect 0.0.0.0
   acq exec <sandbox> -- sh -c 'ss -ltnH 2>/dev/null | grep 3284 || awk "\$2 ~ /:0CD4\$/ && \$4==\"0A\"" /proc/net/tcp'
   ```

   A LISTEN address of `0.0.0.0:3284` (or hex `00000000:0CD4`) is correct;
   `127.0.0.1:3284` (`0100007F:0CD4`) is the bug — see
   `GSA-TTS/agentic-coding-quickstart#333` and that repo's `KNOWN_FAILURE_MODES.md`.

4. **"server cannot connect" while the host `curl` in step 1 succeeds, and no server
   log activity on Desktop launch.** goose Desktop 1.50.0's ACP client ALWAYS sends
   a secret-key handshake, so the **Secret Key** field in Desktop must match the
   server's `GOOSE_SERVER__SECRET_KEY` (kit default `goose-server-kit-local-loopback`).
   An empty or mismatched Secret Key fails to connect even though the server is
   healthy. Confirm the values match:

   ```bash
   # server's secret (what Desktop must send):
   acq exec <sandbox> -- sh -c 'echo "$GOOSE_SERVER__SECRET_KEY"'
   # prove the handshake end-to-end from the host with that value:
   acq ports <sandbox>   # get the host port
   curl -i -H "X-Secret-Key: <secret>" http://127.0.0.1:<host-port>/status      # expect 200
   curl -i "http://127.0.0.1:<host-port>/acp?token=<secret>"                    # expect 406
   ```

   `406` on `/acp` means the secret was accepted (only the SSE header is missing —
   which the real client sends); `401`/`403` means the secret is wrong. After
   correcting the Secret Key, **fully Quit (Cmd-Q) and reopen** Desktop — it reads
   the external-server settings only at startup.

## Server did not start

Check the server log:

```bash
acq exec <sandbox> -- sh -c 'tail -n 40 ~/.local/state/goose/goose-serve.log'
```

Common causes:

- **goose CLI not installed.** The install runs at create time and is non-fatal,
  so a transient download failure leaves the binary absent. Check:

  ```bash
  acq exec <sandbox> -- sh -c 'command -v goose && goose --version || echo MISSING'
  ```

  If `MISSING`, the create-time download or sha256 verification failed. Re-create
  the sandbox (a transient network/registry blip), or verify egress to
  `github.com` / `objects.githubusercontent.com` is allow-listed (it is, by this
  kit) and that the pinned version/hashes in `spec.yaml` still match the release
  assets. On an HTTPS-inspected network, also apply the `zscaler-ca-certificate`
  kit so the download trusts the inspection CA.

- **Wrong-architecture binary.** msb microVMs are aarch64 on Apple Silicon. The
  installer selects the asset by `uname -m` and refuses a mismatched sha, so a
  wrong-arch install shows up as "does not execute" in the create-time output, not
  a running-but-broken binary.

## goose Desktop says "unable to connect" but the server is healthy

If the host `curl .../status` returns `ok` (server up, port reachable) yet Desktop
reports "unable to connect" — or won't let you into Settings — the usual cause is a
**provider-name mismatch**. goose Desktop drives the server by *named provider*. If
Desktop asks for a provider the server hasn't defined, agent initialization fails.

This kit defines a custom provider named **`custom_usai`** on the server. Confirm:

```bash
# The server must have the custom_usai provider defined:
acq exec <sandbox> -- sh -c 'cat ~/.config/goose/custom_providers/custom_usai.json | head'
# ...and the config must mark it active:
acq exec <sandbox> -- sh -c 'grep active_provider ~/.config/goose/config.yaml'
```

In goose Desktop, make sure the selected provider is **`custom_usai`** (USAi) with a
model like `claude-sonnet-5`. If your Desktop uses a differently-named provider,
either rename it to `custom_usai` or edit the kit's shipped `custom_usai.json` +
config primer to match your Desktop's provider name. A full **Quit + reopen** of
Desktop is required after changing the external-server or provider setting.

## goose runs but every model call fails (auth / 401 / 404)

The provider is the shipped `custom_usai` custom provider (OpenAI-compatible),
pointed at USAi. Its key env var is `CUSTOM_USAI_API_KEY`.

- **Missing key.** Confirm you stored the custom secret under the right env name:

  ```bash
  acq secret set -g goose-usai --host api.gsa.usai.gov --env CUSTOM_USAI_API_KEY
  ```

  Verify the env var is present in the guest (the value is a proxied placeholder,
  not the real key — that is expected):

  ```bash
  acq exec <sandbox> -- sh -c 'test -n "$CUSTOM_USAI_API_KEY" && echo SET || echo UNSET'
  ```

- **404 on model calls.** Usually the provider's `base_url` is wrong for the
  gateway. This kit sets `https://api.gsa.usai.gov/api/v1/chat/completions` in
  `custom_usai.json`; if USAi changes its path, update that file. A `401` instead
  means the key/host binding is off — re-check step 1.

- **Wrong model id.** The default `GOOSE_MODEL` is `claude-sonnet-5`. Pick a
  model present in `custom_usai.json` and served by your USAi tenant (goose
  Desktop → Models, or set `GOOSE_MODEL`).

## Config merge warnings

`~/.local/state/goose/goose-config-merge.log` records the merge and the
provider-staging step. If it reports "existing goose config uses an unmodeled
shape", a pre-existing `~/.config/goose/config.yaml` used nested maps/lists the
fail-safe flat merger does not model; it appended only the missing kit keys rather
than risk corrupting your config. Inspect the file and set
`active_provider: custom_usai` / `GOOSE_MODEL` by hand if needed.

## Where things live

| What | Path (in guest) |
|---|---|
| Server log | `~/.local/state/goose/goose-serve.log` |
| Config-merge + provider-stage log | `~/.local/state/goose/goose-config-merge.log` |
| goose global config | `~/.config/goose/config.yaml` |
| custom_usai provider (on server) | `~/.config/goose/custom_providers/custom_usai.json` |
| goose CLI | `/usr/local/bin/goose` |
| Staged USAi primer | `~/goose-config/config.yaml` |
| Staged custom_usai provider | `~/goose-config/custom_providers/custom_usai.json` |
