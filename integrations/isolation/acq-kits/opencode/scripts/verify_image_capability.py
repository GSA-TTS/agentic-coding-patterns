#!/usr/bin/env python3
"""Live synthetic-image capability verification for the OpenCode kit (host-run, stdlib only).

Implements docs/synthetic-image-validation.md. Run INSIDE a sandbox created from the release
bundle, where the USAi key is present only as the injected environment variable. For every model
in the rendered provider block it runs a text control, then N >= 3 independently generated
random-token PNGs in three throwaway configurations (modalities.input unset, ["text","image"],
["text"] as the negative control), classifies each reply, applies the decision rule, and writes
results.json, results.tsv and a rendered evidence Markdown file to an output directory.

Safety properties:
  * Read-only on the user's real OpenCode config. Probes use a throwaway XDG tree under the
    output directory, which is deleted on exit (including Ctrl-C / SIGTERM).
  * Never prints or stores the credential. The provider apiKey must be an `{env:NAME}`
    placeholder (a literal key stops the run); apiKey lines and any secret-like text are
    redacted from everything written.
  * `--dry-run` prints the plan (models, request count) and exits before any request is made.
  * Commits nothing: it produces CANDIDATE evidence for human review. It never edits
    catalog.json, schemas, or any capability value.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_VERSION = "1.0.0"
PROMPT_IMAGE = "Reply with only the characters shown in the image."
PROMPT_CONTROL = "Reply with only the word OK."
EXPECTED_HOST = "api.gsa.usai.gov"
DEFAULT_PROVIDER = "usai"
MIN_SAMPLES = 3
STEP_TIMEOUT = 300
MAX_REPLY_CHARS = 500
# The explicit text-only run is the negative control: a long, harmless refusal is the GOOD outcome there,
# so it gets a much larger stop cap; stored replies are still truncated to MAX_REPLY_CHARS.
MAX_CONTROL_REPLY_CHARS = 8000
MAX_CONSECUTIVE_CONTROL_FAILURES = 3
TOKEN_LEN = 6
# Unambiguous glyphs only (no 0/O, 1/I/L, 2/Z, 5/S, 8/B) so a misread is a model fault, not an OCR coin flip.
ALPHABET = "ACDEFGHJKMNPRTUVWXY3467" + "9"

# --- OpenCode CLI surface (read from `opencode run --help` / `opencode debug paths`, v2.0.30). -------
# If a future OpenCode changes these, edit here only. --standalone is required: without it `run`
# talks to the shared background service, which ignores the throwaway config.
RUN_FLAGS = ["run", "--standalone", "--format", "json"]
FILE_FLAG = "--file"
MODEL_FLAG = "--model"
# Project config and AGENTS.md are discovered by walking up from the cwd, and a project-level
# modalities override would silently defeat the configuration under test; the two DISABLE flags and
# OPENCODE_TEST_HOME (a private HOME) shut those layers off. Verified against a local stand-in
# gateway: with them, a worktree opencode.json no longer overrides an explicit ["text"] run.
ISOLATION_ENV = {
    "OPENCODE_DISABLE_MODELS_FETCH": "1",
    "OPENCODE_DISABLE_AUTOUPDATE": "1",
    "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
    "OPENCODE_DISABLE_CLAUDE_CODE": "1",
}
# Config-layering variables that would defeat the throwaway config; dropped from the child env.
STRIPPED_ENV = (
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CLI_CONFIG_CONTENT",
    "OPENCODE_DB",
    "OPENCODE_MODELS_PATH",
    "OPENCODE_MODELS_URL",
    "OPENCODE_API_KEY",
)
TESTED_OPENCODE = "2.0.30"

CONFIGS = (("unset", None), ("text-image", ["text", "image"]), ("text-only", ["text"]))
CORRECT, WRONG, REJECTED, ERROR = "Accepted-correct", "Accepted-wrong", "Rejected", "Error"
CLASSES = (CORRECT, WRONG, REJECTED, ERROR)

GLYPHS = {
    "A": "01110 10001 10001 11111 10001 10001 10001",
    "C": "01110 10001 10000 10000 10000 10001 01110",
    "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111",
    "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111",
    "H": "10001 10001 10001 11111 10001 10001 10001",
    "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001",
    "M": "10001 11011 10101 10101 10001 10001 10001",
    "N": "10001 10001 11001 10101 10011 10001 10001",
    "P": "11110 10001 10001 11110 10000 10000 10000",
    "R": "11110 10001 10001 11110 10100 10010 10001",
    "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110",
    "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 11011 10001",
    "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100",
    "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010",
    "6": "00110 01000 10000 11110 10001 10001 01110",
    "7": "11111 00001 00010 00100 01000 01000 01000",
    "9": "01110 10001 10001 01111 00001 00010 01100",
}
GLYPH_ROWS = {ch: rows.split() for ch, rows in GLYPHS.items()}
CANVAS = 256
SCALE = 7


class StopRun(Exception):
    """A procedure stop condition fired; the run halts and partial results are written."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


