#!/usr/bin/env python3
"""
Servidor local do painel de revisao de cortes.

Serve o painel web (web/index.html) e o video, e expoe uma API que recalcula
os cortes com FFmpeg conforme o usuario ajusta os parametros. Reaproveita toda
a logica de silence_cut.py.

Uso:
    python server.py --video samples/test.mp4 --port 8765

So usa a biblioteca padrao do Python.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import silence_cut as core  # noqa: E402  (mesma pasta)

# ---------------------------------------------------------------------------
# Estado global do servidor
# ---------------------------------------------------------------------------
FFMPEG = core.find_bin("ffmpeg")
FFPROBE = core.find_bin("ffprobe")
VIDEO = None        # caminho absoluto do video
INFO = None         # metadados (ffprobe), lidos uma vez no start
OUTDIR = os.path.join(BASE, "output")

# Cache: a deteccao de silencio (ffmpeg) so depende de threshold + min_silence.
# margem e min_clip sao pos-processamento puro (Python), entao recalculam na hora.
_cache = {}
_lock = threading.Lock()


def get_silences(threshold, min_silence):
    """Roda o silencedetect (custoso) so quando threshold/min_silence/video mudam."""
    key = (VIDEO, round(threshold, 3), round(min_silence, 3))
    with _lock:
        if key in _cache:
            return _cache[key]
    silences = core.detect_silence(FFMPEG, VIDEO, threshold, min_silence)
    with _lock:
        _cache[key] = silences
    return silences


def subtract_ranges(keeps, cuts):
    """Remove os intervalos 'cuts' das partes mantidas (pode dividir um keep)."""
    norm = sorted((float(a), float(b)) for a, b in cuts if float(b) > float(a))
    result = []
    for ks, ke in keeps:
        pieces = [(ks, ke)]
        for cs, ce in norm:
            nxt = []
            for s, e in pieces:
                if ce <= s or cs >= e:
                    nxt.append((s, e))          # sem sobreposicao
                else:
                    if cs > s:
                        nxt.append((s, cs))     # parte antes do corte
                    if ce < e:
                        nxt.append((ce, e))     # parte depois do corte
            pieces = nxt
        result.extend(pieces)
    return [(s, e) for s, e in result if e - s > 0.05]  # descarta restos minusculos


def compute(params):
    """Aplica os parametros e devolve (clips, silences)."""
    threshold = float(params.get("threshold", -30.0))
    min_silence = float(params.get("min_silence", 0.5))
    margin = float(params.get("margin", 0.05))
    min_clip = float(params.get("min_clip", 0.3))

    silences = get_silences(threshold, min_silence)
    keeps = core.compute_keeps(silences, INFO["duration"], margin, min_clip)

    # cortes sugeridos pela IA (trechos refeitos) que o usuario aplicou
    manual = params.get("manual_cuts") or []
    if manual:
        keeps = subtract_ranges(keeps, manual)

    clips = core.build_clips(keeps, INFO)
    return clips, silences


def detect(params):
    """Resultado para o painel: silencios, trechos mantidos e estatisticas."""
    clips, silences = compute(params)
    kept = sum(c["sec_out"] - c["sec_in"] for c in clips)
    dur = INFO["duration"]

    # classifica a transcricao atual (se o painel mandou) contra os clips desta rodada --
    # assim a transcricao reflete em tempo real o que os parametros/cortes manuais tiram do video.
    segs = params.get("segments") or []
    transcript_overlay = core.classify_segments(segs, clips, INFO["fps"]) if segs else []

    return {
        "silences": [
            {"start": round(s, 3),
             "end": (round(e, 3) if e is not None else round(dur, 3))}
            for s, e in silences
        ],
        "keeps": [
            {"in": c["sec_in"], "out": c["sec_out"],
             "in_frame": c["src_in"], "out_frame": c["src_out"]}
            for c in clips
        ],
        "stats": {
            "duration": round(dur, 3),
            "kept": round(kept, 3),
            "removed": round(dur - kept, 3),
            "cuts": len(clips),
        },
        "transcript_overlay": transcript_overlay,
    }


def _build_markers(clips, analysis):
    """Capitulos da analise de IA -> lista {name, frame} para o build_xml."""
    chapters = analysis.get("chapters") or []
    fps = INFO["fps"]
    markers = []
    for ch in chapters:
        mapped = core.map_time_to_timeline(ch["start_s"], clips, fps)
        markers.append({"name": ch["title"], "frame": mapped["frame"]})
    return markers


def _build_motion_track(clips, analysis, motion_indices):
    """Clipes de motion design ja gerados -> lista {path, frame_start, frame_len}."""
    items = analysis.get("motion_design") or []
    fps = INFO["fps"]
    motion_track = []
    for idx in motion_indices:
        if not (0 <= idx < len(items)):
            continue
        mov_path = os.path.join(OUTDIR, "motion", f"{idx}.mov")
        if not os.path.isfile(mov_path):
            continue
        item = items[idx]
        mapped = core.map_time_to_timeline(item["start_s"], clips, fps)
        frame_len = int(round((item["end_s"] - item["start_s"]) * fps))
        motion_track.append({"path": mov_path, "frame_start": mapped["frame"],
                             "frame_len": frame_len})
    return motion_track


def export(params):
    """Gera timeline.xml + cortes.json em output/."""
    clips, silences = compute(params)
    if not clips:
        return {"ok": False, "error": "Nenhum trecho para manter. Afrouxe o limiar."}

    os.makedirs(OUTDIR, exist_ok=True)
    seq_name = params.get("seq_name", "Auto-Cut")
    analysis = read_analysis()

    markers = _build_markers(clips, analysis) if params.get("chapters_on") else None
    motion_indices = params.get("motion_indices") or []
    motion_track = _build_motion_track(clips, analysis, motion_indices) if motion_indices else None

    xml = core.build_xml(INFO, clips, VIDEO, seq_name, markers=markers, motion_track=motion_track)
    xml_path = os.path.join(OUTDIR, "timeline.xml")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)

    report = {
        "source": os.path.abspath(VIDEO),
        "params": {
            "threshold_db": float(params.get("threshold", -30.0)),
            "min_silence_s": float(params.get("min_silence", 0.5)),
            "margin_s": float(params.get("margin", 0.05)),
            "min_clip_s": float(params.get("min_clip", 0.3)),
        },
        "media": {
            "fps": round(INFO["fps"], 3),
            "duration_s": round(INFO["duration"], 3),
            "width": INFO["width"], "height": INFO["height"],
            "sample_rate": INFO["sample_rate"], "channels": INFO["channels"],
        },
        "segments_kept": [
            {"in_s": c["sec_in"], "out_s": c["sec_out"],
             "in_frame": c["src_in"], "out_frame": c["src_out"]}
            for c in clips
        ],
    }
    json_path = os.path.join(OUTDIR, "cortes.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return {"ok": True, "xml_path": xml_path, "json_path": json_path, "cuts": len(clips)}


def make_preview(params):
    """Renderiza output/preview.mp4 com apenas os trechos mantidos."""
    clips, _ = compute(params)
    keeps = [(c["sec_in"], c["sec_out"]) for c in clips]
    if not keeps:
        return {"ok": False, "error": "Nenhum trecho para manter."}
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.join(OUTDIR, "preview.mp4")
    core.build_preview(FFMPEG, VIDEO, keeps, out)
    return {"ok": True, "path": out}


# ---------------------------------------------------------------------------
# Transcricao (FFmpeg + whisper.cpp) -> SRT para o Premiere
# ---------------------------------------------------------------------------
def find_model():
    """Acha o modelo Whisper: variavel WHISPER_MODEL ou um ggml-*.bin em models/."""
    env = os.environ.get("WHISPER_MODEL")
    if env and os.path.isfile(env):
        return env
    mdir = os.path.join(BASE, "models")
    if os.path.isdir(mdir):
        cands = [f for f in os.listdir(mdir) if f.lower().endswith(".bin")]
        # prefere modelos maiores (mais precisos): turbo/large primeiro
        cands.sort(key=lambda n: (("turbo" not in n.lower()),
                                  ("large" not in n.lower()), n.lower()))
        if cands:
            return os.path.join(mdir, cands[0])
    return None


def find_whisper_cli():
    """Acha o binario whisper-cli (whisper.cpp): variavel WHISPER_CLI ou em bin/."""
    env = os.environ.get("WHISPER_CLI")
    if env and os.path.isfile(env):
        return env
    names = ["whisper-cli.exe", "whisper-cli"]
    dirs = [os.path.join(BASE, "bin", "Release"), os.path.join(BASE, "bin")]
    for d in dirs:
        for n in names:
            c = os.path.join(d, n)
            if os.path.isfile(c):
                return c
    return None


def _srt_time_to_sec(t):
    """'00:00:01,234' -> 1.234"""
    h, m, rest = t.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(path):
    """Le um arquivo SRT e devolve [{start, end, text}]."""
    with open(path, encoding="utf-8") as f:
        content = f.read().strip()
    segs = []
    if not content:
        return segs
    for block in re.split(r"\n\s*\n", content):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        i = next((k for k, ln in enumerate(lines) if "-->" in ln), None)
        if i is None:
            continue
        start_s, end_s = [x.strip() for x in lines[i].split("-->")]
        text = " ".join(lines[i + 1:]).strip()
        if not text:
            continue
        segs.append({"start": round(_srt_time_to_sec(start_s), 3),
                     "end": round(_srt_time_to_sec(end_s), 3),
                     "text": text})
    return segs


# Reconstrucao de frases a partir das palavras cronometradas
PHRASE_MAX_WORDS = 14     # frase nao passa disso (legibilidade no painel)
PHRASE_GAP = 1.0          # silencio (s) entre palavras que forca quebra de frase
SENT_END = (".", "?", "!", "…")  # pontuacao de fim de frase


def _parse_whisper_json_words(path):
    """Le o JSON do whisper-cli (gerado com -ml 1 -sow) -> [{start,end,text}].

    Com -ml 1 -sow cada entrada de `transcription` e uma unica palavra, com
    `offsets.from`/`offsets.to` em milissegundos.
    """
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
    """Monta um segmento de frase a partir de uma lista de palavras."""
    return {
        "start": round(ws[0]["start"], 3),
        "end": round(ws[-1]["end"], 3),
        "text": " ".join(w["text"] for w in ws),
        # words alinha 1:1 com text.split(' ') no frontend (mesma ordem)
        "words": [{"start": round(w["start"], 3), "end": round(w["end"], 3)} for w in ws],
    }


def _words_to_phrases(words):
    """Agrupa palavras cronometradas em frases legiveis (para painel + SRT).

    Quebra ao fim de frase (pontuacao), em pausa longa (PHRASE_GAP) ou ao
    atingir o limite de palavras (PHRASE_MAX_WORDS).
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
    """Transcreve o audio do video atual com whisper-cli (tempo por palavra) e
    grava SRT (por frase, para o Premiere) + JSON (frase + palavras) + TXT."""
    model = find_model()
    if not model:
        return {"ok": False, "error": "Modelo Whisper nao encontrado. "
                "Baixe um ggml-*.bin para a pasta models/."}
    cli = find_whisper_cli()
    if not cli:
        return {"ok": False, "error": "whisper-cli nao encontrado. "
                "Coloque o whisper-cli.exe (whisper.cpp) na pasta bin/."}

    language = params.get("language", "pt") or "pt"
    os.makedirs(OUTDIR, exist_ok=True)
    srt_path = os.path.join(OUTDIR, "transcricao.srt")
    json_path = os.path.join(OUTDIR, "transcricao.json")
    for p in (srt_path, json_path):
        try:
            os.remove(p)  # evita misturar com transcricao anterior
        except OSError:
            pass

    # 1) extrai o audio em WAV 16kHz mono (formato exigido pelo whisper.cpp)
    wav = os.path.join(OUTDIR, "_audio16k.wav")
    cmd_wav = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", VIDEO,
               "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]
    try:
        subprocess.run(cmd_wav, capture_output=True, text=True, timeout=600)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao extrair o audio: {e}"}
    if not os.path.isfile(wav):
        return {"ok": False, "error": "Falha ao extrair o audio do video."}

    # 2) whisper-cli com tempo por palavra (-ml 1 -sow) -> JSON
    out_base = os.path.join(OUTDIR, "_whisper_words")  # gera _whisper_words.json
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
        return {"ok": False, "error": f"Falha ao executar a transcricao: {e}"}

    if not os.path.isfile(wj):
        return {"ok": False, "error": "A transcricao nao gerou saida.",
                "log": (res.stderr or "")[-800:]}

    words = _parse_whisper_json_words(wj)
    if not words:
        return {"ok": False, "error": "A transcricao nao reconheceu nenhuma fala.",
                "log": (res.stderr or "")[-800:]}
    segs = _words_to_phrases(words)

    # SRT por frase (para o Premiere). _sec_to_srt esta definido logo abaixo.
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, s in enumerate(segs):
            f.write(f"{i}\n{_sec_to_srt(s['start'])} --> {_sec_to_srt(s['end'])}\n"
                    f"{s['text']}\n\n")

    # JSON rico (frase + palavras cronometradas) — fonte da legenda no painel
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(segs, f, ensure_ascii=False)

    txt_path = os.path.join(OUTDIR, "transcricao.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(s["text"] for s in segs))

    # nova transcricao invalida a analise anterior (era de outro video/transcricao)
    try:
        os.remove(os.path.join(OUTDIR, "analise.json"))
    except OSError:
        pass

    return {"ok": True, "segments": segs, "count": len(segs),
            "srt_path": srt_path, "txt_path": txt_path,
            "model": os.path.basename(model)}


def _sec_to_srt(t):
    """Segundos -> 'HH:MM:SS,mmm' (formato de tempo do SRT)."""
    t = max(0.0, float(t))
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s, ms = s + 1, 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def export_srt(params):
    """
    Grava SRT + TXT a partir dos segmentos (possivelmente editados) do painel,
    re-temporizados para a timeline JA CORTADA (silencio + manual_cuts) -- assim
    a legenda fica sincronizada com o timeline.xml gerado para o mesmo corte.
    Segmentos que cairam inteiros num trecho removido sao descartados.
    """
    segs = params.get("segments", [])
    if not segs:
        return {"ok": False, "error": "Nada para exportar."}

    clips, _ = compute(params)
    overlay = core.classify_segments(segs, clips, INFO["fps"]) if clips else []

    remapped = []
    for s, ov in zip(segs, overlay):
        if ov["status"] == "cut":
            continue
        remapped.append({**s, "start": ov["tl_start_s"], "end": ov["tl_end_s"]})

    if not remapped:
        return {"ok": False, "error": "Todos os trechos foram removidos pelo corte atual."}

    os.makedirs(OUTDIR, exist_ok=True)
    srt_path = os.path.join(OUTDIR, "transcricao.srt")
    txt_path = os.path.join(OUTDIR, "transcricao.txt")

    with open(srt_path, "w", encoding="utf-8") as f:
        for i, s in enumerate(remapped, 1):
            text = " ".join((s.get("text") or "").split())  # 1 linha por legenda
            f.write(f"{i}\n{_sec_to_srt(s['start'])} --> {_sec_to_srt(s['end'])}\n{text}\n\n")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(" ".join((s.get("text") or "").split()) for s in remapped))

    return {"ok": True, "count": len(remapped), "srt_path": srt_path, "txt_path": txt_path}


