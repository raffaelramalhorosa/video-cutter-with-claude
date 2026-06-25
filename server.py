#!/usr/bin/env python3
"""
Servidor local do painel de revisão de cortes.

Serve o painel web (web/dist/) e expõe a API que aciona os módulos de análise,
transcrição, preview e exportação. Toda a lógica de negócio fica nos módulos:
state, utils, analysis, transcribe, compute, preview, export, motion.

Uso:
    python server.py [--video samples/test.mp4] [--port 8765]
"""

import argparse
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

import silence_cut as core  # noqa: E402
from silence_cut import get_waveform  # noqa: E402
import state                # noqa: E402
from analysis import ia_status, read_analysis  # noqa: E402
from compute import detect                       # noqa: E402
from export import export, export_ass, export_srt, export_fcpxml  # noqa: E402
from motion import load_video, pick_file, render_motion  # noqa: E402
from preview import make_preview                 # noqa: E402
from transcribe import transcribe                # noqa: E402
from utils import parse_srt                      # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _safe_write(self, data):
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

    def _serve_range(self, path, ctype):
        """Serve arquivo de vídeo com suporte a Range (necessário para seek no player)."""
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
            while remaining > 0:
                data = f.read(min(65536, remaining))
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
            if not state.VIDEO:
                self.send_error(404)
                return
            ctype = "video/quicktime" if state.VIDEO.lower().endswith(".mov") else "video/mp4"
            self._serve_range(state.VIDEO, ctype)
        elif path == "/preview_media":
            preview_path = os.path.join(state.OUTDIR, "preview.mp4")
            if not os.path.isfile(preview_path):
                self.send_error(404)
                return
            self._serve_range(preview_path, "video/mp4")
        elif path.startswith("/motion/"):
            fname = os.path.basename(path)
            fpath = os.path.join(state.OUTDIR, "motion", fname)
            ext = os.path.splitext(fname)[1].lower()
            ctype = {".mp4": "video/mp4", ".webm": "video/webm"}.get(ext, "video/quicktime")
            self._serve_range(fpath, ctype)
        elif path.startswith("/assets/"):
            fname = os.path.basename(path)
            fpath = os.path.join(BASE, "web", "dist", "assets", fname)
            ext = fname.rsplit(".", 1)[-1] if "." in fname else ""
            mime = {"js": "application/javascript", "css": "text/css",
                    "woff2": "font/woff2", "woff": "font/woff",
                    "png": "image/png", "svg": "image/svg+xml"}.get(ext, "application/octet-stream")
            self._serve_static(fpath, mime)
        elif path == "/api/analysis":
            self._json(read_analysis())
        elif path == "/api/transcript":
            jpath = os.path.join(state.OUTDIR, "transcricao.json")
            srt = os.path.join(state.OUTDIR, "transcricao.srt")
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
        elif path == "/api/chat_response":
            resp_path = os.path.join(state.OUTDIR, "chat_response.json")
            if os.path.isfile(resp_path):
                try:
                    with open(resp_path, encoding="utf-8") as f:
                        data = json.load(f)
                    data["available"] = True
                    self._json(data)
                except (OSError, json.JSONDecodeError):
                    self._json({"available": False})
            else:
                self._json({"available": False})
        elif path == "/api/trans_progress":
            pp = os.path.join(state.OUTDIR, "trans_progress.txt")
            if not os.path.isfile(pp):
                self._json({"lines": [], "done": False})
                return
            try:
                with open(pp, encoding="utf-8") as f:
                    content = f.read()
                lines = [l for l in content.splitlines() if l.strip() and l.strip() != "__DONE__"]
                done = "__DONE__" in content
                self._json({"lines": lines[-20:], "done": done})  # últimas 20 linhas
            except OSError:
                self._json({"lines": [], "done": False})
        elif path == "/api/waveform":
            if not state.VIDEO:
                self._json({"available": False})
                return
            dur = state.INFO["duration"] if state.INFO else 0
            self._json({**get_waveform(state.FFMPEG, state.VIDEO, dur), "available": True})
        elif path == "/api/info":
            if not state.INFO:
                self._json({"video": None})
                return
            self._json({
                "video": os.path.basename(state.VIDEO),
                "video_path": state.VIDEO,
                "video_dir": os.path.dirname(state.VIDEO),
                "media": {
                    "duration": round(state.INFO["duration"], 3),
                    "fps": round(state.INFO["fps"], 3),
                    "width": state.INFO["width"], "height": state.INFO["height"],
                    "channels": state.INFO["channels"],
                },
                "defaults": {"threshold": -30.0, "min_silence": 0.5,
                             "margin": 0.05, "min_clip": 0.3},
            })
        elif path == "/api/open_folder":
            import platform, subprocess as _sp
            # abre a subpasta do vídeo atual se existir, senão abre output/
            if state.VIDEO:
                stem = os.path.splitext(os.path.basename(state.VIDEO))[0]
                sub = os.path.join(state.OUTDIR, stem)
                folder = os.path.abspath(sub if os.path.isdir(sub) else state.OUTDIR)
            else:
                folder = os.path.abspath(state.OUTDIR)
            try:
                if platform.system() == "Windows":
                    _sp.Popen(["explorer", folder])
                elif platform.system() == "Darwin":
                    _sp.Popen(["open", folder])
                else:
                    _sp.Popen(["xdg-open", folder])
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})
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
        elif path == "/api/export_fcpxml":
            self._json(export_fcpxml(params))
        elif path == "/api/preview":
            self._json(make_preview(params))
        elif path == "/api/transcribe":
            self._json(transcribe(params))
        elif path == "/api/export_srt":
            self._json(export_srt(params))
        elif path == "/api/export_ass":
            self._json(export_ass(params))
        elif path == "/api/pick":
            self._json(pick_file())
        elif path == "/api/motion/render":
            self._json(render_motion(params))
        elif path == "/api/chat":
            req_path = os.path.join(state.OUTDIR, "chat_request.json")
            os.makedirs(state.OUTDIR, exist_ok=True)
            data = {
                "id": params.get("id", f"req_{int(time.time())}"),
                "message": str(params.get("message", ""))[:2000],
                "timestamp": int(time.time()),
            }
            with open(req_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            self._json({"ok": True, "id": data["id"]})
        elif path == "/api/glossary/add":
            word = str(params.get("word", "")).strip()
            if not word:
                self._json({"ok": False, "error": "palavra vazia"})
                return
            gpath = os.path.join(BASE, "glossario.txt")
            try:
                existing = open(gpath, encoding="utf-8").read() if os.path.isfile(gpath) else ""
                # evita duplicatas (case-insensitive)
                if word.lower() not in existing.lower():
                    with open(gpath, "a", encoding="utf-8") as f:
                        f.write(f", {word}" if existing.strip() else word)
                self._json({"ok": True, "word": word})
            except OSError as e:
                self._json({"ok": False, "error": str(e)})
        elif path == "/api/glossary":
            gpath = os.path.join(BASE, "glossario.txt")
            try:
                content = open(gpath, encoding="utf-8").read() if os.path.isfile(gpath) else ""
                words = [w.strip() for w in content.split(",") if w.strip()]
                self._json({"ok": True, "words": words})
            except OSError as e:
                self._json({"ok": False, "words": [], "error": str(e)})
        elif path == "/api/glossary/remove":
            word = str(params.get("word", "")).strip()
            if not word:
                self._json({"ok": False, "error": "palavra vazia"})
                return
            gpath = os.path.join(BASE, "glossario.txt")
            try:
                existing = open(gpath, encoding="utf-8").read() if os.path.isfile(gpath) else ""
                words = [w.strip() for w in existing.split(",") if w.strip() and w.strip().lower() != word.lower()]
                with open(gpath, "w", encoding="utf-8") as f:
                    f.write(", ".join(words))
                self._json({"ok": True, "words": words})
            except OSError as e:
                self._json({"ok": False, "error": str(e)})
        elif path == "/api/load_video":
            self._json(load_video(params.get("path", "")))
        else:
            self.send_error(404)


def main():
    ap = argparse.ArgumentParser(description="Painel de revisão de cortes (servidor local).")
    ap.add_argument("--video", default="", help="vídeo de origem (opcional — pode selecionar pelo painel)")
    ap.add_argument("--port", type=int, default=8765, help="porta HTTP")
    args = ap.parse_args()

    if args.video:
        video = args.video if os.path.isabs(args.video) else os.path.join(BASE, args.video)
        if not os.path.isfile(video):
            sys.exit(f"ERRO: vídeo não encontrado: {video}")
        result = load_video(video)
        if not result.get("ok"):
            sys.exit(f"ERRO: {result.get('error')}")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    video_label = os.path.basename(state.VIDEO) if state.VIDEO else "(nenhum — selecione pelo painel)"
    print(f"Painel em http://127.0.0.1:{args.port}  (vídeo: {video_label})")
    server.serve_forever()


if __name__ == "__main__":
    main()
