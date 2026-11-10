"""Offline tests for the live image-capability verification script.

Pure logic is tested directly; orchestration runs against a stand-in `opencode`
(fixtures/fake_opencode.py). No network, no credentials, no real model.
"""

import importlib.util
import json
import os
import stat
import struct
import sys
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "integrations/isolation/acq-kits/opencode/scripts/verify_image_capability.py"
FAKE = Path(__file__).resolve().parent / "fixtures" / "fake_opencode.py"
SPEC = importlib.util.spec_from_file_location("verify_image_capability", SCRIPT)
v = importlib.util.module_from_spec(SPEC)
sys.modules["verify_image_capability"] = v
SPEC.loader.exec_module(v)

FAKE_SECRET = "zz-not-a-real-key-0123456789abcdef"  # noqa: S105


def outcome(kind="reply", text="", detail=""):
    return v.StepOutcome(kind, text, detail)


def sample(config, index, classification, token="ABCDEF", leaked=False):  # noqa: S107
    return v.Sample(config, index, token, "", classification, leaked=leaked)


def full_result(explicit=(v.CORRECT,) * 3, control_leak=False, control_ok=True):
    result = v.ModelResult("m", {}, control_ok=control_ok)
    for name, _ in v.CONFIGS:
        for i in range(3):
            if name == "text-image":
                result.samples.append(sample(name, i, explicit[i]))
            elif name == "text-only":
                result.samples.append(sample(name, i, v.WRONG, leaked=control_leak))
            else:
                result.samples.append(sample(name, i, v.CORRECT))
    return result


# --- token and PNG generation ---------------------------------------------------------------------


def test_tokens_are_deterministic_by_seed_and_distinct():
    a = v.make_tokens("seed1", "model-a", 5)
    assert a == v.make_tokens("seed1", "model-a", 5)
    assert a != v.make_tokens("seed2", "model-a", 5)
    assert a != v.make_tokens("seed1", "model-b", 5)
    assert len(set(a)) == 5
    assert all(len(t) == v.TOKEN_LEN and set(t) <= set(v.ALPHABET) for t in a)


def test_alphabet_has_a_glyph_for_every_character():
    assert set(v.ALPHABET) <= set(v.GLYPH_ROWS)
    assert all(len(rows) == 7 and all(len(r) == 5 for r in rows) for rows in v.GLYPH_ROWS.values())


def test_png_is_valid_deterministic_and_token_dependent():
    data = v.png_bytes("ACD349")
    assert data == v.png_bytes("ACD349")
    assert data != v.png_bytes("ACD34K")
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    pos, chunks = 8, []
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length : pos + 12 + length])
        assert crc == zlib.crc32(kind + body) & 0xFFFFFFFF
        chunks.append((kind, body))
        pos += 12 + length
    assert [k for k, _ in chunks] == [b"IHDR", b"IDAT", b"IEND"]
    width, height = struct.unpack(">II", chunks[0][1][:8])
    assert (width, height) == (256, 256)
    raw = zlib.decompress(chunks[1][1])
    assert len(raw) == 256 * (1 + 256 * 3)
    assert b"\x00\x00\x00" in raw and b"\xff\xff\xff" in raw


# --- classification and decision rule -------------------------------------------------------------


def test_classification_three_ways():
    assert v.classify(outcome(text="ACD349"), "ACD349") == v.CORRECT
    assert v.classify(outcome(text="  `ACD349`\n"), "ACD349") == v.CORRECT
    assert v.classify(outcome(text="ACD34K"), "ACD349") == v.WRONG
    assert v.classify(outcome(text="The characters are ACD349"), "ACD349") == v.WRONG
    assert v.classify(outcome("rejected", detail="HTTP 400"), "ACD349") == v.REJECTED
    assert v.classify(outcome("error", detail="timeout"), "ACD349") == v.ERROR


def test_interpret_run_shapes():
    ok = '{"type":"step_start"}\n{"type":"text","part":{"text":"AB"}}\n{"type":"text","part":{"text":"CD"}}\n'
    assert v.interpret_run(0, ok) == outcome(text="ABCD")
    err = '{"type":"error","error":{"type":"provider.invalid-request","message":"no images","status":400}}\n'
    assert v.interpret_run(1, err).kind == "rejected"
    for status in (401, 403, 408, 429, 500, 502):
        body = json.dumps({"type": "error", "error": {"type": "x", "message": "m", "status": status}})
        assert v.interpret_run(1, body).kind == "error", status
    assert v.interpret_run(0, "").kind == "error"
    assert v.interpret_run(2, "garbage").kind == "error"
    assert v.interpret_run(None, "", timed_out=True).detail == "timeout"


