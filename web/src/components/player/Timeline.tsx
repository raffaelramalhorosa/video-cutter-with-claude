import { useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { playerRef } from './VideoPlayer'

// escolhe um intervalo "redondo" de marcações para caber ~8-10 ticks na régua
function tickInterval(dur: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900]
  for (const s of steps) if (dur / s <= 10) return s
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

export default function Timeline() {
  const dur = useAppStore((s) => s.dur)
  const keeps = useAppStore((s) => s.keeps)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const rafRef = useRef<number>(0)

  // rAF: segue o tempo do Player direto no DOM (sem passar pelo store), exceto enquanto arrasta
  useEffect(() => {
    const tick = () => {
      if (!draggingRef.current) {
        const t = playerRef.current?.currentTime ?? 0
        if (dur > 0 && playheadRef.current) {
          playheadRef.current.style.left = (t / dur * 100) + '%'
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [dur])

  // busca o tempo a partir da posição X do ponteiro na trilha
  const seekFromX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track || dur <= 0) return
    const rect = track.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    if (playerRef.current) playerRef.current.currentTime = frac * dur
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
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignora */ }
  }, [])

  // realce de segmento ao passar o mouse na transcrição (hook usado por TranscriptSegment)
  const highlightSegment = useCallback((start: number, end: number) => {
    if (!dur || !hlRef.current) return
    hlRef.current.style.left = (start / dur * 100) + '%'
    hlRef.current.style.width = Math.max(0.4, (end - start) / dur * 100) + '%'
    hlRef.current.style.opacity = '1'
  }, [dur])

  const hideHighlight = useCallback(() => {
    if (hlRef.current) hlRef.current.style.opacity = '0'
  }, [])

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__hlSegment = highlightSegment;
    (window as unknown as Record<string, unknown>).__hideHL = hideHighlight
  }, [highlightSegment, hideHighlight])

  // ticks da régua
  const ticks: number[] = []
  if (dur > 0) {
    const step = tickInterval(dur)
    for (let t = 0; t <= dur + 0.001; t += step) ticks.push(t)
  }

  return (
    <div className="relative select-none mt-3">
      {/* régua de tempo */}
      <div className="relative h-5 text-[10px] text-text-muted tabular-nums">
        {ticks.map((t, i) => (
          <div key={i} className="absolute top-0 flex flex-col items-start" style={{ left: (t / dur * 100) + '%' }}>
            <span className="-translate-x-1/2 ml-px whitespace-nowrap">{fmtTick(t)}</span>
            <span className="block w-px h-1.5 bg-text-muted/50 mt-0.5" />
          </div>
        ))}
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
        {keeps.map((k, i) => (
          dur > 0 ? (
            <div
              key={i}
              className="keep-block absolute top-0 bottom-0 bg-keep/35 border-l border-r border-keep/70 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-[3px] after:bg-keep"
              style={{
                left: (k.in / dur * 100) + '%',
                width: ((k.out - k.in) / dur * 100) + '%',
              }}
            />
          ) : null
        ))}

        {/* playhead com cabeça arrastável */}
        <div
          ref={playheadRef}
          className="absolute -top-2 bottom-0 w-px bg-accent pointer-events-none z-20"
          style={{ left: 0 }}
        >
          <span className="absolute -top-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-accent" />
        </div>
      </div>

      <div className="flex justify-between text-text-muted text-[11px] mt-1 tabular-nums">
        <span>0:00</span>
        <span>{dur > 0 ? fmt(dur) : ''}</span>
      </div>
    </div>
  )
}