# --- synthetic image -------------------------------------------------------------------------------


def make_token(seed: str, model: str, index: int, attempt: int = 0) -> str:
    """Deterministic per (seed, model, index) token. Not cryptographic; it only has to be unguessable
    from the prompt and the model id, which never contain it."""
    digest = hashlib.sha256(f"{seed}|{model}|{index}|{attempt}".encode()).digest()
    return "".join(ALPHABET[b % len(ALPHABET)] for b in digest[:TOKEN_LEN])


def make_tokens(seed: str, model: str, count: int) -> list[str]:
    tokens: list[str] = []
    attempt = 0
    while len(tokens) < count:
        candidate = make_token(seed, model, len(tokens), attempt)
        attempt += 1
        if candidate not in tokens:
            tokens.append(candidate)
    return tokens


def render_pixels(token: str) -> list[bytearray]:
    """256x256 black-on-white rows (1 byte per pixel, 0 = black) with the token centred."""
    width = len(token) * 6 * SCALE - SCALE
    left, top = (CANVAS - width) // 2, (CANVAS - 7 * SCALE) // 2
    rows = [bytearray(b"\xff" * CANVAS) for _ in range(CANVAS)]
    for position, char in enumerate(token):
        for gy, bits in enumerate(GLYPH_ROWS[char]):
            for gx, bit in enumerate(bits):
                if bit == "1":
                    x0 = left + (position * 6 + gx) * SCALE
                    for dy in range(SCALE):
                        rows[top + gy * SCALE + dy][x0 : x0 + SCALE] = b"\x00" * SCALE
    return rows


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(token: str) -> bytes:
    """Minimal 8-bit RGB PNG writer (no PIL)."""
    raw = bytearray()
    for row in render_pixels(token):
        raw.append(0)
        for value in row:
            raw += bytes((value, value, value))
    header = struct.pack(">IIBBBBB", CANVAS, CANVAS, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


# --- JSONC, redaction, credential checks ----------------------------------------------------------


def strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas outside strings."""
    out: list[str] = []
    i, n, in_string = 0, len(text), False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
            out.append(ch)
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 1
        else:
            out.append(ch)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


SECRET_PATTERNS = (
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{12,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)
APIKEY_LINE = re.compile(r"(?im)^.*api[_-]?key.*$")
APIKEY_PAIR = re.compile(r"(?i)(api[_-]?key[\"']?\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|\S+)")
ENV_PLACEHOLDER = re.compile(r"^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$")
SECRET_KEY_NAME = re.compile(r"(?i)(authorization|token|secret|password|api[_-]?key)")


def redact(text: str, secret_values: tuple[str, ...] = ()) -> str:
    """Remove apiKey lines/pairs, secret-shaped strings, and any known secret value."""
    text = APIKEY_LINE.sub("[apiKey line removed]", text)
    text = APIKEY_PAIR.sub(r"\1[REDACTED]", text)
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    for value in secret_values:
        if len(value) >= 8:
            text = text.replace(value, "[REDACTED]")
    return text


def find_credential_exposure(block: dict) -> list[str]:
    """Paths of literal credentials in a provider block (anything other than an {env:NAME} placeholder)."""
    found: list[str] = []

    def walk(node: object, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                child = f"{path}.{key}" if path else key
                if isinstance(value, str) and SECRET_KEY_NAME.search(key) and not ENV_PLACEHOLDER.match(value):
                    found.append(child)
                else:
                    walk(value, child)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(block, "")
    return found


def check_host(block: dict, expected_host: str) -> str:
    base_url = (block.get("options") or {}).get("baseURL")
    parsed = urlparse(base_url) if isinstance(base_url, str) else None
    if not parsed or parsed.scheme != "https" or (parsed.hostname or "").lower() != expected_host.lower():
        raise StopRun("UNEXPECTED_HOST", f"provider baseURL host is not https://{expected_host}")
    return expected_host


def key_env_name(block: dict) -> str:
    match = ENV_PLACEHOLDER.match(str((block.get("options") or {}).get("apiKey", "")))
    if not match:
        raise StopRun("CREDENTIAL_EXPOSURE", "provider apiKey is not an {env:NAME} placeholder")
    return match.group(1)


def check_reply_content(reply: str, secret_values: tuple[str, ...], limit: int = MAX_REPLY_CHARS) -> None:
    """Stop condition: a reply that is oversize or carries secret-shaped data is not a token reply."""
    if len(reply) > limit:
        raise StopRun("UNEXPECTED_CONTENT", f"reply longer than {limit} characters")
    if redact(reply, secret_values) != reply:
        raise StopRun("UNEXPECTED_CONTENT", "reply contains credential-shaped data (withheld)")


# --- classification and decision rule --------------------------------------------------------------


@dataclass
class StepOutcome:
    kind: str  # reply | rejected | error
    text: str = ""
    detail: str = ""


@dataclass
class Sample:
    config: str
    index: int
    token: str
    reply: str
    classification: str
    detail: str = ""
    leaked: bool = False


@dataclass
class ModelResult:
    model: str
    facts: dict
    control_ok: bool = False
    control_detail: str = ""
    samples: list[Sample] = field(default_factory=list)
    skipped: str = ""
    unavailable: bool = False


def normalize_reply(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'`":
        text = text[1:-1].strip()
    return text


# A text-control failure is a per-model fact only when the gateway names the model itself (blocked, unknown,
# or lacking a feature OpenCode needs). Deliberately narrow: generic phrases such as "not supported" or
# "does not exist" also appear in credential and routing errors, which must stay run-level failures.
UNAVAILABLE_RE = re.compile(
    r"model[_ -]?blocked|blocked[_ -]?globally|model[_ -]?not[_ -]?found|unknown model"
    r"|model\b[^.]{0,60}\bdoes not exist|(?:does not|doesn['\u2019]?t) support tool use",
    re.IGNORECASE,
)


def control_unavailable(outcome: StepOutcome) -> bool:
    """True when a failed text control means this one model is unusable, so it is skipped, not a run-level fault.

    Never true for a 401, a timeout, a connection error, or a bare 4xx with no model-specific text.
    """
    if outcome.kind not in ("rejected", "error") or outcome.detail.startswith("HTTP 401"):
        return False
    return bool(UNAVAILABLE_RE.search(outcome.detail))


def classify(outcome: StepOutcome, token: str) -> str:
    if outcome.kind == "rejected":
        return REJECTED
    if outcome.kind == "error":
        return ERROR
    return CORRECT if normalize_reply(outcome.text) == token else WRONG


def decide(result: ModelResult, required: int = MIN_SAMPLES) -> tuple[bool, list[str]]:
    """Decision rule: `image` is a candidate only if every text-image sample is Accepted-correct and the
    text-only control never returned the token. Returns (qualifies, reasons it does not)."""
    reasons: list[str] = []
    if not result.control_ok:
        return (False, [result.skipped or "text control failed"])
    by_config = {name: [s for s in result.samples if s.config == name] for name, _ in CONFIGS}
    unset, explicit, control = by_config["unset"], by_config["text-image"], by_config["text-only"]
    if len(unset) < required:
        reasons.append(f"fewer than {required} unset samples")
    if len(explicit) < required:
        reasons.append(f"fewer than {required} text-image samples")
    reasons += [
        f"text-image sample {s.index + 1} was {s.classification}" for s in explicit if s.classification != CORRECT
    ]
    if len(control) < required:
        reasons.append(f"fewer than {required} text-only control samples")
    if any(s.leaked for s in control):
        reasons.append("text-only control returned the token (harness invalid)")
    elif any(s.classification != WRONG for s in control):
        reasons.append("text-only control not established (a sample was not a plain non-token reply)")
    return (not reasons, reasons)


def summarize(results: list[ModelResult], required: int = MIN_SAMPLES) -> dict:
    counts = {name: dict.fromkeys(CLASSES, 0) for name, _ in CONFIGS}
    for result in results:
        for sample in result.samples:
            counts[sample.config][sample.classification] += 1
    qualifying = [r.model for r in results if decide(r, required)[0]]
    leaks = sum(1 for r in results for s in r.samples if s.config == "text-only" and s.leaked)
    skipped = [r.model for r in results if r.unavailable]
    return {
        "models": len(results),
        "qualifying": qualifying,
        "counts": counts,
        "text_only_token_leaks": leaks,
        "skipped_unavailable": skipped,
    }


# --- running OpenCode ------------------------------------------------------------------------------

_active: dict[str, subprocess.Popen | None] = {"proc": None}


class Interrupted(Exception):
    """SIGINT/SIGTERM received; partial results are still written."""


def parse_events(stdout: str) -> list[dict]:
    events: list[dict] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            events.append(value)
    return events


def interpret_run(returncode: int | None, stdout: str, timed_out: bool = False) -> StepOutcome:
    """Turn one `opencode run --format json` result into a reply, a rejection, or an error.

    Shapes observed offline against a local stand-in gateway (OpenCode 2.0.30): success emits
    {"type":"text","part":{"text":...}} events and exits 0; an upstream HTTP error emits
    {"type":"error","error":{"type":...,"message":...,"status":N}} and exits non-zero.
    """
    if timed_out:
        return StepOutcome("error", detail="timeout")
    events = parse_events(stdout)
    errors = [e.get("error") for e in events if e.get("type") == "error" and isinstance(e.get("error"), dict)]
    if errors:
        err = errors[0]
        status = err.get("status") if isinstance(err.get("status"), int) else None
        detail = f"{err.get('type', 'error')}: {err.get('message', '')}".strip()
        if status is not None:
            detail = f"HTTP {status} {detail}"
        # Auth, timeout and rate-limit statuses are routing/availability problems, not a capability answer.
        if status is not None and 400 <= status < 500 and status not in (401, 403, 408, 429):
            return StepOutcome("rejected", detail=detail)
        return StepOutcome("error", detail=detail)
    texts = []
    for event in events:
        part = event.get("part")
        if event.get("type") == "text" and isinstance(part, dict) and isinstance(part.get("text"), str):
            texts.append(part["text"])
    if returncode == 0 and texts:
        return StepOutcome("reply", text="".join(texts))
    if returncode == 0:
        return StepOutcome("error", detail="exit 0 with no text reply")
    return StepOutcome("error", detail=f"exit {returncode} with no error event")


def run_step(
    opencode: str, model_ref: str, prompt: str, image: Path | None, env: dict, cwd: Path, timeout: int
) -> StepOutcome:
    argv = [opencode, *RUN_FLAGS, MODEL_FLAG, model_ref]
    if image is not None:
        argv += [FILE_FLAG, str(image)]
    argv.append(prompt)
    try:
        proc = subprocess.Popen(  # noqa: S603 - argv list, no shell
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            errors="replace",
            start_new_session=True,
        )
    except OSError as exc:
        return StepOutcome("error", detail=f"cannot start opencode: {exc.__class__.__name__}")
    _active["proc"] = proc
    try:
        stdout, _ = proc.communicate(timeout=timeout)
        return interpret_run(proc.returncode, stdout)
    except subprocess.TimeoutExpired:
        kill_group(proc)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.communicate(timeout=10)
        return interpret_run(None, "", timed_out=True)
    finally:
        _active["proc"] = None
        if proc.poll() is None:
            kill_group(proc)


def kill_group(proc: subprocess.Popen) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)


def _raise_interrupted(signum: int, _frame: object) -> None:
    proc = _active["proc"]
    if proc is not None:
        kill_group(proc)
    raise Interrupted(signal.Signals(signum).name)


# --- throwaway configuration ----------------------------------------------------------------------


def load_provider_block(config_path: Path, provider: str) -> dict:
    """Read the rendered provider block. The raw text is never printed."""
    try:
        config = json.loads(strip_jsonc(config_path.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:
        raise StopRun("NO_CONFIG", f"cannot read rendered OpenCode config ({exc.__class__.__name__})") from exc
    block = (config.get("provider") or {}).get(provider)
    if not isinstance(block, dict) or not isinstance(block.get("models"), dict) or not block["models"]:
        raise StopRun("NO_CONFIG", f"no models under provider '{provider}' in the rendered config")
    return block


def config_facts(model: dict) -> dict:
    """Step 1: record whether modalities.input and reasoning are present (never the apiKey)."""
    modalities = model.get("modalities") if isinstance(model.get("modalities"), dict) else {}
    return {"modalities.input": modalities.get("input"), "reasoning": model.get("reasoning")}


def build_probe_config(provider: str, block: dict, model_id: str, modalities: list[str] | None) -> dict:
    """Single-model provider block with modalities forced to the configuration under test.

    The result keeps the `{env:NAME}` apiKey placeholder; the secret itself only reaches the child
    process through its inherited environment. Tools and project instructions are denied so a probe
    cannot read files or load project context.
    """
    probe = copy.deepcopy(block)
    model = copy.deepcopy(probe["models"][model_id])
    model.pop("modalities", None)
    if modalities is not None:
        model["modalities"] = {"input": list(modalities), "output": ["text"]}
    probe["models"] = {model_id: model}
    return {
        "$schema": "https://opencode.ai/config.json",
        "enabled_providers": [provider],
        "instructions": [],
        "permission": {"edit": "deny", "bash": "deny", "read": "deny", "webfetch": "deny", "websearch": "deny"},
        "provider": {provider: probe},
    }


def isolated_env(base: dict, root: Path) -> dict:
    env = {k: v for k, v in base.items() if k not in STRIPPED_ENV}
    env.update(ISOLATION_ENV)
    env.update(
        XDG_CONFIG_HOME=str(root / "config"),
        XDG_DATA_HOME=str(root / "data"),
        XDG_STATE_HOME=str(root / "state"),
        XDG_CACHE_HOME=str(root / "cache"),
        OPENCODE_TEST_HOME=str(root / "home"),
    )
    return env


def write_probe_tree(work: Path, name: str, config: dict) -> Path:
    root = work / name
    for sub in ("config/opencode", "data", "state", "cache", "home"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    path = root / "config" / "opencode" / "opencode.jsonc"
    path.write_text(json.dumps(config), encoding="utf-8")
    path.chmod(0o600)
    return root


# --- orchestration ---------------------------------------------------------------------------------


def safe_name(model_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", model_id)


def utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def opencode_version(opencode: str) -> str:
    try:
        done = subprocess.run(  # noqa: S603 - argv list, no shell
            [opencode, "--version"], capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StopRun("NO_OPENCODE", f"cannot run '{opencode} --version' ({exc.__class__.__name__})") from exc
    match = re.search(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", done.stdout)
    if done.returncode != 0 or not match:
        raise StopRun("NO_OPENCODE", "could not determine the OpenCode version")
    return match.group(0)


@dataclass
class Settings:
    opencode: str
    provider: str
    block: dict
    key_env: str
    secret: tuple[str, ...]
    work: Path
    base_env: dict
    samples: int
    timeout: int
    seed: str
    status: Callable[[str], None] = print


def probe_step(
    cfg: Settings,
    tree: Path,
    cwd: Path,
    model_id: str,
    prompt: str,
    image: Path | None,
    limit: int = MAX_REPLY_CHARS,
) -> StepOutcome:
    outcome = run_step(
        cfg.opencode,
        f"{cfg.provider}/{model_id}",
        prompt,
        image,
        isolated_env(cfg.base_env, tree),
        cwd,
        cfg.timeout,
    )
    if outcome.kind == "reply":
        check_reply_content(outcome.text, cfg.secret, limit)
        outcome.text = outcome.text.strip()
    outcome.detail = redact(outcome.detail, cfg.secret)[:MAX_REPLY_CHARS]
    return outcome


def verify_model(cfg: Settings, model_id: str, cwd: Path, images: Path, results: list[ModelResult]) -> ModelResult:
    result = ModelResult(model=model_id, facts=config_facts(cfg.block["models"][model_id]))
    results.append(result)
    trees = {}
    for name, modalities in CONFIGS:
        trees[name] = write_probe_tree(
            cfg.work, f"{safe_name(model_id)}-{name}", build_probe_config(cfg.provider, cfg.block, model_id, modalities)
        )
    try:
        control = probe_step(cfg, trees["unset"], cwd, model_id, PROMPT_CONTROL, None)
        result.control_ok = control.kind == "reply" and bool(control.text)
        result.control_detail = control.text[:80] if result.control_ok else (control.detail or control.kind)
        if not result.control_ok:
            result.unavailable = control_unavailable(control)
            label = "SKIPPED (unavailable)" if result.unavailable else "text control failed"
            result.skipped = f"{label}: {result.control_detail}"
            return result
        tokens = make_tokens(cfg.seed, model_id, cfg.samples)
        paths = []
        for index, token in enumerate(tokens):
            path = images / f"{safe_name(model_id)}-{index + 1}.png"
            path.write_bytes(png_bytes(token))
            paths.append(path)
        for name, _ in CONFIGS:
            for index, (token, path) in enumerate(zip(tokens, paths, strict=True)):
                limit = MAX_CONTROL_REPLY_CHARS if name == "text-only" else MAX_REPLY_CHARS
                outcome = probe_step(cfg, trees[name], cwd, model_id, PROMPT_IMAGE, path, limit)
                sample = Sample(name, index, token, outcome.text, classify(outcome, token), outcome.detail)
                sample.leaked = outcome.kind == "reply" and token.lower() in outcome.text.lower()
                sample.reply = sample.reply[:MAX_REPLY_CHARS]
                result.samples.append(sample)
                cfg.status(f"  {name} #{index + 1}: {sample.classification}")
                if name == "text-only" and sample.leaked:
                    raise StopRun("NEGATIVE_CONTROL_LEAK", f"{model_id}: explicit text-only returned the token")
        return result
    finally:
        for tree in trees.values():
            shutil.rmtree(tree, ignore_errors=True)


def run_all(cfg: Settings, models: list[str], cwd: Path, images: Path, results: list[ModelResult]) -> None:
    consecutive_control_failures = 0
    for number, model_id in enumerate(models, start=1):
        cfg.status(f"[{number}/{len(models)}] {model_id}")
        result = verify_model(cfg, model_id, cwd, images, results)
        if result.unavailable:
            continue
        consecutive_control_failures = 0 if result.control_ok else consecutive_control_failures + 1
        if consecutive_control_failures >= MAX_CONSECUTIVE_CONTROL_FAILURES:
            raise StopRun(
                "CONTROL_FAILING",
                f"{consecutive_control_failures} consecutive models failed the text control (auth or routing?)",
            )
    if results and not any(r.control_ok for r in results):
        raise StopRun("CONTROL_FAILING", "no model passed the text control (auth, routing, or provider-wide fault?)")


# --- outputs ----------------------------------------------------------------------------------------


def cell(text: object) -> str:
    return re.sub(r"\s+", " ", str(text)).replace("|", "\\|").replace("`", "'").strip()


def tsv_field(text: object) -> str:
    return re.sub(r"[\t\r\n]+", " ", str(text))


def model_record(result: ModelResult, required: int = MIN_SAMPLES) -> dict:
    qualifies, reasons = decide(result, required)
    return {
        "model": result.model,
        "config_facts": result.facts,
        "text_control_ok": result.control_ok,
        "text_control_detail": result.control_detail,
        "skipped": result.skipped,
        "skipped_unavailable": result.unavailable,
        "candidate_image": qualifies,
        "reasons_not_candidate": reasons,
        "samples": [
            {
                "config": s.config,
                "index": s.index + 1,
                "token": s.token,
                "reply": s.reply,
                "classification": s.classification,
                "detail": s.detail,
                "token_in_reply": s.leaked,
            }
            for s in result.samples
        ],
    }


INVALIDATING_STOPS = ("NEGATIVE_CONTROL_LEAK", "UNEXPECTED_CONTENT")


def build_document(meta: dict, results: list[ModelResult]) -> dict:
    required = max(int(meta.get("samples", MIN_SAMPLES)), MIN_SAMPLES)
    records = [model_record(r, required) for r in results]
    summary = summarize(results, required)
    if any(code in str(meta.get("stopped", "")) for code in INVALIDATING_STOPS):
        # The harness itself is in doubt, so nothing from this run may be treated as a candidate.
        for record in records:
            if record["candidate_image"]:
                record["candidate_image"] = False
                record["reasons_not_candidate"].append("run invalidated by a harness stop condition")
        summary["qualifying"] = []
    return {**meta, "summary": summary, "models": records}


def tsv_text(document: dict) -> str:
    header = ["model", "config", "sample", "token", "classification", "reply", "detail", "opencode_version", "date"]
    lines = ["\t".join(header)]
    for model in document["models"]:
        if not model["samples"]:
            lines.append(
                "\t".join(
                    tsv_field(v)
                    for v in (
                        model["model"],
                        "text-control",
                        0,
                        "",
                        "Error",
                        "",
                        model["skipped"],
                        document["opencode_version"],
                        document["date"],
                    )
                )
            )
        for s in model["samples"]:
            row = (
                model["model"],
                s["config"],
                s["index"],
                s["token"],
                s["classification"],
                s["reply"],
                s["detail"],
                document["opencode_version"],
                document["date"],
            )
            lines.append("\t".join(tsv_field(v) for v in row))
    return "\n".join(lines) + "\n"


def replies_cell(model: dict, config: str) -> str:
    parts = []
    for s in model["samples"]:
        if s["config"] == config:
            shown = s["reply"] if s["reply"] else (s["detail"] or "(none)")
            parts.append(f"{s['index']}: '{cell(shown)}' [{s['classification']}]")
    return "<br>".join(parts) or "(not run)"


def fact_cell(value: object) -> str:
    return "absent" if value is None else cell(json.dumps(value))


def evidence_markdown(document: dict) -> str:
    version, date = document["opencode_version"], document["date"]
    lines = [
        f"# Synthetic-image capability evidence: OpenCode {version}, {date}",
        "",
        "**Status:** CANDIDATE evidence produced by `scripts/verify_image_capability.py`. It has not been reviewed.",
        "A human must check every row before any value is committed. It substantiates image input only",
        "(not `reasoning`, `audio`, `video`, or `pdf`). Rows marked `no` stay absent (unknown).",
        "",
        "- Procedure: `synthetic-image-validation.md` "
        f"(script v{document['script_version']}); samples per configuration: {document['samples']}.",
        f"- Provider `{document['provider']}`, host `{document['host']}`; run id (token seed): `{document['seed']}`.",
        "- Tokens are random per run and per model; each image shows a six-character token;",
        "  the same images were used in all three configurations.",
        "- Replies are verbatim, capped, and redacted. This file holds no credentials or raw transcripts.",
        "",
    ]
    if document.get("stopped"):
        lines += [f"**Run stopped early:** `{cell(document['stopped'])}`. Results below are partial.", ""]
    lines += [
        "| Model | Field | Value | OpenCode | Date | Step-1 config (modalities.input / reasoning) | Text control "
        "| Unset | Explicit text+image | Explicit text-only (negative control) | Candidate |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for model in document["models"]:
        facts = model["config_facts"]
        step1 = f"{fact_cell(facts.get('modalities.input'))} / {fact_cell(facts.get('reasoning'))}"
        failure = cell(model["skipped"] or model["text_control_detail"])
        control = (
            "ok" if model["text_control_ok"] else (failure if model["skipped_unavailable"] else f"FAILED: {failure}")
        )
        decision = "yes" if model["candidate_image"] else "no: " + cell("; ".join(model["reasons_not_candidate"]))
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{cell(model['model'])}`",
                    "inputModalities",
                    "image",
                    version,
                    date,
                    step1,
                    control,
                    replies_cell(model, "unset"),
                    replies_cell(model, "text-image"),
                    replies_cell(model, "text-only"),
                    decision,
                ]
            )
            + " |"
        )
    summary = document["summary"]
    lines += [
        "",
        f"Candidates for `image`: {len(summary['qualifying'])} of {summary['models']}: "
        + (", ".join(f"`{m}`" for m in summary["qualifying"]) or "none"),
        "",
    ]
    return "\n".join(lines)


def result_line(document: dict, outdir: Path) -> str:
    counts = document["summary"]["counts"]
    skipped = document["summary"].get("skipped_unavailable", [])
    parts = ["RESULT"]
    for name, _ in CONFIGS:
        c = counts[name]
        parts.append(f"{name}=correct:{c[CORRECT]}/wrong:{c[WRONG]}/rejected:{c[REJECTED]}/error:{c[ERROR]}")
    parts += [
        f"models={document['summary']['models']}",
        f"candidates={len(document['summary']['qualifying'])}",
        f"token_leaks={document['summary']['text_only_token_leaks']}",
        f"skipped={len(skipped)}" + (f"({','.join(skipped)})" if skipped else ""),
        f"stopped={document.get('stopped') or 'no'}",
        f"opencode={document['opencode_version']}",
        f"date={document['date']}",
        f"dir={outdir}",
    ]
    return " ".join(parts)


def write_outputs(outdir: Path, document: dict) -> None:
    for name, content in (
        ("results.json", json.dumps(document, indent=2) + "\n"),
        ("results.tsv", tsv_text(document)),
        ("evidence.md", evidence_markdown(document)),
    ):
        path = outdir / name
        path.write_text(content, encoding="utf-8")
        path.chmod(0o600)


# --- main -------------------------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output-dir", help="default: <cwd>/tmp/image-verification-<UTC stamp>")
    parser.add_argument("--config", default=str(Path.home() / ".config/opencode/opencode.jsonc"))
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--expected-host", default=EXPECTED_HOST)
    parser.add_argument("--opencode", default="opencode", help="OpenCode binary to drive")
    parser.add_argument(
        "--samples", type=int, default=MIN_SAMPLES, help=f"images per configuration (min {MIN_SAMPLES})"
    )
    parser.add_argument("--timeout", type=int, default=STEP_TIMEOUT, help="per-step timeout, seconds")
    parser.add_argument("--models", help="comma-separated subset of model ids (default: all in the rendered block)")
    parser.add_argument("--seed", help="token seed (default: random); a fixed seed reproduces the same tokens")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and exit before any request")
    args = parser.parse_args(argv)
    if args.samples < MIN_SAMPLES:
        parser.error(f"--samples must be at least {MIN_SAMPLES} (the procedure requires repeated independent images)")
    if args.timeout < 1:
        parser.error("--timeout must be positive")
    return args


def select_models(block: dict, subset: str | None) -> list[str]:
    available = list(block["models"])
    if not subset:
        return available
    wanted = [m.strip() for m in subset.split(",") if m.strip()]
    unknown = [m for m in wanted if m not in block["models"]]
    if unknown:
        raise StopRun("NO_CONFIG", f"models not in the rendered block: {', '.join(unknown)}")
    return wanted


def say(message: str) -> None:
    print(message, flush=True)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    stamp = utc_stamp()
    outdir = Path(args.output_dir) if args.output_dir else Path.cwd() / "tmp" / f"image-verification-{stamp}"
    outdir = outdir.resolve()
    results: list[ModelResult] = []
    meta = {
        "script_version": SCRIPT_VERSION,
        "date": datetime.now(UTC).strftime("%Y-%m-%d"),
        "provider": args.provider,
        "samples": args.samples,
        "seed": args.seed or hashlib.sha256(os.urandom(16)).hexdigest()[:12],
        "opencode_version": "unknown",
        "host": args.expected_host,
        "stopped": "",
    }
    work: Path | None = None
    old_handlers = {s: signal.signal(s, _raise_interrupted) for s in (signal.SIGINT, signal.SIGTERM)}
    code = 0
    try:
        meta["opencode_version"] = opencode_version(args.opencode)
        if meta["opencode_version"] != TESTED_OPENCODE:
            say(f"warning: isolation flags were checked on OpenCode {TESTED_OPENCODE}, not {meta['opencode_version']}")
        block = load_provider_block(Path(args.config), args.provider)
        exposed = find_credential_exposure(block)
        if exposed:
            raise StopRun("CREDENTIAL_EXPOSURE", "literal credential in rendered config at: " + ", ".join(exposed))
        check_host(block, args.expected_host)
        key_env = key_env_name(block)
        secret_value = os.environ.get(key_env, "")
        if not secret_value:
            raise StopRun("CREDENTIAL_EXPOSURE", f"{key_env} is not set in this environment (run inside the sandbox)")
        models = select_models(block, args.models)
        requests = len(models) * (1 + 3 * args.samples)
        say(
            f"plan: {len(models)} models x ({args.samples} images x 3 configurations + 1 text control)"
            f" = {requests} requests"
        )
        say(f"opencode {meta['opencode_version']}; provider {args.provider}; output {outdir}")
        if args.dry_run:
            say("dry run: no requests made")
            return 0
        outdir.mkdir(parents=True, exist_ok=True)
        outdir.chmod(0o700)
        # Owned scratch dir: unique per run, created only after preflight, and the only thing cleanup removes.
        work = Path(tempfile.mkdtemp(prefix=".work-", dir=outdir))
        cwd, images = work / "cwd", work / "images"
        for directory in (cwd, images):
            directory.mkdir(parents=True, exist_ok=True)
        cfg = Settings(
            args.opencode,
            args.provider,
            block,
            key_env,
            (secret_value,),
            work,
            dict(os.environ),
            args.samples,
            args.timeout,
            meta["seed"],
            say,
        )
        run_all(cfg, models, cwd, images, results)
    except StopRun as stop:
        meta["stopped"] = str(stop)
        say(f"STOP {stop}")
        code = 2
    except Interrupted as sig:
        meta["stopped"] = f"INTERRUPTED: {sig}"
        say(f"STOP interrupted ({sig}); writing partial results")
        code = 130
    finally:
        for sig_number, handler in old_handlers.items():
            signal.signal(sig_number, handler)
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)
    outdir.mkdir(parents=True, exist_ok=True)
    outdir.chmod(0o700)
    document = build_document(meta, results)
    write_outputs(outdir, document)
    say(result_line(document, outdir))
    return code


if __name__ == "__main__":
    sys.exit(main())