REMOTION_DIR = os.path.join(BASE, "remotion")


def render_motion_remotion(text, duration, out_path, width, height, fps, motion_props):
    """
    Renderiza o clipe de texto animado (.mov ProRes 4444 com alpha) usando o
    projeto Remotion (React) em remotion/. As props vao por arquivo JSON (evita
    problema de aspas/acentos no argv). O fundo e transparente -- o clipe vira a
    2a trilha de video no Premiere.

    motion_props: dict com position, animationStyle, entryDirection, accentWord,
                  accentColor, showBgBox, capsMode, staggerSpeed.

    Requer Node.js + o `npm install` do remotion/ (a skill /setup cuida disso).
    """
    if not os.path.isdir(os.path.join(REMOTION_DIR, "node_modules")):
        raise RuntimeError("Remotion nao instalado. Rode a skill /setup ou "
                           "'npm install' na pasta remotion/.")

    props = {
        "text": text,
        "durationInSeconds": duration,
        "fps": int(round(fps)),
        "width": int(width),
        "height": int(height),
        # personalizacoes visuais vindas do painel
        "position":        motion_props.get("position", "bottom"),
        "animationStyle":  motion_props.get("animationStyle", "spring"),
        "entryDirection":  motion_props.get("entryDirection", "bottom"),
        "accentWord":      motion_props.get("accentWord", ""),
        "accentColor":     motion_props.get("accentColor", "amber"),
        "showBgBox":       bool(motion_props.get("showBgBox", False)),
        "capsMode":        bool(motion_props.get("capsMode", False)),
        "staggerSpeed":    float(motion_props.get("staggerSpeed", 1)),
    }
    props_path = os.path.abspath(out_path) + ".props.json"
    with open(props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, ensure_ascii=False)

    # npx e um .cmd no Windows -- roda via "cmd /c" para o subprocess achar.
    base_cmd = (["cmd", "/c", "npx"] if os.name == "nt" else ["npx"])
    cmd = base_cmd + [
        "remotion", "render", "src/index.ts", "MotionText",
        os.path.abspath(out_path), f"--props={props_path}",
        "--codec=prores", "--prores-profile=4444",
        "--image-format=png", "--pixel-format=yuva444p10le", "--log=error",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace",
                             cwd=REMOTION_DIR, timeout=600)
    finally:
        try:
            os.remove(props_path)
        except OSError:
            pass

    if raw.returncode != 0 or not os.path.isfile(out_path):
        raise RuntimeError(f"falha ao gerar motion clip (Remotion): {raw.stderr[-800:]}")
    return os.path.abspath(out_path)


