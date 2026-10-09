#!/usr/bin/env python3
"""Bridge between the FinanceHub web app and Google Research's FinanceHarness.

The web app cannot run a Python agent, and the harness should not need the user's
key to be exported into a shell profile. So the app posts a small JSON request to
its local server (serve.py), which runs this script in the harness virtualenv and
pipes the request in on stdin. We inject the caller's own model as a harness
"profile" (the seam the harness exposes for exactly this), run the trajectory and
write newline-delimited JSON back to stdout:

    {"type":"start", ...}                 run accepted, model resolved
    {"type":"event","kind":"round_start","round":1}
    {"type":"event","kind":"tool_call","name":"web_search"}
    {"type":"event","kind":"token","text":"..."}      streamed report text
    {"type":"event","kind":"error","error":"..."}
    {"type":"final","report":"...","citations":[...],"trajectory_path":"..."}
    {"type":"error","error":"..."}

Nothing is written to disk except the optional trajectory JSON.

FinanceHarness is CC BY-NC 4.0 (non-commercial use only); see harness/README.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent / "harness" / "finance_harness"
sys.path.insert(0, str(HARNESS_DIR))

# Providers that speak the OpenAI chat-completions wire format. The harness talks
# to all of them through its generic "chat" provider; only Gemini has a native SDK
# path, and Anthropic's own API is not OpenAI-compatible (use OpenRouter for Claude).
OPENAI_COMPATIBLE = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "together": "https://api.together.xyz/v1",
    "mistral": "https://api.mistral.ai/v1",
    "xai": "https://api.x.ai/v1",
    "ollama": "http://127.0.0.1:11434/v1",
    "lmstudio": "http://127.0.0.1:1234/v1",
    "opencode": "https://opencode.ai/zen/v1",
    "opencode-go": "https://opencode.ai/zen/go/v1",
    "custom": None,
}
GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"


def reasoning_effort(provider: str, model: str):
    """Extra request fields for providers that take a reasoning-effort knob.

    DeepSeek V4.1 Flash on OpenCode Zen is used at low effort: it is the cheap
    reasoning tier and the harness does its own multi-round search, so extra
    thinking tokens only add latency and cost here.
    """
    if provider == "opencode" and (model or "").startswith("deepseek-v4.1-flash"):
        return {"reasoning_effort": "low"}
    if provider == "opencode-go" and (model or "").startswith("deepseek-v4.1-flash"):
        return {"reasoning_effort": "low"}
    return {}


CLIENT_UA = "MercerFargo-Finance-Superhub/1.0"
_HEADERS_PATCHED = False


def patch_opencode_headers(session_id: str) -> None:
    """Give OpenCode Go/Zen the headers they ask for.

    Go requires a stable ``x-opencode-session`` per conversation and a client
    user agent. The harness builds its OpenAI client without default headers, so
    we wrap ``client_for`` from the bridge — the vendored package is never edited.
    """
    global _HEADERS_PATCHED
    if _HEADERS_PATCHED:
        return
    from financeharness.providers import client as _client

    original = _client.client_for

    def patched(profile):
        built = original(profile)
        base = (getattr(profile, "base_url", "") or "")
        if "opencode.ai" in base:
            built = built.with_options(default_headers={
                "x-opencode-session": session_id or "mercerfargo-local",
                "User-Agent": CLIENT_UA,
            })
        return built

    _client.client_for = patched
    _HEADERS_PATCHED = True


def emit(obj: dict) -> None:
    """One JSON object per line, flushed so the server can stream it."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(message: str, **extra) -> None:
    payload = {"type": "error", "error": message}
    payload.update(extra)
    emit(payload)


