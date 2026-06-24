import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { playerRef } from './playerRef'
import type { Keep, CaptionBlock } from '../../types'

// ---------- funções de remapeamento de tempo ----------

function originalToEdited(t: number, keeps: Keep[]): number {
  let edited = 0
  for (const k of keeps) {
    if (t <= k.in) break
    if (t >= k.out) edited += k.out - k.in
    else { edited += t - k.in; break }
  }
  return edited
}

function editedToOriginal(editedT: number, keeps: Keep[]): number {
  let remaining = editedT
  for (const k of keeps) {
    const kDur = k.out - k.in
    if (remaining <= kDur) return k.in + remaining
    remaining -= kDur
  }
  return keeps[keeps.length - 1]?.out ?? 0
}

function mapBlockToEdited(b: CaptionBlock, keeps: Keep[]): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = []
  let offset = 0
  for (const k of keeps) {
    const kDur = k.out - k.in
    const os = Math.max(b.start, k.in)
    const oe = Math.min(b.end, k.out)
    if (os < oe) result.push({ start: offset + (os - k.in), end: offset + (oe - k.in) })
    offset += kDur
  }
  return result
}

function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}

const EFFECT_OPTIONS = ['nenhum', 'fade', 'subir', 'descer', 'pop', 'bounce']
const FONT_OPTIONS   = ['Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Anton', 'Impact']
const ZOOM_FACTOR = 1.3
const MAX_ZOOM = 40

// ---------- componente ----------