def render_motion(params):
    """Gera output/motion/<i>.mov a partir de analysis.motion_design[i]."""
    idx = params.get("index")
    if idx is None:
        return {"ok": False, "error": "Faltou o indice do item de motion design."}

    analysis = read_analysis()
    items = analysis.get("motion_design") or []
    if not (0 <= idx < len(items)):
        return {"ok": False, "error": "Indice de motion design invalido."}

    item = items[idx]
    duration = round(item["end_s"] - item["start_s"], 3)
    if duration <= 0:
        return {"ok": False, "error": "Duracao invalida para esse trecho."}

    # Coleta e valida todas as opcoes de personalizacao vindas do painel
    _VALID_POSITIONS  = {"bottom", "center", "top"}
    _VALID_STYLES     = {"spring", "typewriter", "highlight", "lateral", "punch", "hq"}
    _VALID_DIRECTIONS = {"bottom", "top", "left", "right"}
    _VALID_COLORS     = {"amber", "white", "red"}

    motion_props = {
        "position":       params.get("position", "bottom")       if params.get("position")       in _VALID_POSITIONS  else "bottom",
        "animationStyle": params.get("animationStyle", "spring")  if params.get("animationStyle")  in _VALID_STYLES     else "spring",
        "entryDirection": params.get("entryDirection", "bottom")  if params.get("entryDirection")  in _VALID_DIRECTIONS else "bottom",
        "accentWord":     str(params.get("accentWord", ""))[:80],
        "accentColor":    params.get("accentColor", "amber")      if params.get("accentColor")     in _VALID_COLORS     else "amber",
        "showBgBox":      bool(params.get("showBgBox", False)),
        "capsMode":       bool(params.get("capsMode", False)),
        "staggerSpeed":   max(0.25, min(4.0, float(params.get("staggerSpeed", 1)))),
    }

    motion_dir = os.path.join(OUTDIR, "motion")
    os.makedirs(motion_dir, exist_ok=True)
    out_path = os.path.join(motion_dir, f"{idx}.mov")
    preview_path = os.path.join(motion_dir, f"{idx}.preview.mp4")
    try:
        render_motion_remotion(item["frase"], duration, out_path,
                               INFO["width"], INFO["height"], INFO["fps"],
                               motion_props)
        # Preview H.264 (texto sobre o video real) para tocar no navegador --
        # o .mov ProRes entregue ao Premiere nao toca em navegador.
        core.render_motion_preview(FFMPEG, VIDEO, out_path, item["start_s"],
                                   duration, preview_path)
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    return {"ok": True, "path": out_path, "preview": preview_path,
            "duration": duration, "index": idx}