def test_decision_rule_requires_every_sample_correct_and_clean_control():
    assert v.decide(full_result()) == (True, [])
    ok, reasons = v.decide(full_result(explicit=(v.CORRECT, v.WRONG, v.CORRECT)))
    assert not ok and any("sample 2 was Accepted-wrong" in r for r in reasons)
    ok, reasons = v.decide(full_result(explicit=(v.CORRECT, v.CORRECT, v.REJECTED)))
    assert not ok and any("Rejected" in r for r in reasons)
    ok, reasons = v.decide(full_result(control_leak=True))
    assert not ok and any("control returned the token" in r for r in reasons)
    ok, _ = v.decide(full_result(control_ok=False))
    assert not ok


def test_text_only_control_must_be_established_not_just_error():
    result = full_result()
    for s in result.samples:
        if s.config == "text-only":
            s.classification = v.ERROR
    ok, reasons = v.decide(result)
    assert not ok and any("not established" in r for r in reasons)


def test_harness_stop_invalidates_all_candidates():
    meta = {"script_version": "1", "date": "d", "provider": "p", "samples": 3, "seed": "s", "opencode_version": "1"}
    meta["host"] = "h"
    ok = v.build_document({**meta, "stopped": ""}, [full_result()])
    assert ok["summary"]["qualifying"] == ["m"]
    bad = v.build_document({**meta, "stopped": "NEGATIVE_CONTROL_LEAK: x"}, [full_result()])
    assert bad["summary"]["qualifying"] == [] and bad["models"][0]["candidate_image"] is False


def test_decision_rule_needs_enough_samples():
    result = v.ModelResult("m", {}, control_ok=True)
    result.samples = [sample("text-image", 0, v.CORRECT)]
    ok, reasons = v.decide(result)
    assert not ok and any("fewer than 3" in r for r in reasons)


def test_summary_counts_and_qualifying_models():
    good, bad = full_result(), full_result(explicit=(v.WRONG,) * 3)
    bad.model = "bad"
    summary = v.summarize([good, bad])
    assert summary["qualifying"] == ["m"]
    assert summary["counts"]["text-image"][v.CORRECT] == 3
    assert summary["counts"]["text-image"][v.WRONG] == 3


# --- redaction, credential and host stop conditions -----------------------------------------------


def test_redaction_removes_apikey_lines_and_secret_shapes():
    text = 'a\n"apiKey": "' + FAKE_SECRET + '",\nb Bearer abcdefghijklmnop12345\nsk-abcdefghijklmnopqrstu\n'
    cleaned = v.redact(text, (FAKE_SECRET,))
    assert FAKE_SECRET not in cleaned and "Bearer abc" not in cleaned and "sk-abc" not in cleaned
    assert "apiKey line removed" in cleaned
    assert v.redact("tok " + FAKE_SECRET, (FAKE_SECRET,)) == "tok [REDACTED]"
    assert v.redact('api_key = "' + FAKE_SECRET + '"') == "[apiKey line removed]"


def test_credential_exposure_detection():
    clean = {"options": {"apiKey": "{env:USAI_API_KEY}", "headers": {"X-Agent-Type": "opencode"}}}
    assert v.find_credential_exposure(clean) == []
    assert v.key_env_name(clean) == "USAI_API_KEY"
    literal = {"options": {"apiKey": FAKE_SECRET}}
    assert v.find_credential_exposure(literal) == ["options.apiKey"]
    with pytest.raises(v.StopRun) as stop:
        v.key_env_name(literal)
    assert stop.value.code == "CREDENTIAL_EXPOSURE"
    assert FAKE_SECRET not in str(stop.value)
    nested = {"options": {"headers": {"Authorization": "Bearer " + FAKE_SECRET}}}
    assert v.find_credential_exposure(nested) == ["options.headers.Authorization"]


