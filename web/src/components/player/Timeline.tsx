import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { playerRef } from './playerRef'
import type { CaptionBlock } from '../../types'

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
const EFFECT_OPTIONS = ['nenhum', 'fade', 'subir', 'descer', 'pop', 'bounce']
const FONT_OPTIONS   = ['Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Anton', 'Impact']

export default function Timeline() {
  const dur          = useAppStore((s) => s.dur)
  const keeps        = useAppStore((s) => s.keeps)
  const transSegs    = useAppStore((s) => s.transSegs)
  const transOverlay = useAppStore((s) => s.transOverlay)
  const {
    captionBlocks,
    splitCaptionBlock, mergeCaptionBlock, setCaptionBlockStyle, toggleCaptionBlockWord,
  } = useAppStore()

  const outerRef    = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hlRef       = useRef<HTMLDivElement>(null)

  const draggingRef   = useRef(false)
  const rafRef        = useRef<number>(0)
  const seekTargetRef = useRef<number | null>(null)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(0)
  const zoomRef   = useRef(zoom)
  const offsetRef = useRef(offset)
  zoomRef.current   = zoom
  offsetRef.current = offset

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedBlock = captionBlocks.find((b) => b.id === selectedId) ?? null

  const visibleDur    = dur > 0 ? dur / zoom : 0
  const maxOffset     = Math.max(0, dur - visibleDur)
  const clampedOffset = Math.min(maxOffset, Math.max(0, offset))

  const toPct = (t: number) =>
    visibleDur > 0 ? ((t - clampedOffset) / visibleDur) * 100 : 0

  const clampOffset = useCallback((off: number, z: number) => {
    const vd = dur / z
    return Math.min(Math.max(0, dur - vd), Math.max(0, off))
  }, [dur])

  const applyZoom = useCallback((newZoom: number, centerTime?: number) => {
    const z   = zoomRef.current
    const vd  = dur / z
    const cOff = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))
    const pivot = centerTime ?? (cOff + vd / 2)
    const newVd  = dur / newZoom
    const frac   = vd > 0 ? (pivot - cOff) / vd : 0.5
    const newVd2 = dur / newZoom
    const newOff = Math.min(Math.max(0, dur - newVd2), Math.max(0, pivot - frac * newVd))
    setZoom(newZoom)
    setOffset(newOff)
    zoomRef.current   = newZoom
    offsetRef.current = newOff
  }, [dur])

  // rAF: atualiza playhead e auto-scroll
  useEffect(() => {
    const tick = () => {
      if (!draggingRef.current && dur > 0 && playheadRef.current) {
        const playerT = playerRef.current?.currentTime ?? 0
        let t: number
        if (seekTargetRef.current !== null) {
          if (Math.abs(playerT - seekTargetRef.current) < 0.5) {
            seekTargetRef.current = null
            t = playerT
          } else {
            t = seekTargetRef.current
          }
        } else {
          t = playerT
        }

        const z    = zoomRef.current
        const vd   = dur / z
        const cOff = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))

        if (t < cOff || t > cOff + vd) {
          const newOff = Math.min(Math.max(0, dur - vd), Math.max(0, t - vd / 2))
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

  // scroll por wheel → zoom centrado no cursor
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (dur <= 0) return
      const rect = el.getBoundingClientRect()
      const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const z    = zoomRef.current
      const vd   = dur / z
      const cOff = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))
      const cursorTime = cOff + cursorFrac * vd
      const newZoom = Math.max(1, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
      applyZoom(newZoom, cursorTime)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [dur, applyZoom])

  // seek a partir de coordenada X (usa largura do outer)
  const seekFromX = useCallback((clientX: number) => {
    const el = outerRef.current
    if (!el || dur <= 0) return
    const rect  = el.getBoundingClientRect()
    const frac  = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const z     = zoomRef.current
    const vd    = dur / z
    const cOff  = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))
    const t     = Math.min(dur, Math.max(0, cOff + frac * vd))
    seekTargetRef.current = t
    if (playerRef.current) playerRef.current.currentTime = t
    if (playheadRef.current) playheadRef.current.style.left = (frac * 100) + '%'
  }, [dur])

  // pointer events na lane de cortes (drag seek)
  const onCutPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignora */ }
    seekFromX(e.clientX)
  }, [seekFromX])
  const onCutPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) seekFromX(e.clientX)
  }, [seekFromX])
  const onCutPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignora */ }
    draggingRef.current = false
  }, [])

  // click na lane de legenda (área vazia) → seek + deselect
  const onCapLaneClick = useCallback((e: React.MouseEvent) => {
    if (dur <= 0 || !outerRef.current) return
    const rect  = outerRef.current.getBoundingClientRect()
    const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const z     = zoomRef.current
    const vd    = dur / z
    const cOff  = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))
    const t     = cOff + frac * vd
    seekTargetRef.current = t
    if (playerRef.current) playerRef.current.currentTime = t
    setSelectedId(null)
  }, [dur])

  // click num bloco → seleciona + seek para início do bloco
  const handleBlockClick = useCallback((e: React.MouseEvent, block: CaptionBlock) => {
    e.stopPropagation()
    setSelectedId((prev) => (prev === block.id ? null : block.id))
    if (playerRef.current) playerRef.current.currentTime = block.start
  }, [])

  // highlight de segmento via hover na transcrição (API global)
  const highlightSegment = useCallback((start: number, end: number) => {
    if (!dur || !hlRef.current) return
    const z    = zoomRef.current
    const vd   = dur / z
    const cOff = Math.min(Math.max(0, dur - vd), Math.max(0, offsetRef.current))
    hlRef.current.style.left  = ((start - cOff) / vd * 100) + '%'
    hlRef.current.style.width = Math.max(0.4, (end - start) / vd * 100) + '%'
    hlRef.current.style.opacity = '1'
  }, [dur])
  const hideHighlight = useCallback(() => {
    if (hlRef.current) hlRef.current.style.opacity = '0'
  }, [])
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__hlSegment = highlightSegment;
    (window as unknown as Record<string, unknown>).__hideHL    = hideHighlight
  }, [highlightSegment, hideHighlight])

  // ações do bloco selecionado
  const handleSplit = useCallback((afterWordIndex: number) => {
    if (!selectedId) return
    splitCaptionBlock(selectedId, afterWordIndex)
    setSelectedId(null)
  }, [selectedId, splitCaptionBlock])

  const handleMerge = useCallback(() => {
    if (!selectedId) return
    mergeCaptionBlock(selectedId)
    setSelectedId(null)
  }, [selectedId, mergeCaptionBlock])

  const canMerge = selectedBlock
    ? (() => {
        const idx = captionBlocks.findIndex((b) => b.id === selectedId)
        return idx !== -1 && idx < captionBlocks.length - 1
          && captionBlocks[idx + 1].segIndex === selectedBlock.segIndex
      })()
    : false

  const blockColor = (b: CaptionBlock) => {
    const status = transOverlay[b.segIndex]?.status
    if (status === 'cut')     return 'rgba(140,64,64,0.75)'
    if (status === 'partial') return 'rgba(180,140,40,0.75)'
    return b.id === selectedId ? 'rgba(201,138,46,0.9)' : 'rgba(60,122,78,0.75)'
  }

  // ticks da régua
  const ticks: number[] = []
  if (dur > 0 && visibleDur > 0) {
    const step  = tickInterval(visibleDur)
    const start = Math.floor(clampedOffset / step) * step
    for (let t = start; t <= clampedOffset + visibleDur + step * 0.01; t += step) {
      if (t >= 0 && t <= dur + 0.001) ticks.push(t)
    }
  }

  const zoomLabel   = zoom > 1.05 ? `${zoom.toFixed(zoom < 5 ? 1 : 0)}×` : null
  const hasCaptions = captionBlocks.length > 0

  return (
    <div className="relative select-none mt-3">

      {/* régua de tempo */}
      <div className="relative h-5 text-[10px] text-text-muted tabular-nums">
        {ticks.map((t, i) => (
          <div key={i} className="absolute top-0 flex flex-col items-start" style={{ left: toPct(t) + '%' }}>
            <span className="-translate-x-1/2 ml-px whitespace-nowrap">{fmtTick(t)}</span>
            <span className="block w-px h-1.5 bg-text-muted/50 mt-0.5" />
          </div>
        ))}
        <div className="absolute right-0 top-0 flex items-center gap-0.5">
          {zoomLabel && <span className="text-[10px] text-text-muted mr-1 tabular-nums">{zoomLabel}</span>}
          <button onClick={() => applyZoom(Math.max(1, zoom / ZOOM_FACTOR))} className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none" title="Zoom out (−)">−</button>
          <button onClick={() => applyZoom(Math.min(MAX_ZOOM, zoom * ZOOM_FACTOR))} className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none" title="Zoom in (+)">+</button>
          {zoom > 1.05 && (
            <button onClick={() => { setZoom(1); setOffset(0); zoomRef.current = 1; offsetRef.current = 0 }} className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[11px]" title="Resetar zoom">↺</button>
          )}
        </div>
      </div>

      {/* container unificado — playhead absoluto atravessa ambas as lanes */}
      <div ref={outerRef} className="timeline relative bg-bg rounded-md overflow-hidden">

        {/* lane 1: cortes / keeps (arrastável para seek) */}
        <div
          className="relative h-12 cursor-pointer touch-none"
          onPointerDown={onCutPointerDown}
          onPointerMove={onCutPointerMove}
          onPointerUp={onCutPointerUp}
        >
          <div className="absolute inset-0 bg-cut/20" />

          {keeps.map((k, i) =>
            dur > 0 ? (
              <div
                key={i}
                className="keep-block absolute top-0 bottom-0 bg-keep/35 border-l border-r border-keep/70 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-[3px] after:bg-keep"
                style={{ left: toPct(k.in) + '%', width: ((k.out - k.in) / visibleDur * 100) + '%' }}
              />
            ) : null
          )}

          {dur > 0 && transSegs.map((s, i) =>
            transOverlay[i]?.status === 'cut' ? (
              <div
                key={`cut-${i}`}
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: toPct(s.start) + '%',
                  width: Math.max(0.3, (s.end - s.start) / visibleDur * 100) + '%',
                  background: 'rgba(120,120,130,0.55)',
                  borderLeft: '1px solid rgba(160,160,170,0.7)',
                  borderRight: '1px solid rgba(160,160,170,0.7)',
                }}
              />
            ) : null
          )}
        </div>

        {/* lane 2: blocos de legenda (visível só com blocos carregados) */}
        {hasCaptions && (
          <div
            className="relative h-7 bg-bg-secondary/40 border-t border-text-muted/10 cursor-pointer"
            onClick={onCapLaneClick}
          >
            {captionBlocks.map((block) => {
              const left  = toPct(block.start)
              const width = visibleDur > 0 ? ((block.end - block.start) / visibleDur) * 100 : 0
              if (width < 0.05) return null
              return (
                <div
                  key={block.id}
                  onClick={(e) => handleBlockClick(e, block)}
                  title={block.text}
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 3, bottom: 3,
                    background: blockColor(block),
                    borderRadius: 2,
                    overflow: 'hidden',
                    paddingInline: 3,
                    display: 'flex',
                    alignItems: 'center',
                    outline: block.id === selectedId ? '2px solid var(--color-accent)' : 'none',
                    outlineOffset: -2,
                    cursor: 'pointer',
                    zIndex: block.id === selectedId ? 2 : 1,
                  }}
                >
                  {width > 2.5 && (
                    <span style={{ fontSize: 9, color: '#F2F3F5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1, pointerEvents: 'none' }}>
                      {block.text}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* highlight de hover na transcrição */}
        <div
          ref={hlRef}
          className="absolute top-0 bottom-0 pointer-events-none opacity-0 transition-opacity duration-150 rounded-sm z-10"
          style={{
            left: 0, width: 0,
            background: 'rgba(255,255,255,0.18)',
            boxShadow: '0 0 12px 3px var(--color-text-primary), inset 0 0 0 2px var(--color-text-primary)',
          }}
        />

        {/* playhead — atravessa todas as lanes */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-20"
          style={{ left: 0 }}
        >
          <span className="absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-accent" />
        </div>
      </div>

      {/* limites visíveis */}
      <div className="flex justify-between text-text-muted text-[11px] mt-1 tabular-nums">
        <span>{dur > 0 && zoom > 1.05 ? fmt(clampedOffset) : '0:00'}</span>
        <span>{dur > 0 ? fmt(zoom > 1.05 ? Math.min(dur, clampedOffset + visibleDur) : dur) : ''}</span>
      </div>

      {/* modal do bloco selecionado (apartado da timeline) */}
      {selectedBlock && (
        <div className="mt-2 p-3 bg-bg-secondary rounded-md border border-text-muted/15 text-[12px]">

          <p className="text-text-muted text-[10px] uppercase tracking-wide mb-2 flex items-center justify-between">
            <span>Bloco · {fmtTick(selectedBlock.start)} → {fmtTick(selectedBlock.end)}</span>
            <button onClick={() => setSelectedId(null)} className="text-text-muted hover:text-text-secondary normal-case tracking-normal">✕ fechar</button>
          </p>

          {/* palavras + remoção individual */}
          {(() => {
            const words   = selectedBlock.text.trim().split(/\s+/)
            const removed = new Set(selectedBlock.removedWords ?? [])
            const removedCount = removed.size
            return (
              <div className="mb-3">
                <div className="flex flex-wrap items-center gap-0">
                  {words.map((word, wi) => {
                    const isRemoved = removed.has(wi)
                    return (
                      <span key={wi} className="flex items-center">
                        <button
                          onClick={() => toggleCaptionBlockWord(selectedBlock.id, wi)}
                          title={isRemoved ? `Restaurar "${word}"` : `Remover "${word}"`}
                          className={[
                            'px-1.5 py-0.5 rounded text-[12px] transition-all duration-150 select-none',
                            isRemoved
                              ? 'line-through opacity-40 bg-cut/20 text-text-muted hover:opacity-60'
                              : 'bg-bg text-text-primary hover:bg-cut/20 hover:text-cut',
                          ].join(' ')}
                        >{word}</button>
                        {wi < words.length - 1 && (
                          <button
                            onClick={() => handleSplit(wi + 1)}
                            className="w-4 h-5 flex items-center justify-center text-text-muted/40 hover:text-accent hover:bg-accent/10 rounded transition-colors text-[10px]"
                            title={`Dividir aqui (após "${word}")`}
                          >┆</button>
                        )}
                      </span>
                    )
                  })}
                </div>
                {removedCount > 0 && (
                  <p className="text-text-muted text-[10px] mt-1.5">
                    {removedCount} palavra{removedCount > 1 ? 's' : ''} removida{removedCount > 1 ? 's' : ''} — clique nela para restaurar
                  </p>
                )}
              </div>
            )
          })()}

          {/* estilo por bloco */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <span className="flex items-center gap-1.5 text-text-secondary">
              Efeito:
              <select
                value={selectedBlock.effect ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { effect: e.target.value || undefined })}
                className="bg-bg text-text-primary rounded-sm px-2 py-0.5 text-[11px] border border-text-muted/20"
              >
                <option value="">— global —</option>
                {EFFECT_OPTIONS.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
              </select>
            </span>
            <span className="flex items-center gap-1.5 text-text-secondary">
              Fonte:
              <select
                value={selectedBlock.font ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { font: e.target.value || undefined })}
                className="bg-bg text-text-primary rounded-sm px-2 py-0.5 text-[11px] border border-text-muted/20"
              >
                <option value="">— global —</option>
                {FONT_OPTIONS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </span>
            {canMerge && (
              <button
                onClick={handleMerge}
                className="px-2.5 py-0.5 bg-bg text-text-secondary border border-text-muted/20 rounded-sm text-[11px] hover:text-text-primary hover:border-text-muted/40 transition-colors"
              >Unir com próximo →</button>
            )}
          </div>

          {/* tamanho e largura por bloco */}
          <div className="mt-2.5 flex flex-col gap-2 text-[11px] text-text-secondary">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0">Fonte (px)</span>
              <input
                type="range" min={10} max={48} step={1}
                value={selectedBlock.fontSize ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { fontSize: e.target.value ? Number(e.target.value) : undefined })}
                className="flex-1 accent-accent"
              />
              <span className="tabular-nums text-text-muted w-10 text-right">
                {selectedBlock.fontSize != null ? `${selectedBlock.fontSize}px` : 'global'}
              </span>
              {selectedBlock.fontSize != null && (
                <button onClick={() => setCaptionBlockStyle(selectedBlock.id, { fontSize: undefined })} className="text-text-muted hover:text-text-secondary text-[10px]" title="Usar valor global">✕</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0">Largura máx.</span>
              <input
                type="range" min={30} max={100} step={1}
                value={selectedBlock.maxWidth ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { maxWidth: e.target.value ? Number(e.target.value) : undefined })}
                className="flex-1 accent-accent"
              />
              <span className="tabular-nums text-text-muted w-10 text-right">
                {selectedBlock.maxWidth != null ? `${selectedBlock.maxWidth}%` : 'global'}
              </span>
              {selectedBlock.maxWidth != null && (
                <button onClick={() => setCaptionBlockStyle(selectedBlock.id, { maxWidth: undefined })} className="text-text-muted hover:text-text-secondary text-[10px]" title="Usar valor global">✕</button>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
