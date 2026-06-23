import { useRef, useEffect, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { useAppStore } from '../../store/useAppStore'
import { FinalVideo, type CaptionSeg } from '../../remotion/FinalVideo'

/**
 * Adaptador: expõe a mesma interface que o resto do app já usava no <video>
 * cru (currentTime em SEGUNDOS, play, pause), mas por baixo fala com o
 * <Player> do Remotion, que trabalha em FRAMES. Lê o ref do Player AO VIVO
 * (no momento da chamada) — assim funciona mesmo que o ref só fique pronto
 * depois do efeito de montagem. Timeline, TranscriptPanel, TranscriptSegment
 * e TabRevisao continuam funcionando sem mudança.
 */
class PlayerAdapter {
  constructor(private getRef: () => PlayerRef | null, private getFps: () => number) {}
  get currentTime(): number {
    const r = this.getRef()
    return r ? r.getCurrentFrame() / this.getFps() : 0
  }
  set currentTime(sec: number) {
    const r = this.getRef()
    if (r) r.seekTo(Math.round(sec * this.getFps()))
  }
  play() {
    const r = this.getRef()
    if (r) { try { r.play() } catch { /* play pode exigir gesto do usuário */ } }
  }
  pause() {
    const r = this.getRef()
    if (r) r.pause()
  }
}

// Mantém o mesmo ponto de acesso global que os outros componentes importam.
export const playerRef = { current: null as PlayerAdapter | null }

export default function VideoPlayer() {
  const remRef = useRef<PlayerRef>(null)
  const mediaMeta = useAppStore((s) => s.mediaMeta)
  const dur = useAppStore((s) => s.dur)
  const videoTs = useAppStore((s) => s.videoTs)
  const keeps = useAppStore((s) => s.keeps)
  const skipMode = useAppStore((s) => s.skipMode)
  const setSkipMode = useAppStore((s) => s.setSkipMode)
  const transSegs = useAppStore((s) => s.transSegs)
  const transOverlay = useAppStore((s) => s.transOverlay)
  const [captionsOn, setCaptionsOn] = useState(true)

  const fps = mediaMeta?.fps ?? 30
  const fpsRef = useRef(fps)
  fpsRef.current = fps

  // legendas para a composição: texto (editado) + flag de corte (some no preview final)
  const segments: CaptionSeg[] = transSegs.map((s, i) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    cut: transOverlay[i]?.status === 'cut',
  }))

  // adaptador criado uma vez; lê remRef/fps ao vivo, então não importa quando o ref fica pronto
  const adapterRef = useRef<PlayerAdapter | null>(null)
  if (!adapterRef.current) {
    adapterRef.current = new PlayerAdapter(() => remRef.current, () => fpsRef.current)
  }
  useEffect(() => {
    playerRef.current = adapterRef.current
    return () => { playerRef.current = null }
  }, [])

  // modo "reproduzir só os cortes" via rAF (lê o frame atual pelo adaptador, sempre seguro)
  useEffect(() => {
    if (!skipMode || keeps.length === 0) return
    let raf = 0
    const tick = () => {
      const r = remRef.current
      if (r) {
        const t = r.getCurrentFrame() / fpsRef.current
        const inKeep = keeps.find((k) => t >= k.in && t < k.out)
        if (!inKeep) {
          const next = keeps.find((k) => k.in > t)
          if (next) r.seekTo(Math.round(next.in * fpsRef.current))
          else { r.pause(); setSkipMode(false); return }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [skipMode, keeps, setSkipMode])

  if (!mediaMeta || dur <= 0) {
    return (
      <div className="w-full h-[360px] bg-black rounded-md flex items-center justify-center text-text-muted text-sm">
        Carregue um vídeo em "Abrir vídeo".
      </div>
    )
  }

  const durationInFrames = Math.max(1, Math.round(dur * fps))

  return (
    <div>
      <div className="w-full max-h-[360px] flex justify-center bg-black rounded-md overflow-hidden">
        <Player
          key={videoTs}
          ref={remRef}
          component={FinalVideo}
          inputProps={{ src: `/media?ts=${videoTs}`, segments, captionsOn }}
          durationInFrames={durationInFrames}
          compositionWidth={mediaMeta.width}
          compositionHeight={mediaMeta.height}
          fps={fps}
          controls
          acknowledgeRemotionLicense
          style={{ width: '100%', maxHeight: 360 }}
        />
      </div>
      <label className="flex items-center gap-2 mt-2 text-text-secondary text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={captionsOn}
          onChange={(e) => setCaptionsOn(e.target.checked)}
          className="accent-accent"
        />
        Mostrar legenda sobre o vídeo
      </label>
    </div>
  )
}