def test_unexpected_host_stops():
    good = {"options": {"baseURL": "https://api.gsa.usai.gov/api/v1"}}
    assert v.check_host(good, "api.gsa.usai.gov") == "api.gsa.usai.gov"
    for url in (
        "https://evil.example/api/v1",
        "http://api.gsa.usai.gov/api/v1",
        "https://api.gsa.usai.gov.evil.test/",
        None,
    ):
        with pytest.raises(v.StopRun) as stop:
            v.check_host({"options": {"baseURL": url}}, "api.gsa.usai.gov")
        assert stop.value.code == "UNEXPECTED_HOST"


def test_unexpected_reply_content_stops():
    with pytest.raises(v.StopRun) as stop:
        v.check_reply_content("x" * 501, ())
    assert stop.value.code == "UNEXPECTED_CONTENT"
    with pytest.raises(v.StopRun):
        v.check_reply_content("Bearer abcdefghijklmnop12345", ())
    with pytest.raises(v.StopRun):
        v.check_reply_content("leak " + FAKE_SECRET, (FAKE_SECRET,))
    v.check_reply_content("ACD349", (FAKE_SECRET,))


# --- config handling ------------------------------------------------------------------------------


def test_strip_jsonc_handles_comments_and_trailing_commas():
    text = '{ // c\n "a": "x//y", /* b */ "b": [1, 2,], }'
    assert json.loads(v.strip_jsonc(text)) == {"a": "x//y", "b": [1, 2]}


def test_probe_config_forces_modalities_and_keeps_placeholder_only():
    block = {
        "npm": "@ai-sdk/openai-compatible",
        "options": {"baseURL": "https://api.gsa.usai.gov/api/v1", "apiKey": "{env:USAI_API_KEY}"},
        "models": {"a": {"name": "A", "modalities": {"input": ["text", "audio"]}}, "b": {"name": "B"}},
    }
    unset = v.build_probe_config("usai", block, "a", None)
    assert "modalities" not in unset["provider"]["usai"]["models"]["a"]
    assert list(unset["provider"]["usai"]["models"]) == ["a"]
    both = v.build_probe_config("usai", block, "b", ["text", "image"])
    assert both["provider"]["usai"]["models"]["b"]["modalities"]["input"] == ["text", "image"]
    only = v.build_probe_config("usai", block, "b", ["text"])
    assert only["provider"]["usai"]["models"]["b"]["modalities"]["input"] == ["text"]
    assert "modalities" not in block["models"]["b"]
    assert only["permission"]["bash"] == "deny" and only["instructions"] == []
    assert only["provider"]["usai"]["options"]["apiKey"] == "{env:USAI_API_KEY}"


def test_isolated_env_drops_config_overrides_and_points_xdg_at_tree(tmp_path):
    env = v.isolated_env({"PATH": "/bin", "OPENCODE_CONFIG": "/real", "HOME": "/h"}, tmp_path)
    assert "OPENCODE_CONFIG" not in env and env["PATH"] == "/bin"
    assert env["XDG_CONFIG_HOME"] == str(tmp_path / "config")
    assert env["OPENCODE_TEST_HOME"] == str(tmp_path / "home")
    assert env["OPENCODE_DISABLE_PROJECT_CONFIG"] == "1" and env["OPENCODE_DISABLE_CLAUDE_CODE"] == "1"


# --- rendering ------------------------------------------------------------------------------------


def document(results, stopped=""):
    meta = {
        "script_version": v.SCRIPT_VERSION,
        "date": "2026-11-04",
        "provider": "usai",
        "samples": 3,
        "seed": "abc123",
        "opencode_version": "2.0.30",
        "host": "api.gsa.usai.gov",
        "stopped": stopped,
    }
    return v.build_document(meta, results)


def test_evidence_table_and_tsv_and_result_line(tmp_path):
    good = full_result()
    good.model = "good|model"
    good.facts = {"modalities.input": None, "reasoning": None}
    for s in good.samples:
        s.reply = "ABC\nDEF" if s.config == "unset" else s.token
    doc = document([good, v.ModelResult("dead", {}, skipped="text control failed: HTTP 401")])
    md = v.evidence_markdown(doc)
    assert "OpenCode 2.0.30, 2026-11-04" in md and "good\\|model" in md and "ABC DEF" in md
    assert "absent / absent" in md and "CANDIDATE" in md and "FAILED" in md
    assert md.count("\n| `") == 2
    tsv = v.tsv_text(doc).splitlines()
    assert tsv[0].split("\t")[:3] == ["model", "config", "sample"]
    assert all(len(line.split("\t")) == 9 for line in tsv)
    line = v.result_line(doc, tmp_path)
    assert line.startswith("RESULT ") and "opencode=2.0.30" in line and "date=2026-11-04" in line
    assert "candidates=1" in line and f"dir={tmp_path}" in line and "\n" not in line


