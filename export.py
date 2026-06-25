"""Exportação do XML para Premiere e do SRT da legenda."""

import json
import os

import silence_cut as core
import state
from analysis import read_analysis
from compute import build_markers, build_motion_track, compute
from utils import sec_to_srt


def _export_dir() -> str:
    """Retorna output/<nome_do_video>/, criando se necessário."""
    stem = os.path.splitext(os.path.basename(state.VIDEO))[0]
    d = os.path.join(state.OUTDIR, stem)
    os.makedirs(d, exist_ok=True)
    return d


def _hex_to_ass(c: str) -> str:
    c = (c or "").lstrip("#")
    if len(c) == 6:
        return f"&H00{c[4:6]}{c[2:4]}{c[0:2]}".upper()
    return "&H00FFFFFF"


def _sec_to_ass(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    cs = int(round((sec % 1) * 100))
    return f"{h}:{m:02d}:{int(sec):02d}.{cs:02d}"


def export_ass(params):
    """Grava legenda_premiere.ass com estilos completos e N-palavras-por-vez."""
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
        remapped.append({
            **s,
            "_orig_start": s["start"],
            "start": ov["tl_start_s"],
            "end": ov["tl_end_s"],
        })

    if not remapped:
        return {"ok": False, "error": "Todos os trechos foram removidos pelo corte atual."}

    style = params.get("caption_style") or {}
    wpc = int(style.get("wordsPerCaption", 0))
    font = style.get("font", "Arial") or "Arial"
    font_size = max(10, int(float(style.get("fontSize", 20)) * 2.2))
    color = _hex_to_ass(style.get("color", "#ffffff"))
    stroke = _hex_to_ass(style.get("strokeColor", "#000000"))
    stroke_w = int(style.get("strokeWidth", 2))
    has_bg = bool(style.get("bg", False))
    y_pct = float(style.get("yPct", 85)) / 100.0

    play_h = 1080
    if y_pct < 0.35:
        alignment, margin_v = 8, int(y_pct * play_h)
    elif y_pct > 0.65:
        alignment, margin_v = 2, int((1.0 - y_pct) * play_h)
    else:
        alignment, margin_v = 5, 0

    if has_bg:
        border_style, outline, shadow = 3, 0, 0
        back_colour, outline_colour = "&H80000000", "&H00000000"
    elif stroke_w > 0:
        border_style, outline, shadow = 1, stroke_w, 0
        back_colour, outline_colour = "&H00000000", stroke
    else:
        border_style, outline, shadow = 1, 0, 3
        back_colour, outline_colour = "&H00000000", stroke

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 0\n"
        "PlayResX: 1920\n"
        f"PlayResY: {play_h}\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font},{font_size},{color},&H000000FF,{outline_colour},{back_colour},"
        f"0,0,0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},10,10,{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    lines = []
    for s in remapped:
        words = s.get("words") or []
        text_words = (s.get("text") or "").split()
        offset = s["start"] - s["_orig_start"]

        if wpc > 0 and len(words) >= 2 and len(words) == len(text_words):
            chunks = [list(range(i, min(i + wpc, len(words)))) for i in range(0, len(words), wpc)]
            for ci, idxs in enumerate(chunks):
                chunk_text = " ".join(text_words[j] for j in idxs)
                cs = words[idxs[0]]["start"] + offset
                if ci + 1 < len(chunks):
                    ce = words[chunks[ci + 1][0]]["start"] + offset
                else:
                    ce = s["end"]
                ce = min(ce, s["end"])
                lines.append(f"Dialogue: 0,{_sec_to_ass(cs)},{_sec_to_ass(ce)},Default,,0,0,0,,{chunk_text}")
        else:
            text = " ".join(text_words)
            lines.append(f"Dialogue: 0,{_sec_to_ass(s['start'])},{_sec_to_ass(s['end'])},Default,,0,0,0,,{text}")

    out = _export_dir()
    ass_path = os.path.join(out, "legenda_premiere.ass")
    with open(ass_path, "w", encoding="utf-8-sig") as f:
        f.write(header)
        f.write("\n".join(lines) + "\n")

    return {"ok": True, "count": len(lines), "ass_path": ass_path}


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

    out = _export_dir()
    srt_path = os.path.join(out, "legenda_premiere.srt")
    txt_path = os.path.join(out, "legenda_premiere.txt")

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

    out = _export_dir()
    seq_name = params.get("seq_name", "Auto-Cut")
    analysis = read_analysis()

    markers = build_markers(clips, analysis) if params.get("chapters_on") else None
    motion_indices = params.get("motion_indices") or []
    motion_track = build_motion_track(clips, analysis, motion_indices) if motion_indices else None

    xml = core.build_xml(state.INFO, clips, state.VIDEO, seq_name,
                         markers=markers, motion_track=motion_track)
    xml_path = os.path.join(out, "timeline.xml")
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
    json_path = os.path.join(out, "cortes.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return {"ok": True, "xml_path": xml_path, "json_path": json_path, "cuts": len(clips)}


def export_fcpxml(params):
    """Gera timeline.fcpxml compatível com DaVinci Resolve 18+ e Final Cut Pro."""
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    clips, _ = compute(params)
    if not clips:
        return {"ok": False, "error": "Nenhum trecho para manter. Afrouxe o limiar."}

    info  = state.INFO
    fps   = info["fps"]
    w, h  = info["width"], info["height"]
    video = state.VIDEO
    seq_name = params.get("seq_name", "Auto-Cut")

    # FCPXML usa frações racionais para tempo: frame_dur = 1/fps → numerador/denominador
    # Usamos timebase 1/fps em forma de string "Ns" (N frames / fps)
    def frames(sec):
        return f"{round(sec * fps)}/{round(fps)}s"

    total_frames = round(info["duration"] * fps)
    seq_dur = frames(sum(c["sec_out"] - c["sec_in"] for c in clips))

    asset_id  = "r1"
    format_id = "r2"
    seq_id    = "r3"

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE fcpxml>',
        '<fcpxml version="1.11">',
        '  <resources>',
        f'    <format id="{format_id}" name="FFVideoFormat{h}p{round(fps)}" '
        f'frameDuration="1/{round(fps)}s" width="{w}" height="{h}" colorSpace="1-1-1 (Rec. 709)"/>',
        f'    <asset id="{asset_id}" name="{os.path.basename(video)}" '
        f'start="0s" duration="{total_frames}/{round(fps)}s" '
        f'hasVideo="1" hasAudio="1" audioSources="1" audioChannels="{info.get("channels", 2)}" '
        f'audioRate="{info.get("sample_rate", 48000)}">',
        f'      <media-rep kind="original-media" src="file://{video.replace(chr(92), "/")}"/>',
        '    </asset>',
        '  </resources>',
        '  <library>',
        '    <event name="Auto-Cut">',
        f'    <project name="{seq_name}">',
        f'      <sequence duration="{seq_dur}" format="{format_id}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">',
        '        <spine>',
    ]

    offset_frames = 0
    for c in clips:
        src_in  = round(c["sec_in"]  * fps)
        src_out = round(c["sec_out"] * fps)
        clip_dur = src_out - src_in
        lines.append(
            f'          <asset-clip ref="{asset_id}" offset="{offset_frames}/{round(fps)}s" '
            f'name="{os.path.basename(video)}" start="{src_in}/{round(fps)}s" '
            f'duration="{clip_dur}/{round(fps)}s" format="{format_id}" tcFormat="NDF"/>'
        )
        offset_frames += clip_dur

    lines += [
        '        </spine>',
        '      </sequence>',
        '    </project>',
        '    </event>',
        '  </library>',
        '</fcpxml>',
    ]

    out = _export_dir()
    fcpxml_path = os.path.join(out, "timeline.fcpxml")
    with open(fcpxml_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return {"ok": True, "fcpxml_path": fcpxml_path, "cuts": len(clips)}
