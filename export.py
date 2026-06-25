"""Exportação do XML para Premiere e do SRT da legenda."""

import json
import os

import silence_cut as core
import state
from analysis import read_analysis
from compute import build_markers, build_motion_track, compute
from utils import sec_to_srt


def export_srt(params):
    """Grava legenda_premiere.srt re-temporizado para a timeline já cortada."""
    segs = params.get("segments", [])
    if not segs:
        return {"ok": False, "error": "Nada para exportar."}
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    clips, _ = compute(params)
    overlay = core.classify_segments(segs, clips, state.INFO["fps"]) if clips else []

    remapped = []
    for s, ov in zip(segs, overlay):
        if ov["status"] == "cut":
            continue
        remapped.append({**s, "start": ov["tl_start_s"], "end": ov["tl_end_s"]})

    if not remapped:
        return {"ok": False, "error": "Todos os trechos foram removidos pelo corte atual."}

    os.makedirs(state.OUTDIR, exist_ok=True)
    srt_path = os.path.join(state.OUTDIR, "legenda_premiere.srt")
    txt_path = os.path.join(state.OUTDIR, "legenda_premiere.txt")

    with open(srt_path, "w", encoding="utf-8") as f:
        for i, s in enumerate(remapped, 1):
            text = " ".join((s.get("text") or "").split())
            f.write(f"{i}\n{sec_to_srt(s['start'])} --> {sec_to_srt(s['end'])}\n{text}\n\n")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(" ".join((s.get("text") or "").split()) for s in remapped))

    return {"ok": True, "count": len(remapped), "srt_path": srt_path, "txt_path": txt_path}


def export(params):
    """Gera timeline.xml + cortes.json em output/."""
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    clips, _ = compute(params)
    if not clips:
        return {"ok": False, "error": "Nenhum trecho para manter. Afrouxe o limiar."}

    os.makedirs(state.OUTDIR, exist_ok=True)
    seq_name = params.get("seq_name", "Auto-Cut")
    analysis = read_analysis()

    markers = build_markers(clips, analysis) if params.get("chapters_on") else None
    motion_indices = params.get("motion_indices") or []
    motion_track = build_motion_track(clips, analysis, motion_indices) if motion_indices else None

    xml = core.build_xml(state.INFO, clips, state.VIDEO, seq_name,
                         markers=markers, motion_track=motion_track)
    xml_path = os.path.join(state.OUTDIR, "timeline.xml")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)

    report = {
        "source": os.path.abspath(state.VIDEO),
        "params": {
            "threshold_db": float(params.get("threshold", -30.0)),
            "min_silence_s": float(params.get("min_silence", 0.5)),
            "margin_s": float(params.get("margin", 0.05)),
            "min_clip_s": float(params.get("min_clip", 0.3)),
        },
        "media": {
            "fps": round(state.INFO["fps"], 3),
            "duration_s": round(state.INFO["duration"], 3),
            "width": state.INFO["width"], "height": state.INFO["height"],
            "sample_rate": state.INFO["sample_rate"], "channels": state.INFO["channels"],
        },
        "segments_kept": [
            {"in_s": c["sec_in"], "out_s": c["sec_out"],
             "in_frame": c["src_in"], "out_frame": c["src_out"]}
            for c in clips
        ],
    }
    json_path = os.path.join(state.OUTDIR, "cortes.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return {"ok": True, "xml_path": xml_path, "json_path": json_path, "cuts": len(clips)}
