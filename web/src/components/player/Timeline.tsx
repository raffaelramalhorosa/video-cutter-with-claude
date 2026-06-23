import { useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { playerRef } from './VideoPlayer'

export default function Timeline() {
  const dur = useAppStore((s) => s.dur)
  const keeps = useAppStore((s) => s.keeps)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  // rAF: atualiza playhead direto no DOM sem passar pelo store
  useEffect(() => {
    const tick = () => {
      const video = playerRef.current
      if (video && dur > 0 && playheadRef.current) {
        playheadRef.current.style.left = (video.currentTime / dur * 100) + '%'
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [dur])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = playerRef.current
    if (!video) return
    const rect = e.currentTarget.getBoundingClientRect()
    video.currentTime = (e.clientX - rect.left) / rect.width * dur
  }, [dur])

  const highlightSegment = useCallback((start: number, end: number) => {
    if (!dur || !hlRef.current) return
    hlRef.current.style.left = (start / dur * 100) + '%'
    hlRef.current.style.width = Math.max(0.4, (end - start) / dur * 100) + '%'
    hlRef.current.style.opacity = '1'
  }, [dur])

  const hideHighlight = useCallback(() => {
    if (hlRef.current) hlRef.current.style.opacity = '0'
  }, [])

  // expõe para TranscriptSegment via data attribute (workaround sem prop drilling)
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__hlSegment = highlightSegment;
    (window as unknown as Record<string, unknown>).__hideHL = hideHighlight
  }, [highlightSegment, hideHighlight])

  return (
    <div>
      <div
        className="timeline relative h-11 mt-[14px] bg-cut rounded-md overflow-hidden cursor-pointer"
        onClick={handleClick}
      >
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-0.5 bg-text-primary pointer-events-none"
          style={{ left: 0 }}
        />
        <div
          ref={hlRef}
          className="absolute top-0 bottom-0 pointer-events-none opacity-0 transition-opacity duration-150 rounded-sm"
          style={{
            left: 0, width: 0,
            background: 'rgba(255,255,255,0.18)',
            boxShadow: '0 0 12px 3px var(--color-text-primary), inset 0 0 0 2px var(--color-text-primary)',
          }}
        />
        {keeps.map((k, i) => (
          dur > 0 ? (
            <div
              key={i}
              className="keep-block absolute top-0 bottom-0 bg-keep/30 border-l border-r border-keep/70 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-[3px] after:bg-keep"
              style={{
                left: (k.in / dur * 100) + '%',
                width: ((k.out - k.in) / dur * 100) + '%',
              }}
            />
          ) : null
        ))}
      </div>
      <div className="flex justify-between text-text-muted text-[11px] mt-1 tabular-nums">
        <span>0:00</span>
        <span>{dur > 0 ? fmt(dur / 2) : ''}</span>
        <span>{dur > 0 ? fmt(dur) : ''}</span>
      </div>
    </div>
  )
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const r = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}
