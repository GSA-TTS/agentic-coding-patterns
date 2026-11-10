#!/usr/bin/env python3
"""Stand-in `opencode` for offline orchestration tests (no network, no real model)."""

import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

args = sys.argv[1:]
if args[:1] == ["--version"]:
    print("opencode v9.9.9")
    sys.exit(0)

spec = importlib.util.spec_from_file_location("vic", os.environ["VIC_MODULE"])
vic = importlib.util.module_from_spec(spec)
sys.modules["vic"] = vic
spec.loader.exec_module(vic)

cfg = json.loads((Path(os.environ["XDG_CONFIG_HOME"]) / "opencode" / "opencode.jsonc").read_text())
provider_id, block = next(iter(cfg["provider"].items()))
model_id, model = next(iter(block["models"].items()))
modalities = (model.get("modalities") or {}).get("input")
image_allowed = modalities != ["text"]
image = args[args.index("--file") + 1] if "--file" in args else None
seen = os.environ.get("VIC_SEEN")
if seen:
    with open(seen, "a") as handle:
        handle.write(
            json.dumps(
                {
                    "model": model_id,
                    "xdg": os.environ["XDG_CONFIG_HOME"],
                    "image": bool(image),
                    "has_oc_config": "OPENCODE_CONFIG" in os.environ,
                }
            )
            + "\n"
        )


def emit_text(text):
    print(json.dumps({"type": "text", "part": {"text": text}}))
    sys.exit(0)


def emit_error(status, message):
    print(
        json.dumps(
            {"type": "error", "error": {"type": "provider.invalid-request", "message": message, "status": status}}
        )
    )
    sys.exit(1)


if image is None:
    if model_id.startswith("bare404"):
        emit_error(404, "Not Found")
    if model_id.startswith("blocked"):
        emit_error(403, "Not authorized. model_blocked_globally")
    if model_id.startswith("nostream"):
        emit_error(400, "This model doesn't support tool use in streaming mode.")
    if model_id.startswith("auth403"):
        emit_error(403, "Not authorized.")
    if model_id.startswith("timeout"):
        time.sleep(5)
    if model_id.startswith("nocontrol"):
        emit_error(401, "unauthorized")
    emit_text("OK")

index = int(re.search(r"-(\d+)\.png$", image).group(1))
token = vic.make_tokens(os.environ["VIC_SEED"], model_id, 3)[index - 1]
if model_id == "leaky":
    emit_text(token)
if model_id == "rejecter" and image_allowed:
    emit_error(400, "image input is not supported")
if model_id == "blind":
    emit_text("ZZZZZZ")
if model_id == "verbose":
    emit_text(token if image_allowed else "I am unable to view images in this conversation. " * 60)
if model_id == "lateleak":
    emit_text(token if image_allowed else "I cannot see any image. " * 40 + token)
if model_id == "longall":
    emit_text("x" * 600)
if model_id == "longsecret":
    emit_text("I cannot see an image. " * 60 + "Bearer abcdefghijklmnop12345" if not image_allowed else token)
if model_id == "good":
    emit_text(token if image_allowed else "I cannot see any image")
emit_text("I cannot see any image")
