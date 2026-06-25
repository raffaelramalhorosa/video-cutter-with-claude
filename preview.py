"""Renderização do preview.mp4 com burn de legendas."""

import os
import subprocess

import silence_cut as core
import state
from compute import compute
from utils import sec_to_srt


def _caption_style_to_ass(style: dict, preview_h: int) -> str:
    """Converte CaptionStyle do frontend para force_style do filtro subtitles do ffmpeg."""
    def hex_to_ass(c: str) -> str:
        c = (c or "").lstrip("#")
        if len(c) == 6:
            return f"&H00{c[4:6]}{c[2:4]}{c[0:2]}".upper()
        return "&H00FFFFFF"

    font_size = max(10, int(float(style.get("fontSize", 20)) * 2.0))
    y_pct = float(style.get("yPct", 85)) / 100.0
    color = hex_to_ass(style.get("color", "#ffffff"))
    stroke = hex_to_ass(style.get("strokeColor", "#000000"))
    stroke_w = int(style.get("strokeWidth", 2))
    has_bg = bool(style.get("bg", False))

    if y_pct < 0.35:
        alignment, margin_v = 8, int(y_pct * preview_h)
    elif y_pct > 0.65:
        alignment, margin_v = 2, int((1.0 - y_pct) * preview_h)
    else:
        alignment, margin_v = 5, 0

    if has_bg:
        # BorderStyle=3 → caixa opaca; BackColour → fundo semi-transparente preto
        border_style = "BorderStyle=3,BackColour=&H80000000,"
        outline_shadow = "Outline=0,Shadow=0,"
    elif stroke_w == 0:
        # sem fundo e sem contorno → sombra como fallback de legibilidade
        border_style = ""
        outline_shadow = f"Outline=0,Shadow=3,OutlineColour={stroke},"
    else:
        border_style = ""
        outline_shadow = f"Outline={stroke_w},Shadow=0,OutlineColour={stroke},"

    return (
        f"FontName={style.get('font', 'Arial')},"
        f"FontSize={font_size},"
        f"PrimaryColour={color},"
        f"{border_style}"
        f"{outline_shadow}"
        f"Alignment={alignment},"
        f"MarginV={margin_v}"
    )


def make_preview(params):
    """Renderiza output/preview.mp4 com trechos mantidos e legendas queimadas."""
    if state.INFO is None:
        return {"ok": False, "error": "Nenhum vídeo carregado."}

    clips, _ = compute(params)
    keeps = [(c["sec_in"], c["sec_out"]) for c in clips]
    if not keeps:
        return {"ok": False, "error": "Nenhum trecho para manter."}

    os.makedirs(state.OUTDIR, exist_ok=True)
    out = os.path.join(state.OUTDIR, "preview.mp4")
    core.build_preview(state.FFMPEG, state.VIDEO, keeps, out)

    segs = params.get("segments") or []
    caption_style = params.get("caption_style") or {}
    if segs and caption_style.get("on", True) and os.path.isfile(out) and clips:
        overlay = core.classify_segments(segs, clips, state.INFO["fps"])
        remapped = [
            {**s, "start": ov["tl_start_s"], "end": ov["tl_end_s"]}
            for s, ov in zip(segs, overlay)
            if ov["status"] != "cut"
        ]
        if remapped:
            _burn_subtitles(out, remapped, caption_style)

    return {"ok": True, "path": out}


def _burn_subtitles(video_path: str, segs: list, style: dict) -> None:
    """Queima as legendas no vídeo em-place usando ffmpeg subtitles filter."""
    srt_name = "_preview_subs.srt"
    srt_tmp = os.path.join(state.OUTDIR, srt_name)
    with open(srt_tmp, "w", encoding="utf-8") as f:
        for i, s in enumerate(segs, 1):
            text = " ".join((s.get("text") or "").split())
            f.write(f"{i}\n{sec_to_srt(s['start'])} --> {sec_to_srt(s['end'])}\n{text}\n\n")

    # preview_h: largura escalada para 720px pelo build_preview, mantendo proporção
    preview_h = int(720 * state.INFO["height"] / max(state.INFO["width"], 1))
    force_style = _caption_style_to_ass(style, preview_h)
    out_sub = os.path.join(state.OUTDIR, "_preview_sub.mp4")

    # cwd=OUTDIR + nome relativo evita problema do ":" do drive no filtergraph do Windows
    cmd = [state.FFMPEG, "-y", "-hide_banner", "-nostats",
           "-i", video_path,
           "-vf", f"subtitles={srt_name}:force_style='{force_style}'",
           "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
           "-c:a", "copy", out_sub]
    res = subprocess.run(cmd, capture_output=True, text=True,
                         encoding="utf-8", errors="replace",
                         cwd=state.OUTDIR)
    if res.returncode == 0 and os.path.isfile(out_sub):
        os.replace(out_sub, video_path)
    else:
        print(f"[preview] burn de legendas falhou: {res.stderr[-400:]}", flush=True)
