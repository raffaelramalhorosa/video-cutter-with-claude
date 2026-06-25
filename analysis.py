"""Integração com a API Gemini: análise automática da transcrição."""

import json
import os
import re
import threading
import time
import urllib.request

import state

GEMINI_MODEL = "gemini-2.5-flash"
HEARTBEAT = os.path.join(state.OUTDIR, ".ia_heartbeat")


def load_gemini_key():
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        key_file = os.path.join(state.BASE, ".gemini_key")
        if os.path.isfile(key_file):
            key = open(key_file).read().strip()
    return key


def _analyze_with_gemini(srt_text: str, api_key: str) -> dict:
    """Envia o SRT para o Gemini Flash e retorna o dict de análise."""
    prompt_file = os.path.join(state.BASE, ".claude", "analyze_transcript_prompt.md")
    base_prompt = open(prompt_file, encoding="utf-8").read() if os.path.isfile(prompt_file) else ""

    prompt = (
        f"{base_prompt}\n\n"
        "TRANSCRIÇÃO SRT:\n"
        f"{srt_text}\n\n"
        "Retorne SOMENTE o JSON, sem markdown, sem texto adicional."
    )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
    }).encode()

    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        result = json.loads(resp.read())

    raw = result["candidates"][0]["content"]["parts"][0]["text"]
    # Gemini pode envolver o JSON em code fences mesmo com responseMimeType=json
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def auto_analyze(srt_path: str) -> None:
    """Lê o SRT, chama Gemini em background e salva output/analise.json."""
    api_key = load_gemini_key()
    if not api_key:
        print("[gemini] chave não configurada — análise automática pulada", flush=True)
        return
    try:
        srt_text = open(srt_path, encoding="utf-8").read()
        data = _analyze_with_gemini(srt_text, api_key)
        out = os.path.join(state.OUTDIR, "analise.json")
        os.makedirs(state.OUTDIR, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[gemini] análise salva em {out}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[gemini] erro na análise automática: {e}", flush=True)


def start_auto_analyze(srt_path: str) -> None:
    """Dispara auto_analyze em daemon thread (não bloqueia a resposta ao frontend)."""
    threading.Thread(target=auto_analyze, args=(srt_path,), daemon=True).start()


def read_analysis():
    """Lê output/analise.json e devolve o dict (com available=True/False)."""
    path = os.path.join(state.OUTDIR, "analise.json")
    if not os.path.isfile(path):
        return {"available": False}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return {"available": False, "error": str(e)}
    data["available"] = True
    return data


def ia_status():
    """Indica se o Monitor do Claude está ativo (heartbeat recente)."""
    try:
        age = time.time() - os.path.getmtime(HEARTBEAT)
        return {"connected": age <= 15, "age_s": round(age, 1)}
    except OSError:
        return {"connected": False, "age_s": None}
