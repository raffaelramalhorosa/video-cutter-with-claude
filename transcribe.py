"""Transcrição de áudio com whisper-cli (whisper.cpp) — tempo por palavra."""

import json
import os
import subprocess
import urllib.request

import state
from analysis import load_gemini_key, start_auto_analyze
from utils import sec_to_srt

# Parâmetros de agrupamento de palavras em frases
PHRASE_MAX_WORDS = 14    # máximo de palavras por frase (legibilidade no painel)
PHRASE_GAP = 1.0         # pausa (s) entre palavras que força quebra de frase
SENT_END = (".", "?", "!", "…")

# Palavras de preenchimento (fillers) do português brasileiro.
# Segmentos compostos EXCLUSIVAMENTE por estas palavras são marcados is_filler=True.
_FILLERS = frozenset([
    "uh", "uhh", "uhm", "hm", "hmm", "hmmm", "ah", "ahh", "eh",
    "né", "ne", "sabe", "tipo", "assim", "então", "entao",
    "bom", "veja", "olha", "cara", "gente",
])


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


_SILERO_URL = (
    "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
)


def find_or_download_vad_model():
    """Retorna path do silero_vad.onnx, baixando na pasta models/ se necessário."""
    mdir = os.path.join(state.BASE, "models")
    dest = os.path.join(mdir, "silero_vad.onnx")
    if os.path.isfile(dest):
        return dest
    os.makedirs(mdir, exist_ok=True)
    try:
        urllib.request.urlretrieve(_SILERO_URL, dest)
        return dest
    except Exception:  # noqa: BLE001
        # VAD opcional: falha silenciosa, transcrição continua sem VAD
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
    text = " ".join(w["text"] for w in ws)
    # filler: segmento composto só de palavras de preenchimento (≤ 3 palavras)
    tokens = [t.strip(".,!?…").lower() for t in text.split()]
    is_filler = len(tokens) <= 3 and all(t in _FILLERS for t in tokens)
    seg = {
        "start": round(ws[0]["start"], 3),
        "end": round(ws[-1]["end"], 3),
        "text": text,
        # words alinha 1:1 com text.split(' ') no frontend
        "words": [{"start": round(w["start"], 3), "end": round(w["end"], 3)} for w in ws],
    }
    if is_filler:
        seg["is_filler"] = True
    return seg


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


def _mark_word_repetitions(phrases):
    """Marca segmentos que terminam com palavra repetida no início do próximo.

    Padrão: seg[i] termina com palavra X, seg[i+1] começa com X (case-insensitive).
    Marca seg[i] com is_repetition=True — candidato a corte pelo editor.
    Exemplo: "eu fui lá" → "eu fui lá eu expliquei" — o primeiro é falso começo.
    """
    for i in range(len(phrases) - 1):
        words_cur = phrases[i]["text"].split()
        words_next = phrases[i + 1]["text"].split()
        if not words_cur or not words_next:
            continue
        last = words_cur[-1].strip(".,!?…").lower()
        first = words_next[0].strip(".,!?…").lower()
        if last == first and len(last) > 2:  # ignora "a", "e", "o" sozinhos
            phrases[i]["is_repetition"] = True
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

    # 2) whisper-cli com timestamp por palavra (-ml 1 -sow) + DTW para
    #    alinhamento preciso de tokens (-dtw) + glossário de nomes do projeto
    out_base = os.path.join(state.OUTDIR, "_whisper_words")
    wj = out_base + ".json"
    try:
        os.remove(wj)
    except OSError:
        pass
    cmd = [cli, "-m", model, "-l", language, "-ml", "1", "-sow",
           "-dtw", model,           # DTW alignment: timestamps por palavra ±20ms
           "-oj", "-np", "-of", out_base]
    # Silero VAD: reduz alucinações em silêncios/ruídos; baixa o modelo automaticamente
    vad_model = find_or_download_vad_model()
    if vad_model:
        cmd += ["--vad", "-vm", vad_model]
    cmd.append(wav)

    # glossário de nomes do projeto: passado como --prompt para guiar Whisper
    glossary_path = os.path.join(state.BASE, "glossario.txt")
    if os.path.isfile(glossary_path):
        try:
            glossary = open(glossary_path, encoding="utf-8").read().strip()
            if glossary:
                cmd += ["--prompt", glossary, "--carry-initial-prompt"]
        except OSError:
            pass
    # executa whisper-cli transmitindo progresso linha a linha para trans_progress.txt
    progress_path = os.path.join(state.OUTDIR, "trans_progress.txt")
    try:
        with open(progress_path, "w", encoding="utf-8") as pf:
            pf.write("")  # limpa arquivo anterior
    except OSError:
        pass
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace")
        stderr_lines = []
        with open(progress_path, "a", encoding="utf-8", buffering=1) as pf:
            for line in proc.stdout:  # type: ignore[union-attr]
                stderr_lines.append(line)
                # filtra apenas linhas com timestamps (formato: [HH:MM:SS.mmm --> HH:MM:SS.mmm])
                if "-->" in line or line.strip().startswith("["):
                    pf.write(line)
                    pf.flush()
        proc.wait()
        stderr_text = "".join(stderr_lines)
        # sinaliza conclusão
        try:
            with open(progress_path, "a", encoding="utf-8") as pf:
                pf.write("__DONE__\n")
        except OSError:
            pass
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao executar a transcrição: {e}"}
    if proc.returncode and proc.returncode != 0:
        pass  # whisper pode retornar código != 0 e ainda gerar saída válida

    if not os.path.isfile(wj):
        return {"ok": False, "error": "A transcrição não gerou saída.",
                "log": stderr_text[-800:]}

    words = _parse_whisper_json_words(wj)
    if not words:
        return {"ok": False, "error": "A transcrição não reconheceu nenhuma fala.",
                "log": stderr_text[-800:]}
    segs = _mark_word_repetitions(_words_to_phrases(words))

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
