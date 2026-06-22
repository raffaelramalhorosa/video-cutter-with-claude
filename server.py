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
    """Roda o silencedetect (custoso) so quando threshold/min_silence mudam."""
    key = (round(threshold, 3), round(min_silence, 3))
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
    }


def export(params):
    """Gera timeline.xml + cortes.json em output/."""
    clips, silences = compute(params)
    if not clips:
        return {"ok": False, "error": "Nenhum trecho para manter. Afrouxe o limiar."}

    os.makedirs(OUTDIR, exist_ok=True)
    seq_name = params.get("seq_name", "Auto-Cut")

    xml = core.build_xml(INFO, clips, VIDEO, seq_name)
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


def transcribe(params):
    """Transcreve o audio do video atual e grava SRT + TXT em output/."""
    model = find_model()
    if not model:
        return {"ok": False, "error": "Modelo Whisper nao encontrado. "
                "Baixe um ggml-*.bin para a pasta models/."}

    language = params.get("language", "pt") or "pt"
    os.makedirs(OUTDIR, exist_ok=True)
    srt_path = os.path.join(OUTDIR, "transcricao.srt")
    try:
        os.remove(srt_path)  # evita misturar com transcricao anterior
    except OSError:
        pass

    # Caminhos relativos a BASE evitam ter de escapar "C:\\" dentro do filtergraph
    # do ffmpeg (o ":" do drive quebra o parser). Por isso rodamos com cwd=BASE.
    try:
        model_arg = os.path.relpath(model, BASE).replace("\\", "/")
    except ValueError:
        model_arg = model.replace("\\", "/")  # modelo em outro drive (raro)
    dest_arg = os.path.relpath(srt_path, BASE).replace("\\", "/")

    af = (f"whisper=model={model_arg}:language={language}:format=srt:"
          f"queue=30:destination={dest_arg}")
    cmd = [FFMPEG, "-y", "-hide_banner", "-nostats", "-i", VIDEO,
           "-vn", "-af", af, "-f", "null", "-"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace",
                             timeout=3600, cwd=BASE)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Falha ao executar a transcricao: {e}"}

    if not os.path.isfile(srt_path):
        return {"ok": False, "error": "A transcricao nao gerou saida.",
                "log": (res.stderr or "")[-800:]}

    segs = parse_srt(srt_path)
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
    """Grava SRT + TXT a partir dos segmentos (possivelmente editados) do painel."""
    segs = params.get("segments", [])
    if not segs:
        return {"ok": False, "error": "Nada para exportar."}

    os.makedirs(OUTDIR, exist_ok=True)
    srt_path = os.path.join(OUTDIR, "transcricao.srt")
    txt_path = os.path.join(OUTDIR, "transcricao.txt")

    with open(srt_path, "w", encoding="utf-8") as f:
        for i, s in enumerate(segs, 1):
            text = " ".join((s.get("text") or "").split())  # 1 linha por legenda
            f.write(f"{i}\n{_sec_to_srt(s['start'])} --> {_sec_to_srt(s['end'])}\n{text}\n\n")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(" ".join((s.get("text") or "").split()) for s in segs))

    return {"ok": True, "count": len(segs), "srt_path": srt_path, "txt_path": txt_path}


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
        """Serve o video com suporte a Range (necessario para o player buscar)."""
        path = VIDEO
        if not os.path.isfile(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        ctype = "video/quicktime" if path.lower().endswith(".mov") else "video/mp4"
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
            self._serve_static(os.path.join(BASE, "web", "index.html"),
                               "text/html; charset=utf-8")
        elif path == "/tailwind.css":
            self._serve_static(os.path.join(BASE, "web", "tailwind.css"),
                               "text/css; charset=utf-8")
        elif path == "/media":
            self._serve_media()
        elif path == "/api/analysis":
            self._json(read_analysis())
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
