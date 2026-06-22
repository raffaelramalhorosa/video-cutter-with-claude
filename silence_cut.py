#!/usr/bin/env python3
"""
Pipeline: detecta silencio com FFmpeg e gera uma timeline FCP7 XML (xmeml)
que o Adobe Premiere Pro importa. O XML referencia o video original e grava
apenas pontos IN/OUT por clipe -- sem perda de qualidade e mantendo "alcas"
(handles) para o editor estender cada corte.

Uso:
    python silence_cut.py samples/test.mp4
    python silence_cut.py video.mp4 --threshold -30 --min-silence 0.5 --margin 0.05

Saidas em output/:
    - timeline.xml  (sequencia FCP7 para importar no Premiere)
    - cortes.json   (lista legivel dos trechos mantidos e removidos)
    - preview.mp4   (corte rapido para conferir; opcional)

Depende apenas de FFmpeg/ffprobe e da biblioteca padrao do Python.
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from urllib.parse import quote


# ---------------------------------------------------------------------------
# Localizacao dos binarios do FFmpeg
# ---------------------------------------------------------------------------
def find_bin(name):
    """Procura o executavel: PATH -> variavel FFMPEG_DIR -> instalacao do winget."""
    exe = name + (".exe" if os.name == "nt" else "")

    # 1) PATH do sistema
    found = shutil.which(name)
    if found:
        return found

    # 2) variavel de ambiente apontando para a pasta bin do FFmpeg
    env_dir = os.environ.get("FFMPEG_DIR")
    if env_dir:
        cand = os.path.join(env_dir, exe)
        if os.path.isfile(cand):
            return cand

    # 3) fallback: instalacao padrao do winget no Windows
    if os.name == "nt":
        base = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
        hits = glob.glob(os.path.join(base, "**", exe), recursive=True)
        if hits:
            return hits[0]

    sys.exit(f"ERRO: '{name}' nao encontrado. Instale o FFmpeg ou defina FFMPEG_DIR.")


# ---------------------------------------------------------------------------
# Metadados da midia (ffprobe)
# ---------------------------------------------------------------------------
def probe(ffprobe, path):
    """Le fps, dimensoes, duracao, sample rate e canais do arquivo de origem."""
    cmd = [ffprobe, "-v", "error", "-show_streams", "-show_format",
           "-of", "json", path]
    raw = subprocess.run(cmd, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    data = json.loads(raw.stdout)

    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        sys.exit("ERRO: o arquivo nao tem faixa de video.")

    num, den = video["r_frame_rate"].split("/")
    num, den = int(num), int(den)
    fps = num / den

    return {
        "fps": fps,
        "fps_num": num,
        "fps_den": den,
        "width": int(video["width"]),
        "height": int(video["height"]),
        "duration": float(data["format"]["duration"]),
        "sample_rate": int(audio["sample_rate"]) if audio else 48000,
        "channels": int(audio["channels"]) if audio else 2,
    }


def timebase_ntsc(fps_num, fps_den, fps):
    """Converte fps em (timebase inteiro, flag ntsc) no padrao FCP7."""
    # Frame rate inteiro (30/1, 25/1, 60/1...) -> ntsc FALSE
    if fps_den == 1:
        return fps_num, "FALSE"
    # Fracionario (30000/1001 = 29.97, 24000/1001 = 23.976...) -> ntsc TRUE
    return int(round(fps)), "TRUE"


# ---------------------------------------------------------------------------
# Deteccao de silencio (ffmpeg silencedetect)
# ---------------------------------------------------------------------------
def detect_silence(ffmpeg, path, threshold_db, min_silence):
    """Roda silencedetect e devolve lista de (inicio, fim) dos silencios, em segundos."""
    cmd = [ffmpeg, "-hide_banner", "-nostats", "-i", path,
           "-af", f"silencedetect=noise={threshold_db}dB:d={min_silence}",
           "-f", "null", "-"]
    raw = subprocess.run(cmd, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    log = raw.stderr

    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[0-9.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([0-9.]+)", log)]

    silences = []
    for i, s in enumerate(starts):
        end = ends[i] if i < len(ends) else None  # None = silencio vai ate o fim
        silences.append((max(0.0, s), end))
    return silences


# ---------------------------------------------------------------------------
# Calculo dos trechos a manter (inverso do silencio, com margem)
# ---------------------------------------------------------------------------
def compute_keeps(silences, duration, margin, min_clip):
    """
    Retorna os intervalos a MANTER. A margem encolhe cada silencio dos dois
    lados, ou seja, preserva um pouco de audio em volta da fala (as "alcas").
    """
    adjusted = []
    for start, end in silences:
        if end is None:
            end = duration
        s2 = start + margin
        e2 = end - margin
        if e2 - s2 > 0:  # ainda sobra silencio depois de aplicar a margem
            adjusted.append((s2, e2))
    adjusted.sort()

    keeps = []
    pointer = 0.0
    for s, e in adjusted:
        if s > pointer:
            keeps.append((pointer, s))
        pointer = max(pointer, e)
    if pointer < duration:
        keeps.append((pointer, duration))

    # Descarta trechos curtos demais (slivers) para nao gerar clipes inuteis
    return [(a, b) for a, b in keeps if (b - a) >= min_clip]


def build_clips(keeps, info):
    """Converte segundos em frames de origem (in/out) e posicao na timeline."""
    fps = info["fps"]
    clips = []
    timeline = 0
    for a, b in keeps:
        src_in = int(round(a * fps))
        src_out = int(round(b * fps))  # out e exclusivo no FCP7
        length = src_out - src_in
        if length <= 0:
            continue
        clips.append({
            "src_in": src_in,
            "src_out": src_out,
            "tl_start": timeline,
            "tl_end": timeline + length,
            "len": length,
            "sec_in": round(a, 3),
            "sec_out": round(b, 3),
        })
        timeline += length
    return clips


# ---------------------------------------------------------------------------
# Mapeamento de tempo (video original -> timeline ja cortada)
# ---------------------------------------------------------------------------
def map_time_to_timeline(t, clips, fps):
    """
    Converte um instante `t` (segundos no video ORIGINAL) para o frame
    correspondente na timeline pos-corte. Se `t` cair dentro de um trecho
    cortado (silencio removido), ancora no clipe mais proximo em vez de
    falhar -- e avisa isso via `anchored=True` no retorno.

    Retorna {"frame": int, "anchored": bool}.
    """
    if not clips:
        raise ValueError("clips vazio -- nao ha timeline para mapear")

    # Dentro de algum trecho mantido: posicao proporcional dentro do clipe.
    for clip in clips:
        if clip["sec_in"] <= t < clip["sec_out"]:
            offset_frames = int(round((t - clip["sec_in"]) * fps))
            return {"frame": clip["tl_start"] + offset_frames, "anchored": False}

    # Antes do primeiro clipe mantido: ancora no inicio da timeline.
    if t < clips[0]["sec_in"]:
        return {"frame": clips[0]["tl_start"], "anchored": True}

    # Depois do ultimo clipe mantido: ancora no fim da timeline.
    if t >= clips[-1]["sec_out"]:
        return {"frame": clips[-1]["tl_end"], "anchored": True}

    # Dentro de um corte entre dois clipes mantidos: ancora na borda mais proxima.
    for prev_clip, next_clip in zip(clips, clips[1:]):
        if prev_clip["sec_out"] <= t < next_clip["sec_in"]:
            dist_prev = t - prev_clip["sec_out"]
            dist_next = next_clip["sec_in"] - t
            if dist_prev <= dist_next:
                return {"frame": prev_clip["tl_end"], "anchored": True}
            return {"frame": next_clip["tl_start"], "anchored": True}

    raise ValueError(f"nao foi possivel mapear t={t} para a timeline")


# ---------------------------------------------------------------------------
# Geracao do XML FCP7 (xmeml v4)
# ---------------------------------------------------------------------------
def rate_block(tb, ntsc, indent):
    return (f"{indent}<rate>\n"
            f"{indent}  <timebase>{tb}</timebase>\n"
            f"{indent}  <ntsc>{ntsc}</ntsc>\n"
            f"{indent}</rate>\n")


def file_def(info, tb, ntsc, src_frames, pathurl, fname):
    """Definicao completa do arquivo de origem (usada uma unica vez)."""
    return (
        '          <file id="file-1">\n'
        f"            <name>{fname}</name>\n"
        f"            <pathurl>{pathurl}</pathurl>\n"
        + rate_block(tb, ntsc, "            ")
        + f"            <duration>{src_frames}</duration>\n"
        "            <media>\n"
        "              <video>\n"
        "                <samplecharacteristics>\n"
        + rate_block(tb, ntsc, "                  ")
        + f"                  <width>{info['width']}</width>\n"
        f"                  <height>{info['height']}</height>\n"
        "                  <pixelaspectratio>square</pixelaspectratio>\n"
        "                </samplecharacteristics>\n"
        "              </video>\n"
        "              <audio>\n"
        "                <samplecharacteristics>\n"
        "                  <depth>16</depth>\n"
        f"                  <samplerate>{info['sample_rate']}</samplerate>\n"
        "                </samplecharacteristics>\n"
        f"                <channelcount>{info['channels']}</channelcount>\n"
        "              </audio>\n"
        "            </media>\n"
        "          </file>\n"
    )


def links_block(i, channels, indent):
    """Liga o clipe de video aos seus clipes de audio para moverem juntos."""
    out = (f"{indent}<link>\n"
           f"{indent}  <linkclipref>clipitem-v{i}</linkclipref>\n"
           f"{indent}  <mediatype>video</mediatype>\n"
           f"{indent}  <trackindex>1</trackindex>\n"
           f"{indent}  <clipindex>{i + 1}</clipindex>\n"
           f"{indent}</link>\n")
    for ch in range(1, channels + 1):
        out += (f"{indent}<link>\n"
                f"{indent}  <linkclipref>clipitem-a{i}-{ch}</linkclipref>\n"
                f"{indent}  <mediatype>audio</mediatype>\n"
                f"{indent}  <trackindex>{ch}</trackindex>\n"
                f"{indent}  <clipindex>{i + 1}</clipindex>\n"
                f"{indent}</link>\n")
    return out


def video_clipitem(i, clip, tb, ntsc, src_frames, fname, channels, file_xml):
    return (
        f'        <clipitem id="clipitem-v{i}">\n'
        f"          <name>{fname}</name>\n"
        "          <enabled>TRUE</enabled>\n"
        f"          <duration>{src_frames}</duration>\n"
        + rate_block(tb, ntsc, "          ")
        + f"          <start>{clip['tl_start']}</start>\n"
        f"          <end>{clip['tl_end']}</end>\n"
        f"          <in>{clip['src_in']}</in>\n"
        f"          <out>{clip['src_out']}</out>\n"
        + file_xml
        + "          <sourcetrack>\n"
        "            <mediatype>video</mediatype>\n"
        "          </sourcetrack>\n"
        + links_block(i, channels, "          ")
        + "        </clipitem>\n"
    )


def audio_clipitem(i, ch, clip, tb, ntsc, src_frames, fname, channels):
    return (
        f'        <clipitem id="clipitem-a{i}-{ch}">\n'
        f"          <name>{fname}</name>\n"
        "          <enabled>TRUE</enabled>\n"
        f"          <duration>{src_frames}</duration>\n"
        + rate_block(tb, ntsc, "          ")
        + f"          <start>{clip['tl_start']}</start>\n"
        f"          <end>{clip['tl_end']}</end>\n"
        f"          <in>{clip['src_in']}</in>\n"
        f"          <out>{clip['src_out']}</out>\n"
        '          <file id="file-1"/>\n'
        "          <sourcetrack>\n"
        "            <mediatype>audio</mediatype>\n"
        f"            <trackindex>{ch}</trackindex>\n"
        "          </sourcetrack>\n"
        + links_block(i, channels, "          ")
        + "        </clipitem>\n"
    )


def marker_block(marker, indent):
    """Um <marker> no nivel da <sequence> (capitulo)."""
    return (f"{indent}<marker>\n"
            f"{indent}  <comment></comment>\n"
            f"{indent}  <name>{marker['name']}</name>\n"
            f"{indent}  <in>{marker['frame']}</in>\n"
            f"{indent}  <out>-1</out>\n"
            f"{indent}</marker>\n")


def motion_clipitem(i, item, tb, ntsc):
    """Clipe da 2a trilha de video (motion design) -- sem audio, sem links."""
    abspath = os.path.abspath(item["path"])
    pathurl = "file://localhost/" + quote(abspath.replace("\\", "/"), safe="/:")
    fname = os.path.basename(abspath)
    frame_len = item["frame_len"]
    return (
        f'        <clipitem id="clipitem-m{i}">\n'
        f"          <name>{fname}</name>\n"
        "          <enabled>TRUE</enabled>\n"
        f"          <duration>{frame_len}</duration>\n"
        + rate_block(tb, ntsc, "          ")
        + f"          <start>{item['frame_start']}</start>\n"
        f"          <end>{item['frame_start'] + frame_len}</end>\n"
        "          <in>0</in>\n"
        f"          <out>{frame_len}</out>\n"
        f'          <file id="file-motion-{i}">\n'
        f"            <name>{fname}</name>\n"
        f"            <pathurl>{pathurl}</pathurl>\n"
        + rate_block(tb, ntsc, "            ")
        + f"            <duration>{frame_len}</duration>\n"
        "            <media>\n"
        "              <video>\n"
        "                <samplecharacteristics>\n"
        + rate_block(tb, ntsc, "                  ")
        + "                </samplecharacteristics>\n"
        "              </video>\n"
        "            </media>\n"
        "          </file>\n"
        "          <sourcetrack>\n"
        "            <mediatype>video</mediatype>\n"
        "          </sourcetrack>\n"
        "        </clipitem>\n"
    )


def build_xml(info, clips, src_path, seq_name, markers=None, motion_track=None):
    tb, ntsc = timebase_ntsc(info["fps_num"], info["fps_den"], info["fps"])
    src_frames = int(round(info["duration"] * info["fps"]))
    channels = info["channels"]

    abspath = os.path.abspath(src_path)
    pathurl = "file://localhost/" + quote(abspath.replace("\\", "/"), safe="/:")
    fname = os.path.basename(abspath)
    total = sum(c["len"] for c in clips)
    displayformat = "DF" if ntsc == "TRUE" else "NDF"

    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           "<!DOCTYPE xmeml>",
           '<xmeml version="4">',
           '  <sequence id="sequence-1">',
           f"    <name>{seq_name}</name>",
           f"    <duration>{total}</duration>"]
    xml.append(rate_block(tb, ntsc, "    ").rstrip("\n"))
    xml.append("    <timecode>")
    xml.append(rate_block(tb, ntsc, "      ").rstrip("\n"))
    xml.append("      <string>00:00:00:00</string>")
    xml.append("      <frame>0</frame>")
    xml.append(f"      <displayformat>{displayformat}</displayformat>")
    xml.append("    </timecode>")
    xml.append("    <media>")

    # ---- VIDEO ----
    xml.append("      <video>")
    xml.append("        <format>")
    xml.append("          <samplecharacteristics>")
    xml.append(rate_block(tb, ntsc, "            ").rstrip("\n"))
    xml.append(f"            <width>{info['width']}</width>")
    xml.append(f"            <height>{info['height']}</height>")
    xml.append("            <pixelaspectratio>square</pixelaspectratio>")
    xml.append("            <fielddominance>none</fielddominance>")
    xml.append("          </samplecharacteristics>")
    xml.append("        </format>")
    xml.append("        <track>")
    for i, clip in enumerate(clips):
        # Define o arquivo por completo so no primeiro clipe; depois so referencia o id
        file_xml = (file_def(info, tb, ntsc, src_frames, pathurl, fname)
                    if i == 0 else '          <file id="file-1"/>\n')
        xml.append(video_clipitem(i, clip, tb, ntsc, src_frames, fname,
                                  channels, file_xml).rstrip("\n"))
    xml.append("        </track>")
    if motion_track:
        xml.append("        <track>")
        for i, item in enumerate(motion_track):
            xml.append(motion_clipitem(i, item, tb, ntsc).rstrip("\n"))
        xml.append("        </track>")
    xml.append("      </video>")

    # ---- AUDIO ---- (uma track por canal)
    xml.append("      <audio>")
    xml.append("        <format>")
    xml.append("          <samplecharacteristics>")
    xml.append("            <depth>16</depth>")
    xml.append(f"            <samplerate>{info['sample_rate']}</samplerate>")
    xml.append("          </samplecharacteristics>")
    xml.append("        </format>")
    for ch in range(1, channels + 1):
        xml.append("        <track>")
        for i, clip in enumerate(clips):
            xml.append(audio_clipitem(i, ch, clip, tb, ntsc, src_frames,
                                      fname, channels).rstrip("\n"))
        xml.append("        </track>")
    xml.append("      </audio>")

    xml.append("    </media>")
    if markers:
        for marker in markers:
            xml.append(marker_block(marker, "    ").rstrip("\n"))
    xml.append("  </sequence>")
    xml.append("</xmeml>")
    return "\n".join(xml) + "\n"


# ---------------------------------------------------------------------------
# Preview rapido (corte concatenado) -- opcional
# ---------------------------------------------------------------------------
def build_preview(ffmpeg, src_path, keeps, out_path):
    """Gera um MP4 com apenas os trechos mantidos, para conferencia."""
    parts = []
    labels = []
    for i, (a, b) in enumerate(keeps):
        parts.append(f"[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS[v{i}]")
        parts.append(f"[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]")
        labels.append(f"[v{i}][a{i}]")
    n = len(keeps)
    concat = "".join(labels) + f"concat=n={n}:v=1:a=1[v][a]"
    filtergraph = ";".join(parts) + ";" + concat

    cmd = [ffmpeg, "-y", "-hide_banner", "-nostats", "-i", src_path,
           "-filter_complex", filtergraph, "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-c:a", "aac", out_path]
    subprocess.run(cmd, capture_output=True, text=True,
                   encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Motion design (clipe separado, fundo transparente, sem audio)
# ---------------------------------------------------------------------------
# O clipe de texto animado (.mov ProRes 4444 com alpha) e gerado pelo projeto
# Remotion em remotion/ (React) -- ver render_motion_remotion() em server.py.
# Aqui fica apenas o compositor do preview (texto sobre o video, em H.264).


def render_motion_preview(ffmpeg, src_video, mov_path, start_s, duration,
                          out_path, preview_width=540):
    """
    Gera um MP4 (H.264) de preview do motion design para tocar no navegador.

    O .mov entregue ao Premiere e ProRes 4444 com alpha -- e navegador nenhum
    reproduz ProRes. Aqui sobrepomos o texto (mov) ao trecho real do video de
    origem e exportamos em H.264, que toca em qualquer navegador. Assim o
    usuario ve exatamente como o texto vai ficar sobre o video.

    O filtergraph nao referencia caminhos (so os rotulos [0:v]/[1:v]), entao
    nao ha o problema de escapar "C:\\" -- os arquivos entram como -i normais.
    """
    out_dir = os.path.dirname(os.path.abspath(out_path)) or "."
    os.makedirs(out_dir, exist_ok=True)
    w = preview_width
    fc = (f"[0:v]scale={w}:-2,setpts=PTS-STARTPTS[bg];"
          f"[1:v]scale={w}:-2,setpts=PTS-STARTPTS[fg];"
          "[bg][fg]overlay=0:0,format=yuv420p[v]")
    cmd = [ffmpeg, "-y", "-hide_banner", "-nostats",
           "-ss", str(start_s), "-t", str(duration), "-i", src_video,
           "-i", os.path.abspath(mov_path),
           "-filter_complex", fc, "-map", "[v]", "-an",
           "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
           "-movflags", "+faststart", out_path]
    raw = subprocess.run(cmd, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if raw.returncode != 0 or not os.path.isfile(out_path):
        raise RuntimeError(f"falha ao gerar preview do motion: {raw.stderr}")
    return os.path.abspath(out_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Corta silencios e gera timeline FCP7 XML para o Premiere.")
    ap.add_argument("input", help="video de origem (MP4/MOV)")
    ap.add_argument("--outdir", default="output", help="pasta de saida (padrao: output)")
    ap.add_argument("--threshold", type=float, default=-30.0, help="limiar de silencio em dB (padrao: -30)")
    ap.add_argument("--min-silence", type=float, default=0.5, help="duracao minima do silencio em s (padrao: 0.5)")
    ap.add_argument("--margin", type=float, default=0.05, help="margem/alca em s mantida ao redor da fala (padrao: 0.05)")
    ap.add_argument("--min-clip", type=float, default=0.3, help="descarta trechos mantidos menores que isto, em s (padrao: 0.3)")
    ap.add_argument("--seq-name", default="Auto-Cut", help="nome da sequencia no Premiere")
    ap.add_argument("--no-preview", action="store_true", help="nao gerar preview.mp4")
    args = ap.parse_args()

    ffmpeg = find_bin("ffmpeg")
    ffprobe = find_bin("ffprobe")

    os.makedirs(args.outdir, exist_ok=True)

    info = probe(ffprobe, args.input)
    silences = detect_silence(ffmpeg, args.input, args.threshold, args.min_silence)
    keeps = compute_keeps(silences, info["duration"], args.margin, args.min_clip)
    clips = build_clips(keeps, info)

    if not clips:
        sys.exit("Nenhum trecho para manter. Ajuste --threshold ou --min-silence.")

    # cortes.json -- visao legivel para revisao
    report = {
        "source": os.path.abspath(args.input),
        "params": {
            "threshold_db": args.threshold,
            "min_silence_s": args.min_silence,
            "margin_s": args.margin,
            "min_clip_s": args.min_clip,
        },
        "media": {
            "fps": round(info["fps"], 3),
            "duration_s": round(info["duration"], 3),
            "width": info["width"],
            "height": info["height"],
            "sample_rate": info["sample_rate"],
            "channels": info["channels"],
        },
        "silences_detected": [
            {"start_s": round(s, 3), "end_s": (round(e, 3) if e is not None else None)}
            for s, e in silences
        ],
        "segments_kept": [
            {"in_s": c["sec_in"], "out_s": c["sec_out"],
             "in_frame": c["src_in"], "out_frame": c["src_out"]}
            for c in clips
        ],
    }
    json_path = os.path.join(args.outdir, "cortes.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # timeline.xml -- entregavel para o Premiere
    xml = build_xml(info, clips, args.input, args.seq_name)
    xml_path = os.path.join(args.outdir, "timeline.xml")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)

    # preview.mp4 -- conferencia opcional
    preview_path = None
    if not args.no_preview:
        preview_path = os.path.join(args.outdir, "preview.mp4")
        build_preview(ffmpeg, args.input, keeps, preview_path)

    # Resumo no terminal
    kept_total = sum(c["sec_out"] - c["sec_in"] for c in clips)
    print(f"Origem:     {os.path.abspath(args.input)}")
    print(f"Duracao:    {info['duration']:.2f}s | fps {info['fps']:.3f} | {info['width']}x{info['height']} | {info['channels']} canal(is)")
    print(f"Silencios:  {len(silences)} detectados")
    print(f"Trechos:    {len(clips)} mantidos | {kept_total:.2f}s de {info['duration']:.2f}s")
    for c in clips:
        print(f"   manter {c['sec_in']:>7.2f}s -> {c['sec_out']:>7.2f}s  (frames {c['src_in']}-{c['src_out']})")
    print(f"XML:        {os.path.abspath(xml_path)}")
    print(f"JSON:       {os.path.abspath(json_path)}")
    if preview_path:
        print(f"Preview:    {os.path.abspath(preview_path)}")


if __name__ == "__main__":
    main()