def read_analysis():
    """Le output/analise.json (gravado pelo Claude) para o painel exibir."""
    path = os.path.join(OUTDIR, "analise.json")
    if not os.path.isfile(path):
        return {"available": False}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return {"available": False, "error": str(e)}
    data["available"] = True
    return data


# A "escuta" (Monitor do Claude) toca este arquivo a cada ciclo do loop. Se ele
# esta fresco, a sessao do Claude esta ativa e a analise sai automatica.
HEARTBEAT = os.path.join(OUTDIR, ".ia_heartbeat")


def ia_status():
    """Diz ao painel se a IA esta 'escutando' (heartbeat recente do Monitor)."""
    try:
        age = time.time() - os.path.getmtime(HEARTBEAT)
        return {"connected": age <= 15, "age_s": round(age, 1)}
    except OSError:
        return {"connected": False, "age_s": None}


# ---------------------------------------------------------------------------
# Selecionar video pelo explorador nativo do Windows e trocar o video
# ---------------------------------------------------------------------------
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".m4v",
              ".webm", ".mts", ".m2ts", ".wmv", ".flv"}

# Roda em um processo Python separado: abre o dialogo nativo de "Abrir arquivo"
# do Windows. Precisa de uma thread principal propria (o tkinter nao funciona
# bem na thread de trabalho do servidor), por isso vai como subprocesso.
_PICK_SCRIPT = (
    "import sys, tkinter as tk\n"
    "from tkinter import filedialog\n"
    "sys.stdout.reconfigure(encoding='utf-8')\n"
    "r = tk.Tk(); r.withdraw()\n"
    "r.attributes('-topmost', True); r.update()\n"
    "p = filedialog.askopenfilename(\n"
    "    title='Selecione o video',\n"
    "    filetypes=[('Videos', '*.mp4 *.mov *.mkv *.avi *.m4v *.webm *.wmv "
    "*.flv *.mts *.m2ts'), ('Todos os arquivos', '*.*')])\n"
    "r.destroy()\n"
    "sys.stdout.write('PICKED:' + (p or ''))\n"
)


