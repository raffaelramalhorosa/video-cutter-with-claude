import { useRef, useEffect, useState, useCallback } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { useAppStore } from '../../store/useAppStore'
import { FinalVideo, type CaptionSeg } from '../../remotion/FinalVideo'

const CAPTION_EFFECTS: Record<string, string> = {
  nenhum: 'none',
  fade:   'cap-fade   0.2s ease forwards',
  subir:  'cap-slide-up   0.2s ease forwards',
  descer: 'cap-slide-down 0.2s ease forwards',
  pop:    'cap-pop    0.18s ease forwards',
  bounce: 'cap-bounce 0.3s ease forwards',
}

/** Renderiza palavras com coreografia em 3 grupos: primeira | meio | última (abaixo) */
function CaptionCoreografia({ text, font, bg, color, stroke }: { text: string; font: string; bg: boolean; color: string; stroke?: string }) {
  const words = text.trim().split(/\s+/)
  const fontStyle = `'${font}', Impact, sans-serif`
  const baseStyle: React.CSSProperties = {
    display: 'inline-block',
    animationFillMode: 'both',
    fontFamily: fontStyle,
    fontWeight: 700,
    fontSize: 'clamp(13px, 2.5vw, 20px)',
    lineHeight: 1.3,
    color,
    textShadow: '0 2px 8px rgba(0,0,0,0.9)',
    WebkitTextStroke: stroke,
    paintOrder: stroke ? 'stroke fill' : undefined,
  }

  // grupo 1: primeira palavra; grupo 2: palavras do meio; grupo 3: última
  const first = words.slice(0, 1)
  const mid   = words.length >= 3 ? words.slice(1, -1) : []
  const last  = words.length >= 2 ? words.slice(-1) : []

  const wrapStyle: React.CSSProperties = {
    padding: bg ? '6px 14px' : '0',
    background: bg ? 'rgba(0,0,0,0.65)' : 'transparent',
    borderRadius: bg ? 8 : 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  }

  return (
    <div style={wrapStyle}>
      {/* linha 1: primeira + meio */}
      <div style={{ display: 'flex', gap: '0.3em', overflow: 'hidden' }}>
        <span style={{ ...baseStyle, animation: 'cap-coro-first 0.28s 0s ease both' }}>
          {first.join(' ')}
        </span>
        {mid.length > 0 && (
          <span style={{ ...baseStyle, animation: 'cap-coro-mid 0.38s 0.18s ease both' }}>
            {mid.join(' ')}
          </span>
        )}
      </div>
      {/* linha 2: última palavra sobe de baixo */}
      {last.length > 0 && (
        <span style={{ ...baseStyle, animation: 'cap-coro-last 0.35s 0.44s ease both' }}>
          {last.join(' ')}
        </span>
      )}
    </div>
  )
}

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

/** Retorna o texto a exibir no instante `t` dado a configuração de palavras por vez. */
function getCaption(seg: CaptionSeg, t: number, wordsPerCaption: number): string {
  if (wordsPerCaption === 0) return seg.text
  const words = seg.text.trim().split(/\s+/)
  const segDur = seg.end - seg.start
  if (segDur <= 0 || words.length === 0) return seg.text
  const elapsed = Math.max(0, t - seg.start)
  const progress = Math.min(elapsed / segDur, 0.9999)
  const totalChunks = Math.ceil(words.length / wordsPerCaption)
  const chunkIdx = Math.floor(progress * totalChunks)
  const start = chunkIdx * wordsPerCaption
  return words.slice(start, start + wordsPerCaption).join(' ')
}