def test_partial_run_is_labeled_in_evidence():
    md = v.evidence_markdown(document([], stopped="STOP: x"))
    assert "Run stopped early" in md


# --- orchestration against a stand-in opencode ----------------------------------------------------


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    fake = tmp_path / "opencode"
    fake.write_text(f"#!{sys.executable}\n" + FAKE.read_text().split("\n", 1)[1])
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("VIC_MODULE", str(SCRIPT))
    monkeypatch.setenv("VIC_SEED", "fixedseed")
    monkeypatch.setenv("USAI_API_KEY", FAKE_SECRET)
    monkeypatch.setenv("OPENCODE_CONFIG", "/should/be/stripped")
    monkeypatch.setenv("VIC_SEEN", str(tmp_path / "seen.jsonl"))
    models = {name: {"name": name} for name in ("good", "rejecter", "blind", "nocontrol")}
    block = {
        "npm": "@ai-sdk/openai-compatible",
        "options": {"baseURL": "https://api.gsa.usai.gov/api/v1", "apiKey": "{env:USAI_API_KEY}"},
        "models": models,
    }
    config = tmp_path / "opencode.jsonc"
    config.write_text("// rendered\n" + json.dumps({"provider": {"usai": block}}))
    return tmp_path, fake, config


def run_main(sandbox, *extra):
    tmp, fake, config = sandbox
    out = tmp / "out"
    code = v.main(
        ["--opencode", str(fake), "--config", str(config), "--output-dir", str(out), "--seed", "fixedseed", *extra]
    )
    return code, out


def test_end_to_end_classifies_models_and_never_writes_secrets(sandbox, capsys):
    code, out = run_main(sandbox, "--models", "good,rejecter,blind", "--timeout", "30")
    assert code == 0
    printed = capsys.readouterr().out
    assert FAKE_SECRET not in printed and printed.strip().splitlines()[-1].startswith("RESULT ")
    doc = json.loads((out / "results.json").read_text())
    by_model = {m["model"]: m for m in doc["models"]}
    assert doc["opencode_version"] == "9.9.9"
    assert by_model["good"]["candidate_image"] is True
    assert {s["classification"] for s in by_model["good"]["samples"] if s["config"] == "text-only"} == {v.WRONG}
    assert by_model["rejecter"]["candidate_image"] is False
    assert {s["classification"] for s in by_model["rejecter"]["samples"] if s["config"] == "text-image"} == {v.REJECTED}
    assert by_model["blind"]["candidate_image"] is False
    assert len(by_model["good"]["samples"]) == 9
    assert doc["summary"]["qualifying"] == ["good"]
    for name in ("results.json", "results.tsv", "evidence.md"):
        assert FAKE_SECRET not in (out / name).read_text()
    assert not list(out.glob(".work*"))
    seen = [json.loads(line) for line in (sandbox[0] / "seen.jsonl").read_text().splitlines()]
    assert seen and not any(s["has_oc_config"] for s in seen)
    assert all(str(out) in s["xdg"] for s in seen)


def test_default_output_dir_is_under_cwd_tmp(sandbox, monkeypatch, tmp_path):
    work = tmp_path / "wt"
    work.mkdir()
    monkeypatch.chdir(work)
    _, fake, config = sandbox
    assert v.main(["--opencode", str(fake), "--config", str(config), "--models", "good", "--seed", "s"]) == 0
    runs = list((work / "tmp").glob("image-verification-*"))
    assert len(runs) == 1 and (runs[0] / "evidence.md").exists()


def set_models(config, names):
    data = json.loads(config.read_text().split("\n", 1)[1])
    data["provider"]["usai"]["models"] = {n: {"name": n} for n in names}
    config.write_text(json.dumps(data))


