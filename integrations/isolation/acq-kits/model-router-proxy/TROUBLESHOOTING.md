# Troubleshooting — model-router-proxy

## Routing didn't turn on (OpenCode still hits USAi directly)

The kit is **fail-soft**: any problem leaves OpenCode on the direct gateway and
the sandbox still works. Check, in order:

```bash
# 1. did the install run and what did it say?
cat ~/.local/state/model-router-proxy/install.log

# 2. (in-sandbox mode) is the service up?
curl -s http://127.0.0.1:8080/readyz        # want {"status":"ready","candidates":N}
cat ~/.local/state/model-router-proxy/service.log

# 3. is the baseURL actually flipped?
grep baseURL ~/.config/opencode/opencode.jsonc   # want 127.0.0.1:8080/v1

# 4. what state did the toggle last set?
model-router-toggle status
```

Common causes: `USAI_API_KEY` not present (apply the `usai-provider` kit); no
prebuilt dependency wheel for the sandbox Python (install log shows a pip error);
the service couldn't reach USAi (TLS/CA — apply `zscaler-ca-certificate`).

## I toggled routing but nothing changed this session

**Expected.** OpenCode reads the provider `baseURL` **once, at session init**.
`model-router-toggle on`/`off` edits the config, but a running session keeps the
URL it started with. **Start a new OpenCode session** for a toggle to take
effect. `model-router-toggle status` shows what the *next* session will use.

### `off` is sticky — it survives restarts

`model-router-toggle off` persists a preference (`~/.model-router/pref.json`).
The kit's startup script reads it on every boot and **skips re-enabling routing**
while the preference is `off`. (This fixes an earlier bug where every restart
re-flipped routing ON, so `off` could never take hold.) The service still runs
in the background, so `model-router-toggle on` re-enables routing instantly for
the next session. `status` shows the saved preference under `pref:`.

### Mid-session on/off (platform limitation, not a kit bug)

A true mid-session global toggle is **not currently possible from this kit**:
OpenCode exposes no live config-reload or provider-switch hook, so an external
proxy/CLI cannot change the active model mid-turn. This is a candidate upstream
feature (OpenCode) or a harness feature (e.g. **PI**), tracked as future work —
not something the proxy can add on its own.

**What *does* work mid-session: the per-turn bypass.** Pin a model for a single
request (skipping routing) by sending the bypass header with an explicit model:

```
x-model-router-bypass: 1
model: usai/claude_4_8_opus
```

That one turn is forwarded untouched; the next turn routes normally again. It's a
per-turn escape hatch, not a global switch, but it is honored in-session.

## How do I know routing is on, as a user?

- **Session start:** the agent surfaces `model-router-toggle ack` — a one-line
  statement of ON/OFF and how to change it. If the operator set
  `MODEL_ROUTER_ACK=off`, that line is suppressed (log-only mode) and you check
  state explicitly instead.
- **Any time:** `model-router-toggle status` (routing ON/OFF, service
  reachability, and the last recorded toggle).
- **Per turn:** the `x-model-router-decision` response header names the chosen
  model; `~/.local/state/model-router-proxy/decisions.jsonl` logs one line per
  turn (metadata only — no raw prompt text).
- **Audit trail of switches:** `~/.local/state/model-router-proxy/toggle-log.jsonl`.

## Turning the acknowledgement off (log-only)

Set `MODEL_ROUTER_ACK=off` in the guest environment. The on/off state is still
recorded to the toggle log and visible via `status`; only the automatic
user-facing session-start note is silenced.
