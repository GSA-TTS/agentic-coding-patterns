# Troubleshooting — model-router kit

## `model_select` tool is not available in OpenCode

1. Confirm the startup step ran and registered the server:
   ```sh
   cat ~/.local/state/model-router/install.log
   ```
   Look for `registered mcp.model-router in …`.
2. Confirm the entry is in the global config:
   ```sh
   grep -A3 '"model-router"' ~/.config/opencode/opencode.jsonc
   ```
3. If the log says the config is **JSONC/!pure-JSON and cannot be safely
   merged**, your global config has comments. Add the `mcp.model-router` block
   by hand — see the README "If your global config has comments (JSONC)".

## It always abstains

- The request may have no keyword cue the scorer recognizes. The scorer is
  deterministic and keyword-driven (no semantic matching) — rephrase with a
  concrete signal ("refactor", "whole repo", "screenshot"), or override the
  catalog/tune the cues in `catalog.py` / `model_router.py`.
- A plain prose question ("what is X?") abstains by design.

## It suggests a model id that is not in my provider

- The bundled default emits family-prefix ids. To get **real** USAi ids, point
  `MODEL_ROUTER_LIVE_IDS` at a USAi `/models` snapshot, or supply a full roster
  via `MODEL_ROUTER_CATALOG`. See the README "Candidate roster".

## `python3 not found`

- The kit needs `python3` on PATH (standard library only). Installing Python is
  out of scope for this kit; the base image is expected to carry it. The kit
  fails soft (logs and exits 0) when it is missing — the sandbox stays up, the
  tool is simply unavailable that boot.

## Self-test failed at startup

- The log (`~/.local/state/model-router/install.log`) carries the Python
  traceback. This almost always means an edit to `model_router.py` / `catalog.py`
  broke import or the scorer. Run the unit tests on the host:
  ```sh
  python3 tests/test_model_router.py
  ```