export default function VideoPlayer() {
  const remRef = useRef<PlayerRef>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mediaMeta = useAppStore((s) => s.mediaMeta)
  const dur = useAppStore((s) => s.dur)
  const videoTs = useAppStore((s) => s.videoTs)
  const keeps = useAppStore((s) => s.keeps)
  const skipMode = useAppStore((s) => s.skipMode)
  const setSkipMode = useAppStore((s) => s.setSkipMode)
  const transSegs = useAppStore((s) => s.transSegs)
  const transOverlay = useAppStore((s) => s.transOverlay)
  const captionBlocks = useAppStore((s) => s.captionBlocks)
  const captionStyle  = useAppStore((s) => s.captionStyle)
  const setCaptionStyle = useAppStore((s) => s.setCaptionStyle)

  // texto da legenda atualizado a cada 100ms
  const [captionText, setCaptionText] = useState('')

  const fps = mediaMeta?.fps ?? 30
  const fpsRef = useRef(fps)
  fpsRef.current = fps

  const segments: CaptionSeg[] = transSegs.map((s, i) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    cut: transOverlay[i]?.status === 'cut',
  }))
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments
  const captionBlocksRef = useRef(captionBlocks)
  captionBlocksRef.current = captionBlocks
  const wordsRef = useRef(captionStyle.wordsPerCaption)
  wordsRef.current = captionStyle.wordsPerCaption

  // adaptador criado uma vez
  const adapterRef = useRef<PlayerAdapter | null>(null)
  if (!adapterRef.current) {
    adapterRef.current = new PlayerAdapter(() => remRef.current, () => fpsRef.current)
  }
  useEffect(() => {
    playerRef.current = adapterRef.current
    return () => { playerRef.current = null }
  }, [])

  // modo "reproduzir só os cortes" via rAF
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

  // bloco ativo — overrides de fonte/efeito por bloco
  const [activeBlockFont, setActiveBlockFont] = useState<string | undefined>(undefined)
  const [activeBlockEffect, setActiveBlockEffect] = useState<string | undefined>(undefined)

  // poll do tempo atual para atualizar a legenda overlay
  useEffect(() => {
    if (!captionStyle.on) return
    const timer = setInterval(() => {
      const t = playerRef.current?.currentTime ?? 0
      const blocks = captionBlocksRef.current
      if (blocks.length > 0) {
        const block = blocks.find((b) => t >= b.start && t < b.end)
        if (block) {
          // filtra palavras removidas antes de exibir
          const removed = new Set(block.removedWords ?? [])
          const visibleText = block.text.trim().split(/\s+/)
            .filter((_, i) => !removed.has(i))
            .join(' ')
          const asSeg = { start: block.start, end: block.end, text: visibleText, cut: false }
          setCaptionText(getCaption(asSeg, t, wordsRef.current))
          setActiveBlockFont(block.font)
          setActiveBlockEffect(block.effect)
        } else {
          setCaptionText('')
          setActiveBlockFont(undefined)
          setActiveBlockEffect(undefined)
        }
      } else {
        const seg = segmentsRef.current.find((s) => !s.cut && t >= s.start && t < s.end)
        setCaptionText(seg ? getCaption(seg, t, wordsRef.current) : '')
        setActiveBlockFont(undefined)
        setActiveBlockEffect(undefined)
      }
    }, 80)
    return () => clearInterval(timer)
  }, [captionStyle.on])

  // --- drag da legenda ---
  const dragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartPct = useRef(0)

  const onCaptionMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartY.current = e.clientY
    dragStartPct.current = captionStyle.yPct
  }, [captionStyle.yPct])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapperRef.current) return
      const wrapperH = wrapperRef.current.getBoundingClientRect().height
      const deltaPx = e.clientY - dragStartY.current
      const deltaPct = (deltaPx / wrapperH) * 100
      const newY = Math.min(95, Math.max(5, dragStartPct.current + deltaPct))
      setCaptionStyle({ yPct: newY })
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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
      {/* wrapper relativo para o overlay da legenda */}
      <div ref={wrapperRef} className="relative w-full max-h-[360px] flex justify-center bg-black rounded-md overflow-hidden">
        <Player
          key={videoTs}
          ref={remRef}
          component={FinalVideo}
          inputProps={{ src: `/media?ts=${videoTs}`, segments, captionsOn: false }}
          durationInFrames={durationInFrames}
          compositionWidth={mediaMeta.width}
          compositionHeight={mediaMeta.height}
          fps={fps}
          controls
          acknowledgeRemotionLicense
          style={{ width: '100%', maxHeight: 360 }}
        />

        {/* overlay da legenda — arrastável */}
        {captionStyle.on && captionText && (() => {
          const activeEffect  = activeBlockEffect ?? captionStyle.effect
          const activeFont    = activeBlockFont   ?? captionStyle.font
          const stroke = captionStyle.strokeWidth > 0
            ? `${captionStyle.strokeWidth}px ${captionStyle.strokeColor}`
            : undefined
          return (
            <div
              onMouseDown={onCaptionMouseDown}
              style={{
                position: 'absolute',
                top: `${captionStyle.yPct}%`,
                left: '50%',
                transform: 'translate(-50%, -50%)',
                cursor: 'ns-resize',
                userSelect: 'none',
                maxWidth: '82%',
                textAlign: 'center',
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              {activeEffect === 'coreografia' ? (
                <CaptionCoreografia
                  key={captionText}
                  text={captionText}
                  font={activeFont}
                  bg={captionStyle.bg}
                  color={captionStyle.color}
                  stroke={stroke}
                />
              ) : (
                <div
                  key={captionText}
                  style={{
                    padding: captionStyle.bg ? '6px 14px' : '0',
                    background: captionStyle.bg ? 'rgba(0,0,0,0.65)' : 'transparent',
                    borderRadius: captionStyle.bg ? 8 : 0,
                    color: captionStyle.color,
                    fontFamily: `'${activeFont}', Impact, sans-serif`,
                    fontWeight: 700,
                    fontSize: 'clamp(13px, 2.5vw, 20px)',
                    lineHeight: 1.3,
                    textShadow: '0 2px 8px rgba(0,0,0,0.9)',
                    WebkitTextStroke: stroke,
                    paintOrder: stroke ? 'stroke fill' : undefined,
                    animation: CAPTION_EFFECTS[activeEffect] ?? 'none',
                  }}
                >
                  {captionText}
                </div>
              )}
            </div>
          )
        })()}
      </div>

    </div>
  )
}
