"""Transcrição de áudio com whisper-cli (whisper.cpp) — tempo por palavra."""

import json
import os
import subprocess

import state
from analysis import load_gemini_key, start_auto_analyze
from utils import sec_to_srt

# Parâmetros de agrupamento de palavras em frases
PHRASE_MAX_WORDS = 14    # máximo de palavras por frase (legibilidade no painel)
PHRASE_GAP = 1.0         # pausa (s) entre palavras que força quebra de frase
SENT_END = (".", "?", "!", "…")


def find_model():
    """Localiza o modelo Whisper: variável WHISPER_MODEL ou ggml-*.bin em models/."""
    env = os.environ.get("WHISPER_MODEL")
    if env and os.path.isfile(env):
        return env
    mdir = os.path.join(state.BASE, "models")
    if os.path.isdir(mdir):
        cands = [f for f in os.listdir(mdir) if f.lower().endswith(".bin")]
        # prefere turbo/large (mais precisos)
        cands.sort(key=lambda n: (("turbo" not in n.lower()),
                                  ("large" not in n.lower()), n.lower()))
        if cands:
            return os.path.join(mdir, cands[0])
    return None


def find_whisper_cli():
    """Localiza o binário whisper-cli: variável WHISPER_CLI ou em bin/."""
    env = os.environ.get("WHISPER_CLI")
    if env and os.path.isfile(env):
        return env
    names = ["whisper-cli.exe", "whisper-cli"]
    dirs = [os.path.join(state.BASE, "bin", "Release"), os.path.join(state.BASE, "bin")]
    for d in dirs:
        for n in names:
            c = os.path.join(d, n)
            if os.path.isfile(c):
                return c
    return None


def _parse_whisper_json_words(path):
    """Lê o JSON do whisper-cli (-ml 1 -sow) e devolve [{start, end, text}] por palavra."""
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    words = []
    for e in d.get("transcription", []):
        text = (e.get("text") or "").strip()
        if not text:
            continue
        off = e.get("offsets") or {}
        start = (off.get("from") or 0) / 1000.0
        end = (off.get("to") or 0) / 1000.0
        words.append({"start": start, "end": end, "text": text})
    return words


def _make_phrase(ws):
    """Agrupa uma lista de palavras em um único segmento de frase."""
    return {
        "start": round(ws[0]["start"], 3),
        "end": round(ws[-1]["end"], 3),
        "text": " ".join(w["text"] for w in ws),
        # words alinha 1:1 com text.split(' ') no frontend
        "words": [{"start": round(w["start"], 3), "end": round(w["end"], 3)} for w in ws],
    }


def _words_to_phrases(words):
    """Agrupa palavras cronometradas em frases legíveis.

    Quebra em fim de frase (pontuação), pausa longa (PHRASE_GAP) ou ao
    atingir PHRASE_MAX_WORDS.
    """
    phrases, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        ends_sentence = w["text"].endswith(SENT_END)
        gap_next = (i + 1 < len(words)) and (words[i + 1]["start"] - w["end"] > PHRASE_GAP)
        if ends_sentence or gap_next or len(cur) >= PHRASE_MAX_WORDS:
            phrases.append(_make_phrase(cur))
            cur = []
    if cur:
        phrases.append(_make_phrase(cur))
    return phrases


def transcribe(params):
    """Transcreve o vídeo ativo com whisper-cli e grava SRT + JSON + TXT."""
    model = find_model()
    if not model:
        return {"ok": False, "error": "Modelo Whisper não encontrado. "
                "Baixe um ggml-*.bin para a pasta models/."}
    cli = find_whisper_cli()
    if not cli:
        return {"ok": False, "error": "whisper-cli não encontrado. "
                "Coloque o whisper-cli.exe (whisper.cpp) na pasta bin/."}

    language = params.get("language", "pt") or "pt"
    os.makedirs(state.OUTDIR, exist_ok=True)

    srt_path = os.path.join(state.OUTDIR, "transcricao.srt")
    json_path = os.path.join(state.OUTDIR, "transcricao.json")
    for p in (srt_path, json_path):
        try:
            os.remove(p)
        except OSError:
            pass

    # 1) extrai WAV 16kHz mono (formato exigido pelo whisper.cpp)
    wav = os.path.join(state.OUTDIR, "_audio16k.wav")
    cmd_wav = [state.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
               "-i", state.VIDEO,
               "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]
    try:
        subprocess.run(cmd_wav, capture_output=True, text=True, timeout=600)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao extrair o áudio: {e}"}
    if not os.path.isfile(wav):
        return {"ok": False, "error": "Falha ao extrair o áudio do vídeo."}

    # 2) whisper-cli com timestamp por palavra (-ml 1 -sow) -> JSON
    out_base = os.path.join(state.OUTDIR, "_whisper_words")
    wj = out_base + ".json"
    try:
        os.remove(wj)
    except OSError:
        pass
    cmd = [cli, "-m", model, "-l", language, "-ml", "1", "-sow",
           "-oj", "-np", "-of", out_base, wav]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=3600)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao executar a transcrição: {e}"}

    if not os.path.isfile(wj):
        return {"ok": False, "error": "A transcrição não gerou saída.",
                "log": (res.stderr or "")[-800:]}

    words = _parse_whisper_json_words(wj)
    if not words:
        return {"ok": False, "error": "A transcrição não reconheceu nenhuma fala.",
                "log": (res.stderr or "")[-800:]}
    segs = _words_to_phrases(words)

    # nova transcrição invalida a análise anterior
    try:
        os.remove(os.path.join(state.OUTDIR, "analise.json"))
    except OSError:
        pass

    with open(srt_path, "w", encoding="utf-8") as f:
        for i, s in enumerate(segs):
            f.write(f"{i}\n{sec_to_srt(s['start'])} --> {sec_to_srt(s['end'])}\n"
                    f"{s['text']}\n\n")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(segs, f, ensure_ascii=False)

    txt_path = os.path.join(state.OUTDIR, "transcricao.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(s["text"] for s in segs))

    # dispara análise Gemini em background se a chave estiver configurada
    if load_gemini_key():
        start_auto_analyze(srt_path)

    return {"ok": True, "segments": segs, "count": len(segs),
            "srt_path": srt_path, "txt_path": txt_path,
            "model": os.path.basename(model)}