def test_long_refusal_on_text_only_is_classified_and_run_continues(sandbox):
    set_models(sandbox[2], ["verbose", "good"])
    code, out = run_main(sandbox)
    assert code == 0
    doc = json.loads((out / "results.json").read_text())
    assert [m["model"] for m in doc["models"]] == ["verbose", "good"]
    verbose = doc["models"][0]
    control = [s for s in verbose["samples"] if s["config"] == "text-only"]
    assert len(control) == 3 and {s["classification"] for s in control} == {v.WRONG}
    assert all(len(s["reply"]) == v.MAX_REPLY_CHARS for s in control)
    assert verbose["candidate_image"] is True and doc["stopped"] == ""


def test_long_reply_in_token_configurations_still_stops(sandbox):
    set_models(sandbox[2], ["longall", "good"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "UNEXPECTED_CONTENT" in doc["stopped"] and "500" in doc["stopped"]
    assert [m["model"] for m in doc["models"]] == ["longall"]


def test_secret_shaped_long_reply_on_text_only_still_stops(sandbox, capsys):
    set_models(sandbox[2], ["longsecret"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "UNEXPECTED_CONTENT" in doc["stopped"] and doc["summary"]["qualifying"] == []
    assert "abcdefghijklmnop12345" not in (out / "results.json").read_text()
    assert "abcdefghijklmnop12345" not in capsys.readouterr().out


def test_token_after_truncation_point_is_still_detected_as_leak(sandbox):
    set_models(sandbox[2], ["lateleak"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "NEGATIVE_CONTROL_LEAK" in doc["stopped"] and doc["summary"]["qualifying"] == []
    assert doc["summary"]["text_only_token_leaks"] == 1


def test_control_reply_over_the_larger_cap_stops():
    with pytest.raises(v.StopRun):
        v.check_reply_content("x" * (v.MAX_CONTROL_REPLY_CHARS + 1), (), v.MAX_CONTROL_REPLY_CHARS)
    v.check_reply_content("x" * v.MAX_CONTROL_REPLY_CHARS, (), v.MAX_CONTROL_REPLY_CHARS)


def test_negative_control_leak_stops_the_run(sandbox):
    tmp, fake, config = sandbox
    data = json.loads(config.read_text().split("\n", 1)[1])
    data["provider"]["usai"]["models"] = {"leaky": {"name": "leaky"}, "good": {"name": "good"}}
    config.write_text(json.dumps(data))
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "NEGATIVE_CONTROL_LEAK" in doc["stopped"]
    assert [m["model"] for m in doc["models"]] == ["leaky"]
    assert doc["summary"]["text_only_token_leaks"] == 1


def test_repeated_control_failures_stop_the_run(sandbox):
    _, _, config = sandbox
    data = json.loads(config.read_text().split("\n", 1)[1])
    data["provider"]["usai"]["models"] = {f"nocontrol{i}": {"name": "n"} for i in range(4)}
    config.write_text(json.dumps(data))
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and len(doc["models"]) == 3
    assert all(m["text_control_ok"] is False and m["samples"] == [] for m in doc["models"])


def test_literal_credential_stops_before_any_request(sandbox, capsys):
    tmp, fake, config = sandbox
    data = json.loads(config.read_text().split("\n", 1)[1])
    data["provider"]["usai"]["options"]["apiKey"] = FAKE_SECRET
    config.write_text(json.dumps(data))
    code, out = run_main(sandbox)
    assert code == 2
    printed = capsys.readouterr().out
    assert "CREDENTIAL_EXPOSURE" in printed and FAKE_SECRET not in printed
    assert FAKE_SECRET not in (out / "results.json").read_text()
    assert not (tmp / "seen.jsonl").exists()


def test_unexpected_host_stops_before_any_request(sandbox):
    tmp, fake, config = sandbox
    data = json.loads(config.read_text().split("\n", 1)[1])
    data["provider"]["usai"]["options"]["baseURL"] = "https://elsewhere.example/v1"
    config.write_text(json.dumps(data))
    code, out = run_main(sandbox)
    assert code == 2 and not (tmp / "seen.jsonl").exists()
    assert "UNEXPECTED_HOST" in json.loads((out / "results.json").read_text())["stopped"]


def test_missing_key_env_stops(sandbox, monkeypatch):
    monkeypatch.delenv("USAI_API_KEY")
    code, _ = run_main(sandbox)
    assert code == 2


def test_dry_run_makes_no_requests_and_writes_nothing(sandbox, capsys):
    code, out = run_main(sandbox, "--dry-run")
    assert code == 0 and not out.exists() and not (sandbox[0] / "seen.jsonl").exists()
    assert "dry run" in capsys.readouterr().out


def test_samples_below_minimum_is_rejected(sandbox):
    with pytest.raises(SystemExit):
        run_main(sandbox, "--samples", "2")


def test_timeout_is_reported_as_error(sandbox, tmp_path):
    slow = tmp_path / "slow"
    slow.write_text("#!/bin/sh\nsleep 30\n")
    slow.chmod(0o755)
    result = v.run_step(str(slow), "usai/m", "p", None, dict(os.environ), tmp_path, 1)
    assert result.kind == "error" and result.detail == "timeout"


# --- work-dir ownership ---------------------------------------------------------------------------


def preexisting_work(out):
    marker = out / ".work" / "keep.txt"
    marker.parent.mkdir(parents=True)
    marker.write_text("user data")
    return marker


def test_existing_work_dir_survives_dry_run(sandbox):
    out = sandbox[0] / "out"
    marker = preexisting_work(out)
    code, _ = run_main(sandbox, "--dry-run")
    assert code == 0 and marker.read_text() == "user data"


def test_existing_work_dir_survives_preflight_failure(sandbox, monkeypatch):
    out = sandbox[0] / "out"
    marker = preexisting_work(out)
    monkeypatch.delenv("USAI_API_KEY")
    code, _ = run_main(sandbox)
    assert code == 2 and marker.read_text() == "user data"


def test_existing_work_dir_survives_a_full_run(sandbox):
    out = sandbox[0] / "out"
    marker = preexisting_work(out)
    code, _ = run_main(sandbox, "--models", "good")
    assert code == 0 and marker.read_text() == "user data"
    assert not [p for p in out.glob(".work-*")]


def test_owned_work_dir_removed_on_stop_and_interrupt(sandbox, monkeypatch):
    seen = []
    real = v.run_all

    def stopping(cfg, *args, **kwargs):
        seen.append(cfg.work)
        assert cfg.work.is_dir() and cfg.work.parent == sandbox[0] / "out"
        raise v.StopRun("TEST_STOP", "boom")

    monkeypatch.setattr(v, "run_all", stopping)
    code, out = run_main(sandbox)
    assert code == 2 and not seen[0].exists() and not list(out.glob(".work*"))

    def interrupting(cfg, *args, **kwargs):
        seen.append(cfg.work)
        raise v.Interrupted("SIGINT")

    monkeypatch.setattr(v, "run_all", interrupting)
    code, out = run_main(sandbox)
    assert code == 130 and not seen[1].exists() and not list(out.glob(".work*"))
    monkeypatch.setattr(v, "run_all", real)


# --- requested sample count -----------------------------------------------------------------------


def sized_result(samples, text_only):
    result = v.ModelResult("m", {}, control_ok=True)
    for name, _ in v.CONFIGS:
        count = text_only if name == "text-only" else samples
        for i in range(count):
            cls = v.WRONG if name == "text-only" else v.CORRECT
            result.samples.append(sample(name, i, cls))
    return result


def test_candidate_requires_all_requested_samples_in_every_configuration():
    meta = {"script_version": "1", "date": "d", "provider": "p", "samples": 5, "seed": "s"}
    meta.update(opencode_version="1", host="h", stopped="INTERRUPTED: SIGINT")
    partial = v.build_document(meta, [sized_result(5, 3)])
    record = partial["models"][0]
    assert record["candidate_image"] is False
    assert any("fewer than 5 text-only" in r for r in record["reasons_not_candidate"])
    assert partial["summary"]["qualifying"] == []
    full = v.build_document({**meta, "stopped": ""}, [sized_result(5, 5)])
    assert full["models"][0]["candidate_image"] is True and full["summary"]["qualifying"] == ["m"]
    short_unset = sized_result(5, 5)
    short_unset.samples = [s for s in short_unset.samples if not (s.config == "unset" and s.index > 2)]
    assert v.decide(short_unset, 5)[0] is False


# --- per-model unavailability vs run-level control failure ----------------------------------------


def test_control_unavailable_classification():
    blocked = "HTTP 403 provider.auth: Not authorized. model_blocked_globally"
    nostream = "HTTP 400 provider.invalid-request: This model doesn't support tool use in streaming mode."
    assert v.control_unavailable(outcome("error", detail=blocked))
    assert v.control_unavailable(outcome("rejected", detail=nostream))
    assert v.control_unavailable(outcome("rejected", detail="HTTP 404 The model `x` does not exist"))
    for detail in (
        "HTTP 403 provider.auth: Not authorized.",
        "HTTP 401 unauthorized",
        "HTTP 401 provider.auth: API key does not exist",
        "HTTP 401 model_blocked_globally",
        "timeout",
        "cannot start opencode: OSError",
    ):
        assert not v.control_unavailable(outcome("error", detail=detail)), detail
    for detail in (
        "HTTP 403 provider.auth: authentication scheme not supported",
        "HTTP 404 Not Found",
        "HTTP 400 provider.invalid-request: bad request",
        "HTTP 422 unprocessable",
        "HTTP 400 API version not supported",
    ):
        assert not v.control_unavailable(outcome("rejected", detail=detail)), detail


def test_unavailable_models_do_not_trip_the_stop_and_run_exits_zero(sandbox, capsys):
    set_models(sandbox[2], ["good", "blocked1", "nostream1", "blocked2", "blocked3", "nostream2"])
    code, out = run_main(sandbox)
    assert code == 0
    doc = json.loads((out / "results.json").read_text())
    assert doc["stopped"] == "" and len(doc["models"]) == 6
    skipped = [m["model"] for m in doc["models"] if m["skipped_unavailable"]]
    assert skipped == ["blocked1", "nostream1", "blocked2", "blocked3", "nostream2"]
    assert doc["summary"]["skipped_unavailable"] == skipped
    assert all(m["candidate_image"] is False for m in doc["models"] if m["model"] != "good")
    last = capsys.readouterr().out.strip().splitlines()[-1]
    assert "skipped=5(blocked1,nostream1,blocked2,blocked3,nostream2)" in last and "stopped=no" in last
    assert "SKIPPED (unavailable)" in (out / "evidence.md").read_text()


def test_plain_auth_failures_across_models_still_stop(sandbox):
    set_models(sandbox[2], ["auth403a", "auth403b", "auth403c", "good"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and len(doc["models"]) == 3
    assert doc["summary"]["skipped_unavailable"] == []


def test_unavailable_between_real_failures_does_not_reset_or_count(sandbox):
    set_models(sandbox[2], ["auth403a", "blocked1", "auth403b", "blocked2", "auth403c", "good"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and len(doc["models"]) == 5


def test_few_models_all_failing_auth_stops(sandbox):
    set_models(sandbox[2], ["auth403a"])
    code, out = run_main(sandbox)
    assert code == 2
    assert "CONTROL_FAILING" in json.loads((out / "results.json").read_text())["stopped"]


def test_timeouts_count_as_run_level_failures(sandbox):
    set_models(sandbox[2], ["timeout1", "timeout2", "timeout3", "good"])
    code, out = run_main(sandbox, "--timeout", "1")
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and doc["summary"]["skipped_unavailable"] == []


def test_every_model_unavailable_is_a_run_level_stop_not_a_silent_success(sandbox):
    set_models(sandbox[2], ["blocked1", "nostream1", "blocked2", "blocked3"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and "no model passed" in doc["stopped"]
    assert len(doc["models"]) == 4 and doc["summary"]["qualifying"] == []


def test_bare_gateway_rejections_on_every_model_are_run_level(sandbox):
    set_models(sandbox[2], ["bare404a", "bare404b", "bare404c", "good"])
    code, out = run_main(sandbox)
    assert code == 2
    doc = json.loads((out / "results.json").read_text())
    assert "CONTROL_FAILING" in doc["stopped"] and doc["summary"]["skipped_unavailable"] == []


def test_unavailable_skip_reports_only_the_skip_reason():
    result = v.ModelResult("m", {}, skipped="SKIPPED (unavailable): HTTP 403 model_blocked_globally")
    assert v.decide(result) == (False, ["SKIPPED (unavailable): HTTP 403 model_blocked_globally"])
