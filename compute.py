"""Detecção de silêncio, cálculo de clips e overlays de transcrição."""

import silence_cut as core
import state


def get_silences(threshold, min_silence):
    """Roda silencedetect (custoso) só quando threshold/min_silence/video mudam.

    margin e min_clip não entram na chave porque só afetam compute_keeps(),
    chamado depois — a detecção de silêncio em si não muda com esses valores.
    """
    key = (state.VIDEO, round(threshold, 3), round(min_silence, 3))
    with state._lock:
        if key in state._cache:
            return state._cache[key]
        # evita crescimento ilimitado ao explorar muitos thresholds
        if len(state._cache) >= 30:
            state._cache.clear()
    silences = core.detect_silence(state.FFMPEG, state.VIDEO, threshold, min_silence)
    with state._lock:
        state._cache[key] = silences
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
                    nxt.append((s, e))
                else:
                    if cs > s:
                        nxt.append((s, cs))
                    if ce < e:
                        nxt.append((ce, e))
            pieces = nxt
        result.extend(pieces)
    return [(s, e) for s, e in result if e - s > 0.05]


def compute(params):
    """Aplica os parâmetros e devolve (clips, silences)."""
    if state.INFO is None:
        raise RuntimeError("Nenhum vídeo carregado.")

    threshold = float(params.get("threshold", -30.0))
    min_silence = float(params.get("min_silence", 0.5))
    margin = float(params.get("margin", 0.05))
    min_clip = float(params.get("min_clip", 0.3))

    silences = get_silences(threshold, min_silence)
    keeps = core.compute_keeps(silences, state.INFO["duration"], margin, min_clip)

    manual = params.get("manual_cuts") or []
    if manual:
        keeps = subtract_ranges(keeps, manual)

    clips = core.build_clips(keeps, state.INFO)
    return clips, silences


def detect(params):
    """Resultado para o painel: silêncios, trechos mantidos e estatísticas."""
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    clips, silences = compute(params)
    kept = sum(c["sec_out"] - c["sec_in"] for c in clips)
    dur = state.INFO["duration"]

    segs = params.get("segments") or []
    transcript_overlay = core.classify_segments(segs, clips, state.INFO["fps"]) if segs else []

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


def build_markers(clips, analysis):
    """Capítulos da análise de IA -> lista {name, frame} para build_xml."""
    if state.INFO is None:
        return []
    chapters = analysis.get("chapters") or []
    fps = state.INFO["fps"]
    markers = []
    for ch in chapters:
        mapped = core.map_time_to_timeline(ch["start_s"], clips, fps)
        markers.append({"name": ch["title"], "frame": mapped["frame"]})
    return markers


def build_motion_track(clips, analysis, motion_indices):
    """Clipes de motion design gerados -> lista {path, frame_start, frame_len}."""
    if state.INFO is None:
        return []
    import os
    items = analysis.get("motion_design") or []
    fps = state.INFO["fps"]
    motion_track = []
    for idx in motion_indices:
        if not (0 <= idx < len(items)):
            continue
        mov_path = os.path.join(state.OUTDIR, "motion", f"{idx}.mov")
        if not os.path.isfile(mov_path):
            continue
        item = items[idx]
        mapped = core.map_time_to_timeline(item["start_s"], clips, fps)
        frame_len = int(round((item["end_s"] - item["start_s"]) * fps))
        motion_track.append({"path": mov_path, "frame_start": mapped["frame"],
                              "frame_len": frame_len})
    return motion_track
