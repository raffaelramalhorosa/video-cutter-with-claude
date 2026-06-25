"""Estado global compartilhado entre todos os módulos do servidor."""

import os
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(BASE, "output")

# Inicializados por server.py no startup via silence_cut.find_bin()
FFMPEG = None
FFPROBE = None

# Alterados por motion.load_video() e main()
VIDEO = None
INFO = None

# Cache do silencedetect — invalidado ao trocar de vídeo
_cache = {}
_lock = threading.Lock()
