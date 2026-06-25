"""Utilitários puros sem dependências de estado."""

import re


def sec_to_srt(t):
    """Segundos -> 'HH:MM:SS,mmm' (formato de tempo do SRT)."""
    t = max(0.0, float(t))
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s, ms = s + 1, 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def srt_time_to_sec(t):
    """'00:00:01,234' -> 1.234"""
    h, m, rest = t.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(path):
    """Lê um arquivo SRT e devolve [{start, end, text}]."""
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
        segs.append({"start": round(srt_time_to_sec(start_s), 3),
                     "end": round(srt_time_to_sec(end_s), 3),
                     "text": text})
    return segs