def build_profiles(req: dict):
    """Turn the app's provider/key/ model choices into harness ModelProfiles."""
    from financeharness.providers import ModelProfile
    from financeharness.providers.profiles import Generation

    provider = (req.get("provider") or "openai").strip().lower()
    model = (req.get("model") or "").strip()
    reader_model = (req.get("readerModel") or "").strip() or model
    key = (req.get("apiKey") or os.environ.get("FH_BYOK_KEY") or "").strip()
    base_url = (req.get("baseUrl") or "").strip() or None
    max_tokens = int(req.get("maxTokens") or 8192)
    temperature = float(req.get("temperature") or 0.6)

    if provider == "gemini":
        if not key:
            raise ValueError("A Gemini API key is required for the Gemini backbone.")
        backbone = ModelProfile(
            name="byok",
            model=model or "gemini-2.5-flash",
            provider="gemini",
            base_url=GEMINI_OPENAI_BASE,
            api_key_literal=key,
            role="backbone",
            reader_profile="byok-reader",
            timeout_s=900.0,
            generation=Generation(temperature=temperature, top_p=0.95, max_tokens=max_tokens),
        )
        reader = ModelProfile(
            name="byok-reader",
            model=reader_model or model or "gemini-2.5-flash",
            provider="chat",
            base_url=GEMINI_OPENAI_BASE,
            api_key_literal=key,
            role="reader",
            timeout_s=600.0,
            generation=Generation(temperature=0.4, top_p=0.95, max_tokens=8192),
        )
        return backbone, reader

    if provider == "anthropic":
        raise ValueError(
            "Anthropic's native API is not OpenAI-compatible. Point the harness at "
            "OpenRouter (model e.g. anthropic/claude-sonnet-5.5) instead."
        )

    if provider not in OPENAI_COMPATIBLE:
        raise ValueError(f"Provider '{provider}' is not supported by the bridge.")

    base_url = base_url or OPENAI_COMPATIBLE[provider]
    if not base_url:
        raise ValueError("A base URL is required for the custom provider.")
    if provider not in ("ollama", "lmstudio", "custom") and not key:
        raise ValueError(f"A {provider} API key is required.")

    backbone = ModelProfile(
        name="byok",
        model=model,
        provider="chat",
        base_url=base_url,
        api_key_literal=key or "EMPTY",
        role="backbone",
        reader_profile="byok-reader",
        timeout_s=900.0,
        generation=Generation(temperature=temperature, top_p=0.95, max_tokens=max_tokens),
        extra_body=reasoning_effort(provider, model),
    )
    reader = ModelProfile(
        name="byok-reader",
        model=reader_model,
        provider="chat",
        base_url=base_url,
        api_key_literal=key or "EMPTY",
        role="reader",
        timeout_s=600.0,
        generation=Generation(temperature=0.4, top_p=0.95, max_tokens=8192),
        extra_body=reasoning_effort(provider, reader_model),
    )
    return backbone, reader


async def run(req: dict) -> int:
    started = time.time()
    question = (req.get("question") or "").strip()
    if not question:
        fail("The request did not include a question.")
        return 2

    from financeharness.research import run_research, save_trajectory

    backbone, reader = build_profiles(req)
    patch_opencode_headers((req.get("sessionId") or "").strip())
    mode = req.get("mode") or "auto"
    emit({
        "type": "start",
        "model": backbone.model,
        "readerModel": reader.model,
        "provider": req.get("provider") or "openai",
        "mode": mode,
        "startedAt": int(started * 1000),
    })

    # Token-level streaming: the report fills in live in the browser. The final
    # trajectory still carries the authoritative text.
    stream_tokens = bool(req.get("streamTokens", True))
    events = {"count": 0}

    def on_event(kind: str, data: dict) -> None:
        events["count"] += 1
        payload = {"type": "event", "kind": kind}
        if kind == "token" or kind == "reasoning":
            payload["text"] = data.get("text", "")
        elif kind == "round_start":
            payload["round"] = data.get("round")
        elif kind == "tool_call":
            payload["name"] = data.get("name")
            if data.get("args") is not None:
                payload["args"] = data.get("args")
        elif kind == "tool_result":
            payload["ok"] = data.get("ok")
            payload["name"] = data.get("name")
        elif kind == "phase":
            payload["label"] = data.get("label")
        elif kind == "error":
            payload["error"] = data.get("error")
        emit(payload)

    try:
        traj = await run_research(
            question,
            profile=backbone,
            reader_profile=reader,
            mode=mode,
            on_event=on_event,
            stream_tokens=stream_tokens,
        )
    except Exception as exc:  # noqa: BLE001 — report to the UI, keep the server alive
        fail(f"{type(exc).__name__}: {exc}", traceback=traceback.format_exc()[-4000:])
        return 1

    report = traj.get("prediction") or ""
    citations = traj.get("citations") or []
    traj_path = None
    save_path = req.get("savePath")
    if save_path:
        try:
            # Keep the key out of anything we persist: profiles are not part of traj,
            # but strip defensively in case a future version adds them.
            traj.pop("profile", None)
            traj_path = str(save_trajectory(traj, save_path))
        except Exception as exc:  # noqa: BLE001
            emit({"type": "log", "message": f"could not save the trajectory: {exc}"})

    emit({
        "type": "final",
        "report": report,
        "citations": citations,
        "termination": traj.get("termination"),
        "rounds": traj.get("rounds"),
        "elapsedSeconds": traj.get("elapsed_s") or round(time.time() - started, 1),
        "events": events["count"],
        "trajectoryPath": traj_path,
        "usage": traj.get("usage"),
    })
    return 0 if traj.get("termination") == "answer" else 1


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        fail(f"Could not parse the request: {exc}")
        raise SystemExit(2)
    try:
        raise SystemExit(asyncio.run(run(req)))
    except SystemExit:
        raise
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001
        fail(f"{type(exc).__name__}: {exc}", traceback=traceback.format_exc()[-4000:])
        raise SystemExit(1)


if __name__ == "__main__":
    main()