export default function CaptionTimeline() {
  const {
    captionBlocks, transOverlay, keeps,
    splitCaptionBlock, mergeCaptionBlock, setCaptionBlockStyle, toggleCaptionBlockWord,
  } = useAppStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const playheadRef  = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(0)
  const zoomRef   = useRef(zoom)
  const offsetRef = useRef(offset)
  zoomRef.current   = zoom
  offsetRef.current = offset

  const editedDur = keeps.reduce((a, k) => a + k.out - k.in, 0)
  const selectedBlock = captionBlocks.find((b) => b.id === selectedId) ?? null

  // janela visível (em edited time)
  const visibleDur   = editedDur > 0 ? editedDur / zoom : 0
  const maxOffset    = Math.max(0, editedDur - visibleDur)
  const clampedOffset = Math.min(maxOffset, Math.max(0, offset))

  const clampOff = (off: number, z: number) => {
    const vd = editedDur / z
    return Math.min(Math.max(0, editedDur - vd), Math.max(0, off))
  }

  const toPct = (t: number) =>
    visibleDur > 0 ? ((t - clampedOffset) / visibleDur) * 100 : 0

  const applyZoom = useCallback((newZoom: number, centerEditedTime?: number) => {
    const z = zoomRef.current
    const vd = editedDur / z
    const cOff = clampOff(offsetRef.current, z)
    const pivot = centerEditedTime ?? (cOff + vd / 2)
    const newVd = editedDur / newZoom
    const frac = vd > 0 ? (pivot - cOff) / vd : 0.5
    const newOff = clampOff(pivot - frac * newVd, newZoom)
    setZoom(newZoom)
    setOffset(newOff)
    zoomRef.current   = newZoom
    offsetRef.current = newOff
  }, [editedDur])

  // atualiza playhead em edited time + auto-scroll
  useEffect(() => {
    if (editedDur <= 0) return
    const timer = setInterval(() => {
      const t = playerRef.current?.currentTime ?? 0
      const editedT = originalToEdited(t, keeps)
      const z = zoomRef.current
      const vd = editedDur / z
      const cOff = clampOff(offsetRef.current, z)

      // auto-scroll se playhead sair da janela
      if (editedT < cOff || editedT > cOff + vd) {
        const newOff = clampOff(editedT - vd / 2, z)
        offsetRef.current = newOff
        setOffset(newOff)
      }

      const pct = ((editedT - offsetRef.current) / vd) * 100
      if (playheadRef.current) playheadRef.current.style.left = `${pct}%`
    }, 80)
    return () => clearInterval(timer)
  }, [keeps, editedDur])

  // wheel → zoom centrado no cursor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (editedDur <= 0) return
      const rect = el.getBoundingClientRect()
      const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const z = zoomRef.current
      const vd = editedDur / z
      const cOff = clampOff(offsetRef.current, z)
      const cursorEditedT = cOff + cursorFrac * vd
      const newZoom = Math.max(1, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
      applyZoom(newZoom, cursorEditedT)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [editedDur, applyZoom])

  // click na faixa (não num bloco) → seek + deselect
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || editedDur <= 0) return
      const rect = containerRef.current.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const editedT = clampedOffset + frac * visibleDur
      const originalT = editedToOriginal(editedT, keeps)
      if (playerRef.current) playerRef.current.currentTime = originalT
      setSelectedId(null)
    },
    [keeps, editedDur, clampedOffset, visibleDur],
  )

  // click num bloco → seleciona + seek para o início do bloco
  const handleBlockClick = useCallback(
    (e: React.MouseEvent, block: CaptionBlock) => {
      e.stopPropagation()
      setSelectedId((prev) => (prev === block.id ? null : block.id))
      if (playerRef.current) playerRef.current.currentTime = block.start
    },
    [],
  )

  // split: fecha o painel de seleção depois de dividir
  const handleSplit = useCallback(
    (afterWordIndex: number) => {
      if (!selectedId) return
      splitCaptionBlock(selectedId, afterWordIndex)
      setSelectedId(null)
    },
    [selectedId, splitCaptionBlock],
  )

  const handleMerge = useCallback(() => {
    if (!selectedId) return
    mergeCaptionBlock(selectedId)
    setSelectedId(null)
  }, [selectedId, mergeCaptionBlock])

  if (!captionBlocks.length || editedDur <= 0) return null

  const isBlockCut = (b: CaptionBlock) =>
    transOverlay[b.segIndex]?.status === 'cut'

  const blockColor = (b: CaptionBlock) => {
    const status = transOverlay[b.segIndex]?.status
    if (status === 'cut')     return 'rgba(140,64,64,0.75)'
    if (status === 'partial') return 'rgba(180,140,40,0.75)'
    return b.id === selectedId ? 'rgba(201,138,46,0.9)' : 'rgba(60,122,78,0.75)'
  }

  // verifica se o bloco seguinte tem o mesmo segIndex (permite merge)
  const canMerge = selectedBlock
    ? (() => {
        const idx = captionBlocks.findIndex((b) => b.id === selectedId)
        return idx !== -1 && idx < captionBlocks.length - 1
          && captionBlocks[idx + 1].segIndex === selectedBlock.segIndex
      })()
    : false

  const zoomLabel = zoom > 1.05 ? `${zoom.toFixed(zoom < 5 ? 1 : 0)}×` : null

  return (
    <div className="px-4 pb-3 select-none">
      <div className="flex items-center justify-between mb-1 leading-none">
        <p className="text-text-muted text-[10px] uppercase tracking-wide">
          Legenda — tempo editado
          {selectedBlock && (
            <button
              onClick={() => setSelectedId(null)}
              className="ml-2 text-text-muted hover:text-text-secondary normal-case tracking-normal"
            >
              ✕ fechar
            </button>
          )}
        </p>
        {/* controles de zoom */}
        <div className="flex items-center gap-0.5">
          {zoomLabel && (
            <span className="text-[10px] text-text-muted mr-1 tabular-nums">{zoomLabel}</span>
          )}
          <button
            onClick={() => applyZoom(Math.max(1, zoom / ZOOM_FACTOR))}
            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none"
            title="Zoom out"
          >−</button>
          <button
            onClick={() => applyZoom(Math.min(MAX_ZOOM, zoom * ZOOM_FACTOR))}
            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-secondary transition-colors text-[13px] leading-none"
            title="Zoom in"
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

      {/* faixa principal */}
      <div
        ref={containerRef}
        onClick={handleTrackClick}
        className="relative h-7 bg-bg-secondary rounded-sm overflow-hidden cursor-pointer"
      >
        {captionBlocks.map((block) =>
          isBlockCut(block)
            ? null
            : mapBlockToEdited(block, keeps).map((seg, j) => {
                const left  = toPct(seg.start)
                const width = visibleDur > 0 ? ((seg.end - seg.start) / visibleDur) * 100 : 0
                if (width < 0.05) return null
                return (
                  <div
                    key={`${block.id}-${j}`}
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
                      <span style={{
                        fontSize: 9, color: '#F2F3F5',
                        whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis', lineHeight: 1,
                        pointerEvents: 'none',
                      }}>
                        {block.text}
                      </span>
                    )}
                  </div>
                )
              }),
        )}

        {/* playhead */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-10"
          style={{ left: '0%' }}
        />
      </div>

      {/* marcadores de tempo */}
      <div className="flex justify-between text-[10px] text-text-muted mt-0.5 tabular-nums">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmt(clampedOffset + visibleDur * f)}</span>
        ))}
      </div>

      {/* painel do bloco selecionado */}
      {selectedBlock && (
        <div className="mt-2 p-3 bg-bg-secondary rounded-md border border-text-muted/15 text-[12px]">

          {/* texto do bloco */}
          <p className="text-text-muted text-[10px] uppercase tracking-wide mb-2">
            Bloco selecionado · {fmt(selectedBlock.start)} → {fmt(selectedBlock.end)}
          </p>

          {/* divisão por palavras + remoção individual */}
          {(() => {
            const words = selectedBlock.text.trim().split(/\s+/)
            const removed = new Set(selectedBlock.removedWords ?? [])
            const removedCount = removed.size
            return (
              <div className="mb-3">
                <div className="flex flex-wrap items-center gap-0">
                  {words.map((word, wi) => {
                    const isRemoved = removed.has(wi)
                    return (
                      <span key={wi} className="flex items-center">
                        {/* chip da palavra: clique remove/restaura */}
                        <button
                          onClick={() => toggleCaptionBlockWord(selectedBlock.id, wi)}
                          title={isRemoved ? `Restaurar "${word}"` : `Remover "${word}"`}
                          className={[
                            'px-1.5 py-0.5 rounded text-[12px] transition-all duration-150 select-none',
                            isRemoved
                              ? 'line-through opacity-40 bg-cut/20 text-text-muted hover:opacity-60'
                              : 'bg-bg text-text-primary hover:bg-cut/20 hover:text-cut',
                          ].join(' ')}
                        >
                          {word}
                        </button>
                        {/* divisor de split — só entre palavras não removidas consecutivas */}
                        {wi < words.length - 1 && (
                          <button
                            onClick={() => handleSplit(wi + 1)}
                            className="w-4 h-5 flex items-center justify-center text-text-muted/40 hover:text-accent hover:bg-accent/10 rounded transition-colors text-[10px]"
                            title={`Dividir aqui (após "${word}")`}
                          >
                            ┆
                          </button>
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

          {/* controles de estilo por bloco */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            {/* efeito */}
            <span className="flex items-center gap-1.5 text-text-secondary">
              Efeito:
              <select
                value={selectedBlock.effect ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { effect: e.target.value || undefined })}
                className="bg-bg text-text-primary rounded-sm px-2 py-0.5 text-[11px] border border-text-muted/20"
              >
                <option value="">— global —</option>
                {EFFECT_OPTIONS.map((ef) => (
                  <option key={ef} value={ef}>{ef}</option>
                ))}
              </select>
            </span>

            {/* fonte */}
            <span className="flex items-center gap-1.5 text-text-secondary">
              Fonte:
              <select
                value={selectedBlock.font ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { font: e.target.value || undefined })}
                className="bg-bg text-text-primary rounded-sm px-2 py-0.5 text-[11px] border border-text-muted/20"
              >
                <option value="">— global —</option>
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
            </span>

            {/* merge */}
            {canMerge && (
              <button
                onClick={handleMerge}
                className="px-2.5 py-0.5 bg-bg text-text-secondary border border-text-muted/20 rounded-sm text-[11px] hover:text-text-primary hover:border-text-muted/40 transition-colors"
              >
                Unir com próximo →
              </button>
            )}
          </div>

          {/* tamanho e largura por bloco */}
          <div className="mt-2.5 flex flex-col gap-2 text-[11px] text-text-secondary">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0">Fonte (px)</span>
              <input
                type="range"
                min={10}
                max={48}
                step={1}
                value={selectedBlock.fontSize ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { fontSize: e.target.value ? Number(e.target.value) : undefined })}
                className="flex-1 accent-accent"
              />
              <span className="tabular-nums text-text-muted w-10 text-right">
                {selectedBlock.fontSize != null ? `${selectedBlock.fontSize}px` : 'global'}
              </span>
              {selectedBlock.fontSize != null && (
                <button
                  onClick={() => setCaptionBlockStyle(selectedBlock.id, { fontSize: undefined })}
                  className="text-text-muted hover:text-text-secondary text-[10px]"
                  title="Usar valor global"
                >✕</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0">Largura máx.</span>
              <input
                type="range"
                min={30}
                max={100}
                step={1}
                value={selectedBlock.maxWidth ?? ''}
                onChange={(e) => setCaptionBlockStyle(selectedBlock.id, { maxWidth: e.target.value ? Number(e.target.value) : undefined })}
                className="flex-1 accent-accent"
              />
              <span className="tabular-nums text-text-muted w-10 text-right">
                {selectedBlock.maxWidth != null ? `${selectedBlock.maxWidth}%` : 'global'}
              </span>
              {selectedBlock.maxWidth != null && (
                <button
                  onClick={() => setCaptionBlockStyle(selectedBlock.id, { maxWidth: undefined })}
                  className="text-text-muted hover:text-text-secondary text-[10px]"
                  title="Usar valor global"
                >✕</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