def pick_file():
    """Abre o dialogo nativo do Windows e carrega o video escolhido."""
    try:
        res = subprocess.run([sys.executable, "-c", _PICK_SCRIPT],
                             capture_output=True, text=True,
                             encoding="utf-8", timeout=600)
    except Exception as e:  # noqa: BLE001 (qualquer falha vira mensagem ao usuario)
        return {"ok": False, "error": f"Falha ao abrir o explorador: {e}"}

    out = res.stdout or ""
    idx = out.rfind("PICKED:")
    path = out[idx + len("PICKED:"):].strip() if idx >= 0 else ""
    if not path:
        return {"ok": False, "cancelled": True}
    return load_video(path)


def load_video(path):
    """Troca o video ativo: revalida, re-le metadados e limpa o cache."""
    global VIDEO, INFO, _cache
    if not path or not os.path.isfile(path):
        return {"ok": False, "error": "Arquivo nao encontrado."}
    if os.path.splitext(path)[1].lower() not in VIDEO_EXTS:
        return {"ok": False, "error": "Extensao de video nao suportada."}
    try:
        info = core.probe(FFPROBE, path)
    except Exception as e:  # noqa: BLE001 (qualquer falha do ffprobe vira mensagem)
        return {"ok": False, "error": f"Falha ao ler o video: {e}"}

    VIDEO = os.path.abspath(path)
    INFO = info
    with _lock:
        _cache = {}
    return {
        "ok": True,
        "video": os.path.basename(VIDEO),
        "video_dir": os.path.dirname(VIDEO),
        "media": {
            "duration": round(INFO["duration"], 3),
            "fps": round(INFO["fps"], 3),
            "width": INFO["width"], "height": INFO["height"],
            "channels": INFO["channels"],
        },
    }


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silencia o log padrao

    def _safe_write(self, data):
        # O player aborta conexoes ao buscar (seek); ignora o erro resultante.
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self._safe_write(body)

    def _serve_static(self, path, content_type):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self._safe_write(data)

    def _serve_media(self):
        """Serve o video atual com suporte a Range (necessario para o player buscar)."""
        ctype = "video/quicktime" if VIDEO.lower().endswith(".mov") else "video/mp4"
        self._serve_range(VIDEO, ctype)

    def _serve_motion(self, path):
        """Serve um arquivo de motion design (preview .mp4 ou .mov) com Range."""
        ext = os.path.splitext(path)[1].lower()
        ctype = {".mp4": "video/mp4", ".webm": "video/webm"}.get(ext, "video/quicktime")
        self._serve_range(path, ctype)

    def _serve_range(self, path, ctype):
        """Serve um arquivo de video com suporte a Range (necessario para o player buscar)."""
        if not os.path.isfile(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        rng = self.headers.get("Range")

        if rng:
            m = re.match(r"bytes=(\d+)-(\d*)", rng)
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
        else:
            start, length = 0, size
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.end_headers()

        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            chunk = 64 * 1024
            while remaining > 0:
                data = f.read(min(chunk, remaining))
                if not data:
                    break
                self._safe_write(data)
                remaining -= len(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._serve_static(os.path.join(BASE, "web", "dist", "index.html"),
                               "text/html; charset=utf-8")
        elif path == "/media":
            self._serve_media()
        elif path.startswith("/motion/"):
            fname = os.path.basename(path)  # so o nome -- sem permitir sair da pasta motion/
            self._serve_motion(os.path.join(OUTDIR, "motion", fname))
        elif path.startswith("/assets/"):
            fname = os.path.basename(path)
            fpath = os.path.join(BASE, "web", "dist", "assets", fname)
            if os.path.isfile(fpath):
                ext = fname.rsplit(".", 1)[-1] if "." in fname else ""
                mime = {"js": "application/javascript", "css": "text/css", "woff2": "font/woff2", "woff": "font/woff", "png": "image/png", "svg": "image/svg+xml"}.get(ext, "application/octet-stream")
                self._serve_static(fpath, mime)
            else:
                self.send_error(404)
        elif path == "/api/analysis":
            self._json(read_analysis())
        elif path == "/api/transcript":
            # Prefere o JSON rico (frase + tempo por palavra); cai no SRT antigo
            # (sem palavras) quando a transcricao foi feita com a versao antiga.
            jpath = os.path.join(OUTDIR, "transcricao.json")
            srt = os.path.join(OUTDIR, "transcricao.srt")
            if os.path.isfile(jpath):
                try:
                    with open(jpath, encoding="utf-8") as f:
                        segs = json.load(f)
                    self._json({"available": True, "segments": segs, "count": len(segs)})
                except (OSError, ValueError):
                    self._json({"available": False, "segments": [], "count": 0})
            elif os.path.isfile(srt):
                segs = parse_srt(srt)
                self._json({"available": True, "segments": segs, "count": len(segs)})
            else:
                self._json({"available": False, "segments": [], "count": 0})
        elif path == "/api/ia_status":
            self._json(ia_status())
        elif path == "/api/info":
            self._json({
                "video": os.path.basename(VIDEO),
                "video_dir": os.path.dirname(VIDEO),
                "media": {
                    "duration": round(INFO["duration"], 3),
                    "fps": round(INFO["fps"], 3),
                    "width": INFO["width"], "height": INFO["height"],
                    "channels": INFO["channels"],
                },
                "defaults": {"threshold": -30.0, "min_silence": 0.5,
                             "margin": 0.05, "min_clip": 0.3},
            })
        else:
            self.send_error(404)

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            params = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            params = {}

        if path == "/api/detect":
            self._json(detect(params))
        elif path == "/api/export":
            self._json(export(params))
        elif path == "/api/preview":
            self._json(make_preview(params))
        elif path == "/api/transcribe":
            self._json(transcribe(params))
        elif path == "/api/export_srt":
            self._json(export_srt(params))
        elif path == "/api/pick":
            self._json(pick_file())
        elif path == "/api/motion/render":
            self._json(render_motion(params))
        else:
            self.send_error(404)


def main():
    global VIDEO, INFO
    ap = argparse.ArgumentParser(description="Painel de revisao de cortes (servidor local).")
    ap.add_argument("--video", default="samples/test.mp4", help="video de origem")
    ap.add_argument("--port", type=int, default=8765, help="porta HTTP")
    args = ap.parse_args()

    video = args.video if os.path.isabs(args.video) else os.path.join(BASE, args.video)
    if not os.path.isfile(video):
        sys.exit(f"ERRO: video nao encontrado: {video}")
    VIDEO = video
    INFO = core.probe(FFPROBE, VIDEO)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Painel em http://127.0.0.1:{args.port}  (video: {os.path.basename(VIDEO)})")
    server.serve_forever()


if __name__ == "__main__":
    main()
