import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { playerRef } from './VideoPlayer'

// escolhe um intervalo "redondo" de marcações para caber ~8-10 ticks na régua
function tickInterval(visibleDur: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900]
  for (const s of steps) if (visibleDur / s <= 10) return s
  return 1800
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const r = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}

function fmtTick(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s - m * 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const ZOOM_FACTOR = 1.3
const MAX_ZOOM = 40

export default function Timeline() {
  const dur = useAppStore((s) => s.dur)
  const keeps = useAppStore((s) => s.keeps)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef   = useRef(false)
  const rafRef        = useRef<number>(0)
  // tempo alvo do último seek — usado no rAF até o player confirmar o frame
  const seekTargetRef = useRef<number | null>(null)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(0)
  // refs para acesso sem stale closure em rAF e event listeners
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  zoomRef.current = zoom
  offsetRef.current = offset

  // janela visível
  const visibleDur = dur > 0 ? dur / zoom : 0
  const maxOffset = Math.max(0, dur - visibleDur)
  const clampedOffset = Math.min(maxOffset, Math.max(0, offset))

  // converte tempo (s) para posição % na faixa visível
  const toPct = (t: number) =>
    visibleDur > 0 ? ((t - clampedOffset) / visibleDur) * 100 : 0

  // helper para clampar offset com zoom dado
  const clampOffset = (off: number, z: number) => {
    const vd = dur / z
    return Math.min(Math.max(0, dur - vd), Math.max(0, off))
  }

  // aplica zoom centrado num tempo específico (ou no centro da janela)
  const applyZoom = useCallback((newZoom: number, centerTime?: number) => {
    const z = zoomRef.current
    const vd = dur / z
    const cOff = clampOffset(offsetRef.current, z)
    const pivot = centerTime ?? (cOff + vd / 2)
    const newVd = dur / newZoom
    const frac = (pivot - cOff) / vd
    const newOff = clampOffset(pivot - frac * newVd, newZoom)
    setZoom(newZoom)
    setOffset(newOff)
    zoomRef.current = newZoom
    offsetRef.current = newOff
  }, [dur])

  // rAF: atualiza posição do playhead; auto-scroll se sair da vista
  useEffect(() => {
    const tick = () => {
      if (!draggingRef.current && dur > 0 && playheadRef.current) {
        const playerT = playerRef.current?.currentTime ?? 0
        // após seek via click, o Remotion pode demorar alguns frames para
        // refletir o novo frame em getCurrentFrame(). Usamos seekTargetRef
        // como valor autoritativo até o player confirmar a posição.
        let t: number
        if (seekTargetRef.current !== null) {
          if (Math.abs(playerT - seekTargetRef.current) < 0.5) {
            seekTargetRef.current = null  // player confirmou — volta ao normal
            t = playerT
          } else {
            t = seekTargetRef.current  // ainda aguardando — mantém posição
          }
        } else {
          t = playerT
        }

        const z = zoomRef.current
        const vd = dur / z
        const cOff = clampOffset(offsetRef.current, z)

        // auto-scroll: centraliza quando playhead sai da janela visível
        if (t < cOff || t > cOff + vd) {
          const newOff = clampOffset(t - vd / 2, z)
          offsetRef.current = newOff
          setOffset(newOff)
        }

        const pct = ((t - offsetRef.current) / vd) * 100
        playheadRef.current.style.left = pct + '%'
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [dur])

  // wheel → zoom centrado no cursor
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (dur <= 0) return
      const rect = track.getBoundingClientRect()
      const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const z = zoomRef.current
      const vd = dur / z
      const cOff = clampOffset(offsetRef.current, z)
      const cursorTime = cOff + cursorFrac * vd
      const newZoom = Math.max(1, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
      applyZoom(newZoom, cursorTime)
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [dur, applyZoom])

  // seek a partir da posição X na faixa (leva em conta zoom)
  const seekFromX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track || dur <= 0) return
    const rect = track.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const z = zoomRef.current
    const vd = dur / z
    const cOff = clampOffset(offsetRef.current, z)
    const t = Math.min(dur, Math.max(0, cOff + frac * vd))
    seekTargetRef.current = t  // guarda posição intencionada antes do player confirmar
    if (playerRef.current) playerRef.current.currentTime = t
    if (playheadRef.current) playheadRef.current.style.left = (frac * 100) + '%'
  }, [dur])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignora */ }
    seekFromX(e.clientX)
  }, [seekFromX])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) seekFromX(e.clientX)
  }, [seekFromX])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignora */ }
    draggingRef.current = false
  }, [])

  // realce de segmento ao hover na transcrição
  const highlightSegment = useCallback((start: number, end: number) => {
    if (!dur || !hlRef.current) return
    const z = zoomRef.current
    const vd = dur / z
    const cOff = clampOffset(offsetRef.current, z)
    hlRef.current.style.left = ((start - cOff) / vd * 100) + '%'
    hlRef.current.style.width = Math.max(0.4, (end - start) / vd * 100) + '%'
    hlRef.current.style.opacity = '1'
  }, [dur])
  const hideHighlight = useCallback(() => {
    if (hlRef.current) hlRef.current.style.opacity = '0'
  }, [])
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__hlSegment = highlightSegment;
    (window as unknown as Record<string, unknown>).__hideHL = hideHighlight
  }, [highlightSegment, hideHighlight])

  // ticks — só dentro da janela visível
  const ticks: number[] = []
  if (dur > 0 && visibleDur > 0) {
    const step = tickInterval(visibleDur)
    const start = Math.floor(clampedOffset / step) * step
    for (let t = start; t <= clampedOffset + visibleDur + step * 0.01; t += step) {
      if (t >= 0 && t <= dur + 0.001) ticks.push(t)
    }
  }

  const zoomLabel = zoom > 1.05 ? `${zoom.toFixed(zoom < 5 ? 1 : 0)}×` : null

  return (
    <div className="relative select-none mt-3">
      {/* régua de tempo + botões de zoom */}
      <div className="relative h-5 text-[10px] text-text-muted tabular-nums">
        {ticks.map((t, i) => (
          <div key={i} className="absolute top-0 flex flex-col items-start" style={{ left: toPct(t) + '%' }}>
            <span className="-translate-x-1/2 ml-px whitespace-nowrap">{fmtTick(t)}</span>
            <span className="block w-px h-1.5 bg-text-muted/50 mt-0.5" />
          </div>
        ))}

        {/* controles de zoom — canto direito */}
        <div className="absolute right-0 top-0 flex items-center gap-0.5">
          {zoomLabel && (
            <span className="text-[10px] text-text-muted mr-1 tabular-nums">{zoomLabel}</span>
          )}
          <button
            onClick={() => applyZoom(Math.max(1, zoom / ZOOM_FACTOR))}
            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none"
            title="Zoom out (−)"
          >−</button>
          <button
            onClick={() => applyZoom(Math.min(MAX_ZOOM, zoom * ZOOM_FACTOR))}
            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none"
            title="Zoom in (+)"
          >+</button>
          {zoom > 1.05 && (
            <button
              onClick={() => { setZoom(1); setOffset(0); zoomRef.current = 1; offsetRef.current = 0 }}
              className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[11px]"
              title="Resetar zoom"
            >↺</button>
          )}
        </div>
      </div>

      {/* trilha de cortes (arrastável) */}
      <div
        ref={trackRef}
        className="timeline relative h-12 bg-bg rounded-md overflow-hidden cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* base = removido (vermelho sutil) */}
        <div className="absolute inset-0 bg-cut/20" />

        {/* realce de segmento (hover na transcrição) */}
        <div
          ref={hlRef}
          className="absolute top-0 bottom-0 pointer-events-none opacity-0 transition-opacity duration-150 rounded-sm z-10"
          style={{
            left: 0, width: 0,
            background: 'rgba(255,255,255,0.18)',
            boxShadow: '0 0 12px 3px var(--color-text-primary), inset 0 0 0 2px var(--color-text-primary)',
          }}
        />

        {/* trechos mantidos (verde) */}
        {keeps.map((k, i) =>
          dur > 0 ? (
            <div
              key={i}
              className="keep-block absolute top-0 bottom-0 bg-keep/35 border-l border-r border-keep/70 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-[3px] after:bg-keep"
              style={{
                left: toPct(k.in) + '%',
                width: ((k.out - k.in) / visibleDur * 100) + '%',
              }}
            />
          ) : null
        )}

        {/* playhead */}
        <div
          ref={playheadRef}
          className="absolute -top-2 bottom-0 w-px bg-accent pointer-events-none z-20"
          style={{ left: 0 }}
        >
          <span className="absolute -top-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-accent" />
        </div>
      </div>

      {/* limites visíveis */}
      <div className="flex justify-between text-text-muted text-[11px] mt-1 tabular-nums">
        <span>{dur > 0 && zoom > 1.05 ? fmt(clampedOffset) : '0:00'}</span>
        <span>{dur > 0 ? fmt(zoom > 1.05 ? Math.min(dur, clampedOffset + visibleDur) : dur) : ''}</span>
      </div>
    </div>
  )
}
