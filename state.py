"""Estado global compartilhado entre todos os módulos do servidor."""

import os
import sys
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
OUTDIR = os.path.join(BASE, "output")

import silence_cut as _core  # noqa: E402

FFMPEG = _core.find_bin("ffmpeg")
FFPROBE = _core.find_bin("ffprobe")

# Alterados por motion.load_video() e main()
VIDEO = None
INFO = None

# Cache do silencedetect — invalidado ao trocar de vídeo
_cache = {}
_lock = threading.Lock()
