"""Renderização de motion design (Remotion) e carregamento de vídeo."""

import json
import os
import subprocess
import sys

import silence_cut as core
import state
from analysis import read_analysis

REMOTION_DIR = os.path.join(state.BASE, "remotion")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".m4v",
              ".webm", ".mts", ".m2ts", ".wmv", ".flv"}

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


def render_motion_remotion(text, duration, out_path, width, height, fps, motion_props):
    """Renderiza clipe .mov ProRes 4444 com alpha via Remotion."""
    if not os.path.isdir(os.path.join(REMOTION_DIR, "node_modules")):
        raise RuntimeError("Remotion não instalado. Rode a skill /setup ou "
                           "'npm install' na pasta remotion/.")

    props = {
        "text": text,
        "durationInSeconds": duration,
        "fps": int(round(fps)),
        "width": int(width),
        "height": int(height),
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
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    idx = params.get("index")
    if idx is None:
        return {"ok": False, "error": "Faltou o índice do item de motion design."}

    analysis = read_analysis()
    items = analysis.get("motion_design") or []
    if not (0 <= idx < len(items)):
        return {"ok": False, "error": "Índice de motion design inválido."}

    item = items[idx]
    duration = round(item["end_s"] - item["start_s"], 3)
    if duration <= 0:
        return {"ok": False, "error": "Duração inválida para esse trecho."}

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

    motion_dir = os.path.join(state.OUTDIR, "motion")
    os.makedirs(motion_dir, exist_ok=True)
    out_path = os.path.join(motion_dir, f"{idx}.mov")
    preview_path = os.path.join(motion_dir, f"{idx}.preview.mp4")
    try:
        render_motion_remotion(item["frase"], duration, out_path,
                               state.INFO["width"], state.INFO["height"], state.INFO["fps"],
                               motion_props)
        core.render_motion_preview(state.FFMPEG, state.VIDEO, out_path,
                                   item["start_s"], duration, preview_path)
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    return {"ok": True, "path": out_path, "preview": preview_path,
            "duration": duration, "index": idx}


def pick_file():
    """Abre o diálogo nativo do Windows e carrega o vídeo escolhido."""
    try:
        res = subprocess.run([sys.executable, "-c", _PICK_SCRIPT],
                             capture_output=True, text=True,
                             encoding="utf-8", timeout=600)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao abrir o explorador: {e}"}

    out = res.stdout or ""
    idx = out.rfind("PICKED:")
    path = out[idx + len("PICKED:"):].strip() if idx >= 0 else ""
    if not path:
        return {"ok": False, "cancelled": True}
    return load_video(path)


def load_video(path):
    """Troca o vídeo ativo: revalida, re-lê metadados e limpa o cache."""
    if not path or not os.path.isfile(path):
        return {"ok": False, "error": "Arquivo não encontrado."}
    if os.path.splitext(path)[1].lower() not in VIDEO_EXTS:
        return {"ok": False, "error": "Extensão de vídeo não suportada."}
    try:
        info = core.probe(state.FFPROBE, path)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao ler o vídeo: {e}"}

    state.VIDEO = os.path.abspath(path)
    state.INFO = info
    with state._lock:
        state._cache = {}
    return {
        "ok": True,
        "video": os.path.basename(state.VIDEO),
        "video_path": state.VIDEO,
        "video_dir": os.path.dirname(state.VIDEO),
        "media": {
            "duration": round(state.INFO["duration"], 3),
            "fps": round(state.INFO["fps"], 3),
            "width": state.INFO["width"], "height": state.INFO["height"],
            "channels": state.INFO["channels"],
        },
    }
